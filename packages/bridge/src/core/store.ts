import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type StoreErrorCode = "busy" | "full" | "readonly" | "corrupt" | "io" | "conflict" | "not_found";
export class StoreError extends Error {
  override readonly name = "StoreError";
  constructor(readonly code: StoreErrorCode, message: string, options?: ErrorOptions) { super(message, options); }
}

export interface StoredEvent { readonly eventId: string; readonly streamId: string; readonly cursor: string; readonly type: string; readonly payload: Record<string, unknown>; readonly createdAt: number; }
export interface StoredEventPage { readonly items: readonly StoredEvent[]; readonly snapshotRevision: string; readonly nextBeforeCursor?: string; }
export interface StoredCommand { readonly commandId: string; readonly type: string; readonly scopeKey: string; readonly streamId: string; readonly semanticHash: string; readonly payload: Record<string, unknown>; readonly state: string; readonly dispatchCount: number; }
export type AcceptCommandResult = { readonly kind: "accepted" | "duplicate"; readonly command: StoredCommand; readonly event?: StoredEvent } | { readonly kind: "conflict" };
export interface LeaseRecord { readonly scopeKey: string; readonly leaseId: string; readonly installationId: string; readonly connectionId: string; readonly expiresAt: number; readonly reclaimableUntil: number | null; readonly disconnectedAt: number | null; readonly revokedAt: number | null; readonly takeoverReason: string | null; }
export interface StoredQueueItem { readonly queueItemId: string; readonly sessionId: string; readonly message: string; readonly attachmentIds: readonly string[]; readonly position: number; readonly state: "queued" | "dispatching"; readonly createdAt: number; }
export interface StoredDialog { readonly dialogId: string; readonly sessionId: string; readonly upstreamId: string; readonly method: "select" | "confirm" | "input" | "editor"; readonly request: Record<string, unknown>; readonly state: "pending" | "responded" | "expired" | "cancelled" | "orphaned"; readonly createdAt: number; readonly expiresAt: number; }

// M8: durable trust + host policy state records. Kept as plain structural
// types so the bridge runtime can read them with zero extra dependencies.

/** A single durable workspace approval record. */
export interface StoredWorkspaceTrust {
  readonly workspaceId: string;
  readonly rootPath: string;
  readonly label: string;
  /** SHA-256 hex of the canonical manifest. Hex-empty when the record was seeded without fingerprint (M8 compat). */
  readonly fingerprint: string;
  readonly policyVersion: string;
  readonly approvedAt: number;
  readonly approvedBy: string;
  /** Wall-clock when this record was seeded by the M8 upgrade. `undefined` for explicit approvals. */
  readonly seededAt?: number;
  readonly updatedAt: number;
}

/** Durable host policy state. Exactly one row. */
export interface StoredHostPolicyState {
  readonly mode: "full" | "read_only";
  readonly policyVersion: string;
  readonly fingerprint: string;
  readonly source: "config" | "client" | "seed";
  readonly updatedAt: number;
  readonly updatedBy?: string;
}
export type LeaseMutation =
  | { readonly action: "acquire" | "takeover"; readonly scopeKey: string; readonly installationId: string; readonly connectionId: string; readonly now?: number }
  | { readonly action: "release"; readonly scopeKey: string; readonly installationId: string; readonly connectionId: string; readonly now?: number };

/**
 * Two-step migration. v1 = original M6 durable schema. v2 adds the M8
 * workspace trust + host policy state tables. Upgrading from a pre-M8
 * store applies v2 additively (the v1 tables are unchanged).
 */
const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bridge_identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1), host_id TEXT NOT NULL, host_generation TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(session_id TEXT PRIMARY KEY, state_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS streams(stream_id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK(scope IN ('host','session')), session_id TEXT REFERENCES sessions(session_id) ON DELETE CASCADE, current_cursor TEXT NOT NULL DEFAULT '0', retention_floor TEXT NOT NULL DEFAULT '0', UNIQUE(scope,session_id));
CREATE TABLE IF NOT EXISTS events(event_id TEXT NOT NULL UNIQUE, stream_id TEXT NOT NULL REFERENCES streams(stream_id) ON DELETE CASCADE, cursor TEXT NOT NULL, type TEXT NOT NULL, payload_json TEXT NOT NULL, bytes INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(stream_id,cursor));
CREATE INDEX IF NOT EXISTS events_replay ON events(stream_id,length(cursor),cursor);
CREATE TABLE IF NOT EXISTS commands(command_id TEXT PRIMARY KEY, type TEXT NOT NULL, scope_key TEXT NOT NULL, stream_id TEXT NOT NULL REFERENCES streams(stream_id), semantic_hash TEXT NOT NULL, payload_json TEXT NOT NULL, state TEXT NOT NULL, dispatch_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS commands_recovery ON commands(state,created_at);
CREATE TABLE IF NOT EXISTS client_cursors(installation_id TEXT NOT NULL, stream_id TEXT NOT NULL REFERENCES streams(stream_id) ON DELETE CASCADE, cursor TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(installation_id,stream_id));
CREATE TABLE IF NOT EXISTS controller_leases(lease_id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, installation_id TEXT NOT NULL, connection_id TEXT NOT NULL, acquired_at INTEGER NOT NULL, renewed_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, reclaimable_until INTEGER, disconnected_at INTEGER, takeover_reason TEXT, revoked_at INTEGER, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS controller_leases_one_active_scope ON controller_leases(scope_key) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS backups(backup_id TEXT PRIMARY KEY, path TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, created_at INTEGER NOT NULL, verified_at INTEGER);
`;
const MIGRATION_V1_CHECKSUM = new Bun.CryptoHasher("sha256").update(MIGRATION_V1).digest("hex");
/** v2 additions (M8). Tables are additive — does not touch any v1 table. */
const MIGRATION_V2 = `
CREATE TABLE IF NOT EXISTS workspace_trust(workspace_id TEXT PRIMARY KEY, root_path TEXT NOT NULL, label TEXT NOT NULL, fingerprint TEXT, policy_version TEXT NOT NULL DEFAULT 'pi-trust/1', approved_at INTEGER NOT NULL, approved_by TEXT NOT NULL, seeded_at INTEGER, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS policy_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), mode TEXT NOT NULL CHECK(mode IN ('full','read_only')), policy_version TEXT NOT NULL, fingerprint TEXT NOT NULL, source TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT);
`;
const MIGRATION_V2_CHECKSUM = new Bun.CryptoHasher("sha256").update(MIGRATION_V1 + MIGRATION_V2).digest("hex");
const MIGRATION_V3 = `
CREATE TABLE IF NOT EXISTS follow_up_queue(queue_item_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE, message TEXT NOT NULL, attachment_ids_json TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL CHECK(state IN ('queued','dispatching')), position INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(session_id,position));
CREATE INDEX IF NOT EXISTS follow_up_queue_fifo ON follow_up_queue(session_id,state,position);
CREATE TABLE IF NOT EXISTS extension_dialogs(dialog_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE, upstream_id TEXT NOT NULL, method TEXT NOT NULL CHECK(method IN ('select','confirm','input','editor')), request_json TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','responded','expired','cancelled','orphaned')), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(session_id,upstream_id));
CREATE INDEX IF NOT EXISTS extension_dialog_pending ON extension_dialogs(session_id,state,expires_at);
`;
const MIGRATION_V3_CHECKSUM = new Bun.CryptoHasher("sha256").update(MIGRATION_V1 + MIGRATION_V2 + MIGRATION_V3).digest("hex");
/**
 * v4 additions (M15). The `notification_devices` table is the durable
 * registry of mobile installs the bridge uses to fan out push
 * notifications. It is keyed by an opaque `device_id` (UUID); the
 * combination `(installation_id, platform)` is unique so the same
 * mobile installation may only have one active install per platform
 * at a time. Re-registration replaces the existing row atomically
 * (the bridge never duplicates an install).
 *
 * `notification_dedup` is a small bounded table that prevents the
 * same source event from producing two notifications on retry. The
 * primary key is `source_event_id`, with a `created_at` index that
 * the periodic sweeper prunes after the dedupe window.
 */
const MIGRATION_V4 = `
CREATE TABLE IF NOT EXISTS notification_devices(device_id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, platform TEXT NOT NULL CHECK(platform IN ('apns','fcm')), push_token TEXT NOT NULL, app_version TEXT NOT NULL, token_revision INTEGER NOT NULL DEFAULT 1, last_seen_at INTEGER NOT NULL, created_at INTEGER NOT NULL, rejected_reason TEXT, rejected_at INTEGER, UNIQUE(installation_id,platform));
CREATE INDEX IF NOT EXISTS notification_devices_installation ON notification_devices(installation_id);
CREATE TABLE IF NOT EXISTS notification_dedup(source_event_id TEXT PRIMARY KEY, kind TEXT NOT NULL, session_id TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS notification_dedup_age ON notification_dedup(created_at);
`;
const MIGRATION_V4_CHECKSUM = new Bun.CryptoHasher("sha256").update(MIGRATION_V1 + MIGRATION_V2 + MIGRATION_V3 + MIGRATION_V4).digest("hex");

function canonicalCursor(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new StoreError("conflict", "cursor is not canonical");
  return BigInt(value);
}
function uuid(): string { return crypto.randomUUID().toLowerCase(); }
function parseObject(json: string): Record<string, unknown> { return JSON.parse(json) as Record<string, unknown>; }

export class BridgeStore {
  private db: Database;
  private writable = true;
  private maintenance = false;
  private lastFailure: StoreErrorCode | null = null;
  private collectingEvents: StoredEvent[] | null = null;
  private readonly eventListeners = new Set<(event: StoredEvent) => void>();
  constructor(readonly path: string, readonly now: () => number = Date.now) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = this.open(path);
  }

  private open(path: string): Database {
    try {
      const db = new Database(path, { create: true, readwrite: true, strict: true });
      db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;");
      this.migrate(db);
      const integrity = db.query("PRAGMA integrity_check").get() as Record<string, unknown> | null;
      if (!integrity || !Object.values(integrity).includes("ok")) throw new StoreError("corrupt", "database integrity check failed");
      return db;
    } catch (error) { throw this.mapError(error); }
  }

  private migrate(db: Database): void {
    db.exec("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)");
    const existingV1 = db.query("SELECT checksum FROM schema_migrations WHERE version=1").get() as { checksum: string } | null;
    if (existingV1 && existingV1.checksum !== MIGRATION_V1_CHECKSUM) throw new StoreError("corrupt", "migration checksum mismatch (v1)");
    if (!existingV1) {
      this.transactionOn(db, () => {
        db.exec(MIGRATION_V1);
        db.query("INSERT INTO schema_migrations(version,checksum,applied_at) VALUES(1,?,?)").run(MIGRATION_V1_CHECKSUM, this.now());
      });
    }
    const existingV2 = db.query("SELECT checksum FROM schema_migrations WHERE version=2").get() as { checksum: string } | null;
    if (existingV2 && existingV2.checksum !== MIGRATION_V2_CHECKSUM) throw new StoreError("corrupt", "migration checksum mismatch (v2)");
    if (!existingV2) {
      this.transactionOn(db, () => {
        db.exec(MIGRATION_V2);
        db.query("INSERT INTO schema_migrations(version,checksum,applied_at) VALUES(2,?,?)").run(MIGRATION_V2_CHECKSUM, this.now());
      });
    }
    const existingV3 = db.query("SELECT checksum FROM schema_migrations WHERE version=3").get() as { checksum: string } | null;
    if (existingV3 && existingV3.checksum !== MIGRATION_V3_CHECKSUM) throw new StoreError("corrupt", "migration checksum mismatch (v3)");
    if (!existingV3) {
      this.transactionOn(db, () => {
        db.exec(MIGRATION_V3);
        db.query("INSERT INTO schema_migrations(version,checksum,applied_at) VALUES(3,?,?)").run(MIGRATION_V3_CHECKSUM, this.now());
      });
    }
    const existingV4 = db.query("SELECT checksum FROM schema_migrations WHERE version=4").get() as { checksum: string } | null;
    if (existingV4 && existingV4.checksum !== MIGRATION_V4_CHECKSUM) throw new StoreError("corrupt", "migration checksum mismatch (v4)");
    if (!existingV4) {
      this.transactionOn(db, () => {
        db.exec(MIGRATION_V4);
        db.query("INSERT INTO schema_migrations(version,checksum,applied_at) VALUES(4,?,?)").run(MIGRATION_V4_CHECKSUM, this.now());
      });
    }
  }

  private mapError(error: unknown): StoreError {
    if (error instanceof StoreError) return error;
    const message = error instanceof Error ? error.message : String(error);
    const upper = message.toUpperCase();
    const code: StoreErrorCode = upper.includes("BUSY") || upper.includes("LOCKED") ? "busy" : upper.includes("FULL") ? "full" : upper.includes("READONLY") || upper.includes("READ-ONLY") ? "readonly" : upper.includes("CORRUPT") || upper.includes("MALFORMED") ? "corrupt" : "io";
    if (code !== "busy") { this.writable = false; this.lastFailure = code; }
    return new StoreError(code, `durable store ${code}`, { cause: error });
  }

  private transactionOn<T>(db: Database, body: () => T): T {
    try {
      db.exec("BEGIN IMMEDIATE");
      const value = body();
      db.exec("COMMIT");
      return value;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* transaction did not begin */ }
      throw this.mapError(error);
    }
  }
  transaction<T>(body: () => T): T {
    if (!this.writable || this.maintenance) throw new StoreError("readonly", "durable store is not writable");
    if (this.collectingEvents) return body();
    const events: StoredEvent[] = []; this.collectingEvents = events;
    try {
      const result = this.transactionOn(this.db, body);
      for (const event of events) for (const listener of this.eventListeners) listener(event);
      return result;
    } finally { this.collectingEvents = null; }
  }
  onEvent(listener: (event: StoredEvent) => void): () => void { this.eventListeners.add(listener); return () => this.eventListeners.delete(listener); }
  close(): void { this.db.close(false); }
  setWritableForTest(writable: boolean): void { this.writable = writable; if (writable) this.lastFailure = null; }
  isWritable(): boolean { return this.writable; }
  pragma(name: "journal_mode" | "foreign_keys" | "synchronous" | "page_count"): unknown { return this.db.query(`PRAGMA ${name}`).get(); }
  setMaxPageCountForTest(max: number): void { this.db.exec(`PRAGMA max_page_count=${Math.floor(max)}`); }

  identity(): { hostId: string; hostGeneration: string } {
    return this.transaction(() => {
      let row = this.db.query("SELECT host_id hostId,host_generation hostGeneration FROM bridge_identity WHERE singleton=1").get() as { hostId: string; hostGeneration: string } | null;
      if (!row) {
        row = { hostId: uuid(), hostGeneration: "1" };
        this.db.query("INSERT INTO bridge_identity(singleton,host_id,host_generation,created_at,updated_at) VALUES(1,?,?,?,?)").run(row.hostId, row.hostGeneration, this.now(), this.now());
      }
      return row;
    });
  }

  ensureSession(sessionId: string, state: Record<string, unknown> = {}): void {
    this.transaction(() => this.db.query("INSERT OR IGNORE INTO sessions(session_id,state_json,created_at,updated_at) VALUES(?,?,?,?)").run(sessionId, JSON.stringify(state), this.now(), this.now()));
  }
  updateSessionState(sessionId: string, state: Record<string, unknown>): void {
    this.transaction(() => {
      const result = this.db.query("UPDATE sessions SET state_json=?,updated_at=? WHERE session_id=?").run(JSON.stringify(state), this.now(), sessionId);
      if (result.changes !== 1) throw new StoreError("not_found", "session not found");
    });
  }
  sessionExists(sessionId: string): boolean { return this.db.query("SELECT 1 present FROM sessions WHERE session_id=?").get(sessionId) !== null; }
  sessionState(sessionId: string): Record<string, unknown> | null {
    const row = this.db.query("SELECT state_json state FROM sessions WHERE session_id=?").get(sessionId) as { state: string } | null;
    return row ? parseObject(row.state) : null;
  }
  sessionStates(): Array<Record<string, unknown>> {
    const rows = this.db.query("SELECT session_id sessionId,state_json state FROM sessions ORDER BY created_at,session_id").all() as Array<{ sessionId: string; state: string }>;
    return rows.map((row) => ({ sessionId: row.sessionId, ...parseObject(row.state) }));
  }
  ensureStream(streamId: string, scope: "host" | "session", sessionId: string | null = null): void {
    this.transaction(() => this.ensureStreamTx(streamId, scope, sessionId));
  }
  private ensureStreamTx(streamId: string, scope: "host" | "session", sessionId: string | null): void {
    if (scope === "session" && !sessionId) throw new StoreError("conflict", "session stream requires session ID");
    this.db.query("INSERT OR IGNORE INTO streams(stream_id,scope,session_id,current_cursor,retention_floor) VALUES(?,?,?,'0','0')").run(streamId, scope, sessionId);
  }

  private appendEventTx(streamId: string, type: string, payload: Record<string, unknown>, eventId = uuid()): StoredEvent {
    const stream = this.db.query("SELECT current_cursor current FROM streams WHERE stream_id=?").get(streamId) as { current: string } | null;
    if (!stream) throw new StoreError("not_found", "stream not found");
    const cursor = (canonicalCursor(stream.current) + 1n).toString();
    const createdAt = this.now(); const json = JSON.stringify(payload);
    this.db.query("UPDATE streams SET current_cursor=? WHERE stream_id=?").run(cursor, streamId);
    this.db.query("INSERT INTO events(event_id,stream_id,cursor,type,payload_json,bytes,created_at) VALUES(?,?,?,?,?,?,?)").run(eventId, streamId, cursor, type, json, Buffer.byteLength(json), createdAt);
    const event = { eventId, streamId, cursor, type, payload, createdAt };
    this.collectingEvents?.push(event);
    return event;
  }
  appendEvent(streamId: string, type: string, payload: Record<string, unknown>, eventId?: string): StoredEvent { return this.transaction(() => this.appendEventTx(streamId, type, payload, eventId)); }
  streamPosition(streamId: string): { current: string; floor: string } | null { return this.db.query("SELECT current_cursor current,retention_floor floor FROM streams WHERE stream_id=?").get(streamId) as { current: string; floor: string } | null; }
  setRetentionFloor(streamId: string, floor: string): void { canonicalCursor(floor); this.transaction(() => this.db.query("UPDATE streams SET retention_floor=? WHERE stream_id=?").run(floor, streamId)); }
  listEvents(streamId: string, after = "0", through?: string): StoredEvent[] {
    canonicalCursor(after); if (through) canonicalCursor(through);
    const rows = this.db.query(`SELECT event_id eventId,stream_id streamId,cursor,type,payload_json payload,created_at createdAt FROM events WHERE stream_id=? AND (length(cursor)>length(?) OR (length(cursor)=length(?) AND cursor>?)) ${through ? "AND (length(cursor)<length(?) OR (length(cursor)=length(?) AND cursor<=?))" : ""} ORDER BY length(cursor),cursor`).all(...(through ? [streamId, after, after, after, through, through, through] : [streamId, after, after, after])) as Array<{ eventId: string; streamId: string; cursor: string; type: string; payload: string; createdAt: number }>;
    return rows.map((row) => ({ ...row, payload: parseObject(row.payload) }));
  }
  pageSessionEvents(sessionId: string, pageSize: number, beforeCursor?: string): StoredEventPage {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new StoreError("conflict", "page size must be an integer from 1 through 100");
    if (beforeCursor !== undefined) canonicalCursor(beforeCursor);
    return this.transaction(() => {
      if (!this.sessionExists(sessionId)) throw new StoreError("not_found", "session not found");
      const streamId = `session:${sessionId}`;
      const position = this.streamPosition(streamId);
      if (!position) throw new StoreError("not_found", "session stream not found");
      const before = beforeCursor === undefined
        ? ""
        : "AND (length(cursor)<length(?) OR (length(cursor)=length(?) AND cursor<?))";
      const parameters: Array<string | number> = beforeCursor === undefined
        ? [streamId, pageSize + 1]
        : [streamId, beforeCursor, beforeCursor, beforeCursor, pageSize + 1];
      const rows = this.db.query(`SELECT event_id eventId,stream_id streamId,cursor,type,payload_json payload,created_at createdAt FROM events WHERE stream_id=? ${before} ORDER BY length(cursor) DESC,cursor DESC LIMIT ?`).all(...parameters) as Array<{ eventId: string; streamId: string; cursor: string; type: string; payload: string; createdAt: number }>;
      const hasMore = rows.length > pageSize;
      const newestFirst = hasMore ? rows.slice(0, pageSize) : rows;
      const items = newestFirst.reverse().map((row) => ({ ...row, payload: parseObject(row.payload) }));
      return {
        items,
        snapshotRevision: position.current,
        ...(hasMore ? { nextBeforeCursor: items[0]!.cursor } : {}),
      };
    });
  }
  readReplay(streamId: string, after: string): { current: string; floor: string; events: StoredEvent[] } {
    return this.transaction(() => {
      const position = this.streamPosition(streamId); if (!position) throw new StoreError("not_found", "stream not found");
      return { ...position, events: this.listEvents(streamId, after, position.current) };
    });
  }
  // ---------------------------------------------------------------------
  // M11 — multi-session summary directory (add/change/remove + paginated
  // list/search/filter/sort/attention). Summary state is read from the
  // session JSON blob so the host stream can still replay ordered
  // `session.summary` / `session.removed` events for subscribers.
  // ---------------------------------------------------------------------

  /** Allowed sort directions for `listSessionSummaries`. */
  static readonly SESSION_SORT_KEYS = ["name", "attention", "activity", "created", "queue"] as const;
  /** Allowed attention filters. */
  static readonly ATTENTION_FILTERS = new Set(["all", "needs_attention", "ready", "settled", "failed", "aborted", "indeterminate"]);

  /**
   * Idempotently register a session. The first call for a new session
   * emits `session.summary` on the host stream; later calls do nothing
   * (idempotent). The host stream is auto-created.
   */
  addSessionSummary(sessionId: string, summary: Record<string, unknown>): { event: StoredEvent; added: boolean } {
    return this.transaction(() => {
      const hostStream = `host:${this.identity().hostId}`;
      this.ensureStream(hostStream, "host");
      const existing = this.sessionState(sessionId);
      if (existing && Object.keys(existing).length > 0) return { event: { eventId: "", streamId: hostStream, cursor: "0", type: "session.summary", payload: {}, createdAt: 0 }, added: false };
      const state: Record<string, unknown> = { runtimeState: "idle", attentionState: "ready", queueCount: 0, lastActivityAt: this.now(), ...summary, sessionId };
      this.db.query("INSERT INTO sessions(session_id,state_json,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at").run(sessionId, JSON.stringify(state), this.now(), this.now());
      this.ensureStream(`session:${sessionId}`, "session", sessionId);
      const event = this.appendEventTx(hostStream, "session.summary", { sessionId, ...state });
      return { event, added: true };
    });
  }

  /**
   * Apply a partial summary change. Emits `session.summary` with the
   * resulting merged state plus a `changedKeys` array describing the
   * deltas. Unknown sessions are created on demand (mobile can repair
   * the directory if host restarts mid-flight).
   */
  changeSessionSummary(sessionId: string, patch: Record<string, unknown>): { event: StoredEvent; previous: Record<string, unknown> } {
    return this.transaction(() => {
      const hostStream = `host:${this.identity().hostId}`;
      this.ensureStream(hostStream, "host");
      const prior = this.sessionState(sessionId) ?? { sessionId };
      const next: Record<string, unknown> = { ...prior, ...patch, sessionId };
      const changedKeys = Object.keys(patch).filter((key) => JSON.stringify((prior as Record<string, unknown>)[key]) !== JSON.stringify(patch[key]));
      this.db.query("INSERT INTO sessions(session_id,state_json,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at").run(sessionId, JSON.stringify(next), this.now(), this.now());
      this.ensureStream(`session:${sessionId}`, "session", sessionId);
      const event = this.appendEventTx(hostStream, "session.summary", { sessionId, ...next, changedKeys });
      return { event, previous: prior };
    });
  }

  /** Removes a provisional session that was never admitted; emits no event. */
  discardSession(sessionId: string): void {
    this.transaction(() => {
      this.db.query("DELETE FROM sessions WHERE session_id=?").run(sessionId);
    });
  }

  /**
   * Remove a session from the directory. Emits `session.removed` on the
   * host stream. Returns `null` when the session was already gone so
   * the caller can distinguish first removal from a duplicate.
   */
  removeSessionSummary(sessionId: string): { event: StoredEvent; removed: boolean } | null {
    return this.transaction(() => {
      const hostStream = `host:${this.identity().hostId}`;
      this.ensureStream(hostStream, "host");
      if (!this.sessionExists(sessionId)) return null;
      this.db.query("DELETE FROM sessions WHERE session_id=?").run(sessionId);
      const event = this.appendEventTx(hostStream, "session.removed", { sessionId, removedAt: this.now() });
      return { event, removed: true };
    });
  }

  /**
   * Paginated session list with substring search, attention-state
   * filter, and stable sort. Returns newest-first snapshot and an
   * opaque `nextBeforeCursor` token the caller must hand back to fetch
   * the next page. `snapshotRevision` is the host stream current
   * cursor, suitable for change detection by the client.
   */
  listSessionSummaries(input: { filter?: string | null; query?: string | null; sort?: string; pageSize: number; beforeCursor?: string | null; parentSessionId?: string | null }): { items: readonly Record<string, unknown>[]; snapshotRevision: string; nextBeforeCursor?: string } {
    if (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) throw new StoreError("conflict", "page size must be an integer from 1 through 100");
    const sort = (input.sort ?? "activity") as string;
    if (!(BridgeStore.SESSION_SORT_KEYS as readonly string[]).includes(sort)) throw new StoreError("conflict", "sort must be one of name|attention|activity|created|queue");
    const filter = input.filter ?? "all";
    if (!BridgeStore.ATTENTION_FILTERS.has(filter)) throw new StoreError("conflict", "filter must be all|needs_attention|ready|settled|failed|aborted|indeterminate");
    const query = (input.query ?? "").toLowerCase();
    const before = input.beforeCursor;
    return this.transaction(() => {
      const hostStream = `host:${this.identity().hostId}`;
      const position = this.streamPosition(hostStream); if (!position) throw new StoreError("not_found", "host stream not found");
      let rows = (this.db.query("SELECT session_id sessionId,state_json state,created_at createdAt FROM sessions ORDER BY created_at,session_id").all() as Array<{ sessionId: string; state: string; createdAt: number }>).map((row) => {
        const parsed = parseObject(row.state);
        return { ...parsed, sessionId: row.sessionId, createdAt: row.createdAt } as Record<string, unknown>;
      });
      if (input.parentSessionId !== undefined) rows = rows.filter((row) => (row.parentSessionId ?? null) === input.parentSessionId && row.lifecycleState !== "purged");
      else rows = rows.filter((row) => row.lifecycleState !== "purged");
      if (filter === "needs_attention") rows = rows.filter((row) => row.attentionState === "needs_attention");
      else if (filter !== "all") rows = rows.filter((row) => row.attentionState === filter || row.runtimeState === filter);
      if (query.length > 0) rows = rows.filter((row) => {
        const name = (typeof row.name === "string" ? row.name : typeof row.displayName === "string" ? row.displayName : row.sessionId) as string;
        return name.toLowerCase().includes(query);
      });
      const sortKey = (row: Record<string, unknown>): string | number => {
        if (sort === "name") return String(row.name ?? row.displayName ?? row.sessionId);
        if (sort === "attention") return String(row.attentionState ?? "");
        if (sort === "created") return Number(row.createdAt ?? 0);
        if (sort === "queue") return Number(row.queueCount ?? 0);
        return Number(row.lastActivityAt ?? row.createdAt ?? 0);
      };
      rows.sort((left, right) => {
        const lk = sortKey(left); const rk = sortKey(right);
        if (typeof lk === "number" && typeof rk === "number") return rk - lk;
        return sort === "name"
          ? String(lk).localeCompare(String(rk))
          : String(rk).localeCompare(String(lk));
      });
      let startIndex = 0;
      if (before) {
        const offset = Number(before);
        if (!Number.isInteger(offset) || offset < 0) throw new StoreError("conflict", "before cursor is not a valid offset");
        startIndex = offset;
      }
      const slice = rows.slice(startIndex, startIndex + input.pageSize);
      const hasMore = startIndex + input.pageSize < rows.length;
      return {
        items: slice,
        snapshotRevision: position.current,
        ...(hasMore ? { nextBeforeCursor: String(startIndex + input.pageSize) } : {}),
      };
    });
  }

  resolvedSessionName(sessionId: string): string {
    const state = this.sessionState(sessionId);
    if (!state) throw new StoreError("not_found", "session not found");
    const name = typeof state.name === "string" ? state.name.trim() : "";
    return name || `Session ${sessionId.slice(0, 8)}`;
  }

  softDeleteSession(sessionId: string, retentionMs = 7 * 24 * 60 * 60_000, at = this.now()): Record<string, unknown> {
    if (!Number.isFinite(retentionMs) || retentionMs <= 0) throw new StoreError("conflict", "retention must be positive");
    return this.transaction(() => {
      const prior = this.sessionState(sessionId);
      if (!prior) throw new StoreError("not_found", "session not found");
      if (prior.lifecycleState === "purged") throw new StoreError("conflict", "purged session cannot be deleted");
      if (prior.lifecycleState === "soft_deleted") return prior;
      const deletedAt = new Date(at).toISOString();
      const next = { ...prior, lifecycleState: "soft_deleted", deletionState: "soft_deleted", deletedAt, purgeAfter: new Date(at + retentionMs).toISOString(), runtimeState: "stopped" };
      this.db.query("UPDATE sessions SET state_json=?,updated_at=? WHERE session_id=?").run(JSON.stringify(next), this.now(), sessionId);
      this.appendEventTx(`session:${sessionId}`, "session.deleted", { sessionId, deletedAt: next.deletedAt, purgeAfter: next.purgeAfter });
      this.appendEventTx(`host:${this.identity().hostId}`, "session.summary", next);
      return next;
    });
  }

  markSessionDeleteFailed(sessionId: string, reason: string): Record<string, unknown> {
    return this.transaction(() => {
      const prior = this.sessionState(sessionId);
      if (!prior) throw new StoreError("not_found", "session not found");
      const next = { ...prior, lifecycleState: "delete_failed", deletionState: "delete_failed", repairReason: reason.slice(0, 500), deleteAttemptedAt: new Date(this.now()).toISOString() };
      this.db.query("UPDATE sessions SET state_json=?,updated_at=? WHERE session_id=?").run(JSON.stringify(next), this.now(), sessionId);
      this.appendEventTx(`session:${sessionId}`, "session.delete_failed", { sessionId, repairReason: next.repairReason, repairable: true });
      this.appendEventTx(`host:${this.identity().hostId}`, "session.summary", next);
      return next;
    });
  }

  restoreSoftDeletedSession(sessionId: string, at = this.now()): Record<string, unknown> {
    return this.transaction(() => {
      const prior = this.sessionState(sessionId);
      if (!prior) throw new StoreError("not_found", "session not found");
      if (prior.lifecycleState === "delete_failed") throw new StoreError("conflict", "delete repair is required before restore");
      if (prior.lifecycleState !== "soft_deleted") throw new StoreError("conflict", "session is not deleted");
      const deadline = Date.parse(String(prior.purgeAfter ?? ""));
      if (!Number.isFinite(deadline) || deadline <= at) throw new StoreError("conflict", "restore window has elapsed");
      const next = { ...prior, lifecycleState: "active", deletionState: "active", deletedAt: null, purgeAfter: null, repairReason: null, restoredAt: new Date(at).toISOString() };
      this.db.query("UPDATE sessions SET state_json=?,updated_at=? WHERE session_id=?").run(JSON.stringify(next), this.now(), sessionId);
      this.appendEventTx(`session:${sessionId}`, "session.restored", { sessionId, restoredAt: next.restoredAt });
      this.appendEventTx(`host:${this.identity().hostId}`, "session.summary", next);
      return next;
    });
  }

  purgeSessionTombstone(sessionId: string): Record<string, unknown> {
    return this.transaction(() => {
      const prior = this.sessionState(sessionId);
      if (!prior) throw new StoreError("not_found", "session not found");
      if (prior.lifecycleState === "purged") return prior;
      const purgedAt = new Date(this.now()).toISOString();
      const tombstone = { sessionId, lifecycleState: "purged", deletionState: "purged", purgedAt, name: prior.name ?? null, parentSessionId: prior.parentSessionId ?? null, neverReuse: true };
      this.db.query("UPDATE sessions SET state_json=?,updated_at=? WHERE session_id=?").run(JSON.stringify(tombstone), this.now(), sessionId);
      this.appendEventTx(`host:${this.identity().hostId}`, "session.removed", { sessionId, purgedAt, permanent: true, neverReuse: true });
      return tombstone;
    });
  }

  captureSnapshot(streamId: string): { baseline: string; current: string; state: Record<string, unknown>; events: StoredEvent[] } {
    return this.transaction(() => {
      const stream = this.db.query("SELECT current_cursor baseline,session_id sessionId,scope FROM streams WHERE stream_id=?").get(streamId) as { baseline: string; sessionId: string | null; scope: string } | null;
      if (!stream) throw new StoreError("not_found", "stream not found");
      const state = stream.sessionId
        ? this.sessionState(stream.sessionId) ?? {}
        : { scope: "host", sessions: this.sessionStates() };
      const current = this.streamPosition(streamId)!.current;
      return { baseline: stream.baseline, current, state, events: this.listEvents(streamId, stream.baseline, current) };
    });
  }

  acceptCommand(input: { commandId: string; type: string; scopeKey: string; streamId: string; semanticHash: string; payload: Record<string, unknown>; leaseMutation?: LeaseMutation }): AcceptCommandResult {
    return this.transaction(() => {
      const existing = this.command(input.commandId);
      if (existing) return existing.semanticHash === input.semanticHash ? { kind: "duplicate", command: existing } : { kind: "conflict" };
      const lease = input.leaseMutation ? this.applyLeaseMutationTx(input.leaseMutation) : null;
      const now = this.now();
      this.db.query("INSERT INTO commands(command_id,type,scope_key,stream_id,semantic_hash,payload_json,state,dispatch_count,created_at,updated_at) VALUES(?,?,?,?,?,?,'accepted',0,?,?)").run(input.commandId, input.type, input.scopeKey, input.streamId, input.semanticHash, JSON.stringify(input.payload), now, now);
      const event = this.appendEventTx(input.streamId, "command.state", { commandId: input.commandId, commandType: input.type, state: "accepted", errorCode: null });
      if (input.leaseMutation) this.appendEventTx(input.streamId, "controller.state", input.leaseMutation.action === "release" ? { scope: input.scopeKey.startsWith("session:") ? "session" : "host", ...(input.scopeKey.startsWith("session:") ? { sessionId: input.scopeKey.slice("session:".length) } : {}), mode: "observer" } : { scope: input.scopeKey.startsWith("session:") ? "session" : "host", ...(input.scopeKey.startsWith("session:") ? { sessionId: input.scopeKey.slice("session:".length) } : {}), mode: "controller", leaseId: lease!.leaseId, installationId: lease!.installationId, expiresAt: new Date(lease!.expiresAt).toISOString() });
      return { kind: "accepted", command: this.command(input.commandId)!, event };
    });
  }
  command(commandId: string): StoredCommand | null {
    const row = this.db.query("SELECT command_id commandId,type,scope_key scopeKey,stream_id streamId,semantic_hash semanticHash,payload_json payload,state,dispatch_count dispatchCount FROM commands WHERE command_id=?").get(commandId) as (Omit<StoredCommand, "payload"> & { payload: string }) | null;
    return row ? { ...row, payload: parseObject(row.payload) } : null;
  }
  transitionCommand(commandId: string, from: readonly string[], to: string): { command: StoredCommand; event: StoredEvent } | null {
    return this.transaction(() => {
      const command = this.command(commandId); if (!command || !from.includes(command.state)) return null;
      const dispatch = to === "dispatched" ? 1 : 0;
      this.db.query("UPDATE commands SET state=?,dispatch_count=dispatch_count+?,updated_at=? WHERE command_id=?").run(to, dispatch, this.now(), commandId);
      const event = this.appendEventTx(command.streamId, "command.state", { commandId, commandType: command.type, state: to, errorCode: null });
      return { command: this.command(commandId)!, event };
    });
  }
  recoveryCandidates(): StoredCommand[] { return (this.db.query("SELECT command_id commandId,type,scope_key scopeKey,stream_id streamId,semantic_hash semanticHash,payload_json payload,state,dispatch_count dispatchCount FROM commands WHERE state IN ('accepted','dispatched','running') ORDER BY created_at").all() as Array<Omit<StoredCommand,"payload"> & {payload:string}>).map((row) => ({ ...row, payload: parseObject(row.payload) })); }
  markUncertainIndeterminate(): StoredCommand[] {
    const changed: StoredCommand[] = [];
    for (const command of this.recoveryCandidates().filter((item) => item.state === "dispatched" || item.state === "running")) {
      const result = this.transitionCommand(command.commandId, [command.state], "indeterminate"); if (result) changed.push(result.command);
    }
    return changed;
  }

  ackCursor(installationId: string, streamId: string, cursor: string): void { canonicalCursor(cursor); this.transaction(() => this.db.query("INSERT INTO client_cursors(installation_id,stream_id,cursor,updated_at) VALUES(?,?,?,?) ON CONFLICT(installation_id,stream_id) DO UPDATE SET cursor=excluded.cursor,updated_at=excluded.updated_at").run(installationId, streamId, cursor, this.now())); }
  ackedCursor(installationId: string, streamId: string): string | null { return (this.db.query("SELECT cursor FROM client_cursors WHERE installation_id=? AND stream_id=?").get(installationId, streamId) as { cursor: string } | null)?.cursor ?? null; }

  lease(scopeKey: string): LeaseRecord | null { return this.db.query("SELECT scope_key scopeKey,lease_id leaseId,installation_id installationId,connection_id connectionId,expires_at expiresAt,reclaimable_until reclaimableUntil,disconnected_at disconnectedAt,revoked_at revokedAt,takeover_reason takeoverReason FROM controller_leases WHERE scope_key=? AND revoked_at IS NULL ORDER BY updated_at DESC LIMIT 1").get(scopeKey) as LeaseRecord | null; }
  leaseById(leaseId: string): LeaseRecord | null { return this.db.query("SELECT scope_key scopeKey,lease_id leaseId,installation_id installationId,connection_id connectionId,expires_at expiresAt,reclaimable_until reclaimableUntil,disconnected_at disconnectedAt,revoked_at revokedAt,takeover_reason takeoverReason FROM controller_leases WHERE lease_id=?").get(leaseId) as LeaseRecord | null; }
  leaseHistory(scopeKey: string): LeaseRecord[] { return this.db.query("SELECT scope_key scopeKey,lease_id leaseId,installation_id installationId,connection_id connectionId,expires_at expiresAt,reclaimable_until reclaimableUntil,disconnected_at disconnectedAt,revoked_at revokedAt,takeover_reason takeoverReason FROM controller_leases WHERE scope_key=? ORDER BY acquired_at").all(scopeKey) as LeaseRecord[]; }
  private applyLeaseMutationTx(mutation: LeaseMutation): LeaseRecord | null {
    const now = mutation.now ?? this.now();
    const current = this.lease(mutation.scopeKey);
    if (mutation.action === "release") {
      if (!current || current.revokedAt !== null || current.installationId !== mutation.installationId || current.connectionId !== mutation.connectionId) throw new StoreError("conflict", "controller release is not authorized");
      this.db.query("UPDATE controller_leases SET revoked_at=?,updated_at=? WHERE lease_id=?").run(now, now, current.leaseId);
      return null;
    }
    const active = current && current.revokedAt === null && current.expiresAt > now;
    const reclaim = current && current.installationId === mutation.installationId && current.reclaimableUntil !== null && current.reclaimableUntil >= now;
    if (active && mutation.action !== "takeover" && !reclaim) throw new StoreError("conflict", "controller already active");
    if (current) this.db.query("UPDATE controller_leases SET revoked_at=?,takeover_reason=?,updated_at=? WHERE lease_id=?").run(now, mutation.action === "takeover" ? "explicit_takeover" : reclaim ? "same_installation_reclaim" : "expired", now, current.leaseId);
    const leaseId = uuid();
    this.db.query("INSERT INTO controller_leases(lease_id,scope_key,installation_id,connection_id,acquired_at,renewed_at,expires_at,reclaimable_until,disconnected_at,takeover_reason,revoked_at,updated_at) VALUES(?,?,?,?,?,?,?,NULL,NULL,?,NULL,?)").run(leaseId, mutation.scopeKey, mutation.installationId, mutation.connectionId, now, now, now + 45_000, mutation.action === "takeover" ? "explicit_takeover" : null, now);
    return this.lease(mutation.scopeKey)!;
  }
  acquireLease(scopeKey: string, installationId: string, connectionId: string, now = this.now(), takeover = false): LeaseRecord {
    return this.transaction(() => this.applyLeaseMutationTx({ action: takeover ? "takeover" : "acquire", scopeKey, installationId, connectionId, now })!);
  }
  renewLease(scopeKey: string, leaseId: string, connectionId: string, now = this.now()): LeaseRecord {
    return this.transaction(() => {
      const lease = this.lease(scopeKey);
      if (!lease || lease.leaseId !== leaseId || lease.connectionId !== connectionId || lease.revokedAt !== null || lease.expiresAt <= now) throw new StoreError("conflict", "stale controller");
      this.db.query("UPDATE controller_leases SET expires_at=?,renewed_at=?,updated_at=? WHERE lease_id=?").run(now + 45_000, now, now, leaseId); return this.lease(scopeKey)!;
    });
  }
  disconnectLease(scopeKey: string, connectionId: string, now = this.now()): void { this.transaction(() => this.db.query("UPDATE controller_leases SET disconnected_at=?,reclaimable_until=?,updated_at=? WHERE scope_key=? AND connection_id=? AND revoked_at IS NULL").run(now, now + 60_000, now, scopeKey, connectionId)); }
  disconnectConnection(connectionId: string, now = this.now()): void { this.transaction(() => this.db.query("UPDATE controller_leases SET disconnected_at=?,reclaimable_until=?,updated_at=? WHERE connection_id=? AND revoked_at IS NULL").run(now, now + 60_000, now, connectionId)); }
  releaseLease(scopeKey: string, leaseId: string, installationId: string, connectionId: string, now = this.now()): void {
    this.transaction(() => {
      const current = this.lease(scopeKey);
      if (!current || current.leaseId !== leaseId || current.installationId !== installationId || current.connectionId !== connectionId) throw new StoreError("conflict", "controller release is not authorized");
      this.applyLeaseMutationTx({ action: "release", scopeKey, installationId, connectionId, now });
    });
  }

  // ---------------------------------------------------------------------
  // M8 — durable workspace trust + host policy state persistence.
  // ---------------------------------------------------------------------

  /**
   * Returns the persisted trust record for the workspace, or `null` when
   * the workspace has never been approved. The record is keyed by
   * `workspace_id` (the root ID), not by absolute path, so a workspace
   * moved on disk flips back to `approval_required` until re-approved.
   */
  loadWorkspaceTrust(workspaceId: string): StoredWorkspaceTrust | null {
    const row = this.db.query(`SELECT workspace_id workspaceId,root_path rootPath,label,fingerprint,policy_version policyVersion,approved_at approvedAt,approved_by approvedBy,seeded_at seededAt,updated_at updatedAt FROM workspace_trust WHERE workspace_id=?`).get(workspaceId) as (Omit<StoredWorkspaceTrust, "seededAt"> & { seededAt: number | null }) | null;
    if (!row) return null;
    const { seededAt, ...rest } = row;
    return seededAt === null ? rest : { ...rest, seededAt };
  }

  /**
   * Persists (creates or replaces) the trust record for a workspace.
   * The fingerprint is captured at call time — callers must have already
   * canonicalized the workspace and computed the fingerprint so this
   * method is purely a write-side primitive.
   */
  saveWorkspaceTrust(record: StoredWorkspaceTrust): void {
    this.transaction(() => {
      this.db.query(`INSERT INTO workspace_trust(workspace_id,root_path,label,fingerprint,policy_version,approved_at,approved_by,seeded_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(workspace_id) DO UPDATE SET root_path=excluded.root_path,label=excluded.label,fingerprint=excluded.fingerprint,policy_version=excluded.policy_version,approved_at=excluded.approved_at,approved_by=excluded.approved_by,updated_at=excluded.updated_at`).run(
        record.workspaceId, record.rootPath, record.label, record.fingerprint, record.policyVersion, record.approvedAt, record.approvedBy, record.seededAt ?? null, record.updatedAt,
      );
    });
  }

  /** Lists every persisted trust record (used by diagnostics + tests). */
  listWorkspaceTrust(): readonly StoredWorkspaceTrust[] {
    return (this.db.query(`SELECT workspace_id workspaceId,root_path rootPath,label,fingerprint,policy_version policyVersion,approved_at approvedAt,approved_by approvedBy,seeded_at seededAt,updated_at updatedAt FROM workspace_trust ORDER BY workspace_id`).all() as Array<Omit<StoredWorkspaceTrust, "seededAt"> & { seededAt: number | null }>).map((row) => {
      const { seededAt, ...rest } = row;
      return seededAt === null ? rest : { ...rest, seededAt };
    });
  }

  /** Clears the trust record for a workspace. Idempotent. */
  clearWorkspaceTrust(workspaceId: string): void {
    this.transaction(() => this.db.query("DELETE FROM workspace_trust WHERE workspace_id=?").run(workspaceId));
  }

  /** Returns the persisted host policy state, or `null` if never set. */
  loadHostPolicyState(): StoredHostPolicyState | null {
    const row = this.db.query(`SELECT mode,policy_version policyVersion,fingerprint,source,updated_at updatedAt,updated_by updatedBy FROM policy_state WHERE singleton=1`).get() as (Omit<StoredHostPolicyState, "updatedBy"> & { updatedBy: string | null }) | null;
    if (!row) return null;
    const { updatedBy, ...rest } = row;
    return updatedBy === null ? rest : { ...rest, updatedBy };
  }

  /** Persists (creates or replaces) the host policy state. */
  saveHostPolicyState(state: StoredHostPolicyState): void {
    this.transaction(() => {
      this.db.query(`INSERT INTO policy_state(singleton,mode,policy_version,fingerprint,source,updated_at,updated_by) VALUES(1,?,?,?,?,?,?)
        ON CONFLICT(singleton) DO UPDATE SET mode=excluded.mode,policy_version=excluded.policy_version,fingerprint=excluded.fingerprint,source=excluded.source,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).run(
        state.mode, state.policyVersion, state.fingerprint, state.source, state.updatedAt, state.updatedBy ?? null,
      );
    });
  }

  enqueueFollowUp(input: { sessionId: string; message: string; attachmentIds?: readonly string[]; queueItemId?: string }): StoredQueueItem {
    return this.transaction(() => {
      const count = Number((this.db.query("SELECT count(*) AS n FROM follow_up_queue WHERE session_id=? AND state='queued'").get(input.sessionId) as { n: number }).n);
      if (count >= 10) throw new StoreError("full", "queue_full");
      const position = Number((this.db.query("SELECT coalesce(max(position),0)+1 AS n FROM follow_up_queue WHERE session_id=?").get(input.sessionId) as { n: number }).n);
      const item: StoredQueueItem = { queueItemId: input.queueItemId ?? uuid(), sessionId: input.sessionId, message: input.message, attachmentIds: [...(input.attachmentIds ?? [])], position, state: "queued", createdAt: this.now() };
      this.db.query("INSERT INTO follow_up_queue(queue_item_id,session_id,message,attachment_ids_json,state,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(item.queueItemId, item.sessionId, item.message, JSON.stringify(item.attachmentIds), item.state, item.position, item.createdAt, item.createdAt);
      this.emitQueueStateTx(input.sessionId, "turn.queued", { sessionId: input.sessionId, queueItemId: item.queueItemId, position });
      return item;
    });
  }
  listFollowUps(sessionId: string): StoredQueueItem[] {
    const rows = this.db.query("SELECT queue_item_id AS queueItemId,session_id AS sessionId,message,attachment_ids_json AS attachmentIdsJson,position,state,created_at AS createdAt FROM follow_up_queue WHERE session_id=? AND state='queued' ORDER BY position").all(sessionId) as Array<{ queueItemId:string;sessionId:string;message:string;attachmentIdsJson:string;position:number;state:"queued";createdAt:number }>;
    return rows.map(({ attachmentIdsJson, ...row }) => ({ ...row, attachmentIds: JSON.parse(attachmentIdsJson) as string[] }));
  }
  removeFollowUp(sessionId: string, queueItemId: string): StoredQueueItem {
    return this.transaction(() => {
      const item = this.listFollowUps(sessionId).find((value) => value.queueItemId === queueItemId);
      if (!item) throw new StoreError("not_found", "queue_item_not_found");
      this.db.query("DELETE FROM follow_up_queue WHERE queue_item_id=? AND state='queued'").run(queueItemId);
      this.emitQueueStateTx(sessionId, "queue.snapshot", { removedQueueItemId: queueItemId });
      return item;
    });
  }
  clearFollowUps(sessionId: string): StoredQueueItem[] {
    return this.transaction(() => {
      const items = this.listFollowUps(sessionId);
      this.db.query("DELETE FROM follow_up_queue WHERE session_id=? AND state='queued'").run(sessionId);
      this.emitQueueStateTx(sessionId, "queue.snapshot", { cleared: true });
      return items;
    });
  }
  claimNextFollowUp(sessionId: string): StoredQueueItem | null {
    return this.transaction(() => {
      const item = this.listFollowUps(sessionId)[0];
      if (!item) return null;
      const result = this.db.query("UPDATE follow_up_queue SET state='dispatching',updated_at=? WHERE queue_item_id=? AND state='queued'").run(this.now(), item.queueItemId);
      if (result.changes !== 1) return null;
      this.emitQueueStateTx(sessionId, "queue.snapshot", { dispatchedQueueItemId: item.queueItemId });
      return { ...item, state: "dispatching" };
    });
  }
  finishFollowUp(queueItemId: string, requeue = false): void {
    this.transaction(() => {
      const row = this.db.query("SELECT session_id AS sessionId FROM follow_up_queue WHERE queue_item_id=? AND state='dispatching'").get(queueItemId) as { sessionId:string } | null;
      if (!row) return;
      if (requeue) this.db.query("UPDATE follow_up_queue SET state='queued',updated_at=? WHERE queue_item_id=?").run(this.now(), queueItemId);
      else this.db.query("DELETE FROM follow_up_queue WHERE queue_item_id=?").run(queueItemId);
      this.emitQueueStateTx(row.sessionId, "queue.snapshot", requeue ? { recoveredQueueItemId: queueItemId } : { completedQueueItemId: queueItemId });
    });
  }
  recoverDispatchingFollowUps(): number {
    return this.transaction(() => Number(this.db.query("UPDATE follow_up_queue SET state='queued',updated_at=? WHERE state='dispatching'").run(this.now()).changes));
  }
  private emitQueueStateTx(sessionId: string, eventType: string, extra: Record<string, unknown>): void {
    const items = this.listFollowUps(sessionId);
    const payloadItems = items.map((item, index) => ({ queueItemId:item.queueItemId, position:index + 1, message:item.message, attachmentIds:item.attachmentIds, createdAt:new Date(item.createdAt).toISOString() }));
    this.appendEventTx(`session:${sessionId}`, eventType, { sessionId, ...extra, items: payloadItems, queueCount: items.length });
    if (eventType !== "queue.snapshot") this.appendEventTx(`session:${sessionId}`, "queue.snapshot", { sessionId, items: payloadItems, queueCount: items.length });
    const prior = this.sessionState(sessionId) ?? { sessionId };
    const next = { ...prior, queueCount: items.length, updatedAt: this.now() };
    this.db.query("UPDATE sessions SET state_json=?,updated_at=? WHERE session_id=?").run(JSON.stringify(next), this.now(), sessionId);
    this.appendEventTx(`host:${this.identity().hostId}`, "session.summary", { ...next, changedKeys:["queueCount"] });
  }

  createDialog(input: { sessionId:string; upstreamId:string; method:StoredDialog["method"]; request:Record<string,unknown>; expiresAt:number; dialogId?:string }): StoredDialog {
    return this.transaction(() => {
      this.db.query("UPDATE extension_dialogs SET state='orphaned',updated_at=? WHERE session_id=? AND state='pending'").run(this.now(), input.sessionId);
      const dialog: StoredDialog = { dialogId:input.dialogId ?? uuid(), sessionId:input.sessionId, upstreamId:input.upstreamId, method:input.method, request:{...input.request}, state:"pending", createdAt:this.now(), expiresAt:input.expiresAt };
      this.db.query("INSERT INTO extension_dialogs(dialog_id,session_id,upstream_id,method,request_json,state,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(dialog.dialogId,dialog.sessionId,dialog.upstreamId,dialog.method,JSON.stringify(dialog.request),dialog.state,dialog.createdAt,dialog.expiresAt,dialog.createdAt);
      return dialog;
    });
  }
  pendingDialog(sessionId:string, now=this.now()): StoredDialog | null {
    this.expireDialogs(now);
    const row = this.db.query("SELECT dialog_id AS dialogId,session_id AS sessionId,upstream_id AS upstreamId,method,request_json AS requestJson,state,created_at AS createdAt,expires_at AS expiresAt FROM extension_dialogs WHERE session_id=? AND state='pending' ORDER BY created_at DESC LIMIT 1").get(sessionId) as ({dialogId:string;sessionId:string;upstreamId:string;method:StoredDialog["method"];requestJson:string;state:StoredDialog["state"];createdAt:number;expiresAt:number}) | null;
    if (!row) return null; const { requestJson, ...rest } = row; return { ...rest, request:parseObject(requestJson) };
  }
  claimDialogResponse(sessionId:string, dialogId:string, now=this.now()): StoredDialog {
    return this.transaction(() => {
      const dialog = this.pendingDialog(sessionId, now);
      if (!dialog || dialog.dialogId !== dialogId) throw new StoreError("conflict", "invalid_state");
      const result = this.db.query("UPDATE extension_dialogs SET state='responded',updated_at=? WHERE dialog_id=? AND state='pending' AND expires_at>?").run(now,dialogId,now);
      if (result.changes !== 1) throw new StoreError("conflict", "invalid_state");
      return dialog;
    });
  }
  orphanPendingDialogs(sessionId:string): number {
    return this.transaction(()=>Number(this.db.query("UPDATE extension_dialogs SET state='orphaned',updated_at=? WHERE session_id=? AND state='pending'").run(this.now(),sessionId).changes));
  }
  expireDialogs(now=this.now()): StoredDialog[] {
    const rows = this.db.query("SELECT dialog_id AS dialogId,session_id AS sessionId,upstream_id AS upstreamId,method,request_json AS requestJson,state,created_at AS createdAt,expires_at AS expiresAt FROM extension_dialogs WHERE state='pending' AND expires_at<=?").all(now) as Array<{dialogId:string;sessionId:string;upstreamId:string;method:StoredDialog["method"];requestJson:string;state:StoredDialog["state"];createdAt:number;expiresAt:number}>;
    if (rows.length) this.db.query("UPDATE extension_dialogs SET state='expired',updated_at=? WHERE state='pending' AND expires_at<=?").run(now,now);
    return rows.map(({requestJson,...row}) => ({...row,state:"expired",request:parseObject(requestJson)}));
  }

  // ---------------------------------------------------------------------
  // M15 — durable device installation registry + dedupe table.
  //
  // The notification service uses these methods to register, replace,
  // and unregister mobile device installs, and to dedupe retries from
  // upstream events. Both tables are bounded and swept periodically.
  // ---------------------------------------------------------------------

  /**
   * Register a device install. Idempotent on `(installationId, platform)`:
   * a second call for the same pair replaces the row, atomically bumping
   * the token revision. The bridge treats re-registration as the
   * canonical "I just installed on a new phone" signal from mobile.
   */
  registerDeviceInstall(input: {
    readonly deviceId?: string;
    readonly installationId: string;
    readonly platform: "apns" | "fcm";
    readonly pushToken: string;
    readonly appVersion: string;
  }): { readonly device: import("../notifications/types").StoredDeviceInstall; readonly replaced: boolean } {
    return this.transaction(() => {
      const existing = this.db.query(
        "SELECT device_id AS deviceId, installation_id AS installationId, platform, push_token AS pushToken, app_version AS appVersion, token_revision AS tokenRevision, last_seen_at AS lastSeenAt, created_at AS createdAt, rejected_reason AS rejectedReason, rejected_at AS rejectedAt FROM notification_devices WHERE installation_id=? AND platform=?",
      ).get(input.installationId, input.platform) as (Omit<import("../notifications/types").StoredDeviceInstall, "rejectedReason" | "rejectedAt"> & { rejectedReason: string | null; rejectedAt: number | null }) | null;
      if (existing) {
        const replaced = existing.pushToken !== input.pushToken || existing.appVersion !== input.appVersion;
        const revision = replaced ? existing.tokenRevision + 1 : existing.tokenRevision;
        this.db.query(
          "UPDATE notification_devices SET device_id=?, push_token=?, app_version=?, token_revision=?, last_seen_at=?, rejected_reason=NULL, rejected_at=NULL WHERE installation_id=? AND platform=?",
        ).run(existing.deviceId, input.pushToken, input.appVersion, revision, this.now(), input.installationId, input.platform);
        const updated = this.findDeviceInstallById(existing.deviceId)!;
        return { device: updated, replaced };
      }
      const deviceId = input.deviceId ?? uuid();
      const createdAt = this.now();
      this.db.query(
        "INSERT INTO notification_devices(device_id,installation_id,platform,push_token,app_version,token_revision,last_seen_at,created_at,rejected_reason,rejected_at) VALUES(?,?,?,?,?,?,?,?,NULL,NULL)",
      ).run(deviceId, input.installationId, input.platform, input.pushToken, input.appVersion, 1, createdAt, createdAt);
      return { device: this.findDeviceInstallById(deviceId)!, replaced: false };
    });
  }

  /**
   * Replace a token on an existing install. Idempotent. Returns `null`
   * when the install no longer exists so the caller can distinguish a
   * rotation from an unknown device.
   */
  replaceDeviceToken(input: { readonly deviceId: string; readonly pushToken: string; readonly appVersion: string }): import("../notifications/types").StoredDeviceInstall | null {
    return this.transaction(() => {
      const existing = this.findDeviceInstallById(input.deviceId);
      if (!existing) return null;
      const next = existing.pushToken === input.pushToken && existing.appVersion === input.appVersion ? existing.tokenRevision : existing.tokenRevision + 1;
      this.db.query(
        "UPDATE notification_devices SET push_token=?, app_version=?, token_revision=?, last_seen_at=?, rejected_reason=NULL, rejected_at=NULL WHERE device_id=?",
      ).run(input.pushToken, input.appVersion, next, this.now(), input.deviceId);
      return this.findDeviceInstallById(input.deviceId);
    });
  }

  /** Unregister a single device install. Idempotent. */
  unregisterDeviceInstall(deviceId: string): boolean {
    return this.transaction(() => Boolean(this.db.query("DELETE FROM notification_devices WHERE device_id=?").run(deviceId).changes));
  }

  /** Unregister every install belonging to an installationId. */
  unregisterInstallation(installationId: string): number {
    return this.transaction(() => Number(this.db.query("DELETE FROM notification_devices WHERE installation_id=?").run(installationId).changes));
  }

  /**
   * Mark a device as permanently rejected. The notification service
   * calls this when APNs/FCM returns a permanent-failure reason; the
   * device is removed from the active registry once the caller calls
   * {@link unregisterDeviceInstall}.
   */
  markDeviceRejected(deviceId: string, reason: string): import("../notifications/types").StoredDeviceInstall | null {
    return this.transaction(() => {
      const existing = this.findDeviceInstallById(deviceId); if (!existing) return null;
      this.db.query(
        "UPDATE notification_devices SET rejected_reason=?, rejected_at=? WHERE device_id=?",
      ).run(reason.slice(0, 200), this.now(), deviceId);
      return this.findDeviceInstallById(deviceId);
    });
  }

  /** Find a device install by id. */
  findDeviceInstallById(deviceId: string): import("../notifications/types").StoredDeviceInstall | null {
    const row = this.db.query(
      "SELECT device_id AS deviceId, installation_id AS installationId, platform, push_token AS pushToken, app_version AS appVersion, token_revision AS tokenRevision, last_seen_at AS lastSeenAt, created_at AS createdAt, rejected_reason AS rejectedReason, rejected_at AS rejectedAt FROM notification_devices WHERE device_id=?",
    ).get(deviceId) as (Omit<import("../notifications/types").StoredDeviceInstall, "rejectedReason" | "rejectedAt"> & { rejectedReason: string | null; rejectedAt: number | null }) | null;
    if (!row) return null;
    const { rejectedReason, rejectedAt, ...rest } = row;
    return rejectedReason && rejectedAt !== null ? { ...rest, rejectedReason, rejectedAt } : rest;
  }

  /** List active device installs. Used by diagnostics + the service loop. */
  listActiveDeviceInstalls(): readonly import("../notifications/types").StoredDeviceInstall[] {
    return (this.db.query(
      "SELECT device_id AS deviceId, installation_id AS installationId, platform, push_token AS pushToken, app_version AS appVersion, token_revision AS tokenRevision, last_seen_at AS lastSeenAt, created_at AS createdAt, rejected_reason AS rejectedReason, rejected_at AS rejectedAt FROM notification_devices WHERE rejected_reason IS NULL ORDER BY created_at",
    ).all() as Array<Omit<import("../notifications/types").StoredDeviceInstall, "rejectedReason" | "rejectedAt"> & { rejectedReason: string | null; rejectedAt: number | null }>).map((row) => {
      const { rejectedReason, rejectedAt, ...rest } = row;
      return rejectedReason && rejectedAt !== null ? { ...rest, rejectedReason, rejectedAt } : rest;
    });
  }

  /** Record that a source event produced (or was coalesced into) a notification. */
  recordNotificationDedup(input: { readonly sourceEventId: string; readonly kind: string; readonly sessionId: string }): void {
    this.transaction(() => {
      this.db.query("INSERT OR IGNORE INTO notification_dedup(source_event_id,kind,session_id,created_at) VALUES(?,?,?,?)").run(input.sourceEventId, input.kind, input.sessionId, this.now());
    });
  }

  /** Returns true when the source event has been recorded before. */
  hasNotificationDedup(sourceEventId: string): boolean {
    const row = this.db.query("SELECT 1 present FROM notification_dedup WHERE source_event_id=?").get(sourceEventId);
    return row !== null;
  }

  /** Sweep dedupe records older than the dedupe window. */
  sweepNotificationDedup(retentionMs: number, now = this.now()): number {
    return this.transaction(() => Number(this.db.query("DELETE FROM notification_dedup WHERE created_at < ?").run(now - retentionMs).changes));
  }

  /** Update the last-seen timestamp on a device install (heartbeat). */
  touchDeviceInstall(deviceId: string): void {
    this.transaction(() => this.db.query("UPDATE notification_devices SET last_seen_at=? WHERE device_id=?").run(this.now(), deviceId));
  }

  integrityCheck(): boolean { const row = this.db.query("PRAGMA integrity_check").get() as Record<string, unknown> | null; return !!row && Object.values(row).includes("ok"); }
  health(): { ready: boolean; reason?: string } {
    if (!this.writable || this.maintenance) return { ready: false, reason: this.maintenance ? "maintenance" : this.lastFailure ?? "not_writable" };
    try { return this.integrityCheck() ? { ready: true } : { ready: false, reason: "integrity" }; }
    catch (error) { this.mapError(error); return { ready: false, reason: "unavailable" }; }
  }
  backup(destination: string): { path: string; sha256: string; bytes: number } {
    if (this.maintenance) throw new StoreError("busy", "maintenance already active");
    this.maintenance = true;
    try {
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      const temp = `${destination}.tmp-${uuid()}`;
      this.db.query("VACUUM INTO ?").run(temp);
      const bytes = readFileSync(temp); const probe = Database.deserialize(bytes, { strict: true });
      const integrity = probe.query("PRAGMA integrity_check").get() as Record<string,unknown>; probe.close();
      if (!Object.values(integrity).includes("ok")) throw new StoreError("corrupt", "backup integrity check failed");
      const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
      renameSync(temp, destination); const size = statSync(destination).size;
      this.maintenance = false;
      this.transaction(() => this.db.query("INSERT INTO backups(backup_id,path,sha256,bytes,created_at,verified_at) VALUES(?,?,?,?,?,?)").run(uuid(), destination, sha256, size, this.now(), this.now()));
      return { path: destination, sha256, bytes: size };
    } catch (error) { throw this.mapError(error); }
    finally { this.maintenance = false; }
  }
  restore(source: string): { hostId: string; hostGeneration: string } {
    if (this.maintenance) throw new StoreError("busy", "maintenance already active");
    this.maintenance = true;
    try {
      const bytes = readFileSync(source); const temp = `${this.path}.restore-${uuid()}`; writeFileSync(temp, bytes, { mode: 0o600 });
      const expected = this.db.query("SELECT sha256 FROM backups WHERE path=? ORDER BY created_at DESC LIMIT 1").get(source) as { sha256: string } | null;
      if (!expected) { unlinkSync(temp); throw new StoreError("conflict", "backup is not registered"); }
      const actual = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
      if (expected.sha256 !== actual) { unlinkSync(temp); throw new StoreError("corrupt", "backup checksum mismatch"); }
      const probe = Database.deserialize(bytes, { strict: true }); const integrity = probe.query("PRAGMA integrity_check").get() as Record<string,unknown>; probe.close();
      if (!Object.values(integrity).includes("ok")) { unlinkSync(temp); throw new StoreError("corrupt", "backup integrity check failed"); }
      this.db.close(false);
      if (this.path !== ":memory:") copyFileSync(this.path, `${this.path}.pre-restore`);
      rmSync(`${this.path}-wal`, { force: true }); rmSync(`${this.path}-shm`, { force: true });
      renameSync(temp, this.path); this.writable = true; this.lastFailure = null; this.db = this.open(this.path); this.maintenance = false;
      return this.incrementHostGeneration();
    } catch (error) { throw error instanceof StoreError ? error : this.mapError(error); }
    finally { this.maintenance = false; }
  }

  incrementHostGeneration(): { hostId: string; hostGeneration: string } {
    const identity = this.identity();
    return this.transaction(() => {
      const generation = (canonicalCursor(identity.hostGeneration) + 1n).toString();
      this.db.query("UPDATE bridge_identity SET host_generation=?,updated_at=? WHERE singleton=1").run(generation, this.now());
      return { hostId: identity.hostId, hostGeneration: generation };
    });
  }
}
