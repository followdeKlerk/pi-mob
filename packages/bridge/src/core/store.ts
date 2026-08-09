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
export interface StoredEventForwardPage { readonly items: readonly StoredEvent[]; readonly snapshotRevision: string; readonly nextAfterCursor?: string; }
export const MAX_EVENT_PAGE_SIZE = 100;
// Mobile catalogue and transcript discovery are intentionally bounded. This
// is a presentation boundary only: durable session rows and event journals
// remain available to host-side recovery and explicit retention work.
export const MOBILE_SESSION_VISIBILITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MOBILE_ACTIVE_RUNTIME_STATES = new Set([
  "starting",
  "idle",
  "running",
  "waiting_for_input",
  "retry_wait",
  "compacting",
  "stopping",
  "crashed",
  "crash_loop",
  "incompatible",
  "indeterminate",
]);
export function isMobileSessionVisible(summary: Record<string, unknown>, now = Date.now()): boolean {
  const runtimeState = typeof summary.runtimeState === "string" ? summary.runtimeState : "";
  if (MOBILE_ACTIVE_RUNTIME_STATES.has(runtimeState)) return true;
  if (summary.attentionState === "needs_attention") return true;
  if (Number.isInteger(summary.queueCount) && Number(summary.queueCount) > 0) return true;
  const rawActivity = summary.lastActivityAt;
  const activity = typeof rawActivity === "number"
    ? rawActivity
    : typeof rawActivity === "string"
      ? Date.parse(rawActivity)
      : Number(summary.createdAt ?? 0);
  return Number.isFinite(activity) && now - activity <= MOBILE_SESSION_VISIBILITY_WINDOW_MS;
}
export function mobileSessionVisibilityCutoff(now = Date.now()): string {
  return new Date(now - MOBILE_SESSION_VISIBILITY_WINDOW_MS).toISOString();
}
// Maintenance transactions are deliberately bounded so live writes stay responsive.
export const MAX_EVENT_COMPACTION_ROWS = 1000;
export const MAX_EVENT_COMPACTION_BYTES = 4 * 1024 * 1024;
export interface LegacyEventCompactionOptions {
  /** Maximum legacy rows removed by one transaction. */
  readonly maxRows?: number;
  /** Maximum event payload bytes removed by one transaction. */
  readonly maxBytes?: number;
  /** Injectable wall clock used when deciding credential validity. */
  readonly now?: number;
}
export interface LegacyEventCompactionResult {
  readonly deletedRows: number;
  readonly deletedBytes: number;
  /** Streams with events but no valid acknowledged cursor in this batch. */
  readonly blockedStreams: readonly string[];
}
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

/**
 * Phase 4 — durable installation credential row. The bridge stores the
 * SHA-256 hash of the plaintext credential plus metadata; the plaintext
 * lives only in mobile Keystore-backed secure storage.
 */
export interface StoredInstallationCredential {
  readonly installationId: string;
  readonly credentialHash: string;
  readonly enrollmentSecretHash: string;
  readonly enrollmentSource: "qr" | "manual" | "cli" | "seed";
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly expiresAt?: number;
  readonly revokedAt?: number;
  readonly revokedReason?: string;
}
export type LeaseMutation =
  | { readonly action: "acquire" | "takeover"; readonly scopeKey: string; readonly installationId: string; readonly connectionId: string; readonly now?: number }
  | { readonly action: "release"; readonly scopeKey: string; readonly installationId: string; readonly connectionId: string; readonly now?: number };
/** Backend reference retained for daemon/runtime use; never merged into sessionState(). */
export interface StoredBackendSession {
  readonly bridgeSessionId: string;
  readonly backendKind: string;
  readonly backendSessionId: string;
  readonly backendSessionFile: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type BackendMigrationState = "running" | "completed" | "failed" | "indeterminate";
export type BackendMigrationOutcome = "succeeded" | "failed" | "unknown";

/** Durable migration bookkeeping. `reason` is bounded and report-safe. */
export interface StoredBackendMigration {
  readonly bridgeSessionId: string;
  readonly migrationId: string;
  readonly fromBackendKind: string;
  readonly toBackendKind: string;
  readonly state: BackendMigrationState;
  readonly outcome: BackendMigrationOutcome | null;
  readonly reason: string | null;
  readonly attempt: number;
  readonly retryable: boolean;
  readonly startedAt: number;
  readonly completedAt: number | null;
  readonly updatedAt: number;
}

/**
 * Additive migration chain. v1 is the original M6 durable schema; each
 * subsequent version adds only its own tables/indexes and preserves prior
 * schemas and checksums.
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
/**
 * v5 additions (Phase 4). The `installation_credentials` table is the
 * durable registry of mobile installs authorised to speak on a Tailscale
 * tailnet through the bridge. The `enrollment_secrets` table is the set
 * of single-use, expiring pair-payload secrets issued during `pi-mob
 * setup`. Both tables are keyed by hashed values — the bridge never
 * persists plaintext credentials or enrollment secrets.
 *
 * Indexes:
 *   - installation_credentials_credential_hash_lookup supports the
 *     constant-time `findInstallationCredentialByHash` path used for
 *     lookups when only the credential is in hand.
 *   - enrollment_secrets_unique_secret_hash enforces the single-use
 *     semantics; a replayed hash collides and the enroll endpoint
 *     rejects with `enrollment_secret_replayed`.
 */
const MIGRATION_V5 = `
CREATE TABLE IF NOT EXISTS installation_credentials(
  installation_id TEXT PRIMARY KEY,
  credential_hash TEXT NOT NULL,
  enrollment_secret_hash TEXT NOT NULL,
  enrollment_source TEXT NOT NULL CHECK(enrollment_source IN ('qr','manual','cli','seed')),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  revoked_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS installation_credentials_credential_hash ON installation_credentials(credential_hash);
CREATE INDEX IF NOT EXISTS installation_credentials_last_seen ON installation_credentials(last_seen_at);
CREATE TABLE IF NOT EXISTS enrollment_secrets(
  secret_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by_installation_id TEXT
);
`;
const MIGRATION_V5_CHECKSUM = new Bun.CryptoHasher("sha256").update(MIGRATION_V1 + MIGRATION_V2 + MIGRATION_V3 + MIGRATION_V4 + MIGRATION_V5).digest("hex");
/**
 * v6 additions (OMP cutover). Backend references are deliberately separate
 * from the mobile-facing session JSON so private backend paths cannot leak
 * through protocol projections. Migration rows are one-per-bridge-session:
 * a migration id is an idempotency key, while the state/outcome columns make
 * interrupted work explicit and recoverable.
 */
const MIGRATION_V6 = `
CREATE TABLE IF NOT EXISTS session_backend_refs(
  bridge_session_id TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
  backend_kind TEXT NOT NULL CHECK(length(backend_kind) BETWEEN 1 AND 32),
  backend_session_id TEXT NOT NULL CHECK(length(backend_session_id) BETWEEN 1 AND 256),
  backend_session_file TEXT NOT NULL CHECK(length(backend_session_file) BETWEEN 1 AND 4096),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(backend_kind,backend_session_id)
);
CREATE TABLE IF NOT EXISTS session_migrations(
  bridge_session_id TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
  migration_id TEXT NOT NULL CHECK(length(migration_id) BETWEEN 1 AND 256),
  from_backend_kind TEXT NOT NULL CHECK(length(from_backend_kind) BETWEEN 1 AND 32),
  to_backend_kind TEXT NOT NULL CHECK(length(to_backend_kind) BETWEEN 1 AND 32),
  state TEXT NOT NULL CHECK(state IN ('running','completed','failed','indeterminate')),
  outcome TEXT CHECK(outcome IN ('succeeded','failed','unknown')),
  reason TEXT,
  attempt INTEGER NOT NULL CHECK(attempt >= 1),
  retryable INTEGER NOT NULL DEFAULT 0 CHECK(retryable IN (0,1)),
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE(migration_id),
  CHECK(
    (state='running' AND outcome IS NULL AND completed_at IS NULL) OR
    (state='completed' AND outcome='succeeded' AND completed_at IS NOT NULL) OR
    (state='failed' AND outcome='failed' AND completed_at IS NOT NULL) OR
    (state='indeterminate' AND outcome='unknown' AND completed_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS session_migrations_state ON session_migrations(state,updated_at);
`;
const MIGRATION_V6_CHECKSUM = new Bun.CryptoHasher("sha256").update(MIGRATION_V1 + MIGRATION_V2 + MIGRATION_V3 + MIGRATION_V4 + MIGRATION_V5 + MIGRATION_V6).digest("hex");

function canonicalCursor(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new StoreError("conflict", "cursor is not canonical");
  return BigInt(value);
}
function uuid(): string { return crypto.randomUUID().toLowerCase(); }
function parseObject(json: string): Record<string, unknown> { return JSON.parse(json) as Record<string, unknown>; }

function boundedIdentifier(value: string, name: string, max = 256): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new StoreError("conflict", `${name} is invalid`);
  }
  return value;
}
function reportSafeReason(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500);
}
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
      // Full integrity verification is an explicit doctor/backup operation.
      // Normal daemon startup has already proven the database readable by
      // opening it and running migrations; a full-table integrity scan here
      // would block listener startup for transcript-heavy installations.
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
    const existingV5 = db.query("SELECT checksum FROM schema_migrations WHERE version=5").get() as { checksum: string } | null;
    if (existingV5 && existingV5.checksum !== MIGRATION_V5_CHECKSUM) throw new StoreError("corrupt", "migration checksum mismatch (v5)");
    if (!existingV5) {
      this.transactionOn(db, () => {
        db.exec(MIGRATION_V5);
        db.query("INSERT INTO schema_migrations(version,checksum,applied_at) VALUES(5,?,?)").run(MIGRATION_V5_CHECKSUM, this.now());
      });
    }
    const existingV6 = db.query("SELECT checksum FROM schema_migrations WHERE version=6").get() as { checksum: string } | null;
    if (existingV6 && existingV6.checksum !== MIGRATION_V6_CHECKSUM) throw new StoreError("corrupt", "migration checksum mismatch (v6)");
    if (!existingV6) {
      this.transactionOn(db, () => {
        db.exec(MIGRATION_V6);
        db.query("INSERT INTO schema_migrations(version,checksum,applied_at) VALUES(6,?,?)").run(MIGRATION_V6_CHECKSUM, this.now());
      });
    }
  }

  /** Returns the list of applied migration versions. Diagnostic only. */
  migrationsApplied(): number[] {
    return (this.db.query("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>).map((row) => row.version);
  }

  /** Phase 4 — Upsert an installation credential row. Plaintext is never stored;
   * the caller supplies the SHA-256 hex hash. The (installationId, source)
   * pair is the durable identity, and `lastSeenAt` is bumped on every
   * successful match. */
  upsertInstallationCredential(input: {
    readonly installationId: string;
    readonly credentialHash: string;
    readonly enrollmentSecretHash: string;
    readonly enrollmentSource: "qr" | "manual" | "cli" | "seed";
    readonly createdAt: number;
    readonly lastSeenAt: number;
    readonly expiresAt?: number;
  }): StoredInstallationCredential {
    return this.transaction(() => {
      const existing = this.db.query("SELECT 1 present FROM installation_credentials WHERE installation_id=?").get(input.installationId);
      if (existing) {
        this.db.query(
          "UPDATE installation_credentials SET credential_hash=?, enrollment_secret_hash=?, enrollment_source=?, created_at=?, last_seen_at=?, expires_at=? WHERE installation_id=?",
        ).run(input.credentialHash, input.enrollmentSecretHash, input.enrollmentSource, input.createdAt, input.lastSeenAt, input.expiresAt ?? null, input.installationId);
      } else {
        this.db.query(
          "INSERT INTO installation_credentials(installation_id,credential_hash,enrollment_secret_hash,enrollment_source,created_at,last_seen_at,expires_at,revoked_at,revoked_reason) VALUES(?,?,?,?,?,?,?,NULL,NULL)",
        ).run(input.installationId, input.credentialHash, input.enrollmentSecretHash, input.enrollmentSource, input.createdAt, input.lastSeenAt, input.expiresAt ?? null);
      }
      return this.findInstallationCredential(input.installationId) ?? (() => { throw new StoreError("io", "credential row missing after upsert"); })();
    });
  }

  /** Phase 4 — Find an installation credential row by installationId. */
  findInstallationCredential(installationId: string): StoredInstallationCredential | null {
    const row = this.db.query(
      "SELECT installation_id AS installationId, credential_hash AS credentialHash, enrollment_secret_hash AS enrollmentSecretHash, enrollment_source AS enrollmentSource, created_at AS createdAt, last_seen_at AS lastSeenAt, expires_at AS expiresAt, revoked_at AS revokedAt, revoked_reason AS revokedReason FROM installation_credentials WHERE installation_id=?",
    ).get(installationId) as (Omit<StoredInstallationCredential, "expiresAt" | "revokedAt" | "revokedReason"> & { expiresAt: number | null; revokedAt: number | null; revokedReason: string | null }) | null;
    if (!row) return null;
    const { expiresAt, revokedAt, revokedReason, ...rest } = row;
    return {
      ...rest,
      ...(expiresAt !== null ? { expiresAt } : {}),
      ...(revokedAt !== null && revokedReason !== null ? { revokedAt, revokedReason } : {}),
    } satisfies StoredInstallationCredential;
  }

  /** Phase 4 — Touch `last_seen_at` after a successful hello. */
  touchInstallationCredential(installationId: string, at: number): void {
    this.transaction(() => this.db.query("UPDATE installation_credentials SET last_seen_at=? WHERE installation_id=?").run(at, installationId));
  }

  /** Phase 4 — Mark an installation credential revoked. Idempotent. */
  revokeInstallationCredential(installationId: string, reason: string, at: number): boolean {
    return this.transaction(() => {
      const existing = this.db.query("SELECT revoked_at AS revokedAt FROM installation_credentials WHERE installation_id=?").get(installationId) as { revokedAt: number | null } | null;
      if (!existing) return false;
      if (existing.revokedAt !== null) return true;
      this.db.query("UPDATE installation_credentials SET revoked_at=?, revoked_reason=? WHERE installation_id=?").run(at, reason.slice(0, 200), installationId);
      return true;
    });
  }

  /** Phase 4 — Create a pending enrollment secret (single-use, expiring). */
  createEnrollmentSecret(input: { readonly secretHash: string; readonly createdAt: number; readonly expiresAt: number; readonly usedAt?: number | null }): void {
    this.transaction(() => this.db.query("INSERT OR REPLACE INTO enrollment_secrets(secret_hash,created_at,expires_at,used_at,used_by_installation_id) VALUES(?,?,?,?,NULL)").run(input.secretHash, input.createdAt, input.expiresAt, input.usedAt ?? null));
  }

  /** Phase 4 — Atomically consume an enrollment secret. */
  consumeEnrollmentSecret(secretHash: string, at: number, installationId?: string):
    | { readonly kind: "consumed" }
    | { readonly kind: "already_used" }
    | { readonly kind: "expired" }
    | { readonly kind: "unknown" } {
    return this.transaction(() => {
      const row = this.db.query("SELECT expires_at AS expiresAt, used_at AS usedAt FROM enrollment_secrets WHERE secret_hash=?").get(secretHash) as { expiresAt: number; usedAt: number | null } | null;
      if (!row) return { kind: "unknown" };
      if (row.usedAt !== null) return { kind: "already_used" };
      if (row.expiresAt <= at) return { kind: "expired" };
      const result = this.db.query("UPDATE enrollment_secrets SET used_at=?, used_by_installation_id=? WHERE secret_hash=? AND used_at IS NULL").run(at, installationId ?? null, secretHash);
      if (result.changes !== 1) return { kind: "already_used" };
      return { kind: "consumed" };
    });
  }

  /** Phase 4 — Read an enrollment secret's current state without mutating. */
  findEnrollmentSecret(secretHash: string): { readonly createdAt: number; readonly expiresAt: number; readonly usedAt: number | null; readonly usedByInstallationId: string | null } | null {
    const row = this.db.query("SELECT created_at AS createdAt, expires_at AS expiresAt, used_at AS usedAt, used_by_installation_id AS usedByInstallationId FROM enrollment_secrets WHERE secret_hash=?").get(secretHash) as { createdAt: number; expiresAt: number; usedAt: number | null; usedByInstallationId: string | null } | null;
    return row;
  }

  /** Phase 4 — Enumerate every stored `installationId`. Diagnostic only. */
  aggregateRetainedInstallationIds(): readonly string[] {
    return (this.db.query("SELECT installation_id AS installationId FROM installation_credentials ORDER BY created_at").all() as Array<{ installationId: string }>).map((row) => row.installationId);
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
  isSessionVisibleToMobile(sessionId: string, now = this.now()): boolean {
    const row = this.db.query("SELECT state_json state,created_at createdAt FROM sessions WHERE session_id=?").get(sessionId) as { state: string; createdAt: number } | null;
    if (!row) return false;
    const state = parseObject(row.state);
    if (state.lifecycleState === "purged") return false;
    return isMobileSessionVisible({ ...state, createdAt: state.createdAt ?? row.createdAt }, now);
  }

  ensureBackendSession(input: {
    readonly bridgeSessionId: string;
    readonly backendKind: string;
    readonly backendSessionId: string;
    readonly backendSessionFile: string;
    readonly at?: number;
  }): StoredBackendSession {
    const bridgeSessionId = boundedIdentifier(input.bridgeSessionId, "bridge session ID");
    const backendKind = boundedIdentifier(input.backendKind, "backend kind", 32);
    const backendSessionId = boundedIdentifier(input.backendSessionId, "backend session ID");
    const backendSessionFile = boundedIdentifier(input.backendSessionFile, "backend session file", 4096);
    const at = input.at ?? this.now();
    return this.transaction(() => {
      const session = this.db.query("SELECT 1 FROM sessions WHERE session_id=?").get(bridgeSessionId);
      if (!session) this.db.query("INSERT INTO sessions(session_id,state_json,created_at,updated_at) VALUES(?,?,?,?)").run(bridgeSessionId, "{}", at, at);
      const existing = this.db.query(
        "SELECT bridge_session_id AS bridgeSessionId,backend_kind AS backendKind,backend_session_id AS backendSessionId,backend_session_file AS backendSessionFile,created_at AS createdAt,updated_at AS updatedAt FROM session_backend_refs WHERE bridge_session_id=?",
      ).get(bridgeSessionId) as StoredBackendSession | null;
      if (existing) {
        if (existing.backendKind !== backendKind || existing.backendSessionFile !== backendSessionFile) throw new StoreError("conflict", "bridge session backend reference conflicts");
        const owner = this.db.query("SELECT bridge_session_id AS bridgeSessionId FROM session_backend_refs WHERE backend_kind=? AND backend_session_id=?").get(backendKind, backendSessionId) as { bridgeSessionId: string } | null;
        if (owner && owner.bridgeSessionId !== bridgeSessionId) throw new StoreError("conflict", "backend session reference is already assigned");
        if (existing.backendSessionId === backendSessionId) return existing;
        this.db.query("UPDATE session_backend_refs SET backend_session_id=?,updated_at=? WHERE bridge_session_id=?").run(backendSessionId, at, bridgeSessionId);
        return this.backendSession(bridgeSessionId) ?? (() => { throw new StoreError("io", "backend reference missing after update"); })();
      }
      const owner = this.db.query("SELECT bridge_session_id AS bridgeSessionId FROM session_backend_refs WHERE backend_kind=? AND backend_session_id=?").get(backendKind, backendSessionId) as { bridgeSessionId: string } | null;
      if (owner && owner.bridgeSessionId !== bridgeSessionId) throw new StoreError("conflict", "backend session reference is already assigned");
      this.db.query("INSERT INTO session_backend_refs(bridge_session_id,backend_kind,backend_session_id,backend_session_file,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(
        bridgeSessionId, backendKind, backendSessionId, backendSessionFile, at, at,
      );
      return this.backendSession(bridgeSessionId) ?? (() => { throw new StoreError("io", "backend reference missing after insert"); })();
    });
  }

  /** Daemon-only backend identity/reference; never merged into sessionState(). */
  backendSession(bridgeSessionId: string): StoredBackendSession | null {
    const id = boundedIdentifier(bridgeSessionId, "bridge session ID");
    return this.db.query(
      "SELECT bridge_session_id AS bridgeSessionId,backend_kind AS backendKind,backend_session_id AS backendSessionId,backend_session_file AS backendSessionFile,created_at AS createdAt,updated_at AS updatedAt FROM session_backend_refs WHERE bridge_session_id=?",
    ).get(id) as StoredBackendSession | null;
  }

  beginBackendMigration(input: {
    readonly bridgeSessionId: string;
    readonly migrationId: string;
    readonly fromBackendKind: string;
    readonly toBackendKind: string;
    readonly retryable?: boolean;
    readonly at?: number;
  }): StoredBackendMigration {
    const bridgeSessionId = boundedIdentifier(input.bridgeSessionId, "bridge session ID");
    const migrationId = boundedIdentifier(input.migrationId, "migration ID");
    const fromBackendKind = boundedIdentifier(input.fromBackendKind, "source backend kind", 32);
    const toBackendKind = boundedIdentifier(input.toBackendKind, "target backend kind", 32);
    if (fromBackendKind === toBackendKind) throw new StoreError("conflict", "migration source and target backends must differ");
    const at = input.at ?? this.now();
    return this.transaction(() => {
      if (!this.sessionExists(bridgeSessionId)) throw new StoreError("not_found", "session not found");
      const existing = this.db.query(
        "SELECT bridge_session_id AS bridgeSessionId,migration_id AS migrationId,from_backend_kind AS fromBackendKind,to_backend_kind AS toBackendKind,state,outcome,reason,attempt,retryable,started_at AS startedAt,completed_at AS completedAt,updated_at AS updatedAt FROM session_migrations WHERE bridge_session_id=?",
      ).get(bridgeSessionId) as (Omit<StoredBackendMigration, "retryable"> & { retryable: number }) | null;
      if (existing) {
        if (existing.migrationId !== migrationId || existing.fromBackendKind !== fromBackendKind || existing.toBackendKind !== toBackendKind) throw new StoreError("conflict", "bridge session already has a different migration");
        return { ...existing, retryable: Boolean(existing.retryable) };
      }
      if (this.db.query("SELECT 1 FROM session_migrations WHERE migration_id=?").get(migrationId)) throw new StoreError("conflict", "migration ID is already in use");
      this.db.query(
        "INSERT INTO session_migrations(bridge_session_id,migration_id,from_backend_kind,to_backend_kind,state,outcome,reason,attempt,retryable,started_at,completed_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,NULL,?)",
      ).run(bridgeSessionId, migrationId, fromBackendKind, toBackendKind, "running", null, null, 1, input.retryable === true ? 1 : 0, at, at);
      return this.backendMigration(bridgeSessionId) ?? (() => { throw new StoreError("io", "migration row missing after insert"); })();
    });
  }

  backendMigration(bridgeSessionId: string): StoredBackendMigration | null {
    const id = boundedIdentifier(bridgeSessionId, "bridge session ID");
    const row = this.db.query(
      "SELECT bridge_session_id AS bridgeSessionId,migration_id AS migrationId,from_backend_kind AS fromBackendKind,to_backend_kind AS toBackendKind,state,outcome,reason,attempt,retryable,started_at AS startedAt,completed_at AS completedAt,updated_at AS updatedAt FROM session_migrations WHERE bridge_session_id=?",
    ).get(id) as (Omit<StoredBackendMigration, "retryable"> & { retryable: number }) | null;
    return row ? { ...row, retryable: Boolean(row.retryable) } : null;
  }

  completeBackendMigration(input: {
    readonly bridgeSessionId: string;
    readonly migrationId: string;
    readonly outcome: "succeeded" | "failed";
    readonly reason?: string | null;
    readonly retryable?: boolean;
    readonly at?: number;
  }): StoredBackendMigration {
    const id = boundedIdentifier(input.bridgeSessionId, "bridge session ID");
    const migrationId = boundedIdentifier(input.migrationId, "migration ID");
    const at = input.at ?? this.now();
    return this.transaction(() => {
      const prior = this.backendMigration(id);
      if (!prior || prior.migrationId !== migrationId) throw new StoreError("not_found", "migration not found");
      if (prior.state === "indeterminate") throw new StoreError("conflict", "indeterminate migration requires explicit recovery");
      if (prior.state === "completed" || prior.state === "failed") {
        if (prior.outcome === input.outcome) return prior;
        throw new StoreError("conflict", "migration outcome conflicts with durable outcome");
      }
      const state: BackendMigrationState = input.outcome === "succeeded" ? "completed" : "failed";
      this.db.query("UPDATE session_migrations SET state=?,outcome=?,reason=?,retryable=?,completed_at=?,updated_at=? WHERE bridge_session_id=? AND migration_id=? AND state='running'").run(
        state, input.outcome, reportSafeReason(input.reason), input.outcome === "failed" && input.retryable === true ? 1 : 0, at, at, id, migrationId,
      );
      return this.backendMigration(id) ?? (() => { throw new StoreError("io", "migration row missing after completion"); })();
    });
  }

  markBackendMigrationIndeterminate(input: { readonly bridgeSessionId: string; readonly migrationId: string; readonly reason: string; readonly at?: number }): StoredBackendMigration {
    const id = boundedIdentifier(input.bridgeSessionId, "bridge session ID");
    const migrationId = boundedIdentifier(input.migrationId, "migration ID");
    const reason = reportSafeReason(input.reason) ?? "migration outcome is unknown";
    const at = input.at ?? this.now();
    return this.transaction(() => {
      const prior = this.backendMigration(id);
      if (!prior || prior.migrationId !== migrationId) throw new StoreError("not_found", "migration not found");
      if (prior.state === "indeterminate") return prior;
      if (prior.state !== "running") throw new StoreError("conflict", "terminal migration cannot become indeterminate");
      this.db.query("UPDATE session_migrations SET state='indeterminate',outcome='unknown',reason=?,completed_at=NULL,updated_at=? WHERE bridge_session_id=? AND migration_id=? AND state='running'").run(reason, at, id, migrationId);
      return this.backendMigration(id) ?? (() => { throw new StoreError("io", "migration row missing after transition"); })();
    });
  }

  recoverBackendMigration(input: {
    readonly bridgeSessionId: string;
    readonly migrationId: string;
    readonly outcome: "succeeded" | "failed";
    readonly reason: string;
    readonly retryable?: boolean;
    readonly at?: number;
  }): StoredBackendMigration {
    const id = boundedIdentifier(input.bridgeSessionId, "bridge session ID");
    const migrationId = boundedIdentifier(input.migrationId, "migration ID");
    const at = input.at ?? this.now();
    return this.transaction(() => {
      const prior = this.backendMigration(id);
      if (!prior || prior.migrationId !== migrationId) throw new StoreError("not_found", "migration not found");
      if (prior.state !== "indeterminate") {
        if (prior.outcome === input.outcome) return prior;
        throw new StoreError("conflict", "migration is not indeterminate");
      }
      const state: BackendMigrationState = input.outcome === "succeeded" ? "completed" : "failed";
      this.db.query("UPDATE session_migrations SET state=?,outcome=?,reason=?,retryable=?,completed_at=?,updated_at=? WHERE bridge_session_id=? AND migration_id=? AND state='indeterminate'").run(
        state, input.outcome, reportSafeReason(input.reason), input.outcome === "failed" && input.retryable === true ? 1 : 0, at, at, id, migrationId,
      );
      return this.backendMigration(id) ?? (() => { throw new StoreError("io", "migration row missing after recovery"); })();
    });
  }

  retryBackendMigration(input: { readonly bridgeSessionId: string; readonly migrationId: string; readonly at?: number }): StoredBackendMigration {
    const id = boundedIdentifier(input.bridgeSessionId, "bridge session ID");
    const migrationId = boundedIdentifier(input.migrationId, "migration ID");
    const at = input.at ?? this.now();
    return this.transaction(() => {
      const prior = this.backendMigration(id);
      if (!prior || prior.migrationId !== migrationId) throw new StoreError("not_found", "migration not found");
      if (prior.state === "running") return prior;
      if (prior.state === "indeterminate") throw new StoreError("conflict", "indeterminate migration requires explicit recovery");
      if (prior.state !== "failed" || !prior.retryable) throw new StoreError("conflict", "migration is not retryable");
      this.db.query("UPDATE session_migrations SET state='running',outcome=NULL,reason=NULL,attempt=attempt+1,completed_at=NULL,updated_at=? WHERE bridge_session_id=? AND migration_id=? AND state='failed' AND retryable=1").run(at, id, migrationId);
      return this.backendMigration(id) ?? (() => { throw new StoreError("io", "migration row missing after retry"); })();
    });
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

  /**
   * Append using a caller-owned event identity. Replaying the same identity
   * returns the exact durable row without notifying listeners or advancing
   * the stream. Reusing it for different event content is a conflict rather
   * than an accidental duplicate.
   */
  appendEventIdempotent(streamId: string, type: string, payload: Record<string, unknown>, eventId: string): StoredEvent {
    if (!eventId) throw new StoreError("conflict", "eventId is required for idempotent append");
    return this.transaction(() => {
      const row = this.db.query("SELECT event_id eventId,stream_id streamId,cursor,type,payload_json payload,created_at createdAt FROM events WHERE event_id=?").get(eventId) as {
        eventId: string; streamId: string; cursor: string; type: string; payload: string; createdAt: number;
      } | null;
      if (row) {
        const existingPayload = parseObject(row.payload);
        if (row.streamId !== streamId || row.type !== type || JSON.stringify(existingPayload) !== JSON.stringify(payload)) {
          throw new StoreError("conflict", `event identity already exists with different content: ${eventId}`);
        }
        return { ...row, payload: existingPayload };
      }
      return this.appendEventTx(streamId, type, payload, eventId);
    });
  }
  streamPosition(streamId: string): { current: string; floor: string } | null { return this.db.query("SELECT current_cursor current,retention_floor floor FROM streams WHERE stream_id=?").get(streamId) as { current: string; floor: string } | null; }
  setRetentionFloor(streamId: string, floor: string): void { canonicalCursor(floor); this.transaction(() => this.db.query("UPDATE streams SET retention_floor=? WHERE stream_id=?").run(floor, streamId)); }
  listEvents(streamId: string, after = "0", through?: string): StoredEvent[] {
    canonicalCursor(after); if (through) canonicalCursor(through);
    const rows = this.db.query(`SELECT event_id eventId,stream_id streamId,cursor,type,payload_json payload,created_at createdAt FROM events WHERE stream_id=? AND (length(cursor)>length(?) OR (length(cursor)=length(?) AND cursor>?)) ${through ? "AND (length(cursor)<length(?) OR (length(cursor)=length(?) AND cursor<=?))" : ""} ORDER BY length(cursor),cursor`).all(...(through ? [streamId, after, after, after, through, through, through] : [streamId, after, after, after])) as Array<{ eventId: string; streamId: string; cursor: string; type: string; payload: string; createdAt: number }>;
    return rows.map((row) => ({ ...row, payload: parseObject(row.payload) }));
  }
  /**
   * Read a bounded forward page. When `throughCursor` is omitted, the
   * stream's current cursor is captured as the page snapshot boundary. Pass
   * that boundary to subsequent calls to traverse a stable prefix while new
   * events continue to arrive.
   */
  pageEvents(streamId: string, pageSize: number, afterCursor = "0", throughCursor?: string): StoredEventForwardPage {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_EVENT_PAGE_SIZE) {
      throw new StoreError("conflict", `event page size must be an integer from 1 through ${MAX_EVENT_PAGE_SIZE}`);
    }
    canonicalCursor(afterCursor);
    if (throughCursor !== undefined) canonicalCursor(throughCursor);
    return this.transaction(() => {
      const position = this.streamPosition(streamId);
      if (!position) throw new StoreError("not_found", "stream not found");
      const through = throughCursor ?? position.current;
      const rows = this.db.query(`SELECT event_id eventId,stream_id streamId,cursor,type,payload_json payload,created_at createdAt FROM events WHERE stream_id=? AND (length(cursor)>length(?) OR (length(cursor)=length(?) AND cursor>?)) AND (length(cursor)<length(?) OR (length(cursor)=length(?) AND cursor<=?)) ORDER BY length(cursor),cursor LIMIT ?`).all(streamId, afterCursor, afterCursor, afterCursor, through, through, through, pageSize + 1) as Array<{ eventId: string; streamId: string; cursor: string; type: string; payload: string; createdAt: number }>;
      const hasMore = rows.length > pageSize;
      const items = rows.slice(0, pageSize).map((row) => ({ ...row, payload: parseObject(row.payload) }));
      return {
        items,
        snapshotRevision: through,
        ...(hasMore && items.length > 0 ? { nextAfterCursor: items[items.length - 1]!.cursor } : {}),
      };
    });
  }
  latestEvent(streamId: string): StoredEvent | null {
    const row = this.db.query("SELECT event_id eventId,stream_id streamId,cursor,type,payload_json payload,created_at createdAt FROM events WHERE stream_id=? ORDER BY length(cursor) DESC,cursor DESC LIMIT 1").get(streamId) as { eventId: string; streamId: string; cursor: string; type: string; payload: string; createdAt: number } | null;
    return row ? { ...row, payload: parseObject(row.payload) } : null;
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
      rows = rows.filter((row) => isMobileSessionVisible(row, this.now()));
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
    const row = this.db.query("SELECT command_id commandId,type,scope_key scopeKey,stream_id streamId,semantic_hash semanticHash,payload_json payload,state,dispatch_count dispatchCount,created_at createdAt,updated_at updatedAt FROM commands WHERE command_id=?").get(commandId) as (Omit<StoredCommand, "payload"> & { payload: string }) | null;
    return row ? { ...row, payload: parseObject(row.payload) } : null;
  }
  transitionCommand(commandId: string, from: readonly string[], to: string): { command: StoredCommand; event: StoredEvent } | null {
    return this.transaction(() => {
      const command = this.command(commandId); if (!command || !from.includes(command.state)) return null;
      const dispatch = to === "dispatched" ? 1 : 0;
      this.db.query("UPDATE commands SET state=?,dispatch_count=dispatch_count+?,updated_at=? WHERE command_id=?").run(to, dispatch, this.now(), commandId);
      const event = this.appendEventTx(command.streamId, "command.state", { commandId, commandType: command.type, state: to });
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

  /**
   * Remove a bounded prefix of the legacy `events` journal. For each stream,
   * only valid credentials with an existing cursor row participate in the
   * acknowledgement floor; a credential that never subscribed to the stream
   * does not pin its history. Revoked and expired rows are deliberately
   * absent from that quorum. When no valid acknowledgement exists, the stream
   * is left untouched. The delete and retention-floor update share one
   * transaction, so a restart cannot expose a floor for rows that were not
   * removed.
   *
   * This method never touches `canonical_session_events` and never advances a
   * floor past the stream's current cursor. Decimal cursors are compared with
   * bigint in memory rather than JavaScript Number.
   */
  compactLegacyEvents(options: LegacyEventCompactionOptions = {}): LegacyEventCompactionResult {
    const maxRows = options.maxRows ?? MAX_EVENT_COMPACTION_ROWS;
    const maxBytes = options.maxBytes ?? MAX_EVENT_COMPACTION_BYTES;
    const at = options.now ?? this.now();
    if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > MAX_EVENT_COMPACTION_ROWS) throw new StoreError("conflict", `event compaction rows must be an integer from 1 through ${MAX_EVENT_COMPACTION_ROWS}`);
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_EVENT_COMPACTION_BYTES) throw new StoreError("conflict", `event compaction bytes must be an integer from 1 through ${MAX_EVENT_COMPACTION_BYTES}`);
    return this.transaction(() => {
      const streams = this.db.query("SELECT stream_id streamId,current_cursor current,retention_floor floor FROM streams ORDER BY stream_id").all() as Array<{ streamId: string; current: string; floor: string }>;
      const blockedStreams: string[] = [];
      let deletedRows = 0;
      let deletedBytes = 0;
      for (const stream of streams) {
        if (deletedRows >= maxRows || deletedBytes >= maxBytes) break;
        const current = canonicalCursor(stream.current);
        const floor = canonicalCursor(stream.floor);
        // Missing cursor rows are intentionally excluded: a client that has
        // never subscribed to this stream will receive snapshot_required when
        // it first syncs, rather than pinning history forever.
        const cursorRows = this.db.query(
          "SELECT cc.cursor FROM client_cursors cc INNER JOIN installation_credentials credentials ON credentials.installation_id=cc.installation_id WHERE cc.stream_id=? AND credentials.revoked_at IS NULL AND (credentials.expires_at IS NULL OR credentials.expires_at>?) ORDER BY cc.installation_id",
        ).all(stream.streamId, at) as Array<{ cursor: string }>;
        const acknowledgements: bigint[] = [];
        for (const row of cursorRows) {
          try { acknowledgements.push(canonicalCursor(row.cursor)); }
          catch { /* malformed durable cursors cannot authorize deletion */ }
        }
        if (acknowledgements.length === 0) {
          if (this.db.query("SELECT 1 present FROM events WHERE stream_id=? LIMIT 1").get(stream.streamId)) blockedStreams.push(stream.streamId);
          continue;
        }
        let safeCursor = acknowledgements.reduce((minimum, cursor) => cursor < minimum ? cursor : minimum, current);
        if (safeCursor > current) safeCursor = current;
        if (safeCursor <= floor) continue;
        const remainingRows = maxRows - deletedRows;
        const remainingBytes = maxBytes - deletedBytes;
        const candidates = this.db.query(
          "SELECT cursor,bytes FROM events WHERE stream_id=? AND (length(cursor)>length(?) OR (length(cursor)=length(?) AND cursor>?)) AND (length(cursor)<length(?) OR (length(cursor)=length(?) AND cursor<=?)) ORDER BY length(cursor),cursor LIMIT ?",
        ).all(stream.streamId, stream.floor, stream.floor, stream.floor, safeCursor.toString(), safeCursor.toString(), safeCursor.toString(), remainingRows) as Array<{ cursor: string; bytes: number }>;
        const selected: Array<{ cursor: string; bytes: number }> = [];
        let selectedBytes = 0;
        for (const candidate of candidates) {
          if (selectedBytes + candidate.bytes > remainingBytes) break;
          selected.push(candidate);
          selectedBytes += candidate.bytes;
        }
        if (selected.length === 0) continue;
        const greatestDeleted = canonicalCursor(selected[selected.length - 1]!.cursor);
        // Candidates are ordered from the floor, so this one predicate removes
        // exactly the selected contiguous prefix in one SQL statement.
        this.db.query(
          "DELETE FROM events WHERE stream_id=? AND (length(cursor)>length(?) OR (length(cursor)=length(?) AND cursor>?)) AND (length(cursor)<length(?) OR (length(cursor)=length(?) AND cursor<=?))",
        ).run(stream.streamId, stream.floor, stream.floor, stream.floor, greatestDeleted.toString(), greatestDeleted.toString(), greatestDeleted.toString());
        const candidateFloor = floor > greatestDeleted ? floor : greatestDeleted;
        const newFloor = candidateFloor > current ? current : candidateFloor;
        this.db.query("UPDATE streams SET retention_floor=? WHERE stream_id=?").run(newFloor.toString(), stream.streamId);
        deletedRows += selected.length;
        deletedBytes += selectedBytes;
      }
      return { deletedRows, deletedBytes, blockedStreams };
    });
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
    try {
      const row = this.db.query("SELECT 1 AS ok").get() as { ok?: number } | null;
      return row?.ok === 1 ? { ready: true } : { ready: false, reason: "unavailable" };
    }
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
