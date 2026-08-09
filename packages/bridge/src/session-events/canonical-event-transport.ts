/**
 * Phase 4 — canonical session-event transport layer.
 *
 * This module owns the per-connection canonical-session-event
 * subscription state. It implements:
 *
 *   1. Subscribe-before-replay: a connection registers for one or
 *      more `sessionId`s BEFORE any replay is read, so events
 *      committed during the replay window are buffered.
 *   2. Strict sequence replay: the dedicated canonical-session-event
 *      log is queried for `sequence > afterSequence`, in strict
 *      sequence order, with a bounded batch size (default 256).
 *   3. Replay/live identical shape: the wire envelope produced for
 *      replay and live frames is byte-shape equivalent (plan §3.4).
 *      Both shapes use the dedicated top-level canonical frame
 *      defined in `canonical-session-store.ts`.
 *   4. Persist-before-publish (plan §3.2): the transport listens to
 *      `CanonicalSessionStore.onCommit()` which only fires AFTER the
 *      underlying SQLite transaction commits.
 *   5. Reconnect/lag recovery: a client re-subscribes with its last
 *      applied sequence; the server may reread from SQLite to
 *      recover missed events.
 *
 * Legacy streams are unchanged. The transport is opt-in and is
 * constructed only when the runtime exposes `session_events.v2` in
 * its capability list.
 */

import type { CanonicalSessionStore, CanonicalSessionEventRecord } from "./canonical-session-store";
import { encodeCanonicalEnvelope } from "./canonical-session-store";
import { PROTOCOL_MAJOR, PROTOCOL_MINOR } from "@pi-mob/protocol-schema";

export interface CanonicalEventSubscription {
  /** The session this subscription tracks. */
  readonly sessionId: string;
  /** Highest sequence the consumer has durably applied. */
  lastAppliedSequence: number;
  /**
   * Whether the subscription is currently mid-replay. New
   * post-commit canonical events arriving while replaying are
   * buffered in `pending` instead of being delivered immediately.
   */
  replayInFlight: boolean;
  /** Pending events captured during the replay window. */
  pending: CanonicalSessionEventRecord[];
  /**
   * Subscriber callback invoked for every replay and live event
   * after the replay window has closed. The transport guarantees
   * the callback is invoked in strict per-session sequence order.
   */
  onEvent: (event: CanonicalSessionEventRecord) => void;
  /**
   * Optional callback invoked when replay completes successfully.
   * The transport calls this ONCE per subscription, after the
   * pending buffer has been flushed in sequence order.
   */
  onReplayComplete?: () => void;
}

export interface CanonicalEventTransportOptions {
  readonly store: CanonicalSessionStore;
  /**
   * Maximum batch size used when reading replay events from the
   * dedicated canonical log. The transport pages internally until
   * the log is exhausted or the subscriber's `afterSequence`
   * matches the committed tail. Defaults to 256.
   */
  readonly replayBatchSize?: number;
  /**
   * Maximum number of pending events buffered during the replay
   * window. If exceeded, the transport switches to rereading from
   * the durable log rather than buffering indefinitely.
   */
  readonly pendingLimit?: number;
}

/**
 * Replay pages stay below the bridge's 1 MiB outbound JSON limit even
 * when replacement-content events carry large snapshots. The client
 * still enforces the protocol's independent 1024-item maximum.
 */
const DEFAULT_REPLAY_BATCH_SIZE = 256;
const DEFAULT_REPLAY_MAX_BYTES = 512 * 1024;

/**
 * Default pending-event ceiling during the replay window. The
 * transport rereads from SQLite past this cap to guarantee
 * sequence completeness.
 */
const DEFAULT_PENDING_LIMIT = 1024;

/**
 * Wire envelope for one canonical session event. The shape is
 * identical for replay and live delivery (plan §3.4 / §8.4) so a
 * client cannot distinguish a replayed event from a live event.
 */
export interface CanonicalWireEvent {
  readonly eventId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface CanonicalReplayResult {
  readonly sessionId: string;
  readonly events: readonly CanonicalWireEvent[];
  readonly latestSequence: number;
  readonly complete: boolean;
}

/**
 * Per-process canonical-event transport. The transport is
 * constructed by the bridge runtime when the host advertises
 * `session_events.v2`. The transport owns:
 *
 *   - A map of per-connection subscriptions keyed by connection id
 *     and session id.
 *   - The post-commit listener that drains live events into the
 *     correct subscription (replay buffer or direct dispatch).
 *
 * The transport deliberately does NOT touch the legacy stream
 * layer. The existing `subscription.set` flow stays intact.
 */
export class CanonicalEventTransport {
  private readonly store: CanonicalSessionStore;
  private readonly replayBatchSize: number;
  private readonly pendingLimit: number;
  /** connectionId -> sessionId -> subscription */
  private readonly subscriptions = new Map<string, Map<string, CanonicalEventSubscription>>();
  private unsubscribeCommit: () => void;

  constructor(options: CanonicalEventTransportOptions) {
    this.store = options.store;
    this.replayBatchSize = options.replayBatchSize ?? DEFAULT_REPLAY_BATCH_SIZE;
    this.pendingLimit = options.pendingLimit ?? DEFAULT_PENDING_LIMIT;
    this.unsubscribeCommit = this.store.onCommit((event) => this.deliverLive(event));
  }

  /**
   * Subscribe one connection to a session's canonical events and
   * read the durable replay in strict sequence order. The method
   * returns the complete replay batch plus the latest committed
   * sequence so the client can verify it has the most recent
   * canonical event.
   *
   * The method is synchronous because the underlying SQLite read
   * is synchronous. The transport buffers live events arriving
   * during the replay window so the client never sees a gap.
   */
  subscribe(
    connectionId: string,
    sessionId: string,
    afterSequence: number,
    onEvent: (event: CanonicalSessionEventRecord) => void,
    onReplayComplete?: () => void,
  ): CanonicalReplayResult {
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new Error("afterSequence must be a non-negative integer");
    }
    if (typeof connectionId !== "string" || connectionId.length === 0) {
      throw new Error("connectionId is required");
    }
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new Error("sessionId is required");
    }
    if (typeof onEvent !== "function") {
      throw new Error("onEvent callback is required");
    }
    let perSession = this.subscriptions.get(connectionId);
    if (!perSession) {
      perSession = new Map();
      this.subscriptions.set(connectionId, perSession);
    }
    const existing = perSession.get(sessionId);
    const subscription: CanonicalEventSubscription = existing?.replayInFlight
      ? existing
      : {
          sessionId,
          lastAppliedSequence: afterSequence,
          replayInFlight: true,
          pending: [],
          onEvent,
          ...(onReplayComplete ? { onReplayComplete } : {}),
        };
    if (existing?.replayInFlight) {
      if (afterSequence !== existing.lastAppliedSequence) {
        throw new Error("canonical replay cursor does not match the active replay");
      }
      subscription.onEvent = onEvent;
      if (onReplayComplete) subscription.onReplayComplete = onReplayComplete;
    } else {
      perSession.set(sessionId, subscription);
    }
    // Return one bounded page. The client repeats the same subscription
    // with the returned cursor until `complete` is true. Keeping the
    // subscription in replay mode across those requests lets the
    // transport buffer post-commit events instead of exposing a gap.
    const page = this.store.readAfter(sessionId, afterSequence, this.replayBatchSize);
    const replay: CanonicalWireEvent[] = [];
    let replayBytes = 0;
    let cursor = afterSequence;
    const appendRecord = (record: CanonicalSessionEventRecord): boolean => {
      const wire = toWireEvent(record);
      const bytes = Buffer.byteLength(JSON.stringify(wire));
      if (
        replay.length > 0 &&
        replayBytes + bytes > DEFAULT_REPLAY_MAX_BYTES
      ) {
        return false;
      }
      cursor = record.sequence;
      replay.push(wire);
      replayBytes += bytes;
      subscription.lastAppliedSequence = record.sequence;
      return true;
    };
    for (const record of page) {
      if (record.sequence !== cursor + 1) {
        subscription.replayInFlight = false;
        throw new Error("canonical replay detected a sequence gap");
      }
      if (!appendRecord(record)) break;
    }
    // Only drain buffered events when the durable page is short. If the
    // page filled the item or byte bound, the next request must first
    // read the missing durable range and then merge any buffered tail.
    if (
      replay.length === page.length &&
      replay.length < this.replayBatchSize
    ) {
      const drained = subscription.pending
        .slice()
        .sort((left, right) => left.sequence - right.sequence);
      const retained: CanonicalSessionEventRecord[] = [];
      for (const record of drained) {
        if (record.sequence <= cursor) continue;
        if (record.sequence !== cursor + 1) {
          subscription.replayInFlight = false;
          throw new Error("canonical replay detected a sequence gap");
        }
        if (!appendRecord(record)) {
          retained.push(record);
          continue;
        }
      }
      subscription.pending = retained;
    }
    const latestSequence = this.store.latestSequence(sessionId);
    const complete =
      subscription.pending.every((record) => record.sequence <= cursor) &&
      cursor >= latestSequence;
    subscription.replayInFlight = !complete;
    if (complete) subscription.onReplayComplete?.();
    return {
      sessionId,
      events: replay,
      latestSequence,
      complete,
    };
  }

  /**
   * Discard a single connection's subscriptions. Idempotent. The
   * server calls this on socket close.
   */
  disconnect(connectionId: string): void {
    this.subscriptions.delete(connectionId);
  }

  /** Diagnostic: the number of active subscriptions for one connection. */
  connectionSubscriptionCount(connectionId: string): number {
    return this.subscriptions.get(connectionId)?.size ?? 0;
  }

  /** Diagnostic: the total number of subscriptions across all connections. */
  totalSubscriptionCount(): number {
    let total = 0;
    for (const inner of this.subscriptions.values()) total += inner.size;
    return total;
  }

  /**
   * Release the post-commit listener. The daemon calls this on
   * shutdown so the listener does not fire after the runtime has
   * stopped accepting writes.
   */
  close(): void {
    this.unsubscribeCommit();
    this.subscriptions.clear();
  }

  // ----- internals -----

  private deliverLive(event: CanonicalSessionEventRecord): void {
    for (const perSession of this.subscriptions.values()) {
      const subscription = perSession.get(event.sessionId);
      if (!subscription) continue;
      if (subscription.replayInFlight) {
        if (subscription.pending.length >= this.pendingLimit) {
          // Pending ceiling exceeded; drain the oldest so the
          // delivery ordering remains bounded. The replay window
          // will pick up any purged events from SQLite on its
          // next read.
          subscription.pending.shift();
        }
        subscription.pending.push(event);
        continue;
      }
      // After the replay window has closed, the live event MUST
      // match `lastAppliedSequence + 1`; otherwise we observed a
      // gap and the client must rebuild. The transport records
      // the gap on the subscription so the next `subscribe()`
      // returns `complete: false`.
      if (event.sequence <= subscription.lastAppliedSequence) {
        // Duplicate live event. The client already applied it
        // (probably via replay); drop it silently.
        continue;
      }
      if (event.sequence !== subscription.lastAppliedSequence + 1) {
        subscription.lastAppliedSequence = event.sequence - 1;
        // We don't recreate state here; the client will detect
        // the gap on its next `subscribe()` and rebuild.
        continue;
      }
      subscription.lastAppliedSequence = event.sequence;
      subscription.onEvent(event);
    }
  }
}

/** Encode one canonical record into the byte-shape-equivalent wire event. */
export function toWireEvent(record: Readonly<CanonicalSessionEventRecord>): CanonicalWireEvent {
  return {
    eventId: record.eventId,
    sessionId: record.sessionId,
    sequence: record.sequence,
    eventType: record.eventType,
    occurredAt: record.occurredAt,
    data: { ...record.payload },
  };
}

/** Encode a canonical envelope (used by adapters that build envelopes
 *  directly from raw normalized events without round-tripping through
 *  the dedicated log). */
export function toWireEnvelope(record: Readonly<CanonicalSessionEventRecord>): CanonicalWireEvent {
  const envelope = encodeCanonicalEnvelope(record);
  return {
    eventId: envelope.eventId,
    sessionId: envelope.sessionId,
    sequence: envelope.sequence,
    eventType: envelope.type,
    occurredAt: envelope.occurredAt,
    data: envelope.payload as Record<string, unknown>,
  };
}

/** Lightweight envelope helper used by tests and runtime to assemble
 *  the over-the-wire message that the server hands to its send
 *  helper. The transport does not own a send helper; the runtime
 *  calls this and writes the JSON envelope itself. */
export function buildLiveMessage(
  event: CanonicalWireEvent,
  requestId?: string,
): Record<string, unknown> {
  return {
    protocol: { major: PROTOCOL_MAJOR, minor: PROTOCOL_MINOR },
    messageId: crypto.randomUUID().toLowerCase(),
    ...(typeof requestId === "string" ? { requestId } : {}),
    type: "session.event",
    sentAt: new Date().toISOString(),
    payload: event,
  };
}

/** Build the replay-result response envelope the server returns after
 *  `session.events.subscribe`. The shape mirrors `session.event`
 *  element-by-element; only the wrapper differs. */
export function buildReplayResultMessage(
  result: CanonicalReplayResult,
  requestId: string,
): Record<string, unknown> {
  return {
    protocol: { major: PROTOCOL_MAJOR, minor: PROTOCOL_MINOR },
    messageId: crypto.randomUUID().toLowerCase(),
    requestId,
    type: "session.events.replay.result",
    sentAt: new Date().toISOString(),
    payload: result,
  };
}

/** Build a `session.event` wire envelope from a wire-shaped event.
 *  The runtime hands the resulting envelope to the WebSocket
 *  send helper so the live frame is byte-shape equivalent to a
 *  replay element. */
export function toWireMessage(event: CanonicalWireEvent, requestId?: string): Record<string, unknown> {
  return {
    protocol: { major: PROTOCOL_MAJOR, minor: PROTOCOL_MINOR },
    messageId: crypto.randomUUID().toLowerCase(),
    ...(typeof requestId === "string" ? { requestId } : {}),
    type: "session.event",
    sentAt: new Date().toISOString(),
    payload: event,
  };
}
