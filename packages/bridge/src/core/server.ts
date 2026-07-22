import { ERROR_CODES, LIMITS, PROTOCOL_MAJOR, PROTOCOL_MINOR, validateFixture } from "@pi-mob/protocol-schema";

const MAX_JSON_BYTES = LIMITS.maxJsonBytes;
export const MAX_OUTBOUND_BYTES = 8 * 1024 * 1024;
export function exceedsSlowConsumerLimit(bufferedBytes: number, nextMessageBytes: number): boolean { return bufferedBytes + nextMessageBytes > MAX_OUTBOUND_BYTES; }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const SUMMARY_EVENTS = new Set(["session.state", "session.metadata", "controller.state", "turn.started", "turn.waiting_for_input", "turn.settled", "turn.aborted", "turn.failed", "turn.indeterminate", "queue.snapshot", "command.state", "error.event"]);
function compareCursor(left: string, right: string): number { return left.length === right.length ? left.localeCompare(right) : left.length - right.length; }

export interface SubscriptionMessage { readonly type: string; readonly payload: Record<string, unknown>; readonly eventId?: string; readonly streamId?: string; readonly cursor?: string; }
export interface SubscriptionResult { readonly streams: readonly Record<string, unknown>[]; readonly messages?: readonly SubscriptionMessage[]; }
export interface BridgeRuntimePort {
  readonly bridgeVersion: string;
  readonly piVersion: string;
  identity(): { hostId: string; hostGeneration: string; hostDisplayName: string };
  ready(): { ready: boolean; reason?: string };
  /** Additive optional capabilities; absence must remain explicit to clients. */
  optionalCapabilities?(): readonly string[];
  subscribe(connection: ConnectionContext, payload: Record<string, unknown>): Promise<SubscriptionResult> | SubscriptionResult;
  control(connection: ConnectionContext, type: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  command(connection: ConnectionContext, message: Record<string, unknown>): Promise<Record<string, unknown>> | Record<string, unknown>;
  onEvent?(listener: (event: { eventId: string; streamId: string; cursor: string; type: string; payload: Record<string, unknown> }) => void): () => void;
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

function id(): string { return crypto.randomUUID().toLowerCase(); }
function envelope(type: string, payload: Record<string, unknown>, requestId?: unknown, commandId?: unknown): Record<string, unknown> {
  return { protocol: { major: PROTOCOL_MAJOR, minor: PROTOCOL_MINOR }, messageId: id(), ...(typeof requestId === "string" ? { requestId } : {}), ...(typeof commandId === "string" ? { commandId } : {}), type, sentAt: new Date().toISOString(), payload };
}
function context(data: SocketData): ConnectionContext { return { connectionId: data.connectionId, installationId: data.installationId, subscriptions: new Set(data.subscriptions.keys()) }; }
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
        const upgraded = server.upgrade(request, { data: { connectionId: id(), installationId: "", hello: false, synchronized: false, subscriptions: new Map(), syncing: false, pendingEvents: [], tokens: 20, tokenAt: Date.now(), queuedBytes: 0 } });
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
          const result = await options.runtime.control(context(ws.data), type, payload);
          if (result) send(ws, envelope(`${type}.result`, result, message.requestId));
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
    const required = Array.isArray(payload.requiredCapabilities) ? payload.requiredCapabilities : [];
    const capabilities = ["streams.v1", "commands.v1", "controller_leases.v1", ...(runtime.optionalCapabilities?.() ?? [])];
    if (required.some((item) => typeof item !== "string" || !capabilities.includes(item))) { sendError(ws, "unsupported_capability", "A required capability is unsupported.", message.requestId); ws.close(1002, "capability"); return; }
    if (!validateFixture({ name: "live", kind: "hello", valid: true, message })) { sendError(ws, "invalid_message", "Hello does not match the protocol schema.", message.requestId); return; }
    ws.data.installationId = installationId; ws.data.hello = true;
    send(ws, envelope("hello.accepted", { connectionId: ws.data.connectionId, hostId: identity.hostId, hostGeneration: identity.hostGeneration, hostDisplayName: identity.hostDisplayName, bridgeVersion: runtime.bridgeVersion, piVersion: runtime.piVersion, serverTime: new Date().toISOString(), capabilities, limits: LIMITS }, message.requestId));
  }
  function consumeToken(data: SocketData): boolean { const now = Date.now(); data.tokens = Math.min(20, data.tokens + (now - data.tokenAt) * 0.01); data.tokenAt = now; if (data.tokens < 1) return false; data.tokens -= 1; return true; }

  options.runtime.onEvent?.((event) => {
    for (const socket of sockets) {
      if (!socket.data.subscriptions.has(event.streamId)) continue;
      if (socket.data.syncing) socket.data.pendingEvents.push(event);
      else if (socket.data.synchronized) sendLiveEvent(socket, event);
    }
  });
  Object.assign(server, {
    broadcastProtocol(value: Record<string, unknown>, streamId?: string) { for (const socket of sockets) if (!streamId || socket.data.subscriptions.has(streamId)) send(socket, value); },
    connectionCount() { return sockets.size; },
  });
  return server as BridgeServer;
}
