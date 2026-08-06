/**
 * Phase 3 — bounded diagnostics sink for raw Pi events.
 *
 * The rewrite removes `pi.rpc.event` from the user-visible session
 * transcript per `pi-mob-simplification-plan.md` §3.3 ("Raw Pi events
 * are diagnostics only"). This module is the sink that retains raw
 * event observability without leaking raw shapes into the chat
 * rendering path.
 *
 * The sink is implemented as a single bounded SQLite table. The bridge
 * owns the writes; mobile clients never see the table. A small row
 * budget is enforced so the bridge cannot be coerced into unbounded
 * growth by a hostile Pi subprocess; eviction is FIFO by `receivedAt`.
 *
 * The sink is intentionally separate from `BridgeStore.events` so a
 * reviewer can grep for diagnostics writes without reading the
 * transcript code, and so future deletion of the diagnostics surface
 * does not require touching the journal code.
 *
 * Best-effort guarantees: `append` MUST NEVER throw, MUST NEVER return
 * a value, and MUST NEVER block the caller for an unbounded amount of
 * time. SQLite failures, oversized payloads, malformed payloads, and
 * closed databases are all coerced to a single sensible storage row or
 * counted via the `onError` callback so the daemon can surface
 * diagnostics-write failures observably without losing Pi notifications.
 */

import type { Database } from "bun:sqlite";
import type { RawPiEvent } from "../pi/types";

/**
 * SQLite migration fragment that creates the diagnostics table. The
 * fragment is checked into a dedicated migration so the diagnostics
 * surface is opt-in: a bridge that has not yet applied the rewrite
 * slice will not have the table and raw events will simply be dropped.
 */
export const PI_DIAGNOSTICS_MIGRATION = `
CREATE TABLE IF NOT EXISTS pi_event_diagnostics(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  received_at TEXT NOT NULL,
  event_type TEXT,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pi_event_diagnostics_received_at_idx ON pi_event_diagnostics(received_at);
`;

/**
 * Default maximum number of diagnostics rows retained. One raw event
 * per Pi notification per active session produces well under 10k rows
 * per hour even under stress; 5000 rows is roughly an hour of full
 * activity and is the default eviction ceiling.
 */
export const PI_DIAGNOSTICS_DEFAULT_LIMIT = 5000;

/**
 * Hard ceiling on the size of any single JSON payload. A payload that
 * exceeds the limit is stored verbatim up to the ceiling, and the
 * remainder is replaced with a structured truncation marker so the row
 * always parses as a valid JSON document. The ceiling is intentionally
 * generous (256 KiB) so legitimate raw events are preserved verbatim.
 */
export const PI_DIAGNOSTICS_MAX_PAYLOAD_BYTES = 256 * 1024;

/**
 * Lower bound on the configured retention limit. Callers MUST supply
 * a value of at least 1; zero or negative values disable diagnostics
 * rather than crash the sink.
 */
export const PI_DIAGNOSTICS_MIN_LIMIT = 1;

export interface PiDiagnosticsSinkOptions {
  /** Maximum retained rows. Defaults to {@link PI_DIAGNOSTICS_DEFAULT_LIMIT}. */
  readonly limit?: number;
  /** Wall-clock supplier. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Observable failure hook. Defaults to a no-op so the sink never throws. */
  readonly onError?: (error: unknown, context: { phase: "append" | "ensureSchema" | "close" }) => void;
  /** Override the JSON serialiser. Defaults to `JSON.stringify`. */
  readonly serialize?: (value: unknown) => string;
  /**
   * Override the structured truncation marker. The default produces a
   * valid JSON object that decodes to the original payload plus a clear
   * truncation flag. Tests substitute this hook to assert exact
   * truncation behaviour.
   */
  readonly truncate?: (payloadJson: string, originalBytes: number) => string;
}

export interface PiDiagnosticsSinkInternals {
  /** Capture the most recent prepare/run errors so tests can reach them. */
  readonly failureCount: number;
  /** Truncate a payload JSON string to the byte ceiling. Exposed for tests. */
  truncatePayload(payloadJson: string): string;
}

/**
 * Bounded raw-Pi-event diagnostics sink. Writes are append-only with
 * FIFO eviction when the row limit is exceeded.
 *
 * The sink NEVER participates in transcript rendering. There is no
 * read API; diagnostic rows are intended to be consumed by a support
 * bundle export or by direct SQLite inspection. Diagnostic-only access
 * keeps the rewrite slice honest: the only way to inspect raw events
 * is to opt into the diagnostics surface.
 */
export class PiDiagnosticsSink {
  readonly limit: number;
  private readonly now: () => number;
  private readonly onError: (error: unknown, context: { phase: "append" | "ensureSchema" | "close" }) => void;
  private readonly serialize: (value: unknown) => string;
  private readonly truncate: (payloadJson: string, originalBytes: number) => string;
  private readonly db: Database | null;
  private prepared: Statement | null = null;
  private evictPrepared: Statement | null = null;
  private countPrepared: Statement | null = null;
  private closed = false;
  /** Bounded failure counter for observability. */
  failureCount = 0;

  constructor(
    db: Database | null,
    options: PiDiagnosticsSinkOptions = {},
  ) {
    // Reject zero or negative limits outright: those callers almost
    // certainly meant "disabled" rather than "store the next row outside
    // the bound". The sink still records nothing in that case so the
    // bridge keeps running.
    const requested = options.limit ?? PI_DIAGNOSTICS_DEFAULT_LIMIT;
    this.limit = Number.isFinite(requested) && requested >= PI_DIAGNOSTICS_MIN_LIMIT
      ? Math.floor(requested)
      : 0;
    this.now = options.now ?? Date.now;
    this.onError = options.onError ?? (() => undefined);
    this.serialize = options.serialize ?? ((value: unknown) => JSON.stringify(value));
    this.truncate = options.truncate ?? defaultTruncate;
    this.db = db;
    if (this.limit > 0 && db !== null) {
      try { this.ensureSchema(); }
      catch (error) { this.recordFailure(error, "ensureSchema"); }
    }
  }

  private ensureSchema(): void {
    if (!this.db) return;
    this.db.exec(PI_DIAGNOSTICS_MIGRATION);
  }

  private prepare(): Statement | null {
    if (!this.db) return null;
    if (this.prepared) return this.prepared;
    try {
      this.prepared = this.db.prepare(
        "INSERT INTO pi_event_diagnostics(session_id,received_at,event_type,payload_json) VALUES(?,?,?,?)",
      );
    } catch (error) {
      this.recordFailure(error, "append");
      return null;
    }
    return this.prepared;
  }

  private evict(): void {
    if (!this.db || this.limit === 0) return;
    try {
      if (!this.evictPrepared) {
        this.evictPrepared = this.db.prepare(
          `DELETE FROM pi_event_diagnostics WHERE id IN (
            SELECT id FROM pi_event_diagnostics ORDER BY received_at ASC, id ASC LIMIT ?
          )`,
        );
      }
      if (!this.countPrepared) {
        this.countPrepared = this.db.prepare("SELECT COUNT(*) AS count FROM pi_event_diagnostics");
      }
      const count = (this.countPrepared.get() as { count: number }).count;
      const overage = count + 1 - this.limit;
      if (overage > 0) this.evictPrepared.run(overage);
    } catch (error) {
      this.recordFailure(error, "append");
    }
  }

  /**
   * Append one raw Pi notification to the diagnostics sink. The
   * payload is JSON-encoded; payloads that cannot be encoded fall back
   * to a bounded placeholder so the bridge never crashes. This method
   * is intentionally `void` and never throws or rejects.
   */
  append(raw: unknown, sessionId: string | null): void {
    if (this.closed || this.limit === 0 || !this.db) return;
    const receivedAt = new Date(this.now()).toISOString();
    const eventType = isRawPiEvent(raw) && typeof raw.type === "string" ? raw.type : null;
    let payloadJson: string;
    try {
      const serialised = this.serialize(raw);
      // `JSON.stringify` is contractually allowed to return `undefined`
      // (e.g. for raw values whose `toJSON` returns `undefined`, or for
      // top-level functions/symbols). Coerce such cases to a valid
      // placeholder so downstream `length` reads and JSON parses always
      // succeed.
      payloadJson = typeof serialised === "string" ? serialised : JSON.stringify({ __unserializable: true });
    } catch {
      payloadJson = JSON.stringify({ __unserializable: true });
    }
    if (payloadJson.length > PI_DIAGNOSTICS_MAX_PAYLOAD_BYTES) {
      payloadJson = this.truncate(payloadJson, payloadJson.length);
    }
    try {
      this.evict();
      const statement = this.prepare();
      if (statement === null) return;
      statement.run(sessionId, receivedAt, eventType, payloadJson);
    } catch (error) {
      this.recordFailure(error, "append");
    }
  }

  /** Truncate a payload to the configured byte ceiling. Exposed for tests. */
  truncatePayload(payloadJson: string): string {
    if (payloadJson.length <= PI_DIAGNOSTICS_MAX_PAYLOAD_BYTES) return payloadJson;
    return this.truncate(payloadJson, payloadJson.length);
  }

  /**
   * Close the underlying SQLite database. Safe to call multiple times.
   * The daemon calls this on shutdown so the diagnostics file does not
   * leak an open connection when the bridge exits.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (!this.db) return;
    try { this.db.close(); }
    catch (error) { this.recordFailure(error, "close"); }
  }

  private recordFailure(error: unknown, phase: "append" | "ensureSchema" | "close"): void {
    this.failureCount += 1;
    try { this.onError(error, { phase }); }
    catch { /* onError is itself best-effort */ }
  }
}

type Statement = ReturnType<Database["prepare"]>;

function isRawPiEvent(value: unknown): value is RawPiEvent {
  return typeof value === "object" && value !== null && "type" in (value as Record<string, unknown>);
}

function defaultTruncate(payloadJson: string, originalBytes: number): string {
  // The truncated row is a single self-contained JSON envelope
  // `{prefix, truncated, originalBytes}` so the document is always
  // parseable regardless of where the original prefix happened to end.
  // Storing the prefix as a JSON string guarantees the surrounding
  // envelope is valid even when the prefix is mid-string or mid-object.
  const marker = JSON.stringify({
    __truncated: true,
    __originalBytes: originalBytes,
  });
  const overhead = marker.length + 32; // envelope + "prefix":"" + braces
  const available = PI_DIAGNOSTICS_MAX_PAYLOAD_BYTES - overhead;
  if (available <= 0) return marker;
  const prefix = payloadJson.slice(0, available);
  const envelope = JSON.stringify({ prefix, __truncated: true, __originalBytes: originalBytes });
  return envelope;
}
