/**
 * Tailscale Serve route management.
 *
 * The bridge uses Tailscale Serve to expose its loopback listener through a
 * MagicDNS HTTPS origin. The route table is shared with every other Tailscale
 * service running on the host; the bridge MUST NOT remove routes it does not
 * own, and MUST NOT enable Funnel for any port.
 *
 * All mutation flows through an injected {@link ServeDriver} so the install
 * and update flows can run against an in-memory implementation in tests. The
 * driver models the JSON shape `tailscale serve` exposes via its API/CLI:
 * each route carries a `source` (the listener port), an optional `accept`
 * filter, and a list of `handlers` (forward, https, or web).
 *
 * The owned route is identified by a stable `routeId` string that the
 * installer writes into the route's annotation. The bridge recognises its
 * own route via that annotation; any route lacking the annotation is treated
 * as unrelated and is preserved verbatim.
 */

/** Tailscale route handler kinds recognised by this module. */
export type ServeHandlerKind = "forward" | "https" | "web" | "funnel";

export interface ServeForwardHandler {
  readonly kind: "forward";
  /** Loopback address the upstream service binds to (e.g. `http://127.0.0.1:8788`). */
  readonly address: string;
}

export interface ServeHttpsHandler {
  readonly kind: "https";
  readonly address: string;
}

export interface ServeWebHandler {
  readonly kind: "web";
  readonly path: string;
  readonly address: string;
}

export interface ServeFunnelHandler {
  readonly kind: "funnel";
  readonly path: string;
  readonly address: string;
}

export type ServeHandler =
  | ServeForwardHandler
  | ServeHttpsHandler
  | ServeWebHandler
  | ServeFunnelHandler;

/** Optional allow-list of clients permitted to reach the route. */
export interface ServeRouteAccept {
  readonly name: string;
  readonly from: string;
  readonly patterns?: readonly string[];
}

/** Single Tailscale Serve route entry. */
export interface ServeRoute {
  readonly source: { readonly tcp?: { readonly port: number } };
  readonly accept?: readonly ServeRouteAccept[];
  readonly handlers: readonly ServeHandler[];
  /** Owner annotation. Routes without an annotation are treated as unrelated. */
  readonly annotations?: Readonly<Record<string, string>>;
}

/** Owning identifier for the bridge's route (also used as the annotation key). */
export const BRIDGE_ROUTE_ANNOTATION_KEY = "pi-mob.bridge/owner";

/** Stable owner id; every bridge-owned route carries this exact value. */
export const BRIDGE_ROUTE_OWNER = "pi-mob-bridge";

/**
 * Driver injected into every Tailscale Serve operation. Production code uses
 * a `tailscale serve` JSON CLI bridge; tests substitute a deterministic
 * in-memory implementation.
 */
export interface ServeDriver {
  /** Returns the current route table in Tailscale's JSON shape. */
  listRoutes(): Promise<readonly ServeRoute[]>;
  /** Replaces the entire route table. Implementations MUST persist atomically. */
  setRoutes(routes: readonly ServeRoute[]): Promise<void>;
}

/** Thrown when a Serve route operation fails structural validation. */
export class ServeRouteError extends Error {
  override readonly name: string = "ServeRouteError";
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export interface ApplyServeRouteArgs {
  readonly driver: ServeDriver;
  /** Loopback port the bridge daemon listens on. */
  readonly tcpPort: number;
  /**
   * Optional web handler; when supplied, the bridge registers both a TCP
   * forward (for the WebSocket) and a web handler (for HTTPS health/attachments).
   */
  readonly webAddress?: string;
  /** Optional allow-list of clients; defaults to no allow-list (still tailnet-only). */
  readonly accept?: readonly ServeRouteAccept[];
  /**
   * Stable identifier under the `pi-mob.bridge/owner` annotation. Defaults
   * to {@link BRIDGE_ROUTE_OWNER}; tests override to detect cross-test leaks.
   */
  readonly ownerId?: string;
}

export interface ServeApplyResult {
  /** The route table after the operation. */
  readonly routes: readonly ServeRoute[];
  /** The route owned by the bridge, or null if no bridge route is now configured. */
  readonly ownedRoute: ServeRoute | null;
  /** Routes that existed before the operation but were not owned by the bridge. */
  readonly preservedRoutes: readonly ServeRoute[];
  /** True when the operation altered the route table. */
  readonly changed: boolean;
}

export interface RemoveOwnedServeRouteArgs {
  readonly driver: ServeDriver;
  /** Optional owner override; defaults to {@link BRIDGE_ROUTE_OWNER}. */
  readonly ownerId?: string;
}

export interface ServeRemoveResult {
  readonly routes: readonly ServeRoute[];
  readonly removed: boolean;
  readonly preservedRoutes: readonly ServeRoute[];
}

/**
 * Ensures exactly one bridge-owned route is configured for `tcpPort`. Any
 * other routes are preserved unchanged. If the bridge already owns a route
 * on the same port, it is left alone; if it owns a route on a different
 * port, the stale route is removed and replaced with the requested one.
 *
 * Funnel handlers are forbidden in this entry point: the bridge must never
 * add a Funnel handler even if the caller passes `webAddress`, because the
 * web handler is an HTTPS handler, not a Funnel handler.
 */
export async function applyServeRoute(args: ApplyServeRouteArgs): Promise<ServeApplyResult> {
  validateApplyArgs(args);
  const owner = args.ownerId ?? BRIDGE_ROUTE_OWNER;
  const existing = await args.driver.listRoutes();
  const owned = findOwnedRoutes(existing, owner);
  const preserved = existing.filter((route) => !isOwnedBy(route, owner));

  if (preserved.some((route) => route.source.tcp?.port === args.tcpPort)) {
    throw new ServeRouteError(
      "route_port_in_use",
      `refusing to replace an unrelated Serve route on port ${args.tcpPort}`,
    );
  }

  if (owned.length > 1) {
    throw new ServeRouteError(
      "duplicate_owned_route",
      `expected at most one bridge-owned route, found ${owned.length}`,
    );
  }

  const handlers: ServeHandler[] = [
    {
      kind: "forward",
      address: `http://127.0.0.1:${args.tcpPort}`,
    },
  ];
  if (args.webAddress !== undefined) {
    handlers.push({
      kind: "https",
      address: args.webAddress,
    });
  }
  const annotations = { [BRIDGE_ROUTE_ANNOTATION_KEY]: owner };
  const routeAccept = args.accept !== undefined && args.accept.length > 0 ? args.accept : undefined;
  const desiredRoute: ServeRoute = {
    source: { tcp: { port: args.tcpPort } },
    ...(routeAccept !== undefined ? { accept: routeAccept } : {}),
    handlers,
    annotations,
  };

  const ownedPortMatches = owned.length === 1 && owned[0]!.source.tcp?.port === args.tcpPort;
  const changed = !(ownedPortMatches && routeEqual(owned[0]!, desiredRoute));
  const finalRoutes = [...preserved, desiredRoute];
  if (changed) {
    await args.driver.setRoutes(finalRoutes);
  }
  return {
    routes: changed ? finalRoutes : existing,
    ownedRoute: desiredRoute,
    preservedRoutes: preserved,
    changed,
  };
}

/**
 * Removes only routes owned by the bridge. Routes belonging to other
 * services (annotations absent or carrying a different owner id) are
 * preserved verbatim. The driver is only mutated when a removal actually
 * happens.
 */
export async function removeOwnedServeRoute(args: RemoveOwnedServeRouteArgs): Promise<ServeRemoveResult> {
  const owner = args.ownerId ?? BRIDGE_ROUTE_OWNER;
  const existing = await args.driver.listRoutes();
  const preserved = existing.filter((route) => !isOwnedBy(route, owner));
  const removed = existing.length !== preserved.length;
  if (removed) {
    await args.driver.setRoutes(preserved);
  }
  return {
    routes: removed ? preserved : existing,
    removed,
    preservedRoutes: preserved,
  };
}

/**
 * Inspects the route table and returns a structured snapshot. Useful for
 * doctor reports and for the install verifier. The result identifies the
 * bridge-owned route and any Funnel exposures regardless of ownership — the
 * doctor probe uses the latter to refuse a degraded readiness verdict.
 */
export interface ServeInspection {
  readonly routes: readonly ServeRoute[];
  readonly ownedRoute: ServeRoute | null;
  readonly funnelRoutes: readonly ServeRoute[];
  readonly preservedRoutes: readonly ServeRoute[];
  /** Stable string fingerprint of the route table (sorted, annotated). */
  readonly fingerprint: string;
}

export async function inspectServeRoutes(args: {
  readonly driver: ServeDriver;
  readonly ownerId?: string;
}): Promise<ServeInspection> {
  const owner = args.ownerId ?? BRIDGE_ROUTE_OWNER;
  const routes = await args.driver.listRoutes();
  const owned = routes.find((route) => isOwnedBy(route, owner)) ?? null;
  const funnelRoutes = routes.filter((route) => route.handlers.some((handler) => handler.kind === "funnel"));
  const preservedRoutes = routes.filter((route) => !isOwnedBy(route, owner));
  return {
    routes,
    ownedRoute: owned,
    funnelRoutes,
    preservedRoutes,
    fingerprint: fingerprintRoutes(routes),
  };
}

function validateApplyArgs(args: ApplyServeRouteArgs): void {
  if (!Number.isInteger(args.tcpPort) || args.tcpPort < 1 || args.tcpPort > 65535) {
    throw new ServeRouteError("port", `tcpPort must be an integer in 1..65535 (got ${args.tcpPort})`);
  }
  if (args.webAddress !== undefined) {
    if (!/^https?:\/\/127\.0\.0\.1:\d+$/.test(args.webAddress)) {
      throw new ServeRouteError(
        "web_address",
        `webAddress must reference loopback 127.0.0.1 (got ${JSON.stringify(args.webAddress)})`,
      );
    }
  }
  if (args.accept !== undefined) {
    for (const entry of args.accept) {
      if (typeof entry.name !== "string" || entry.name.length === 0) {
        throw new ServeRouteError("accept", "accept[].name must be a non-empty string");
      }
      if (typeof entry.from !== "string" || entry.from.length === 0) {
        throw new ServeRouteError("accept", "accept[].from must be a non-empty string");
      }
    }
  }
}

function findOwnedRoutes(routes: readonly ServeRoute[], owner: string): readonly ServeRoute[] {
  return routes.filter((route) => isOwnedBy(route, owner));
}

function isOwnedBy(route: ServeRoute, owner: string): boolean {
  return route.annotations?.[BRIDGE_ROUTE_ANNOTATION_KEY] === owner;
}

function routeEqual(a: ServeRoute, b: ServeRoute): boolean {
  if (a.source.tcp?.port !== b.source.tcp?.port) return false;
  if (a.handlers.length !== b.handlers.length) return false;
  for (let i = 0; i < a.handlers.length; i += 1) {
    const ha = a.handlers[i]!;
    const hb = b.handlers[i]!;
    if (ha.kind !== hb.kind || ha.address !== hb.address) return false;
  }
  const acceptA = JSON.stringify(a.accept ?? []);
  const acceptB = JSON.stringify(b.accept ?? []);
  return acceptA === acceptB;
}

function fingerprintRoutes(routes: readonly ServeRoute[]): string {
  const normalized = routes
    .map((route) => ({
      port: route.source.tcp?.port ?? null,
      annotations: route.annotations ?? {},
      handlers: route.handlers.map((handler) => ({ kind: handler.kind, address: handler.address })),
    }))
    .sort((a, b) => (a.port ?? 0) - (b.port ?? 0));
  return JSON.stringify(normalized);
}
