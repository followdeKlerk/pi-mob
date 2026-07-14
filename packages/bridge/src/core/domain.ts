import { compareDecimalCursors, semanticCommandSha256 } from "@pi-mob/protocol-schema";
import { BridgeStore, StoreError, type LeaseMutation, type LeaseRecord, type StoredCommand, type StoredEvent } from "./store";

export interface AdapterPort {
  dispatch(command: StoredCommand): Promise<void>;
  /**
   * Optional workspace listing for the `workspace.list` control flow.
   * Adapters that do not support multi-workspace discovery should
   * leave this undefined; the runtime surfaces `workspace_unavailable`.
   */
  listWorkspaces?(): { readonly items: ReadonlyArray<Record<string, unknown>> };
  listModels?(sessionId?: string): { readonly items: ReadonlyArray<Record<string, unknown>> };
  admission?(): { readonly accepting: boolean; readonly reason?: string };
  /** Reject invalid external references before durable command acceptance. */
  validateCommand?(type: string, payload: Record<string, unknown>): void;
  /** Non-throwing post-acceptance retention hook. */
  commandAccepted?(type: string, payload: Record<string, unknown>, commandId: string): void;
}
export class IndeterminateDispatchError extends Error {
  override readonly name = "IndeterminateDispatchError";
}

export interface CommandSubmission { readonly receipt: { commandId: string; state: string; duplicate: boolean }; readonly completion: Promise<void>; }

export class CommandLanes {
  private readonly tails = new Map<string, Promise<void>>();
  enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const prior = this.tails.get(key) ?? Promise.resolve();
    const current = prior.catch(() => undefined).then(task);
    this.tails.set(key, current);
    void current.finally(() => { if (this.tails.get(key) === current) this.tails.delete(key); });
    return current;
  }
}

const BRIDGE_LOCAL_COMMANDS = new Set(["controller.acquire", "controller.takeover", "controller.release"]);
export class DurableCommandService {
  private readonly lanes = new CommandLanes();
  constructor(readonly store: BridgeStore, readonly adapter: AdapterPort) {}

  submit(input: { commandId: string; type: string; payload: Record<string, unknown>; scopeKey: string; streamId: string; leaseMutation?: LeaseMutation }): CommandSubmission {
    const semanticHash = semanticCommandSha256({ type: input.type, payload: input.payload });
    const accepted = this.store.acceptCommand({ ...input, semanticHash });
    if (accepted.kind === "conflict") throw new StoreError("conflict", "idempotency conflict");
    if (accepted.kind === "duplicate") return { receipt: { commandId: input.commandId, state: accepted.command.state, duplicate: true }, completion: Promise.resolve() };
    const completion = this.dispatchAccepted(accepted.command);
    return { receipt: { commandId: input.commandId, state: "accepted", duplicate: false }, completion };
  }

  private dispatchAccepted(command: StoredCommand): Promise<void> {
    return this.lanes.enqueue(command.scopeKey, async () => {
      const claimed = this.store.transitionCommand(command.commandId, ["accepted"], "dispatched");
      if (!claimed) return;
      try {
        this.store.transitionCommand(command.commandId, ["dispatched"], "running");
        if (!BRIDGE_LOCAL_COMMANDS.has(claimed.command.type)) await this.adapter.dispatch(claimed.command);
        this.store.transitionCommand(command.commandId, ["running"], "completed");
      } catch (error) {
        this.store.transitionCommand(
          command.commandId,
          ["dispatched", "running"],
          error instanceof IndeterminateDispatchError ? "indeterminate" : "failed",
        );
      }
    });
  }

  async recover(): Promise<{ resumed: number; indeterminate: number }> {
    const indeterminate = this.store.markUncertainIndeterminate().length;
    const accepted = this.store.recoveryCandidates().filter((command) => command.state === "accepted");
    await Promise.all(accepted.map((command) => this.dispatchAccepted(command)));
    return { resumed: accepted.length, indeterminate };
  }
}

export class CursorInvalidError extends Error { override readonly name = "CursorInvalidError"; readonly code = "cursor_invalid"; }
export type SyncMode = "current" | "replay" | "snapshot_required";
export interface StreamSync {
  readonly mode: SyncMode;
  readonly baseline?: string;
  readonly snapshotParts?: readonly Record<string, unknown>[];
  readonly events: readonly StoredEvent[];
  readonly currentCursor: string;
}

export class StreamService {
  constructor(readonly store: BridgeStore, readonly maxSnapshotPartBytes = 64 * 1024) {}
  validateSubscriptions(hostStreamId: string, streams: readonly { streamId: string; detail: "full" | "summary" }[]): void {
    if (!streams.some((stream) => stream.streamId === hostStreamId)) throw new StoreError("conflict", "host stream is mandatory");
    if (streams.filter((stream) => stream.detail === "full" && stream.streamId.startsWith("session:")).length > 1) throw new StoreError("conflict", "only one full session subscription is allowed");
    if (streams.filter((stream) => stream.detail === "summary").length > 5) throw new StoreError("conflict", "too many summary subscriptions");
  }
  sync(streamId: string, afterCursor?: string): StreamSync {
    const position = this.store.streamPosition(streamId); if (!position) throw new StoreError("not_found", "stream not found");
    try { if (afterCursor !== undefined) compareDecimalCursors(afterCursor, position.current); }
    catch { throw new CursorInvalidError("cursor is not a canonical decimal string"); }
    if (afterCursor !== undefined) {
      const replay = this.store.readReplay(streamId, afterCursor);
      if (compareDecimalCursors(afterCursor, replay.current) === 0) return { mode: "current", events: [], currentCursor: replay.current };
      const invalid = compareDecimalCursors(afterCursor, replay.floor) < 0 || compareDecimalCursors(afterCursor, replay.current) > 0;
      if (!invalid) return { mode: "replay", events: replay.events, currentCursor: replay.current };
    }
    const snapshot = this.store.captureSnapshot(streamId);
    const json = JSON.stringify(snapshot.state); const parts: Record<string, unknown>[] = [];
    let fragment = ""; let fragmentBytes = 0;
    for (const character of json) {
      const bytes = new TextEncoder().encode(character).byteLength;
      if (fragment.length > 0 && fragmentBytes + bytes > this.maxSnapshotPartBytes) { parts.push({ index: parts.length, json: fragment }); fragment = ""; fragmentBytes = 0; }
      fragment += character; fragmentBytes += bytes;
    }
    if (fragment.length > 0) parts.push({ index: parts.length, json: fragment });
    if (parts.length === 0) parts.push({ index: 0, json: "{}" });
    const replay = this.store.readReplay(streamId, snapshot.baseline);
    return { mode: "snapshot_required", baseline: snapshot.baseline, snapshotParts: parts, events: replay.events, currentCursor: replay.current };
  }
  ack(installationId: string, cursors: Readonly<Record<string, string>>): void { for (const [streamId, cursor] of Object.entries(cursors)) this.store.ackCursor(installationId, streamId, cursor); }
}

export type ApplyResult = "applied" | "duplicate" | "gap" | "conflict";
export class StreamContinuityTracker {
  private readonly streams = new Map<string, { cursor: string; events: Map<string, string> }>();
  apply(event: Pick<StoredEvent, "streamId" | "cursor" | "eventId">): ApplyResult {
    const current = this.streams.get(event.streamId) ?? { cursor: "0", events: new Map<string, string>() };
    const seen = current.events.get(event.cursor);
    if (seen) return seen === event.eventId ? "duplicate" : "conflict";
    const expected = (BigInt(current.cursor) + 1n).toString();
    if (event.cursor !== expected) return "gap";
    current.cursor = event.cursor; current.events.set(event.cursor, event.eventId); this.streams.set(event.streamId, current); return "applied";
  }
  reset(streamId: string, cursor: string): void { this.streams.set(streamId, { cursor, events: new Map() }); }
}

export class ControllerLeaseService {
  constructor(readonly store: BridgeStore) {}
  acquire(scopeKey: string, installationId: string, connectionId: string, takeover = false, now?: number): LeaseRecord { return this.store.acquireLease(scopeKey, installationId, connectionId, now, takeover); }
  renew(scopeKey: string, leaseId: string, connectionId: string, now?: number): LeaseRecord { return this.store.renewLease(scopeKey, leaseId, connectionId, now); }
  disconnect(scopeKey: string, connectionId: string, now?: number): void { this.store.disconnectLease(scopeKey, connectionId, now); }
  release(scopeKey: string, leaseId: string, installationId: string, connectionId: string, now?: number): void { this.store.releaseLease(scopeKey, leaseId, installationId, connectionId, now); }
  assertController(scopeKey: string, leaseId: string, connectionId: string, now = Date.now()): void {
    const lease = this.store.lease(scopeKey);
    if (!lease || lease.leaseId !== leaseId || lease.connectionId !== connectionId || lease.revokedAt !== null || lease.expiresAt <= now) throw new StoreError("conflict", "stale controller");
  }
}
