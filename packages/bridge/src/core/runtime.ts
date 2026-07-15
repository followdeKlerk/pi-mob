import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { relative } from "node:path";
import { COMMAND_METADATA, semanticCommandSha256 } from "@pi-mob/protocol-schema";
import { ControllerLeaseService, DurableCommandService, StreamService, type AdapterPort } from "./domain";
import type { BridgeRuntimePort, ConnectionContext, SubscriptionMessage, SubscriptionResult } from "./server";
import { BridgeStore, StoreError, type LeaseMutation } from "./store";
import {
  DurableTrustPolicyStore,
  HostPolicyService,
  type BoundedSearchFn,
  type HostPolicyMode,
  type WorkspaceRootId,
  type TrustState,
  deriveRootId,
  WorkspacePolicyError,
} from "./workspace-policy";

export class RuntimeProtocolError extends Error { override readonly name = "RuntimeProtocolError"; constructor(readonly code: string, message: string) { super(message); } }
const SUMMARY_EVENT_TYPES = new Set(["session.state", "session.metadata", "controller.state", "turn.started", "turn.waiting_for_input", "turn.settled", "turn.aborted", "turn.failed", "turn.indeterminate", "queue.snapshot", "command.state", "error.event"]);
const SUMMARY_STATE_KEYS = new Set(["runtimeState", "attentionState", "policyMode", "modelSummary", "queueCount", "lastActivityAt", "controllerSummary"]);
const SESSION_GATING_COMMAND_TYPES = new Set(["session.create", "session.activate", "turn.start", "prompt.submit"]) as ReadonlySet<string>;
/** M8 commands that the runtime recognises as lease-free because they
 * happen at host-bootstrap time, before any controller can exist. */
const M8_LEASE_FREE_COMMANDS = new Set(["workspace.trust.approve"]) as ReadonlySet<string>;
const HISTORY_TOKEN_KIND = "session.history.page";
interface HistoryPageToken {
  readonly version: 1;
  readonly kind: typeof HISTORY_TOKEN_KIND;
  readonly hostId: string;
  readonly sessionId: string;
  readonly pageSize: number;
  readonly beforeCursor: string;
}
const SESSION_LIST_TOKEN_KIND = "session.list";
interface SessionListToken {
  readonly version: 1;
  readonly kind: typeof SESSION_LIST_TOKEN_KIND;
  readonly hostId: string;
  readonly hostGeneration: string;
  readonly sort: string;
  readonly filter: string;
  readonly query: string;
  readonly parentSessionId: string;
  readonly pageSize: number;
  readonly beforeCursor: string;
}

function canonicalDecimal(value: unknown): value is string { return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value); }

function mobileTrustState(status: TrustState["status"]): "approved" | "unapproved" | "fingerprint_changed" {
  if (status === "trusted") return "approved";
  if (status === "changed") return "fingerprint_changed";
  return "unapproved";
}

/**
 * Optional M8 policy hook the runtime consumes. The runtime never
 * assumes one is installed; the existing one-session adapter therefore
 * keeps working untouched by leaving `policy` undefined.
 *
 * The runtime *only* reads `mode`, `evaluate`, `setMode`, `search`,
 * `resolveTrust`, and `currentSessionPolicyMode`. It does NOT mutate the
 * trust store directly — every approval flows through
 * {@link RuntimePolicyHandler.approve}.
 */
export interface RuntimePolicyHandler {
  readonly trustStore: DurableTrustPolicyStore;
  readonly hostPolicy: HostPolicyService;
  readonly search: BoundedSearchFn;
  /** Returns the trust state for a workspace (root path is absolute). */
  resolveTrust(rootCanonical: string, workspaceId?: WorkspaceRootId): TrustState;
  /** Returns the seed used by the daemon (label + displayed name). */
  rootSeed(): { id: WorkspaceRootId; canonicalPath: string; label: string };
  /** Records a new approval for the workspace. Idempotent for the same fingerprint. */
  approve(input: { workspaceId?: WorkspaceRootId; rootCanonical?: string; label?: string; fingerprint: string; approvedBy: string; now?: number }): { workspaceId: WorkspaceRootId; fingerprint: string; approvedAt: number; policyVersion: string };
}

export interface DurableRuntimeOptions {
  readonly store: BridgeStore;
  readonly adapter: AdapterPort;
  readonly bridgeVersion: string;
  readonly piVersion: string;
  readonly hostDisplayName: string;
  /** M8 — install the policy handler to enable trust + host policy enforcement. */
  readonly policy?: RuntimePolicyHandler;
  /** M8 — override the per-session default policy mode (used by one-session compat). */
  readonly defaultSessionPolicyMode?: HostPolicyMode;
}

export class DurableBridgeRuntime implements BridgeRuntimePort {
  readonly bridgeVersion: string;
  readonly piVersion: string;
  readonly commands: DurableCommandService;
  readonly streams: StreamService;
  readonly leases: ControllerLeaseService;
  private readonly hostDisplayName: string;
  private readonly policy: RuntimePolicyHandler | null;
  private readonly defaultSessionPolicyMode: HostPolicyMode;
  private readonly historyTokenSecret = randomBytes(32);
  private readyState = false;
  private readonly searchCandidates = new Map<WorkspaceRootId, { canonicalPath: string; label: string }>();
  constructor(readonly options: DurableRuntimeOptions) {
    this.bridgeVersion = options.bridgeVersion; this.piVersion = options.piVersion; this.hostDisplayName = options.hostDisplayName;
    this.policy = options.policy ?? null;
    this.defaultSessionPolicyMode = options.defaultSessionPolicyMode ?? "full";
    this.commands = new DurableCommandService(options.store, options.adapter); this.streams = new StreamService(options.store); this.leases = new ControllerLeaseService(options.store);
    const identity = options.store.identity(); options.store.ensureStream(`host:${identity.hostId}`, "host");
  }
  async start(): Promise<{ resumed: number; indeterminate: number }> {
    const recovered = await this.commands.recover(); this.readyState = true; return recovered;
  }
  onEvent(listener: Parameters<BridgeStore["onEvent"]>[0]): () => void { return this.options.store.onEvent(listener); }
  identity(): { hostId: string; hostGeneration: string; hostDisplayName: string } { return { ...this.options.store.identity(), hostDisplayName: this.hostDisplayName }; }
  ready(): { ready: boolean; reason?: string } {
    if (!this.readyState) return { ready: false, reason: "startup recovery incomplete" };
    const health = this.options.store.health(); return health.ready ? { ready: true } : { ready: false, reason: `durable store ${health.reason ?? "unavailable"}` };
  }
  setReadyForTest(ready: boolean): void { this.readyState = ready; }

  subscribe(_connection: ConnectionContext, payload: Record<string, unknown>): SubscriptionResult {
    const requested = Array.isArray(payload.streams) ? payload.streams.map((value) => value as Record<string, unknown>) : [];
    const streams = requested.map((value) => ({ streamId: String(value.streamId ?? ""), detail: value.detail === "summary" ? "summary" as const : "full" as const, afterCursor: typeof value.afterCursor === "string" ? value.afterCursor : undefined }));
    const hostStreamId = `host:${this.identity().hostId}`; this.streams.validateSubscriptions(hostStreamId, streams);
    const accepted: Record<string, unknown>[] = []; const messages: SubscriptionMessage[] = [];
    for (const request of streams) {
      let sync;
      try { sync = this.streams.sync(request.streamId, request.afterCursor); }
      catch (error) {
        const code = error instanceof Error && error.name === "CursorInvalidError" ? "cursor_invalid" : "stream_not_found";
        messages.push({ type: "error", payload: { code, message: "Stream cannot be synchronized.", retryable: false, details: { streamId: request.streamId } } });
        continue;
      }
      accepted.push({ streamId: request.streamId, mode: sync.mode });
      if (sync.mode === "current") {
        if (request.streamId.startsWith("session:")) {
          const state = this.options.store.sessionState(request.streamId.slice("session:".length)) ?? {};
          const visible = request.detail === "summary" ? Object.fromEntries(Object.entries(state).filter(([key]) => SUMMARY_STATE_KEYS.has(key))) : state;
          messages.push({ type: "session.state", payload: { sessionId: request.streamId.slice("session:".length), ...visible } });
        }
        else messages.push({ type: "host.state", payload: { ready: this.ready().ready } });
      }
      if (sync.mode === "snapshot_required") {
        const snapshotId = crypto.randomUUID().toLowerCase();
        messages.push({ type: "stream.snapshot.begin", payload: { snapshotId, streamId: request.streamId, baselineCursor: sync.baseline! } });
        const snapshotParts = request.detail === "summary" && request.streamId.startsWith("session:")
          ? [{ index: 0, json: JSON.stringify(Object.fromEntries(Object.entries(this.options.store.sessionState(request.streamId.slice("session:".length)) ?? {}).filter(([key]) => SUMMARY_STATE_KEYS.has(key)))) }]
          : sync.snapshotParts!;
        snapshotParts.forEach((part, index) => messages.push({ type: "stream.snapshot.part", payload: { snapshotId, part: index, items: [part] } }));
        messages.push({ type: "stream.snapshot.end", payload: { snapshotId, partCount: snapshotParts.length } });
      }
      for (const event of sync.events) if (request.detail === "full" || SUMMARY_EVENT_TYPES.has(event.type)) messages.push({ type: event.type, payload: event.payload, eventId: event.eventId, streamId: event.streamId, cursor: event.cursor });
      messages.push({ type: "stream.sync.complete", payload: { streamId: request.streamId, currentCursor: sync.currentCursor, mode: sync.mode } });
    }
    return { streams: accepted, messages };
  }

  control(connection: ConnectionContext, type: string, payload: Record<string, unknown>): Record<string, unknown> | void {
    if (type === "cursor.ack") { this.streams.ack(connection.installationId, payload.cursors as Record<string,string>); return; }
    if (type === "controller.renew") {
      const leaseId = String(payload.leaseId ?? ""); const existing = this.options.store.leaseById(leaseId); if (!existing) throw new RuntimeProtocolError("stale_controller", "lease not found");
      try { const lease = this.leases.renew(existing.scopeKey, leaseId, connection.connectionId); return { leaseId: lease.leaseId, expiresAt: lease.expiresAt }; }
      catch { throw new RuntimeProtocolError("stale_controller", "lease is stale"); }
    }
    if (type === "command.current") { const command = this.options.store.command(String(payload.commandId ?? "")); if (!command) throw new RuntimeProtocolError("command_not_found", "command not found"); return { commandId: command.commandId, state: command.state }; }
    if (type === "session.history.page") return this.sessionHistoryPage(payload);
    if (type === "session.list") return this.sessionList(payload);
    if (type === "model.list") {
      if (typeof this.options.adapter.listModels !== "function") throw new RuntimeProtocolError("unsupported_capability", "adapter does not expose configured models");
      return { items: this.options.adapter.listModels(typeof payload.sessionId === "string" ? payload.sessionId : undefined).items.map((item) => ({ ...item })) };
    }
    if (type === "workspace.list") {
      if (!this.policy) {
        // Backwards-compatible behaviour: fall back to the adapter's
        // own listing when no policy module is installed.
        if (typeof this.options.adapter.listWorkspaces !== "function") throw new RuntimeProtocolError("workspace_unavailable", "adapter does not expose a workspace listing");
        const listing = this.options.adapter.listWorkspaces();
        return { items: listing.items.map((item) => ({ ...item })) };
      }
      return { items: this.listWorkspaceItems() };
    }
    if (type === "workspace.search") {
      if (!this.policy) throw new RuntimeProtocolError("workspace_unavailable", "policy module is not installed");
      return this.searchWorkspaces(payload);
    }
    if (type === "workspace.trust.approve") {
      if (!this.policy) throw new RuntimeProtocolError("workspace_unavailable", "policy module is not installed");
      return this.approveWorkspace(payload);
    }
    if (type === "workspace.trust_state") {
      if (!this.policy) throw new RuntimeProtocolError("workspace_unavailable", "policy module is not installed");
      return this.currentTrustState();
    }
    if (type === "policy.summary") {
      if (!this.policy) throw new RuntimeProtocolError("workspace_unavailable", "policy module is not installed");
      const eff = this.policy.hostPolicy.effective();
      return { mode: eff.mode, policyVersion: eff.rules.policyVersion, fingerprint: eff.rules.fingerprint };
    }
    return {};
  }

  private sessionList(payload: Record<string, unknown>): Record<string, unknown> {
    const pageSize = payload.pageSize;
    if (!Number.isInteger(pageSize) || (pageSize as number) < 1 || (pageSize as number) > 100) {
      throw new RuntimeProtocolError("invalid_message", "pageSize must be an integer from 1 through 100");
    }
    const sort = typeof payload.sort === "string" ? payload.sort : "activity";
    const filterRaw = typeof payload.filter === "string" ? payload.filter : "all";
    const query = typeof payload.query === "string" ? payload.query : "";
    const parentSessionId = typeof payload.parentSessionId === "string" ? payload.parentSessionId : "";
    const identity = this.identity();
    const rawToken = payload.pageToken;
    let beforeCursor: string | null = null;
    if (rawToken !== null && rawToken !== undefined) {
      if (typeof rawToken !== "string") throw new RuntimeProtocolError("invalid_message", "page token must be a string or null");
      const decoded = this.decodeSessionListToken(rawToken);
      if (decoded.sort !== sort) throw new RuntimeProtocolError("invalid_message", "page token is not bound to this query");
      if (decoded.filter !== filterRaw) throw new RuntimeProtocolError("invalid_message", "page token is not bound to this query");
      if (decoded.query !== query) throw new RuntimeProtocolError("invalid_message", "page token is not bound to this query");
      if (decoded.parentSessionId !== parentSessionId) throw new RuntimeProtocolError("invalid_message", "page token is not bound to this tree parent");
      if (decoded.pageSize !== pageSize) throw new RuntimeProtocolError("invalid_message", "page token is not bound to this query");
      beforeCursor = decoded.beforeCursor;
    }
    let page;
    try {
      page = this.options.store.listSessionSummaries({
        filter: filterRaw,
        query: query || null,
        sort,
        pageSize: pageSize as number,
        beforeCursor,
        ...(parentSessionId ? { parentSessionId } : {}),
      });
    } catch (error) {
      if (error instanceof StoreError && error.code === "conflict") throw new RuntimeProtocolError("invalid_message", error.message);
      throw error;
    }
    return {
      items: page.items.map((item) => ({ ...item })),
      snapshotRevision: page.snapshotRevision,
      ...(page.nextBeforeCursor !== undefined
        ? { nextPageToken: this.encodeSessionListToken({
          version: 1,
          kind: SESSION_LIST_TOKEN_KIND,
          hostId: identity.hostId,
          hostGeneration: identity.hostGeneration,
          sort,
          filter: filterRaw,
          query,
          parentSessionId,
          pageSize: pageSize as number,
          beforeCursor: page.nextBeforeCursor,
        }) }
        : {}),
    };
  }

  private sessionHistoryPage(payload: Record<string, unknown>): Record<string, unknown> {
    const sessionId = String(payload.sessionId ?? "");
    const pageSize = payload.pageSize;
    if (!Number.isInteger(pageSize) || (pageSize as number) < 1 || (pageSize as number) > 100) {
      throw new RuntimeProtocolError("invalid_message", "pageSize must be an integer from 1 through 100");
    }
    if (!this.options.store.sessionExists(sessionId)) throw new RuntimeProtocolError("session_not_found", "session not found");
    const rawToken = payload.pageToken;
    let beforeCursor: string | undefined;
    if (rawToken !== null && rawToken !== undefined) {
      if (typeof rawToken !== "string") throw new RuntimeProtocolError("invalid_message", "page token must be a string or null");
      beforeCursor = this.decodeHistoryPageToken(rawToken, sessionId, pageSize as number).beforeCursor;
    }
    let page;
    try { page = this.options.store.pageSessionEvents(sessionId, pageSize as number, beforeCursor); }
    catch (error) {
      if (error instanceof StoreError && error.code === "not_found") throw new RuntimeProtocolError("session_not_found", "session not found");
      throw error;
    }
    return {
      items: page.items.map((event) => ({
        eventId: event.eventId,
        streamId: event.streamId,
        cursor: event.cursor,
        type: event.type,
        payload: event.payload,
        createdAt: event.createdAt,
      })),
      snapshotRevision: page.snapshotRevision,
      ...(page.nextBeforeCursor ? { nextPageToken: this.encodeHistoryPageToken({
        version: 1,
        kind: HISTORY_TOKEN_KIND,
        hostId: this.identity().hostId,
        sessionId,
        pageSize: pageSize as number,
        beforeCursor: page.nextBeforeCursor,
      }) } : {}),
    };
  }

  private encodeHistoryPageToken(value: HistoryPageToken): string {
    const body = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.historyTokenSecret).update(body, "utf8").digest("base64url");
    return `${body}.${signature}`;
  }

  private encodeSessionListToken(value: SessionListToken): string {
    const body = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.historyTokenSecret).update(body, "utf8").digest("base64url");
    return `${body}.${signature}`;
  }

  private decodeSessionListToken(token: string): SessionListToken {
    try {
      if (token.length === 0 || token.length > 4096) throw new Error("invalid token length");
      const parts = token.split(".");
      if (parts.length !== 2 || !parts[0] || !parts[1] || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error("invalid token shape");
      const expected = createHmac("sha256", this.historyTokenSecret).update(parts[0], "utf8").digest();
      const actual = Buffer.from(parts[1], "base64url");
      if (actual.toString("base64url") !== parts[1] || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("invalid token signature");
      const encodedBody = Buffer.from(parts[0], "base64url");
      if (encodedBody.toString("base64url") !== parts[0]) throw new Error("invalid token encoding");
      const parsed = JSON.parse(encodedBody.toString("utf8")) as Partial<SessionListToken>;
      if (parsed.version !== 1 || parsed.kind !== SESSION_LIST_TOKEN_KIND) throw new Error("token kind mismatch");
      const identity = this.identity();
      if (parsed.hostId !== identity.hostId || parsed.hostGeneration !== identity.hostGeneration) throw new Error("page token is not bound to the current host generation");
      if (typeof parsed.sort !== "string" || typeof parsed.filter !== "string" || typeof parsed.query !== "string" || typeof parsed.parentSessionId !== "string" || typeof parsed.pageSize !== "number" || typeof parsed.beforeCursor !== "string" || !canonicalDecimal(parsed.beforeCursor)) throw new Error("page token shape invalid");
      return parsed as SessionListToken;
    } catch {
      throw new RuntimeProtocolError("invalid_message", "page token is invalid or does not match the session list query");
    }
  }

  private decodeHistoryPageToken(token: string, sessionId: string, pageSize: number): HistoryPageToken {
    try {
      if (token.length === 0 || token.length > 4096) throw new Error("invalid token length");
      const parts = token.split(".");
      if (parts.length !== 2 || !parts[0] || !parts[1] || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error("invalid token shape");
      const expected = createHmac("sha256", this.historyTokenSecret).update(parts[0], "utf8").digest();
      const actual = Buffer.from(parts[1], "base64url");
      if (actual.toString("base64url") !== parts[1] || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("invalid token signature");
      const encodedBody = Buffer.from(parts[0], "base64url");
      if (encodedBody.toString("base64url") !== parts[0]) throw new Error("invalid token encoding");
      const parsed = JSON.parse(encodedBody.toString("utf8")) as Partial<HistoryPageToken>;
      const hostId = this.identity().hostId;
      if (parsed.version !== 1 || parsed.kind !== HISTORY_TOKEN_KIND || parsed.hostId !== hostId || parsed.sessionId !== sessionId || parsed.pageSize !== pageSize || !canonicalDecimal(parsed.beforeCursor)) {
        throw new Error("page token is not bound to this query");
      }
      return parsed as HistoryPageToken;
    } catch {
      throw new RuntimeProtocolError("invalid_message", "page token is invalid or does not match the history query");
    }
  }

  /** Bounded workspace listing produced by the policy module. */
  private listWorkspaceItems(): Record<string, unknown>[] {
    const seed = this.policy!.rootSeed();
    const trust = this.policy!.resolveTrust(seed.canonicalPath);
    const sessions = this.options.store.sessionStates();
    const eff = this.policy!.hostPolicy.effective();
    const indexed = this.policy!.search({
      rootCanonical: seed.canonicalPath,
      query: "*",
      maxDepth: 2,
      maxResults: 50,
    });
    const sessionCandidates = sessions.flatMap((session) =>
      typeof session.workspaceId === "string" &&
      typeof session.workspaceRootPath === "string" &&
      typeof session.workspaceRelativePath === "string"
        ? [{
            canonicalPath: session.workspaceRootPath,
            rootRelativePath: session.workspaceRelativePath,
            name: typeof session.workspaceDisplayName === "string"
              ? session.workspaceDisplayName
              : session.workspaceRelativePath,
            id: session.workspaceId,
          }]
        : [],
    );
    const candidateMap = new Map<string, {
      canonicalPath: string;
      rootRelativePath: string;
      name: string;
      id: string;
    }>();
    for (const candidate of [
      { canonicalPath: seed.canonicalPath, rootRelativePath: ".", name: seed.label, id: seed.id },
      ...sessionCandidates,
      ...indexed.map((item) => ({ ...item, id: deriveRootId(item.canonicalPath) })),
    ]) candidateMap.set(candidate.id, candidate);
    return [...candidateMap.values()].map((candidate) => {
      this.searchCandidates.set(candidate.id, {
        canonicalPath: candidate.canonicalPath,
        label: candidate.name,
      });
      // The configured home root is the authority boundary. Indexed child
      // folders inherit that approval instead of requiring dozens of
      // redundant per-folder trust prompts.
      const candidateTrust = trust;
      const sessionCount = sessions.filter((session) => session.workspaceId === candidate.id).length;
      return {
        workspaceId: candidate.id,
        displayName: candidate.name,
        rootLabel: seed.label,
        relativePath: candidate.rootRelativePath,
        availability: "available",
        fingerprint: candidateTrust.fingerprint,
        trustState: mobileTrustState(candidateTrust.status),
        approved: candidateTrust.status === "trusted",
        invalidatedReason: candidateTrust.invalidatedReason,
        policyVersion: candidateTrust.policyVersion,
        policyMode: eff.mode,
        manifest: candidateTrust.manifest.resources.map((resource) => ({
          relativePath: resource.relativePath,
          kind: resource.kind,
          sizeBytes: resource.size,
          sha256: resource.sha256,
        })),
        availableSince: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        sessionCount,
      };
    });
  }

  private searchWorkspaces(payload: Record<string, unknown>): Record<string, unknown> {
    const query = String(payload.query ?? "");
    if (!query || query.length === 0) throw new RuntimeProtocolError("invalid_state", "search query must not be empty");
    const seed = this.policy!.rootSeed();
    const maxDepth = typeof payload.maxDepth === "number" ? payload.maxDepth : 4;
    const maxResults = typeof payload.maxResults === "number" ? payload.maxResults : 50;
    let items: readonly { canonicalPath: string; rootRelativePath: string; name: string }[];
    try {
      items = this.policy!.search({ rootCanonical: seed.canonicalPath, query, maxDepth, maxResults });
    } catch (error) {
      if (error instanceof WorkspacePolicyError && error.code === "aborted") throw new RuntimeProtocolError("aborted", "search was cancelled");
      throw error;
    }
    return { items: items.map((item) => {
      const workspaceId = deriveRootId(item.canonicalPath);
      this.searchCandidates.set(workspaceId, { canonicalPath: item.canonicalPath, label: item.name });
      const trust = this.policy!.resolveTrust(seed.canonicalPath, seed.id);
      return {
        workspaceId,
        displayName: item.name,
        relativePath: item.rootRelativePath,
        rootLabel: seed.label,
        availability: "available",
        trustState: mobileTrustState(trust.status),
        fingerprint: trust.fingerprint,
        policyVersion: trust.policyVersion,
        manifest: trust.manifest.resources.map((resource) => ({ relativePath: resource.relativePath, kind: resource.kind, sizeBytes: resource.size, sha256: resource.sha256 })),
      };
    }) };
  }

  private approveWorkspace(payload: Record<string, unknown>): Record<string, unknown> {
    const workspaceId = String(payload.workspaceId ?? "");
    const fingerprint = String(payload.fingerprint ?? "");
    const approvedBy = String(payload.approvedBy ?? "mobile");
    if (!workspaceId) throw new RuntimeProtocolError("invalid_state", "workspaceId is required");
    if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new RuntimeProtocolError("invalid_state", "fingerprint must be a 64-char hex SHA-256");
    const seed = this.policy!.rootSeed();
    const candidate = workspaceId === seed.id
      ? { canonicalPath: seed.canonicalPath, label: seed.label }
      : this.searchCandidates.get(workspaceId);
    if (!candidate) throw new RuntimeProtocolError("workspace_not_allowed", "workspace is not in the allowed roots");
    // Reject if the fingerprint no longer matches the current manifest.
    const trust = this.policy!.resolveTrust(candidate.canonicalPath, workspaceId);
    if (trust.fingerprint !== fingerprint) throw new RuntimeProtocolError("workspace_trust_required", "fingerprint does not match current workspace manifest");
    const record = this.policy!.approve({ workspaceId, rootCanonical: candidate.canonicalPath, label: candidate.label, fingerprint, approvedBy });
    return { workspaceId: record.workspaceId, fingerprint, policyVersion: trust.policyVersion, approvedAt: record.approvedAt };
  }

  private currentTrustState(): Record<string, unknown> {
    const seed = this.policy!.rootSeed();
    const trust = this.policy!.resolveTrust(seed.canonicalPath);
    return { workspaceId: seed.id, trustState: mobileTrustState(trust.status), status: trust.status, fingerprint: trust.fingerprint, policyVersion: trust.policyVersion, invalidatedReason: trust.invalidatedReason };
  }

  /** Returns the host policy evaluation result for a session-level mode
   * request. Kept as a public field-free helper so tests can exercise
   * the same logic without going through the full command path. */
  evaluateSessionPolicy(requestedMode: HostPolicyMode): { allowed: boolean; reason?: string; code?: string; approvedHost?: HostPolicyMode } {
    if (!this.policy) return { allowed: true };
    const decision = this.policy.hostPolicy.evaluate({ requestedMode });
    if (decision.allow) return { allowed: true };
    if (decision.code === "escalation_required") {
      return { allowed: false, reason: decision.message ?? "host policy escalation denied", code: "escalation_required" };
    }
    return { allowed: false, reason: decision.message ?? "policy denied", code: decision.code };
  }

  command(connection: ConnectionContext, message: Record<string, unknown>): Record<string, unknown> {
    const type = String(message.type); const payload = message.payload as Record<string, unknown>; const commandId = String(message.commandId ?? "");
    const metadata = COMMAND_METADATA.find((item) => item.type === type); if (!metadata) throw new RuntimeProtocolError("invalid_state", "unsupported command");
    const existing = this.options.store.command(commandId);
    if (existing) {
      const hash = semanticCommandSha256({ type, payload });
      if (hash !== existing.semanticHash) throw new StoreError("conflict", "idempotency conflict");
      const duplicate = this.commands.submit({ commandId, type, payload, scopeKey: existing.scopeKey, streamId: existing.streamId });
      return { state: duplicate.receipt.state, duplicate: true };
    }
    const admission = this.options.adapter.admission?.();
    if (admission && !admission.accepting) {
      throw new RuntimeProtocolError(admission.reason === "host_draining" ? "host_draining" : "host_not_ready", "host is not accepting commands");
    }
    const requestedSession = typeof payload.sessionId === "string" ? payload.sessionId : null;
    const sessionId = metadata.scope === "session" ? requestedSession : metadata.scope === "host-or-session" && payload.scope === "session" ? requestedSession : null;
    if ((metadata.scope === "session" || payload.scope === "session") && !sessionId) throw new RuntimeProtocolError("session_not_found", "session ID is required");
    if (sessionId && !this.options.store.sessionExists(sessionId)) throw new RuntimeProtocolError("session_not_found", "session does not exist");
    if (sessionId && type === "prompt.submit" &&
        this.options.store.sessionState(sessionId)?.runtimeState === "indeterminate") {
      throw new RuntimeProtocolError("invalid_state", "indeterminate session requires explicit activation");
    }

    // M8: gate session.process activation on trust state. Mobile cannot
    // dispatch `session.create`/`session.activate` against an untrusted
    // workspace — the user has to run `workspace.trust.approve` first.
    // Mobile cannot escalate policy via `session.create` either; the
    // requested mode must be allowed by the host policy.
    if (this.policy && SESSION_GATING_COMMAND_TYPES.has(type)) {
      const seed = this.policy.rootSeed();
      const requestedWorkspaceId = typeof payload.workspaceId === "string"
        ? payload.workspaceId
        : seed.id;
      const candidate = requestedWorkspaceId === seed.id
        ? { canonicalPath: seed.canonicalPath, label: seed.label }
        : this.searchCandidates.get(requestedWorkspaceId);
      if (!candidate) {
        throw new RuntimeProtocolError(
          "workspace_not_allowed",
          "workspace is not in the indexed home folders",
        );
      }
      if (type === "session.create") {
        const expectedRelativePath = relative(seed.canonicalPath, candidate.canonicalPath)
          .split("\\").join("/") || ".";
        const suppliedRelativePath = payload.workspaceRelativePath ??
          (requestedWorkspaceId === seed.id ? "." : null);
        if (suppliedRelativePath !== expectedRelativePath) {
          throw new RuntimeProtocolError(
            "workspace_not_allowed",
            "workspace path does not match the indexed folder",
          );
        }
      }
      const trust = this.policy.resolveTrust(seed.canonicalPath, seed.id);
      if (trust.status !== "trusted") {
        throw new RuntimeProtocolError(
          "workspace_trust_required",
          trust.invalidatedReason ?? "workspace trust approval required",
        );
      }
      const requestedMode: HostPolicyMode = (payload.policyMode === "read_only" || payload.policyMode === "full")
        ? payload.policyMode
        : this.defaultSessionPolicyMode;
      const decision = this.policy.hostPolicy.evaluate({ requestedMode });
      if (!decision.allow) {
        throw new RuntimeProtocolError(
          decision.code === "escalation_required" ? "escalation_required" : "policy_denied",
          decision.message ?? "host policy denied this request",
        );
      }
    }
    // M8: enforce `session.policy.set` against the host policy +
    // explicit escalation rules.
    let policyMutation: { requestedMode: HostPolicyMode; approvedHost?: HostPolicyMode } | undefined;
    if (this.policy && type === "session.policy.set") {
      const requestedMode: HostPolicyMode | null = payload.policyMode === "read_only" || payload.policyMode === "full" ? payload.policyMode : null;
      if (!requestedMode) throw new RuntimeProtocolError("invalid_state", "session.policy.set requires policyMode full or read_only");
      const approvedHost: HostPolicyMode | undefined = payload.approvedHost === "full" || payload.approvedHost === "read_only" ? payload.approvedHost : undefined;
      const decision = this.policy.hostPolicy.evaluate({ requestedMode, ...(approvedHost ? { approvedHost } : {}) });
      if (!decision.allow) {
        throw new RuntimeProtocolError(decision.code === "escalation_required" ? "escalation_required" : "policy_denied", decision.message ?? "host policy denied this request");
      }
      policyMutation = { requestedMode, ...(approvedHost ? { approvedHost } : {}) };
    }

    const identity = this.identity(); const streamId = sessionId ? `session:${sessionId}` : `host:${identity.hostId}`; const scopeKey = streamId;
    if (metadata.requiresLeaseId && !M8_LEASE_FREE_COMMANDS.has(type)) {
      try { this.leases.assertController(scopeKey, String(message.leaseId ?? ""), connection.connectionId); }
      catch { throw new RuntimeProtocolError("stale_controller", "controller lease is stale"); }
    }
    // M8: handle workspace.trust.approve as a command that bypasses the
    // command/replay pipeline — it is purely a store write that must
    // happen exactly once at bootstrap. The runtime still records it on
    // the host stream so subscribers see the trust state change.
    if (this.policy && type === "workspace.trust.approve") {
      const approved = this.approveWorkspace((payload ?? {}) as Record<string, unknown>);
      this.options.store.appendEvent(`host:${this.identity().hostId}`, "workspace.trust_state", {
        workspaceId: approved.workspaceId,
        fingerprint: approved.fingerprint,
        policyVersion: approved.policyVersion,
        status: "trusted",
        trustState: "approved",
        approvedBy: (payload as Record<string, unknown>).approvedBy ?? "mobile",
        approvedAt: approved.approvedAt,
      });
      return { state: "completed", duplicate: false, trustApproved: true, fingerprint: approved.fingerprint, approvedAt: approved.approvedAt };
    }
    const leaseMutation: LeaseMutation | undefined = type === "controller.acquire" || type === "controller.takeover"
      ? { action: type === "controller.takeover" ? "takeover" : "acquire", scopeKey, installationId: connection.installationId, connectionId: connection.connectionId }
      : type === "controller.release"
      ? { action: "release", scopeKey, installationId: connection.installationId, connectionId: connection.connectionId }
      : undefined;
    if (!this.options.store.command(commandId)) {
      try { this.options.adapter.validateCommand?.(type, payload); }
      catch (error) {
        if ((error as Error).message === "attachment_unavailable") {
          throw new RuntimeProtocolError("attachment_unavailable", "one or more attachments are unavailable");
        }
        if ((error as Error).message === "queue_full" || (error instanceof StoreError && error.code === "full")) {
          throw new RuntimeProtocolError("queue_full", "follow-up queue is full");
        }
        if ((error as Error).message === "invalid_state") throw new RuntimeProtocolError("invalid_state", "command is no longer valid");
        if ((error as Error).message === "queue_item_not_found") throw new RuntimeProtocolError("queue_item_not_found", "queued follow-up was not found");
        throw error;
      }
    }
    let submission;
    try { submission = this.commands.submit({ commandId, type, payload, scopeKey, streamId, ...(leaseMutation ? { leaseMutation } : {}) }); }
    catch (error) {
      if (error instanceof StoreError && error.code === "conflict" && (type === "controller.acquire" || type === "controller.takeover")) throw new RuntimeProtocolError("controller_conflict", "controller is already held");
      if (error instanceof StoreError && error.code === "conflict" && type === "controller.release") throw new RuntimeProtocolError("stale_controller", "controller release is not authorized");
      throw error;
    }

    if (!submission.receipt.duplicate) this.options.adapter.commandAccepted?.(type, payload, commandId);

    // Mutate host policy only after lease validation and durable command
    // acceptance. A stale observer or conflicting command must have no side
    // effects on the host-wide policy.
    if (this.policy && policyMutation && !submission.receipt.duplicate) {
      const result = this.policy.hostPolicy.setMode({
        mode: policyMutation.requestedMode,
        actor: policyMutation.approvedHost ? `client:${policyMutation.approvedHost}` : `client:connection:${connection.connectionId}`,
      });
      if (!result.ok) {
        throw new RuntimeProtocolError(result.code === "escalation_required" ? "escalation_required" : "policy_denied", result.message);
      }
    }

    // M8: snapshot policy mode/version/fingerprint at prompt start so the
    // turn is bound to a stable policy even if the host policy changes
    // mid-flight. The snapshot is durable: written to session state and
    // emitted as the declared `session.policy` event on the session stream.
    if (this.policy && sessionId && type === "prompt.submit") {
      const snapshot = this.policy.hostPolicy.effective();
      const trustSeed = this.policy.rootSeed();
      const trust = this.policy.resolveTrust(trustSeed.canonicalPath);
      const snapshottedAt = new Date(this.options.store.now()).toISOString();
      const snapshotPayload = {
        sessionId,
        policyMode: snapshot.mode,
        policyVersion: snapshot.rules.policyVersion,
        fingerprint: trust.fingerprint,
        manifestPolicyVersion: trust.policyVersion,
        snapshottedAt,
      };
      this.options.store.appendEvent(`session:${sessionId}`, "session.policy", snapshotPayload);
      const prior = this.options.store.sessionState(sessionId) ?? {};
      this.options.store.updateSessionState(sessionId, {
        ...prior,
        policyMode: snapshot.mode,
        policyVersion: snapshot.rules.policyVersion,
        trustFingerprint: trust.fingerprint,
        manifestPolicyVersion: trust.policyVersion,
        lastPolicySnapshotAt: snapshottedAt,
      });
    }
    void submission.completion;
    return { state: submission.receipt.state, duplicate: submission.receipt.duplicate };
  }
  disconnected(connection: ConnectionContext): void { this.options.store.disconnectConnection(connection.connectionId); }
  async recover(): Promise<{ resumed: number; indeterminate: number }> { return this.commands.recover(); }
}
