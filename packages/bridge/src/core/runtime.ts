import { COMMAND_METADATA, semanticCommandSha256 } from "@pi-mob/protocol-schema";
import { ControllerLeaseService, DurableCommandService, StreamService, type AdapterPort } from "./domain";
import type { BridgeRuntimePort, ConnectionContext, SubscriptionMessage, SubscriptionResult } from "./server";
import { BridgeStore, StoreError, type LeaseMutation } from "./store";

export class RuntimeProtocolError extends Error { override readonly name = "RuntimeProtocolError"; constructor(readonly code: string, message: string) { super(message); } }
const SUMMARY_EVENT_TYPES = new Set(["session.state", "session.metadata", "controller.state", "turn.started", "turn.waiting_for_input", "turn.settled", "turn.aborted", "turn.failed", "turn.indeterminate", "queue.snapshot", "command.state", "error.event"]);
const SUMMARY_STATE_KEYS = new Set(["runtimeState", "attentionState", "policyMode", "modelSummary", "queueCount", "lastActivityAt", "controllerSummary"]);
export interface DurableRuntimeOptions { readonly store: BridgeStore; readonly adapter: AdapterPort; readonly bridgeVersion: string; readonly piVersion: string; readonly hostDisplayName: string; }

export class DurableBridgeRuntime implements BridgeRuntimePort {
  readonly bridgeVersion: string;
  readonly piVersion: string;
  readonly commands: DurableCommandService;
  readonly streams: StreamService;
  readonly leases: ControllerLeaseService;
  private readonly hostDisplayName: string;
  private readyState = false;
  constructor(readonly options: DurableRuntimeOptions) {
    this.bridgeVersion = options.bridgeVersion; this.piVersion = options.piVersion; this.hostDisplayName = options.hostDisplayName;
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
    return {};
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
    const requestedSession = typeof payload.sessionId === "string" ? payload.sessionId : null;
    const sessionId = metadata.scope === "session" ? requestedSession : metadata.scope === "host-or-session" && payload.scope === "session" ? requestedSession : null;
    if ((metadata.scope === "session" || payload.scope === "session") && !sessionId) throw new RuntimeProtocolError("session_not_found", "session ID is required");
    if (sessionId && !this.options.store.sessionExists(sessionId)) throw new RuntimeProtocolError("session_not_found", "session does not exist");
    const identity = this.identity(); const streamId = sessionId ? `session:${sessionId}` : `host:${identity.hostId}`; const scopeKey = streamId;
    if (metadata.requiresLeaseId) {
      try { this.leases.assertController(scopeKey, String(message.leaseId ?? ""), connection.connectionId); }
      catch { throw new RuntimeProtocolError("stale_controller", "controller lease is stale"); }
    }
    const leaseMutation: LeaseMutation | undefined = type === "controller.acquire" || type === "controller.takeover"
      ? { action: type === "controller.takeover" ? "takeover" : "acquire", scopeKey, installationId: connection.installationId, connectionId: connection.connectionId }
      : type === "controller.release"
      ? { action: "release", scopeKey, installationId: connection.installationId, connectionId: connection.connectionId }
      : undefined;
    let submission;
    try { submission = this.commands.submit({ commandId, type, payload, scopeKey, streamId, ...(leaseMutation ? { leaseMutation } : {}) }); }
    catch (error) {
      if (error instanceof StoreError && error.code === "conflict" && (type === "controller.acquire" || type === "controller.takeover")) throw new RuntimeProtocolError("controller_conflict", "controller is already held");
      if (error instanceof StoreError && error.code === "conflict" && type === "controller.release") throw new RuntimeProtocolError("stale_controller", "controller release is not authorized");
      throw error;
    }
    void submission.completion;
    return { state: submission.receipt.state, duplicate: submission.receipt.duplicate };
  }
  disconnected(connection: ConnectionContext): void { this.options.store.disconnectConnection(connection.connectionId); }
  async recover(): Promise<{ resumed: number; indeterminate: number }> { return this.commands.recover(); }
}
