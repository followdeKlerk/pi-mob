/**
 * Phase 2 — canonical session-event store facade.
 *
 * This module wraps the existing transactional `BridgeStore.appendEvent`
 * with the closed canonical-event contract from
 * `packages/bridge/src/session-events/canonical-event.ts`. The rewrite
 * slice reuses the underlying journal; it does not introduce a parallel
 * persistence layer.
 *
 * Responsibilities:
 *   - Validate that every event matches a closed canonical event type.
 *   - Assign stable identity (`eventId` and `sourceEventId`) before
 *     persisting so duplicate raw Pi notifications do not duplicate
 *     canonical events.
 *   - Emit a post-commit notification through the existing
 *     `BridgeStore.onEvent()` listener so live WebSocket delivery
 *     remains persist-before-publish (plan §3.2).
 *   - Expose `readAfter`, `latestSequence`, and `append` so the
 *     WebSocket layer can subscribe and replay from canonical state.
 *
 * The facade is intentionally narrow. It does not own transcript
 * projection, command state, or session lifecycle events. Those stay
 * on `BridgeStore` directly. The facade only governs the canonical
 * session-event families declared in `canonical-event.ts`.
 *
 * Source-id dedup invariants:
 *   - The dedup set records *every* source id seen for a session, not
 *     just the latest one, so `A, B, A` correctly dedupes the second A.
 *   - The dedup membership is updated ONLY after a successful journal
 *     append. A failed append must allow the caller to retry the same
 *     source id without being misreported as a duplicate.
 *   - The dedup set is capped per session to bound memory; least
 *     recently inserted entries are evicted beyond the cap. The cap is
 *     intentionally large enough that production notifications never
 *     evict during a normal session.
 */

import type { BridgeStore, StoredEvent } from "../core/store";
import {
  CANONICAL_EVENT_TYPES,
  isCanonicalEventType,
  validateCanonicalEnvelope,
  type CanonicalEventEnvelope,
  type CanonicalEventType,
} from "./canonical-event";

/**
 * Default per-session cap on the dedup set. A busy Pi session rarely
 * produces more than a few thousand distinct notification ids during a
 * single chat; 8192 entries is multiple times that. Production wiring
 * can override this limit through {@link CanonicalEventStoreOptions}.
 */
export const CANONICAL_DEDUP_DEFAULT_LIMIT = 8192;

export interface CanonicalEventStoreOptions {
  readonly store: BridgeStore;
  /** Source-id generator. Defaults to `crypto.randomUUID()`. */
  readonly idGenerator?: () => string;
  /** Wall-clock supplier. Defaults to `Date.now`. */
  readonly now?: () => number;
  /**
   * Maximum number of source ids to remember per session. Exceeding the
   * cap evicts the oldest entries in insertion order. The default is
   * {@link CANONICAL_DEDUP_DEFAULT_LIMIT}.
   */
  readonly dedupLimit?: number;
}

/**
 * Narrow canonical-event writer input. Source-id is optional; when
 * present, the store deduplicates against previously observed source
 * events for the same session.
 */
export interface CanonicalEventInput {
  readonly type: CanonicalEventType;
  readonly payload: Readonly<Record<string, unknown>>;
  /** Stable upstream source identifier (e.g. raw Pi notification id). */
  readonly sourceEventId?: string;
}

export interface AppendResult {
  readonly events: readonly StoredEvent[];
  /** True when the source id was already seen and no new event was persisted. */
  readonly deduplicated: boolean;
}

/**
 * Canonical-event store facade. Construction is cheap; instances are
 * expected to be created once per bridge and passed around as a
 * singleton.
 */
export class CanonicalEventStore {
  private readonly store: BridgeStore;
  private readonly idGenerator: () => string;
  private readonly now: () => number;
  private readonly dedupLimit: number;
  /**
   * Per-session dedup sets. Each set tracks every source id observed
   * for the session so the second occurrence of any id is deduped.
   * Insertion order is preserved so eviction is FIFO.
   */
  private readonly seenSourceIds = new Map<string, Set<string>>();

  constructor(options: CanonicalEventStoreOptions) {
    this.store = options.store;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
    this.now = options.now ?? Date.now;
    const requested = options.dedupLimit ?? CANONICAL_DEDUP_DEFAULT_LIMIT;
    this.dedupLimit = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : CANONICAL_DEDUP_DEFAULT_LIMIT;
  }

  /**
   * Append one canonical event. The event is validated against the
   * closed type set; raw Pi notifications MUST be normalized into the
   * canonical shape before calling this method. The returned value is
   * available only AFTER the underlying `BridgeStore.appendEvent()`
   * commits, satisfying plan §3.2 (persist-before-publish). The call
   * is synchronous because the underlying journal write is.
   *
   * Source-id semantics:
   *   - When `sourceEventId` is supplied AND has already been observed
   *     for the session, the call returns `{ deduplicated: true }`
   *     without writing a new event.
   *   - When `sourceEventId` is supplied AND has not been observed, the
   *     store commits the append FIRST and only then records the
   *     source id. A failed append leaves the dedup set unchanged so
   *     the caller may retry the same id.
   */
  append(
    sessionId: string,
    input: CanonicalEventInput,
  ): AppendResult {
    if (!isCanonicalEventType(input.type)) {
      throw new Error(`canonical event type is not in the closed set: ${input.type}`);
    }
    if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 128) {
      throw new Error("sessionId must be a non-empty string up to 128 characters");
    }
    const streamId = `session:${sessionId}`;
    const position = this.store.streamPosition(streamId);
    if (!position) throw new Error(`session stream is not provisioned: ${streamId}`);
    const sequence = Number(BigInt(position.current) + 1n);
    const eventId = this.idGenerator();
    const occurredAt = new Date(this.now()).toISOString();
    const seen = this.seenSourceIds.get(sessionId);
    if (input.sourceEventId !== undefined && seen && seen.has(input.sourceEventId)) {
      const existing = this.readAfter(sessionId, sequence - 1, 1);
      return { events: existing, deduplicated: true };
    }
    const envelope: CanonicalEventEnvelope = {
      eventId,
      sessionId,
      sequence,
      type: input.type,
      occurredAt,
      payload: { ...input.payload, sessionId, occurredAt },
    };
    const validation = validateCanonicalEnvelope(envelope);
    if (validation !== null) throw new Error(`invalid canonical envelope: ${validation}`);
    const stored = this.store.appendEvent(streamId, input.type, {
      ...input.payload,
      sessionId,
      canonicalSequence: sequence,
      canonicalEventId: eventId,
      canonicalOccurredAt: occurredAt,
    });
    // Only record the source id after the append succeeds. A failed
    // append preserves the dedup invariant so the caller may retry the
    // same source id without being incorrectly labelled a duplicate.
    if (input.sourceEventId !== undefined) this.recordSourceId(sessionId, input.sourceEventId);
    return { events: [stored], deduplicated: false };
  }

  /**
   * Record a source id for the session, evicting the oldest entries
   * when the dedup cap is exceeded. Exposed for callers that need to
   * pre-warm the dedup set (e.g. integration tests) without going
   * through `append`.
   */
  recordSourceId(sessionId: string, sourceEventId: string): void {
    let set = this.seenSourceIds.get(sessionId);
    if (!set) {
      set = new Set();
      this.seenSourceIds.set(sessionId, set);
    }
    set.add(sourceEventId);
    while (set.size > this.dedupLimit) {
      const first = set.values().next().value;
      if (first === undefined) break;
      set.delete(first);
    }
  }

  /** Test-only helper: did we record this source id for this session? */
  hasSourceId(sessionId: string, sourceEventId: string): boolean {
    return this.seenSourceIds.get(sessionId)?.has(sourceEventId) ?? false;
  }

  /** Read every persisted canonical event with sequence > `after`. */
  readAfter(sessionId: string, after: number, limit?: number): readonly StoredEvent[] {
    if (!Number.isInteger(after) || after < 0) throw new Error("after must be a non-negative integer");
    const streamId = `session:${sessionId}`;
    const all = this.store.listEvents(streamId, String(after));
    const filtered = all.filter((event) => (CANONICAL_EVENT_TYPES as readonly string[]).includes(event.type));
    return typeof limit === "number" ? filtered.slice(0, limit) : filtered;
  }

  /** Return the highest sequence number persisted for this session. */
  latestSequence(sessionId: string): number {
    const streamId = `session:${sessionId}`;
    const position = this.store.streamPosition(streamId);
    return position ? Number(BigInt(position.current)) : 0;
  }

  /** Subscribe to post-commit canonical events. Used by the WebSocket layer. */
  onCommit(listener: (event: StoredEvent) => void): () => void {
    return this.store.onEvent((event) => {
      if (!(CANONICAL_EVENT_TYPES as readonly string[]).includes(event.type)) return;
      listener(event);
    });
  }
}

function defaultIdGenerator(): string {
  return crypto.randomUUID().toLowerCase();
}
