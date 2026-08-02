/**
 * Bridge endpoint validation.
 *
 * The bridge is exposed only via Tailscale Serve in front of a loopback
 * listener. This module is the single chokepoint that accepts or rejects
 * candidate endpoints; every other code path (pairing, doctor, install)
 * consumes a {@link BridgeEndpoint} produced by {@link validateBridgeEndpoint}.
 *
 * Acceptance rules:
 *
 *   - `https://` scheme only; `http://` is refused unconditionally.
 *   - Hostname MUST end in `.ts.net` and MUST NOT be a wildcard.
 *   - The hostname MUST NOT be loopback (127.0.0.1, ::1, localhost) or
 *     RFC1918 / link-local / multicast. Those addresses are never
 *     phone-reachable through Tailscale MagicDNS.
 *   - The endpoint MUST NOT contain a `funnel` token (Funnel would expose
 *     the bridge to the public internet).
 *   - The endpoint MUST NOT carry credentials, query tokens, fragments, or
 *     attachment identifiers — pairing only ever carries the public origin.
 *
 * The validator is pure (no I/O) so the install/doctor flows can run it
 * against synthetic values without spawning subprocesses.
 */

/** Reason a candidate endpoint was refused. */
export type EndpointRejectionCode =
  | "scheme"
  | "host_empty"
  | "host_wildcard"
  | "host_loopback"
  | "host_lan"
  | "host_link_local"
  | "host_multicast"
  | "host_unspecified"
  | "host_not_tailscale"
  | "host_ip_literal"
  | "host_unsafe_characters"
  | "funnel"
  | "credentials"
  | "query"
  | "fragment"
  | "port"
  | "path"
  | "syntax";

/** Parsed bridge endpoint suitable for passcode pairing and WebSocket derivation. */
export interface BridgeEndpoint {
  readonly scheme: "https";
  /** Lowercase hostname ending in `.ts.net`. Never a wildcard or IP literal. */
  readonly host: string;
  /** Effective TCP port; always 443 unless the origin included an explicit port. */
  readonly port: number;
  /** Normalized path component; defaults to `/v1/ws` for pairing. */
  readonly path: string;
  /** Canonical HTTPS origin (`https://host[:port]`). */
  readonly origin: string;
  /** Canonical WebSocket URL derived from the origin (`wss://host[:port]/v1/ws`). */
  readonly wsUrl: string;
}

/** Result of classifying a candidate endpoint. */
export type EndpointClassification =
  | { readonly kind: "accept"; readonly endpoint: BridgeEndpoint }
  | { readonly kind: "reject"; readonly code: EndpointRejectionCode; readonly reason: string };

/** Thrown when {@link validateBridgeEndpoint} rejects a value. */
export class EndpointGuardError extends Error {
  override readonly name: string = "EndpointGuardError";
  constructor(readonly code: EndpointRejectionCode, message: string) {
    super(message);
  }
}

/** Options accepted by {@link validateBridgeEndpoint}. */
export interface ValidateEndpointOptions {
  /**
   * Default path to apply when the candidate does not specify one.
   * Defaults to `/v1/ws`. The path is normalised to a leading `/`.
   */
  readonly defaultPath?: string;
}

/**
 * Validates and parses a candidate endpoint. Throws {@link EndpointGuardError}
 * on rejection; returns a typed {@link BridgeEndpoint} on acceptance.
 */
export function validateBridgeEndpoint(
  value: string,
  options: ValidateEndpointOptions = {},
): BridgeEndpoint {
  const classification = classifyEndpoint(value, options);
  if (classification.kind === "reject") {
    throw new EndpointGuardError(classification.code, classification.reason);
  }
  return classification.endpoint;
}

/**
 * Returns the typed classification of the candidate. Use this when the
 * caller wants to surface a structured rejection reason instead of throwing.
 */
export function classifyEndpoint(
  value: string,
  options: ValidateEndpointOptions = {},
): EndpointClassification {
  if (typeof value !== "string") {
    return reject("syntax", "endpoint must be a string");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return reject("syntax", "endpoint must not be empty");
  }
  if (trimmed.length > 2048) {
    return reject("syntax", `endpoint length ${trimmed.length} exceeds 2048`);
  }
  if (trimmed.includes("@")) {
    return reject("credentials", "endpoint must not embed credentials");
  }
  if (trimmed.includes("#")) {
    return reject("fragment", "endpoint must not contain a fragment");
  }

  // Split off query before URL parsing so we can reject it explicitly. The
  // bridge origin must not carry tokens in the query string.
  const queryIndex = trimmed.indexOf("?");
  if (queryIndex >= 0) {
    const query = trimmed.slice(queryIndex + 1);
    if (query.length > 0) {
      return reject("query", "endpoint must not contain a query string");
    }
  }
  const noQuery = queryIndex >= 0 ? trimmed.slice(0, queryIndex) : trimmed;

  let parsed: URL;
  try {
    parsed = new URL(noQuery);
  } catch {
    return reject("syntax", `endpoint is not a parseable URL: ${trimmed}`);
  }

  if (parsed.protocol !== "https:") {
    return reject("scheme", `endpoint scheme must be https (got ${JSON.stringify(parsed.protocol)})`);
  }

  // `parsed.username`/`parsed.password` are populated for userinfo URIs;
  // we already rejected `@` above but defend in depth.
  if (parsed.username !== "" || parsed.password !== "") {
    return reject("credentials", "endpoint must not embed credentials");
  }

  const host = parsed.hostname.toLowerCase();
  if (host.length === 0) {
    return reject("host_empty", "endpoint must include a hostname");
  }
  if (host.includes("*")) {
    return reject("host_wildcard", `endpoint host must not contain a wildcard (got ${JSON.stringify(host)})`);
  }
  if (!/^[a-z0-9.\-]+$/.test(host)) {
    return reject("host_unsafe_characters", `endpoint host contains disallowed characters: ${JSON.stringify(host)}`);
  }

  // Reject literal IPv4/IPv6 hosts — pairing must be a phone-reachable
  // MagicDNS hostname. Numeric hosts cannot be served by Tailscale Serve.
  if (isIpLiteral(host)) {
    return reject("host_ip_literal", `endpoint host must be a MagicDNS name, not an IP literal (got ${JSON.stringify(host)})`);
  }

  if (LOOPBACK_HOSTS.has(host)) {
    return reject("host_loopback", `endpoint host is loopback (got ${JSON.stringify(host)})`);
  }
  if (isRfc1918(host) || isLinkLocal(host)) {
    return reject("host_lan", `endpoint host is private/LAN and not MagicDNS-reachable (got ${JSON.stringify(host)})`);
  }
  if (isMulticast(host)) {
    return reject("host_multicast", `endpoint host is multicast (got ${JSON.stringify(host)})`);
  }
  if (isUnspecified(host)) {
    return reject("host_unspecified", `endpoint host is the unspecified address (got ${JSON.stringify(host)})`);
  }

  // Funnel explicitly forbidden — the substring check is intentionally
  // case-insensitive so an adversarial `Funnel` token in a subdomain cannot
  // smuggle past the host-name regex.
  if (/\bfunnel\b/i.test(host)) {
    return reject("funnel", `endpoint host contains 'funnel' (got ${JSON.stringify(host)})`);
  }

  if (!host.endsWith(".ts.net")) {
    return reject("host_not_tailscale", `endpoint host must end in .ts.net (got ${JSON.stringify(host)})`);
  }

  // Reject ".ts.net" by itself — MagicDNS always yields a node-name prefix.
  if (host === ".ts.net" || host === "ts.net") {
    return reject("host_not_tailscale", `endpoint host must include a MagicDNS node prefix (got ${JSON.stringify(host)})`);
  }

  let port = 443;
  if (parsed.port !== "") {
    const parsedPort = Number.parseInt(parsed.port, 10);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      return reject("port", `endpoint port is invalid: ${JSON.stringify(parsed.port)}`);
    }
    port = parsedPort;
  }

  const defaultPath = options.defaultPath ?? "/v1/ws";
  const path = normalizePath(parsed.pathname, defaultPath);
  if (path.includes("..")) {
    return reject("path", `endpoint path contains traversal: ${JSON.stringify(path)}`);
  }

  const origin = port === 443 ? `https://${host}` : `https://${host}:${port}`;
  return {
    kind: "accept",
    endpoint: {
      scheme: "https",
      host,
      port,
      path,
      origin,
      wsUrl: `${origin.replace(/^https/, "wss")}${path}`,
    },
  };
}

function reject(code: EndpointRejectionCode, reason: string): EndpointClassification {
  return { kind: "reject", code, reason };
}

function normalizePath(value: string, defaultPath: string): string {
  if (value.length === 0 || value === "/") return defaultPath;
  if (!value.startsWith("/")) return `/${value}`;
  return value;
}

/** Hosts that always refer to the local machine. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0:0:0:0:0:0:0:1",
  "0:0:0:0:0:0:0:0",
  "ip6-localhost",
  "ip6-loopback",
]);

/** Returns true for any IPv4 or IPv6 literal. */
function isIpLiteral(host: string): boolean {
  if (isIpv4Literal(host)) return true;
  if (host.includes(":")) return true;
  return false;
}

function isIpv4Literal(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return false;
    const n = Number.parseInt(part, 10);
    if (n < 0 || n > 255) return false;
  }
  return true;
}

function isRfc1918(host: string): boolean {
  if (!isIpv4Literal(host)) return false;
  const parts = host.split(".").map((p) => Number.parseInt(p, 10));
  const [a, b] = parts as [number, number, ...number[]];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isLinkLocal(host: string): boolean {
  if (!isIpv4Literal(host)) return false;
  const parts = host.split(".").map((p) => Number.parseInt(p, 10));
  const [a, b] = parts as [number, number, ...number[]];
  if (a === 169 && b === 254) return true;
  if (host === "fe80::" || host.startsWith("fe80:")) return true;
  return false;
}

function isMulticast(host: string): boolean {
  if (!isIpv4Literal(host)) return false;
  const first = Number.parseInt(host.split(".")[0]!, 10);
  if (first >= 224 && first <= 239) return true;
  if (host.startsWith("ff")) return true;
  return false;
}

function isUnspecified(host: string): boolean {
  if (host === "0.0.0.0") return true;
  if (host === "::") return true;
  return false;
}

/**
 * Throws if `hostId` is not a RFC 4122 canonical UUID (lowercase,
 * hyphen-separated, 8-4-4-4-12 hex digits). The pairing payload kind
 * requires a stable opaque ID for change detection.
 */
export function assertValidHostId(hostId: unknown): asserts hostId is string {
  if (typeof hostId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(hostId)) {
    throw new EndpointGuardError("syntax", `hostId must be a lowercase RFC 4122 UUID (got ${JSON.stringify(hostId)})`);
  }
}
