import { ERROR_CODES, LIMITS, PROTOCOL_MAJOR, PROTOCOL_MINOR, validateFixture } from "@pi-mob/protocol-schema";
import type { BindOutcome } from "../auth/enrollment";
const MAX_JSON_BYTES = LIMITS.maxJsonBytes;
export const MAX_OUTBOUND_BYTES = 8 * 1024 * 1024;
export function exceedsSlowConsumerLimit(bufferedBytes: number, nextMessageBytes: number): boolean { return bufferedBytes + nextMessageBytes > MAX_OUTBOUND_BYTES; }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const SUMMARY_EVENTS = new Set(["session.state", "session.metadata", "controller.state", "turn.started", "turn.waiting_for_input", "turn.settled", "turn.aborted", "turn.failed", "turn.indeterminate", "queue.snapshot", "command.state", "error.event"]);
const ENROLLMENT_RATE_WINDOW_MS = 60_000;
const ENROLLMENT_RATE_LIMIT = 10;
const enrollmentAttempts = new Map<string, { windowStartedAt: number; count: number }>();
function compareCursor(left: string, right: string): number { return left.length === right.length ? left.localeCompare(right) : left.length - right.length; }

async function enroll(request: Request, runtime: BridgeRuntimePort): Promise<Response> {
  const binder = runtime.bindEnrollment;
  if (!binder) return Response.json({ code: "invalid_state", message: "Enrollment is unavailable.", retryable: false, details: {} }, { status: 503 });
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 16 * 1024) return Response.json({ code: "payload_too_large", message: "Enrollment request is too large.", retryable: false, details: {} }, { status: 413 });
  let value: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 16 * 1024) throw new Error("too large");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid object");
    value = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ code: "invalid_message", message: "Enrollment request is invalid.", retryable: false, details: {} }, { status: 400 });
  }
  if (typeof value.installationId !== "string" || typeof value.passcode !== "string") {
    return Response.json({ code: "invalid_message", message: "Enrollment request is invalid.", retryable: false, details: {} }, { status: 400 });
  }
  const now = Date.now();
  const key = value.installationId;
  const previous = enrollmentAttempts.get(key);
  const attempt = previous && now - previous.windowStartedAt < ENROLLMENT_RATE_WINDOW_MS
    ? { windowStartedAt: previous.windowStartedAt, count: previous.count + 1 }
    : { windowStartedAt: now, count: 1 };
  enrollmentAttempts.set(key, attempt);
  if (attempt.count > ENROLLMENT_RATE_LIMIT) {
    return Response.json({ code: "rate_limited", message: "Enrollment is temporarily rate limited.", retryable: true, details: {} }, { status: 429 });
  }
  const outcome = binder(value.installationId, value.passcode);
  if (outcome.kind !== "bound") {
    const status = outcome.kind === "expired" || outcome.kind === "already_used" ? 410 : 401;
    return Response.json({ code: "invalid_auth", message: "Enrollment challenge is not valid.", retryable: false, details: {} }, { status });
  }
  return Response.json({ installationId: outcome.installationId, installationCredential: outcome.credential }, { status: 201 });
}

export interface SubscriptionMessage { readonly type: string; readonly payload: Record<string, unknown>; readonly eventId?: string; readonly streamId?: string; readonly cursor?: string; }
export interface SubscriptionResult { readonly streams: readonly Record<string, unknown>[]; readonly messages?: readonly SubscriptionMessage[]; }
export interface BridgeRuntimePort {
  readonly bridgeVersion: string;
  readonly piVersion: string;
  identity(): { hostId: string; hostGeneration: string; hostDisplayName: string };
  ready(): { ready: boolean; reason?: string };
  /** Phase 4 — verify an installation credential against the durable store.
   *  Returns null when no row is associated with the `installationId`.
   *  Otherwise returns the row's authoritative state (including revoked/
   *  expired flags) so the server can apply a single non-enumerating
   *  rejection on every miss. */
  verifyInstallationCredential?(installationId: string, plaintext: string, now?: number): CredentialVerificationResult;
  bindEnrollment?(installationId: string, passcode: string): BindOutcome;
  subscribe(connection: ConnectionContext, payload: Record<string, unknown>): Promise<SubscriptionResult> | SubscriptionResult;
  control(connection: ConnectionContext, type: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  command(connection: ConnectionContext, message: Record<string, unknown>): Promise<Record<string, unknown>> | Record<string, unknown>;
  optionalCapabilities?(): readonly string[];
  /** Mobile-facing catalogue boundary. Durable host state is never deleted. */
  sessionVisibilityCutoff?(): string;
  /** Redacts stale host catalogue events without creating cursor gaps. */
  mobileEvent?(event: { eventId: string; streamId: string; cursor: string; type: string; payload: Record<string, unknown> }): { eventId: string; streamId: string; cursor: string; type: string; payload: Record<string, unknown> };
  onEvent?(listener: (event: { eventId: string; streamId: string; cursor: string; type: string; payload: Record<string, unknown> }) => void): () => void;
  /**
   * Phase 4 — register a listener for canonical session-event live
   * pushes. The listener is invoked once per committed canonical
   * event with the wire-shape payload (`eventId`, `sessionId`,
   * `sequence`, `eventType`, `occurredAt`, `data`). The runtime
   * only emits after the dedicated canonical-session-event log has
   * committed the row.
   */
  onCanonicalLiveEvent?(listener: (event: { readonly eventId: string; readonly sessionId: string; readonly sequence: number; readonly eventType: string; readonly occurredAt: string; readonly data: Record<string, unknown> }) => void): () => void;
  disconnected?(connection: ConnectionContext): void;
}
export interface ConnectionContext { readonly connectionId: string; readonly installationId: string; readonly subscriptions: ReadonlySet<string>; }
interface PendingLiveEvent { eventId: string; streamId: string; cursor: string; type: string; payload: Record<string, unknown>; }
interface SocketData {
  connectionId: string;
  installationId: string;
  hello: boolean;
  synchronized: boolean;
  subscriptions: Map<string, "full" | "summary">;
  /**
   * Phase 4 — set of sessionIds the connection is subscribed to via
   * `session.events.subscribe`. The set is populated by the server
   * when the control handler returns a `session.events.replay.result`
   * and torn down when the socket closes (the runtime's `disconnected`
   * hook handles the matching transport-side cleanup).
   */
  canonicalSubscriptions: Set<string>;
  syncing: boolean;
  pendingEvents: PendingLiveEvent[];
  tokens: number;
  tokenAt: number;
  queuedBytes: number;
}
export interface BridgeServerTestHooks {
  afterCommandAccepted?(message: Readonly<Record<string, unknown>>): "drop_receipt" | "close" | void;
  beforeOutbound?(value: Readonly<Record<string, unknown>>): "pause" | void;
}
export interface BridgeServerOptions {
  readonly hostname?: string;
  readonly port?: number;
  readonly runtime: BridgeRuntimePort;
  /** Lower deterministic threshold for backpressure integration tests. */
  readonly outboundBackpressureLimit?: number;
  /** Private binary attachment/export routes; never receives WebSocket traffic. */
  readonly httpHandler?: (request: Request) => Response | Promise<Response | null> | null;
  /** Injectable only by in-process tests; the daemon exposes no control endpoint. */
  readonly testHooks?: BridgeServerTestHooks;
}
export type BridgeServer = Bun.Server<SocketData> & { broadcastProtocol(value: Record<string, unknown>, streamId?: string): void; connectionCount(): number };

/**
 * Phase 4 — the verification contract every runtime MUST implement when
 * `hello` carries an installation credential.
 */
export interface CredentialVerification {
  readonly kind: "valid";
  readonly installationId: string;
  readonly lastSeenAt: number;
}
export interface CredentialRejection {
  readonly kind: "missing" | "revoked" | "expired" | "wrong" | "not_bound";
  readonly installationId?: string;
}
export type CredentialVerificationResult = CredentialVerification | CredentialRejection;

function id(): string { return crypto.randomUUID().toLowerCase(); }
function envelope(type: string, payload: Record<string, unknown>, requestId?: unknown, commandId?: unknown): Record<string, unknown> {
  return { protocol: { major: PROTOCOL_MAJOR, minor: PROTOCOL_MINOR }, messageId: id(), ...(typeof requestId === "string" ? { requestId } : {}), ...(typeof commandId === "string" ? { commandId } : {}), type, sentAt: new Date().toISOString(), payload };
}
function context(data: SocketData): ConnectionContext { return { connectionId: data.connectionId, installationId: data.installationId, subscriptions: new Set(data.subscriptions.keys()) }; }

/** Phase 4 — build the wire envelope for a single live canonical session event.
 *  The shape is byte-equivalent to one element of the
 *  `session.events.replay.result.events` array so replay and live
 *  frames are indistinguishable to the client (plan §3.4). */
function canonicalLiveMessage(event: { readonly eventId: string; readonly sessionId: string; readonly sequence: number; readonly eventType: string; readonly occurredAt: string; readonly data: Record<string, unknown> }): Record<string, unknown> {
  return {
    protocol: { major: PROTOCOL_MAJOR, minor: PROTOCOL_MINOR },
    messageId: id(),
    type: "session.event",
    sentAt: new Date().toISOString(),
    payload: {
      eventId: event.eventId,
      sessionId: event.sessionId,
      sequence: event.sequence,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      data: event.data,
    },
  };
}
function hasInvalidCursor(value: unknown, key = ""): boolean {
  if (Array.isArray(value)) return value.some((item) => hasInvalidCursor(item, key));
  if (value && typeof value === "object") return Object.entries(value as Record<string,unknown>).some(([childKey, child]) => hasInvalidCursor(child, childKey));
  return /cursor$/i.test(key) && (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value));
}

export function createBridgeServer(options: BridgeServerOptions): BridgeServer {
  const hostname = options.hostname ?? "127.0.0.1";
  if (!LOOPBACK.has(hostname)) throw new Error("production bridge must bind to loopback");
  const sockets = new Set<Bun.ServerWebSocket<SocketData>>();

  const server = Bun.serve<SocketData>({
    hostname, port: options.port ?? 0,
    async fetch(request, server) {
      let url: URL;
      try { url = new URL(request.url); }
      catch { return new Response("bad request", { status: 400 }); }
      if (url.pathname === "/v1/enroll") {
        if (request.method !== "POST") return Response.json({ code: "invalid_message", message: "POST required", retryable: false, details: {} }, { status: 405 });
        return enroll(request, options.runtime);
      }
      if (url.pathname === "/healthz") return Response.json({ status: "ok" });
      if (url.pathname === "/readyz") {
        try { const ready = options.runtime.ready(); return Response.json({ status: ready.ready ? "ready" : "not_ready", ...(ready.reason ? { reason: ready.reason } : {}) }, { status: ready.ready ? 200 : 503 }); }
        catch { return Response.json({ status: "not_ready", reason: "runtime unavailable" }, { status: 503 }); }
      }
      if (options.httpHandler && (url.pathname === "/v1/attachments" || url.pathname.startsWith("/v1/exports/"))) {
        const response = await options.httpHandler(request);
        if (response) return response;
      }
      if (url.pathname === "/v1/ws") {
        const upgraded = server.upgrade(request, { data: { connectionId: id(), installationId: "", hello: false, synchronized: false, subscriptions: new Map(), canonicalSubscriptions: new Set(), syncing: false, pendingEvents: [], tokens: 20, tokenAt: Date.now(), queuedBytes: 0 } });
        return upgraded ? undefined : new Response("upgrade required", { status: 426 });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      data: {} as SocketData,
      maxPayloadLength: MAX_JSON_BYTES,
      backpressureLimit: options.outboundBackpressureLimit ?? MAX_OUTBOUND_BYTES,
      closeOnBackpressureLimit: true,
      perMessageDeflate: false,
      open(ws) { sockets.add(ws); },
      close(ws) { sockets.delete(ws); if (ws.data.hello) options.runtime.disconnected?.(context(ws.data)); },
      drain(ws) { ws.data.queuedBytes = ws.getBufferedAmount(); },
      async message(ws, raw) {
        if (typeof raw !== "string") { sendError(ws, "invalid_message", "Binary messages are unsupported."); ws.close(1003, "text required"); return; }
        if (Buffer.byteLength(raw) > MAX_JSON_BYTES) { sendError(ws, "payload_too_large", "Message exceeds the protocol limit."); ws.close(1009, "too large"); return; }
        let message: Record<string, unknown>;
        try { const parsed = JSON.parse(raw); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); message = parsed as Record<string, unknown>; }
        catch { sendError(ws, "invalid_message", "Malformed JSON message."); return; }
        const type = message.type;
        if (typeof type !== "string" || !message.payload || typeof message.payload !== "object" || Array.isArray(message.payload)) { sendError(ws, "invalid_message", "Invalid envelope.", message.requestId); return; }
        const payload = message.payload as Record<string, unknown>;
        if (!ws.data.hello) { handleHello(ws, message, payload, options.runtime); return; }
        if (!consumeToken(ws.data)) { sendError(ws, "rate_limited", "Control rate exceeded.", message.requestId); return; }
        if (message.connectionId !== ws.data.connectionId) { sendError(ws, "stale_connection", "Connection ID is stale.", message.requestId); return; }
        try {
          if ((type === "subscription.set" || type === "cursor.ack") && hasInvalidCursor(payload)) { sendError(ws, "cursor_invalid", "Cursor is not a canonical decimal string.", message.requestId); return; }
          const fixtureKind = message.commandId !== undefined ? "command" : "control";
          if (!validateFixture({ name: "live", kind: fixtureKind, valid: true, message })) { sendError(ws, "invalid_message", "Message does not match the protocol schema.", message.requestId, message.commandId); return; }
          if (type === "subscription.set") {
            const previous = new Map(ws.data.subscriptions); const previousSynchronized = ws.data.synchronized; ws.data.subscriptions.clear(); ws.data.syncing = true; ws.data.synchronized = false; ws.data.pendingEvents = [];
            const streams = Array.isArray(payload.streams) ? payload.streams : [];
            for (const item of streams) if (item && typeof item === "object" && typeof (item as { streamId?: unknown }).streamId === "string") ws.data.subscriptions.set((item as { streamId: string }).streamId, (item as { detail?: unknown }).detail === "summary" ? "summary" : "full");
            try {
              const result = await options.runtime.subscribe(context(ws.data), payload);
              const resultMessages = result.messages ?? [];
              const sentEventIds = new Set(resultMessages.flatMap((item) => item.eventId ? [item.eventId] : []));
              send(ws, envelope("subscription.accepted", { streams: result.streams }, message.requestId));
              let finalSyncIndex = -1;
              for (let index = 0; index < resultMessages.length; index += 1) if (resultMessages[index]!.type === "stream.sync.complete") finalSyncIndex = index;
              for (let index = 0; index < resultMessages.length; index += 1) {
                // Open the command-admission fence before queueing the final
                // readiness marker. A client can react as soon as that frame
                // arrives; setting this afterwards creates a real
                // host_not_ready race on fast links.
                if (index === finalSyncIndex) ws.data.synchronized = true;
                const item = resultMessages[index]!;
                send(ws, { ...envelope(item.type, item.payload), ...(item.eventId ? { eventId: item.eventId } : {}), ...(item.streamId ? { streamId: item.streamId } : {}), ...(item.cursor ? { cursor: item.cursor } : {}) });
              }
              if (finalSyncIndex < 0) ws.data.synchronized = true;
              const pending = ws.data.pendingEvents.filter((event) => !sentEventIds.has(event.eventId)).sort((left, right) => left.streamId === right.streamId ? compareCursor(left.cursor, right.cursor) : left.streamId.localeCompare(right.streamId));
              ws.data.pendingEvents = []; ws.data.syncing = false;
              for (const event of pending) sendLiveEvent(ws, event);
            } catch (error) { ws.data.subscriptions = previous; ws.data.pendingEvents = []; ws.data.syncing = false; ws.data.synchronized = previousSynchronized; throw error; }
            return;
          }
          if (message.commandId !== undefined) {
            if (!ws.data.synchronized) { sendError(ws, "host_not_ready", "Initial synchronization is incomplete.", message.requestId, message.commandId); return; }
            const readiness = options.runtime.ready();
            if (!readiness.ready) { sendError(ws, readiness.reason?.includes("full") ? "storage_full" : "database_unavailable", "Durable state is unavailable.", message.requestId, message.commandId); return; }
            const result = await options.runtime.command(context(ws.data), message);
            const fault = options.testHooks?.afterCommandAccepted?.(message);
            if (fault === "close") { ws.close(1011, "test_fault"); return; }
            if (fault !== "drop_receipt") send(ws, envelope("command.receipt", result, message.requestId, message.commandId));
            return;
          }
          const result = await options.runtime.control(context(ws.data), type, type === "session.events.subscribe" ? { ...payload, __requestId: typeof message.requestId === "string" ? message.requestId : null } : payload);
          if (result) {
            // Phase 4 — the `session.events.subscribe` control
            // returns the ready-to-send envelope plus a side
            // channel that registers the connection for live
            // canonical pushes. The server forwards the envelope
            // verbatim (already byte-shape compatible with the
            // server envelope) and updates the socket's canonical
            // subscription set.
            if (type === "session.events.subscribe") {
              const routingHint = result.__canonicalSubscribeSessionId;
              const subscribeSessionId = typeof routingHint === "string" ? routingHint : null;
              const resultPayload = result.payload;
              const replayComplete = resultPayload !== null &&
                typeof resultPayload === "object" &&
                "complete" in resultPayload &&
                resultPayload.complete === true;
              if (subscribeSessionId) {
                if (replayComplete) ws.data.canonicalSubscriptions.add(subscribeSessionId);
                else ws.data.canonicalSubscriptions.delete(subscribeSessionId);
              }
              // The transport keeps the durable subscription in replay
              // mode and buffers commits until the client catches up.
              if (subscribeSessionId && replayComplete) ws.data.canonicalSubscriptions.add(subscribeSessionId);
              // `__canonicalSubscribeSessionId` is an internal routing hint;
              // never expose it on the strict replay-result wire envelope.
              const wireResult = { ...(result as Record<string, unknown>) };
              delete wireResult.__canonicalSubscribeSessionId;
              send(ws, wireResult);
            } else if (result) {
              // The wire response name for catalogue requests predates the
              // generic `${control}.result` convention. Keep that canonical
              // response name so mobile validators and generated schemas
              // remain aligned.
              const responseType = type === "catalogue.snapshot.request"
                ? "catalogue.snapshot.result"
                : `${type}.result`;
              send(ws, envelope(responseType, result, message.requestId));
            }
          }
        } catch (error) {
          const storeCode = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
          const code = typeof storeCode === "string" && ERROR_CODES.includes(storeCode as never) ? storeCode : storeCode === "full" ? "storage_full" : ["busy", "readonly", "corrupt", "io"].includes(String(storeCode)) ? "database_unavailable" : error instanceof Error && /idempotency conflict/i.test(error.message) ? "idempotency_conflict" : "invalid_state";
          sendError(ws, code, "Request could not be applied.", message.requestId, message.commandId);
        }
      },
    },
  });

  function send(ws: Bun.ServerWebSocket<SocketData>, value: Record<string, unknown>): boolean {
    if (options.testHooks?.beforeOutbound?.(value) === "pause") return true;
    const json = JSON.stringify(value); const bytes = Buffer.byteLength(json);
    if (bytes > MAX_JSON_BYTES) { sendError(ws, "payload_too_large", "Outbound message exceeds the protocol limit."); return false; }
    ws.data.queuedBytes = ws.getBufferedAmount();
    if (ws.data.queuedBytes + bytes > (options.outboundBackpressureLimit ?? MAX_OUTBOUND_BYTES)) { ws.close(1008, "slow_consumer"); return false; }
    ws.send(json, false); return true;
  }
  function sendLiveEvent(ws: Bun.ServerWebSocket<SocketData>, event: PendingLiveEvent): void {
    const detail = ws.data.subscriptions.get(event.streamId); if (!detail || (detail === "summary" && !SUMMARY_EVENTS.has(event.type))) return;
    send(ws, { ...envelope(event.type, event.payload), eventId: event.eventId, streamId: event.streamId, cursor: event.cursor });
  }
  function sendError(ws: Bun.ServerWebSocket<SocketData>, code: string, message: string, requestId?: unknown, commandId?: unknown): void { send(ws, envelope("error", { code, message, retryable: code === "rate_limited", details: {} }, requestId, commandId)); }
  function handleHello(ws: Bun.ServerWebSocket<SocketData>, message: Record<string, unknown>, payload: Record<string, unknown>, runtime: BridgeRuntimePort): void {
    if (message.type !== "hello") { sendError(ws, "invalid_state", "hello must be the first message.", message.requestId); ws.close(1002, "hello required"); return; }
    const protocol = message.protocol as Record<string, unknown> | undefined;
    if (protocol?.major !== PROTOCOL_MAJOR) { sendError(ws, "unsupported_protocol", "Unsupported protocol major.", message.requestId); ws.close(1002, "protocol"); return; }
    const installationId = payload.installationId; if (typeof installationId !== "string" || !UUID.test(installationId)) { sendError(ws, "invalid_message", "Invalid installation ID.", message.requestId); return; }
    const identity = runtime.identity();
    if (payload.expectedHostId !== undefined && payload.expectedHostId !== identity.hostId) { sendError(ws, "host_identity_mismatch", "Host identity differs.", message.requestId); ws.close(1008, "host identity"); return; }
    // Phase 4 — Application-layer authentication. The hello payload now
    // carries an `installationCredential`; the bridge refuses the
    // handshake for unknown / wrong / revoked / expired / not-bound
    // cases under a single non-enumerating error code so an attacker
    // cannot probe state.
    const installationCredential = payload.installationCredential;
    if (typeof installationCredential !== "string" || installationCredential.length === 0) {
      sendError(ws, "invalid_auth", "Missing installation credential.", message.requestId);
      ws.close(1008, "auth");
      return;
    }
    const verifier = runtime.verifyInstallationCredential;
    if (typeof verifier !== "function") {
      sendError(ws, "invalid_auth", "Installation credential verification is unavailable.", message.requestId);
      ws.close(1008, "auth");
      return;
    }
    const verification = verifier(installationId, installationCredential);
    if (verification.kind !== "valid") {
      // `not_bound` carries the actionable re-pair message; everything
      // else collapses to the same code word for non-enumeration.
      const code = verification.kind === "not_bound" ? "re_pair_required" : "invalid_auth";
      const reason = verification.kind === "not_bound"
        ? "Re-pair your phone with the bridge to continue."
        : "Credential is not valid.";
      sendError(ws, code, reason, message.requestId);
      ws.close(1008, "auth");
      return;
    }
    const required = Array.isArray(payload.requiredCapabilities) ? payload.requiredCapabilities : [];
    // Advertise only capabilities that the released mobile path can exercise.
  // Raw Pi RPC remains an internal bridge command for compatibility callers,
  // but it is not a mobile capability and must not be required by the app.
  const capabilities = ["streams.v1", "commands.v1", "controller_leases.v1", ...(runtime.optionalCapabilities?.() ?? [])];
    if (required.some((item) => typeof item !== "string" || !capabilities.includes(item))) { sendError(ws, "unsupported_capability", "A required capability is unsupported.", message.requestId); ws.close(1002, "capability"); return; }
    if (!validateFixture({ name: "live", kind: "hello", valid: true, message })) { sendError(ws, "invalid_message", "Hello does not match the protocol schema.", message.requestId); return; }
    ws.data.installationId = installationId; ws.data.hello = true;
    const visibilityCutoff = runtime.sessionVisibilityCutoff?.();
    send(ws, envelope("hello.accepted", {
      connectionId: ws.data.connectionId,
      hostId: identity.hostId,
      hostGeneration: identity.hostGeneration,
      hostDisplayName: identity.hostDisplayName,
      bridgeVersion: runtime.bridgeVersion,
      piVersion: runtime.piVersion,
      serverTime: new Date().toISOString(),
      capabilities,
      limits: LIMITS,
      ...(typeof visibilityCutoff === "string" ? { sessionVisibilityCutoff: visibilityCutoff } : {}),
    }, message.requestId));
  }
  function consumeToken(data: SocketData): boolean { const now = Date.now(); data.tokens = Math.min(20, data.tokens + (now - data.tokenAt) * 0.01); data.tokenAt = now; if (data.tokens < 1) return false; data.tokens -= 1; return true; }

  options.runtime.onEvent?.((event) => {
    const mobileEvent = options.runtime.mobileEvent?.(event) ?? event;
    for (const socket of sockets) {
      if (!socket.data.subscriptions.has(event.streamId)) continue;
      if (socket.data.syncing) socket.data.pendingEvents.push(mobileEvent);
      else if (socket.data.synchronized) sendLiveEvent(socket, mobileEvent);
    }
  });
  options.runtime.onCanonicalLiveEvent?.((event) => {
    // Forward canonical live events to sockets that registered for
    // the owning sessionId via `session.events.subscribe`. The
    // envelope uses the plan's top-level canonical frame so replay
    // and live frames are byte-shape equivalent (plan §3.4).
    const wire = canonicalLiveMessage(event);
    for (const socket of sockets) {
      if (!socket.data.canonicalSubscriptions.has(event.sessionId)) continue;
      if (!socket.data.hello) continue;
      send(socket, wire);
    }
  });
  Object.assign(server, {
    broadcastProtocol(value: Record<string, unknown>, streamId?: string) { for (const socket of sockets) if (!streamId || socket.data.subscriptions.has(streamId)) send(socket, value); },
    connectionCount() { return sockets.size; },
  });
  return server as BridgeServer;
}
