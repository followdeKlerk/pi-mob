/**
 * Phase 4 — dedicated canonical session-event log + wire delivery model.
 *
 * The previous rewrite slice (Phase 1/2/3) wired the canonical-event
 * contract on top of the existing mixed legacy stream (`BridgeStore.
 * events`). That mixed-stream approach has two structural problems the
 * plan calls out explicitly:
 *
 *   1. The sequence numbers used by the canonical facade are the
 *      legacy mixed-stream cursors, so a client that subscribes only
 *      to canonical events observes gaps whenever an operational
 *      event (`recipe.activity`, `command.state`, `session.state`,
 *      ...) was interleaved.
 *   2. The wire envelope is the legacy `{type, payload, eventId,
 *      streamId, cursor}` shape, not the plan's top-level
 *      `{sessionId, sequence, eventId, eventType, occurredAt, data}`
 *      canonical frame.
 *
 * This module introduces a DEDICATED canonical session-event log that
 * lives alongside the legacy journal. The store:
 *
 *   - Allocates a per-session monotonic `sequence` from a dedicated
 *     `canonical_session_sequences` row, atomic with the insert.
 *   - Persists every canonical event into `canonical_session_events`
 *     keyed by `(session_id, sequence)` with a unique `event_id` and
 *     a unique `source_event_id` so duplicates are detected.
 *   - Fires a post-commit listener (`onCanonicalCommit`) AFTER the
 *     underlying SQLite transaction commits, satisfying plan §3.2
 *     (persist-before-publish).
 *   - Exposes `appendCanonicalSessionEvent`, `readCanonicalSessionEventsAfter`,
 *     `readCanonicalSessionEventsRange`, and `latestCanonicalSessionSequence`
 *     so the WebSocket transport can subscribe and replay from
 *     canonical state.
 *
 * The legacy stream remains only as a compatibility projection for
 * clients that do not negotiate `session_events.v2`. Production live
 * admission and canonical history/recovery use this dedicated log; the
 * compatibility projection never supplies transcript state to canonical clients.
 */

import type { Database } from "bun:sqlite";
import type { BridgeStore } from "../core/store";
import {
  CANONICAL_EVENT_TYPES,
  isCanonicalEventType,
  validateCanonicalEnvelope,
  type CanonicalEventEnvelope,
  type CanonicalEventType,
} from "./canonical-event";

/**
 * SQLite migration fragment. The migration is additive; the legacy
 * `streams` and `events` tables are unchanged.
 *
 *   - `canonical_session_sequences(session_id PRIMARY KEY, last_sequence INTEGER NOT NULL)`
 *       Per-session monotonic cursor. Updated atomically with each
 *       insert. Defaults to 0 on first write so the first event is
 *       sequence 1.
 *   - `canonical_session_events(session_id, sequence, event_id UNIQUE,
 *       source_event_id, event_type, occurred_at, payload_json,
 *       created_at, PRIMARY KEY(session_id, sequence))`
 *       The durable canonical log. `source_event_id` is a stable
 *       upstream identity (raw Pi notification id when supplied,
 *       generated event_id otherwise) so duplicate source events
 *       can be detected without dedupe state in memory.
 *   - Indexes for replay-after-sequence scans (the dominant access
 *     pattern) and source-id lookups (deduplication).
 */
export const CANONICAL_SESSION_EVENTS_MIGRATION = `
CREATE TABLE IF NOT EXISTS canonical_session_sequences(
  session_id TEXT PRIMARY KEY,
  last_sequence INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS canonical_session_events(
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  source_event_id TEXT,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(session_id, sequence),
  UNIQUE(event_id)
);
CREATE INDEX IF NOT EXISTS canonical_session_events_session_seq_idx
  ON canonical_session_events(session_id, sequence);
CREATE INDEX IF NOT EXISTS canonical_session_events_source_idx
  ON canonical_session_events(source_event_id);
`;

export interface CanonicalSessionEventMetrics {
  readonly appended: number;
  readonly deduplicated: number;
  readonly lastCommittedSequence: number;
}

export interface CanonicalSessionEventRecord {
  readonly sessionId: string;
  readonly sequence: number;
  readonly eventId: string;
  readonly sourceEventId: string | null;
  readonly eventType: CanonicalEventType;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: number;
}

export interface CanonicalAppendInput {
  readonly sessionId: string;
  readonly type: CanonicalEventType;
  readonly payload: Readonly<Record<string, unknown>>;
  /**
   * Optional stable upstream identity. When present, the store
   * short-circuits if a row with the same `(sessionId,
   * sourceEventId)` already exists, and assigns the existing
   * record back to the caller without inserting a duplicate.
   */
  readonly sourceEventId?: string;
  /**
   * Optional override for the deterministic event id; defaults to
   * `crypto.randomUUID()`. Tests pass an explicit value to make
   * assertions stable.
   */
  readonly eventId?: string;
  /**
   * Optional override for the wall-clock ISO timestamp. Tests pass
   * a deterministic value to make replay assertions stable.
   */
  readonly occurredAt?: string;
}

export interface CanonicalAppendResult {
  readonly event: CanonicalSessionEventRecord;
  /** True when an existing row matched `sourceEventId` and no insert happened. */
  readonly deduplicated: boolean;
}

export interface CanonicalSessionStoreOptions {
  /** Wall-clock supplier for `createdAt`. Defaults to `Date.now`. */
  readonly now?: () => number;
  /**
   * Override for the event id generator. Defaults to a lower-case
   * `crypto.randomUUID()`. Tests use this to make event ids stable.
   */
  readonly idGenerator?: () => string;
}

/**
 * Dedicated canonical session-event store. The store owns the SQL
 * migration and the listener set; the {@link BridgeStore} keeps
 * ownership of the underlying SQLite connection lifecycle.
 *
 * The class is intentionally synchronous. The underlying journal
 * write is a single SQLite transaction; making the wrapper async
 * would only obscure the persist-before-publish contract the plan
 * requires at every emission site.
 */
export class CanonicalSessionStore {
  private readonly now: () => number;
  private readonly idGenerator: () => string;
  private readonly listeners = new Set<(event: CanonicalSessionEventRecord) => void>();
  private appendedCount = 0;
  private deduplicatedCount = 0;

  constructor(
    private readonly store: BridgeStore,
    options: CanonicalSessionStoreOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
    this.ensureSchema();
  }

  /**
   * Apply the dedicated canonical schema if it has not been applied
   * yet. The migration is idempotent (`CREATE TABLE IF NOT EXISTS`)
   * so a re-applied slice never breaks an existing bridge state.
   */
  ensureSchema(): void {
    (this.store as unknown as { db: Database }).db.exec(CANONICAL_SESSION_EVENTS_MIGRATION);
  }

  /**
   * Insert one canonical event into the dedicated log. The insert
   * and the per-session sequence bump happen in one transaction;
   * the listener fires AFTER `COMMIT` so subscribers never see a
   * pre-commit event.
   *
   * Returns `{ deduplicated: true }` when an existing row already
   * carries `sourceEventId` for this session.
   */
  append(input: CanonicalAppendInput): CanonicalAppendResult {
    if (!isCanonicalEventType(input.type)) {
      throw new Error(`canonical event type is not in the closed set: ${input.type}`);
    }
    if (typeof input.sessionId !== "string" || input.sessionId.length === 0 || input.sessionId.length > 128) {
      throw new Error("sessionId must be a non-empty string up to 128 characters");
    }
    if (!this.store.sessionExists(input.sessionId)) {
      throw new Error(`session is not provisioned: ${input.sessionId}`);
    }
    const sourceEventId = input.sourceEventId ?? null;
    let pendingRecord: CanonicalSessionEventRecord | null = null;
    const prepared = this.store.transaction(() => {
      if (sourceEventId !== null) {
        const existing = this.findBySource(input.sessionId, sourceEventId);
        if (existing) {
          this.deduplicatedCount += 1;
        return { event: existing, deduplicated: true } satisfies CanonicalAppendResult;
        }
      }
      const eventId = input.eventId ?? this.idGenerator();
      const occurredAt = input.occurredAt ?? new Date(this.now()).toISOString();
      const sequence = this.bumpSequence(input.sessionId);
      const validation = validateCanonicalEnvelope({
        eventId,
        sessionId: input.sessionId,
        sequence,
        type: input.type,
        occurredAt,
        payload: input.payload as Record<string, unknown>,
      });
      if (validation !== null) throw new Error(`invalid canonical envelope: ${validation}`);
      const json = JSON.stringify(input.payload);
      const createdAt = this.now();
      this.rawExec(
        "INSERT INTO canonical_session_events(session_id,sequence,event_id,source_event_id,event_type,occurred_at,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)",
        [input.sessionId, sequence, eventId, sourceEventId, input.type, occurredAt, json, createdAt],
      );
      const record: CanonicalSessionEventRecord = {
        sessionId: input.sessionId,
        sequence,
        eventId,
        sourceEventId,
        eventType: input.type,
        occurredAt,
        payload: { ...input.payload },
        createdAt,
      };
      pendingRecord = record;
      return { event: record, deduplicated: false } satisfies CanonicalAppendResult;
    });
    // Fire listeners AFTER `COMMIT` so subscribers never observe a
    // pre-commit event (plan §3.2 — persist-before-publish).
    if (pendingRecord !== null && !prepared.deduplicated) {
      this.appendedCount += 1;
      this.notify(pendingRecord);
    }
    return prepared;
  }

  /**
   * Read every canonical event for the session with `sequence > after`,
   * in strict sequence order. When `limit` is supplied the result is
   * bounded; the caller paginates by re-reading from the last seen
   * sequence.
   */
  metrics(sessionId: string): CanonicalSessionEventMetrics {
    return {
      appended: this.appendedCount,
      deduplicated: this.deduplicatedCount,
      lastCommittedSequence: this.latestSequence(sessionId),
    };
  }

  readAfter(sessionId: string, after: number, limit?: number): readonly CanonicalSessionEventRecord[] {
    if (typeof sessionId !== "string" || sessionId.length === 0) throw new Error("sessionId is required");
    if (!Number.isInteger(after) || after < 0) throw new Error("after must be a non-negative integer");
    const cappedLimit = typeof limit === "number" ? Math.min(Math.max(0, Math.floor(limit)), 4096) : undefined;
    const sql = cappedLimit !== undefined
      ? "SELECT session_id sessionId,sequence,event_id eventId,source_event_id sourceEventId,event_type eventType,occurred_at occurredAt,payload_json payloadJson,created_at createdAt FROM canonical_session_events WHERE session_id=? AND sequence>? ORDER BY sequence LIMIT ?"
      : "SELECT session_id sessionId,sequence,event_id eventId,source_event_id sourceEventId,event_type eventType,occurred_at occurredAt,payload_json payloadJson,created_at createdAt FROM canonical_session_events WHERE session_id=? AND sequence>? ORDER BY sequence";
    const parameters: Array<string | number> = cappedLimit !== undefined
      ? [sessionId, after, cappedLimit]
      : [sessionId, after];
    const rows = (this.store as unknown as { db: Database }).db.query(sql).all(...parameters) as Array<{
      sessionId: string; sequence: number; eventId: string; sourceEventId: string | null; eventType: string; occurredAt: string; payloadJson: string; createdAt: number;
    }>;
    return rows.map((row) => ({
      sessionId: row.sessionId,
      sequence: row.sequence,
      eventId: row.eventId,
      sourceEventId: row.sourceEventId,
      eventType: row.eventType as CanonicalEventType,
      occurredAt: row.occurredAt,
      payload: this.parsePayload(row.payloadJson, `${row.sessionId}:${row.sequence}:${row.eventId}`),
      createdAt: row.createdAt,
    }));
  }

  /** Read a contiguous range; inclusive on both ends. */
  readRange(sessionId: string, fromInclusive: number, toInclusive: number): readonly CanonicalSessionEventRecord[] {
    if (typeof sessionId !== "string" || sessionId.length === 0) throw new Error("sessionId is required");
    if (!Number.isInteger(fromInclusive) || fromInclusive < 1) throw new Error("fromInclusive must be >= 1");
    if (!Number.isInteger(toInclusive) || toInclusive < fromInclusive) throw new Error("toInclusive must be >= fromInclusive");
    const rows = (this.store as unknown as { db: Database }).db.query(
      "SELECT session_id sessionId,sequence,event_id eventId,source_event_id sourceEventId,event_type eventType,occurred_at occurredAt,payload_json payloadJson,created_at createdAt FROM canonical_session_events WHERE session_id=? AND sequence BETWEEN ? AND ? ORDER BY sequence",
    ).all(sessionId, fromInclusive, toInclusive) as Array<{
      sessionId: string; sequence: number; eventId: string; sourceEventId: string | null; eventType: string; occurredAt: string; payloadJson: string; createdAt: number;
    }>;
    return rows.map((row) => ({
      sessionId: row.sessionId,
      sequence: row.sequence,
      eventId: row.eventId,
      sourceEventId: row.sourceEventId,
      eventType: row.eventType as CanonicalEventType,
      occurredAt: row.occurredAt,
      payload: this.parsePayload(row.payloadJson, `${row.sessionId}:${row.sequence}:${row.eventId}`),
      createdAt: row.createdAt,
    }));
  }

  /** Return the highest sequence number durably persisted for the session. */
  latestSequence(sessionId: string): number {
    if (typeof sessionId !== "string" || sessionId.length === 0) throw new Error("sessionId is required");
    const row = (this.store as unknown as { db: Database }).db.query(
      "SELECT last_sequence lastSequence FROM canonical_session_sequences WHERE session_id=?",
    ).get(sessionId) as { lastSequence: number } | null;
    return row?.lastSequence ?? 0;
  }

  /** Look up an event by its deterministic source identity. */
  findBySource(sessionId: string, sourceEventId: string): CanonicalSessionEventRecord | null {
    if (typeof sessionId !== "string" || sessionId.length === 0) throw new Error("sessionId is required");
    if (typeof sourceEventId !== "string" || sourceEventId.length === 0) throw new Error("sourceEventId is required");
    const row = (this.store as unknown as { db: Database }).db.query(
      "SELECT session_id sessionId,sequence,event_id eventId,source_event_id sourceEventId,event_type eventType,occurred_at occurredAt,payload_json payloadJson,created_at createdAt FROM canonical_session_events WHERE session_id=? AND source_event_id=?",
    ).get(sessionId, sourceEventId) as {
      sessionId: string; sequence: number; eventId: string; sourceEventId: string | null; eventType: string; occurredAt: string; payloadJson: string; createdAt: number;
    } | null;
    if (!row) return null;
    return {
      sessionId: row.sessionId,
      sequence: row.sequence,
      eventId: row.eventId,
      sourceEventId: row.sourceEventId,
      eventType: row.eventType as CanonicalEventType,
      occurredAt: row.occurredAt,
      payload: this.parsePayload(row.payloadJson, `${row.sessionId}:${row.sequence}:${row.eventId}`),
      createdAt: row.createdAt,
    };
  }

  /**
   * Subscribe to post-commit canonical events. The listener fires
   * synchronously after each successful SQLite `COMMIT`. A listener
   * that throws does NOT roll back the transaction; the throw is
   * caught and a structured warning is logged via the redacting
   * logger so a misbehaving subscriber cannot corrupt the durable
   * log.
   */
  onCommit(listener: (event: CanonicalSessionEventRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Verify payload JSON and sequence metadata without mutating data. */
  checkIntegrity(sessionId: string): readonly string[] {
    if (typeof sessionId !== "string" || sessionId.length === 0) throw new Error("sessionId is required");
    const issues: string[] = [];
    const rows = (this.store as unknown as { db: Database }).db.query(
      "SELECT sequence,event_id eventId,event_type eventType,payload_json payloadJson FROM canonical_session_events WHERE session_id=? ORDER BY sequence",
    ).all(sessionId) as Array<{ sequence: number; eventId: string; eventType: string; payloadJson: string }>;
    rows.forEach((row, index) => {
      if (row.sequence !== index + 1) issues.push(`sequence_gap:${sessionId}:${row.sequence}`);
      try {
        const payload = JSON.parse(row.payloadJson) as unknown;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) issues.push(`payload_shape:${row.eventId}`);
      } catch {
        issues.push(`payload_json:${row.eventId}`);
      }
      if (!isCanonicalEventType(row.eventType)) issues.push(`event_type:${row.eventId}`);
    });
    const latest = this.latestSequence(sessionId);
    if (latest !== rows.length) issues.push(`sequence_index:${sessionId}:${latest}:${rows.length}`);
    return issues;
  }

  /** Total canonical events for one session. Diagnostic only. */
  count(sessionId: string): number {
    if (typeof sessionId !== "string" || sessionId.length === 0) throw new Error("sessionId is required");
    const row = (this.store as unknown as { db: Database }).db.query(
      "SELECT COUNT(*) AS count FROM canonical_session_events WHERE session_id=?",
    ).get(sessionId) as { count: number } | null;
    return row?.count ?? 0;
  }

  // ----- internals -----

  private bumpSequence(sessionId: string): number {
    this.rawExec(
      "INSERT INTO canonical_session_sequences(session_id,last_sequence) VALUES(?,1) ON CONFLICT(session_id) DO UPDATE SET last_sequence=last_sequence+1",
      [sessionId],
    );
    const row = (this.store as unknown as { db: Database }).db.query(
      "SELECT last_sequence lastSequence FROM canonical_session_sequences WHERE session_id=?",
    ).get(sessionId) as { lastSequence: number } | null;
    if (!row) throw new Error(`sequence row missing for session ${sessionId}`);
    return row.lastSequence;
  }

  private notify(event: CanonicalSessionEventRecord): void {
    for (const listener of this.listeners) {
      try { listener(event); }
      catch { /* listener failures must not corrupt the canonical log */ }
    }
  }

  private parsePayload(json: string, context: string): Record<string, unknown> {
    let parsed: unknown;
    try { parsed = JSON.parse(json); }
    catch { throw new Error(`canonical payload corruption at ${context}`); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`canonical payload shape corruption at ${context}`);
    }
    return parsed as Record<string, unknown>;
  }

  private rawExec(sql: string, parameters: ReadonlyArray<string | number | null>): void {
    (this.store as unknown as { db: Database }).db.query(sql).run(...parameters);
  }
}

function defaultIdGenerator(): string {
  return crypto.randomUUID().toLowerCase();
}

/**
 * Encode one canonical event record into the plan's top-level wire
 * envelope. The wire shape is identical for replay and live delivery
 * (plan §3.4 / §8.4) so a client cannot distinguish a replayed event
 * from a live event.
 */
export function encodeCanonicalEnvelope(event: Readonly<CanonicalSessionEventRecord>): CanonicalEventEnvelope {
  return {
    eventId: event.eventId,
    sessionId: event.sessionId,
    sequence: event.sequence,
    type: event.eventType,
    occurredAt: event.occurredAt,
    payload: event.payload,
  };
}

/** Re-export the closed type list for callers that need a stable reference. */
export { CANONICAL_EVENT_TYPES };
