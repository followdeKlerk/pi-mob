import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type StoreErrorCode = "busy" | "full" | "readonly" | "corrupt" | "io" | "conflict" | "not_found";
export class StoreError extends Error {
  override readonly name = "StoreError";
  constructor(readonly code: StoreErrorCode, message: string, options?: ErrorOptions) { super(message, options); }
}

export interface StoredEvent { readonly eventId: string; readonly streamId: string; readonly cursor: string; readonly type: string; readonly payload: Record<string, unknown>; readonly createdAt: number; }
export interface StoredCommand { readonly commandId: string; readonly type: string; readonly scopeKey: string; readonly streamId: string; readonly semanticHash: string; readonly payload: Record<string, unknown>; readonly state: string; readonly dispatchCount: number; }
export type AcceptCommandResult = { readonly kind: "accepted" | "duplicate"; readonly command: StoredCommand; readonly event?: StoredEvent } | { readonly kind: "conflict" };
export interface LeaseRecord { readonly scopeKey: string; readonly leaseId: string; readonly installationId: string; readonly connectionId: string; readonly expiresAt: number; readonly reclaimableUntil: number | null; readonly disconnectedAt: number | null; readonly revokedAt: number | null; }
export type LeaseMutation =
  | { readonly action: "acquire" | "takeover"; readonly scopeKey: string; readonly installationId: string; readonly connectionId: string; readonly now?: number }
  | { readonly action: "release"; readonly scopeKey: string; readonly installationId: string; readonly connectionId: string; readonly now?: number };

const MIGRATION = `
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
const MIGRATION_CHECKSUM = new Bun.CryptoHasher("sha256").update(MIGRATION).digest("hex");

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
    const existing = db.query("SELECT checksum FROM schema_migrations WHERE version=1").get() as { checksum: string } | null;
    if (existing && existing.checksum !== MIGRATION_CHECKSUM) throw new StoreError("corrupt", "migration checksum mismatch");
    if (!existing) {
      this.transactionOn(db, () => {
        db.exec(MIGRATION);
        db.query("INSERT INTO schema_migrations(version,checksum,applied_at) VALUES(1,?,?)").run(MIGRATION_CHECKSUM, this.now());
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
  readReplay(streamId: string, after: string): { current: string; floor: string; events: StoredEvent[] } {
    return this.transaction(() => {
      const position = this.streamPosition(streamId); if (!position) throw new StoreError("not_found", "stream not found");
      return { ...position, events: this.listEvents(streamId, after, position.current) };
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

  lease(scopeKey: string): LeaseRecord | null { return this.db.query("SELECT scope_key scopeKey,lease_id leaseId,installation_id installationId,connection_id connectionId,expires_at expiresAt,reclaimable_until reclaimableUntil,disconnected_at disconnectedAt,revoked_at revokedAt FROM controller_leases WHERE scope_key=? AND revoked_at IS NULL ORDER BY updated_at DESC LIMIT 1").get(scopeKey) as LeaseRecord | null; }
  leaseById(leaseId: string): LeaseRecord | null { return this.db.query("SELECT scope_key scopeKey,lease_id leaseId,installation_id installationId,connection_id connectionId,expires_at expiresAt,reclaimable_until reclaimableUntil,disconnected_at disconnectedAt,revoked_at revokedAt FROM controller_leases WHERE lease_id=?").get(leaseId) as LeaseRecord | null; }
  leaseHistory(scopeKey: string): LeaseRecord[] { return this.db.query("SELECT scope_key scopeKey,lease_id leaseId,installation_id installationId,connection_id connectionId,expires_at expiresAt,reclaimable_until reclaimableUntil,disconnected_at disconnectedAt,revoked_at revokedAt FROM controller_leases WHERE scope_key=? ORDER BY acquired_at").all(scopeKey) as LeaseRecord[]; }
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
      const identity = this.identity();
      return this.transaction(() => {
        const generation = (canonicalCursor(identity.hostGeneration) + 1n).toString();
        this.db.query("UPDATE bridge_identity SET host_generation=?,updated_at=? WHERE singleton=1").run(generation, this.now()); return { hostId: identity.hostId, hostGeneration: generation };
      });
    } catch (error) { throw error instanceof StoreError ? error : this.mapError(error); }
    finally { this.maintenance = false; }
  }
}
