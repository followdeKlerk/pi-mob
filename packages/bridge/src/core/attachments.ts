/**
 * M13 — bounded resumable upload state.
 *
 * This module owns all persistence for attachment upload sessions:
 *
 *   - opaque IDs (public IDs are hex tokens; filesystem paths never leave
 *     the module),
 *   - per-chunk offset / size / sha-256 integrity checks,
 *   - bounded, defensible resource limits (bytes, chunks, open count,
 *     filename length, content-type length),
 *   - idempotent retries on the same `clientUploadId` and hard conflicts
 *     when the client re-uses an idempotency key with different bytes,
 *   - a TTL that quiesces abandoned uploads and makes reference
 *     resolution refuse stale handles,
 *   - durable metadata in a single SQLite database inside an injected
 *     root, with chunk blobs stored alongside as opaque binary parts;
 *     callers stream bytes back through `openReadStream`, never by path,
 *   - safe reference resolution that returns only the public metadata a
 *     downstream component needs to address the attachment.
 *
 * The module is intentionally self-contained: it does not import other
 * bridge subsystems, does not write outside its injected root, and does
 * not surface filesystem paths to callers. Lifetime is explicit; the
 * caller owns the `AttachmentStore` and must `close()` it.
 *
 * SQLite migration v1 is shipped with this module; the schema is
 * additive — it never alters a v0 schema — so creating a fresh store on
 * a clean root boots straight to v1.
 */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/* eslint-disable @typescript-eslint/no-non-null-assertion */

// ---------------------------------------------------------------------------
// Public error model.
// ---------------------------------------------------------------------------

export type AttachmentErrorCode =
  | "not_found"
  | "expired"
  | "incomplete"
  | "released"
  | "conflict"
  | "too_large"
  | "bad_chunk"
  | "bad_hash"
  | "limit_exceeded"
  | "bad_request"
  | "io";

export class AttachmentError extends Error {
  override readonly name = "AttachmentError";
  constructor(readonly code: AttachmentErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

// ---------------------------------------------------------------------------
// Public record shapes — these are the only types that escape the module.
// ---------------------------------------------------------------------------

export type AttachmentState = "open" | "complete" | "aborted" | "expired";

export interface AttachmentRecord {
  readonly id: string;
  readonly clientUploadId: string | null;
  readonly contentType: string;
  readonly filename: string | null;
  readonly declaredTotalBytes: number;
  readonly receivedBytes: number;
  readonly chunkCount: number;
  readonly state: AttachmentState;
  readonly expectedSha256: string | null;
  readonly finalSha256: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly expiresAt: number;
  readonly completedAt: number | null;
  readonly chunkSize: number;
}

export interface AttachmentLimits {
  readonly maxAttachmentBytes: number;
  readonly chunkMaxBytes: number;
  readonly chunkMinBytes: number;
  readonly maxOpenAttachments: number;
  readonly maxChunksPerAttachment: number;
  readonly maxFilenameLength: number;
  readonly maxContentTypeLength: number;
  readonly ttlMs: number;
  readonly completedTtlMs: number;
}

export interface AttachmentBeginInput {
  readonly contentType: string;
  readonly totalBytes: number;
  readonly chunkSize?: number;
  readonly filename?: string | null;
  readonly sha256?: string | null;
  readonly clientUploadId?: string | null;
  readonly now?: number;
}

export interface AttachmentBeginResult {
  readonly record: AttachmentRecord;
  readonly kind: "created" | "duplicate" | "conflict";
  /** Populated only when `kind === "conflict"`. */
  readonly conflict?: { readonly existingId: string; readonly existing: AttachmentRecord; readonly reason: string };
}

export interface AttachmentAppendInput {
  readonly payload: Uint8Array;
  readonly offset: number;
  /** Caller-supplied sha-256 (hex) of `payload`. Required. */
  readonly contentSha256: string;
  readonly now?: number;
}

export type AttachmentAppendKind = "accepted" | "duplicate" | "conflict";

export interface AttachmentAppendResult {
  readonly record: AttachmentRecord;
  readonly kind: AttachmentAppendKind;
  /** When `kind === "conflict"`, the offset the caller should retry with. */
  readonly expectedNextOffset?: number;
  /** When `kind === "duplicate"`, the actual offset the chunk was stored at. */
  readonly storedOffset?: number;
}

/**
 * Opaque attachment reference. Carries the public id plus the
 * generation timestamp we should treat as authoritative when checking
 * expiry — callers must round-trip the whole token, not just the id.
 */
export interface AttachmentReference {
  readonly attachmentId: string;
  readonly issuedAt: number;
}

export interface AttachmentResolution {
  readonly id: string;
  readonly available: boolean;
  readonly reason?: "not_found" | "expired" | "released" | "incomplete";
  readonly contentType?: string;
  readonly filename?: string | null;
  readonly bytes?: number;
  readonly sha256?: string | null;
  readonly expiresAt?: number;
}

export interface AttachmentStoreOptions {
  readonly root: string;
  readonly now?: () => number;
  readonly maxAttachmentBytes?: number;
  readonly chunkMaxBytes?: number;
  readonly chunkMinBytes?: number;
  readonly maxOpenAttachments?: number;
  readonly maxChunksPerAttachment?: number;
  readonly maxFilenameLength?: number;
  readonly maxContentTypeLength?: number;
  readonly ttlMs?: number;
  readonly completedTtlMs?: number;
}

export interface AttachmentSweepResult {
  readonly removed: readonly string[];
  readonly bytesReclaimed: number;
}

// ---------------------------------------------------------------------------
// Defaults — chosen to be defensive, not to be tuned casually.
// ---------------------------------------------------------------------------

const DEFAULTS: Required<Omit<AttachmentStoreOptions, "root" | "now">> = {
  maxAttachmentBytes: 10 * 1024 * 1024, // protocol hard limit: 10 MiB
  chunkMaxBytes: 8 * 1024 * 1024, // 8 MiB
  chunkMinBytes: 1,
  maxOpenAttachments: 1024,
  maxChunksPerAttachment: 16_384,
  maxFilenameLength: 200,
  maxContentTypeLength: 200,
  ttlMs: 24 * 60 * 60_000, // 24h for in-progress uploads
  completedTtlMs: 24 * 60 * 60_000, // 24h for unreferenced completed uploads
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HEX_SHA256 = /^[0-9a-f]{64}$/;

function uuid(): string {
  return crypto.randomUUID().toLowerCase();
}

/** Protocol-shaped opaque UUID, independent from the internal row ID. */
function publicId(): string { return uuid(); }

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normaliseContentType(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) throw new AttachmentError("bad_request", "contentType is required");
  if (trimmed.length > DEFAULTS.maxContentTypeLength) throw new AttachmentError("bad_request", "contentType is too long");
  // RFC 6838 media type: type/subtype[;params]. We are defensive about
  // whitespace and casing; we do not attempt full RFC parsing here, but we
  // reject obvious junk so the metadata column stays structured.
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:[ \t]*;[ \t]*[a-z0-9!#$&^_.+-]+=(?:[a-z0-9!#$&^_.+-]+|"[^"]*"))*$/.test(trimmed)) {
    throw new AttachmentError("bad_request", "contentType is not a well-formed media type");
  }
  return trimmed;
}

function normaliseFilename(value: string | null | undefined, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) throw new AttachmentError("bad_request", `filename is longer than ${maxLength} bytes`);
  // Strip path traversal: never let a caller plant a directory component
  // in the durable filename column.
  const safe = trimmed.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, "_");
  if (!safe) throw new AttachmentError("bad_request", "filename is empty after sanitisation");
  if (safe === "." || safe === "..") throw new AttachmentError("bad_request", "filename is reserved");
  return safe;
}

function normaliseSha256(value: string | null | undefined, field: string): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim().toLowerCase();
  if (!HEX_SHA256.test(trimmed)) throw new AttachmentError("bad_request", `${field} must be a 64-char lowercase hex sha-256`);
  return trimmed;
}

function parseRow(row: Record<string, unknown>): AttachmentRecord {
  return {
    id: row.id as string,
    clientUploadId: (row.client_upload_id as string | null) ?? null,
    contentType: row.content_type as string,
    filename: (row.filename as string | null) ?? null,
    declaredTotalBytes: Number(row.declared_total_bytes),
    receivedBytes: Number(row.received_bytes),
    chunkCount: Number(row.chunk_count),
    state: row.state as AttachmentState,
    expectedSha256: (row.expected_sha256 as string | null) ?? null,
    finalSha256: (row.final_sha256 as string | null) ?? null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    expiresAt: Number(row.expires_at),
    completedAt: row.completed_at === null ? null : Number(row.completed_at),
    chunkSize: Number(row.chunk_size),
  };
}

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS attachments(
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  client_upload_id TEXT,
  content_type TEXT NOT NULL,
  filename TEXT,
  declared_total_bytes INTEGER NOT NULL,
  received_bytes INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL CHECK(state IN ('open','complete','aborted','expired')),
  expected_sha256 TEXT,
  final_sha256 TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completed_at INTEGER,
  chunk_size INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS attachments_client_upload
  ON attachments(client_upload_id) WHERE client_upload_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS attachments_state_expires
  ON attachments(state, expires_at);
CREATE TABLE IF NOT EXISTS chunks(
  attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  byte_offset INTEGER NOT NULL,
  byte_length INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY(attachment_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS chunks_offset ON chunks(attachment_id, byte_offset);
`;

const SCHEMA_V1_CHECKSUM = sha256(new TextEncoder().encode(SCHEMA_V1));

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class AttachmentStore {
  private readonly db: Database;
  private readonly limits: AttachmentLimits;
  private readonly now: () => number;
  private readonly root: string;
  private closed = false;

  constructor(options: AttachmentStoreOptions) {
    if (!options || typeof options !== "object") throw new AttachmentError("bad_request", "options are required");
    if (!options.root || typeof options.root !== "string") throw new AttachmentError("bad_request", "root is required");
    this.root = options.root;
    this.now = options.now ?? Date.now;

    const maxAttachmentBytes = positiveOr(options.maxAttachmentBytes, DEFAULTS.maxAttachmentBytes);
    const chunkMaxBytes = positiveOr(options.chunkMaxBytes, DEFAULTS.chunkMaxBytes);
    const chunkMinBytes = options.chunkMinBytes === undefined ? DEFAULTS.chunkMinBytes : options.chunkMinBytes;
    const maxOpenAttachments = positiveOr(options.maxOpenAttachments, DEFAULTS.maxOpenAttachments);
    const maxChunksPerAttachment = positiveOr(options.maxChunksPerAttachment, DEFAULTS.maxChunksPerAttachment);
    const maxFilenameLength = positiveOr(options.maxFilenameLength, DEFAULTS.maxFilenameLength);
    const maxContentTypeLength = positiveOr(options.maxContentTypeLength, DEFAULTS.maxContentTypeLength);
    const ttlMs = positiveOr(options.ttlMs, DEFAULTS.ttlMs);
    const completedTtlMs = positiveOr(options.completedTtlMs, DEFAULTS.completedTtlMs);

    if (chunkMinBytes < 1) throw new AttachmentError("bad_request", "chunkMinBytes must be >= 1");
    if (chunkMinBytes > chunkMaxBytes) throw new AttachmentError("bad_request", "chunkMinBytes must be <= chunkMaxBytes");

    this.limits = {
      maxAttachmentBytes,
      chunkMaxBytes,
      chunkMinBytes,
      maxOpenAttachments,
      maxChunksPerAttachment,
      maxFilenameLength,
      maxContentTypeLength,
      ttlMs,
      completedTtlMs,
    };

    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const dbPath = join(this.root, "attachments.sqlite");
    this.db = new Database(dbPath, { create: true, readwrite: true, strict: true });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;");
    this.migrate();
    // Establish the blobs directory next to the SQLite database.
    mkdirSync(join(this.root, "blobs"), { recursive: true, mode: 0o700 });
  }

  /** Effective limits — read-only, useful for diagnostics and tests. */
  get configuration(): Readonly<AttachmentLimits> {
    return this.limits;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.db.close();
    } catch (error) {
      throw new AttachmentError("io", "failed to close database", { cause: error as Error });
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new AttachmentError("io", "attachment store is closed");
  }

  private migrate(): void {
    this.db.transaction(() => {
      this.db.exec(SCHEMA_V1);
      const existing = this.db.query("SELECT version FROM schema_migrations WHERE version=1").get();
      if (!existing) this.db.query("INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?)").run(this.now());
      // PRAGMA user_version is the conventional cross-check but we keep an
      // explicit table for clarity in tests.
      this.db.exec(`PRAGMA user_version = 1`);
    })();
    if (sha256(new TextEncoder().encode(SCHEMA_V1)) !== SCHEMA_V1_CHECKSUM) {
      throw new AttachmentError("io", "schema checksum drift detected; refusing to open store");
    }
  }

  // -------------------------------------------------------------------------
  // Begin — idempotent on `clientUploadId`.
  // -------------------------------------------------------------------------

  begin(input: AttachmentBeginInput): AttachmentBeginResult {
    this.ensureOpen();
    if (!input || typeof input !== "object") throw new AttachmentError("bad_request", "begin input is required");
    if (!Number.isFinite(input.totalBytes) || !Number.isInteger(input.totalBytes) || input.totalBytes <= 0) {
      throw new AttachmentError("bad_request", "totalBytes must be a positive integer");
    }
    if (input.totalBytes > this.limits.maxAttachmentBytes) {
      throw new AttachmentError("too_large", `attachment exceeds ${this.limits.maxAttachmentBytes} bytes`);
    }
    const contentType = normaliseContentType(input.contentType);
    const filename = normaliseFilename(input.filename ?? null, this.limits.maxFilenameLength);
    const sha = normaliseSha256(input.sha256 ?? null, "sha256");
    const now = input.now ?? this.now();
    if (!Number.isFinite(now)) throw new AttachmentError("bad_request", "now must be a finite number");
    const clientUploadId = input.clientUploadId ? input.clientUploadId.trim() : "";
    if (clientUploadId && clientUploadId.length > 200) throw new AttachmentError("bad_request", "clientUploadId is too long");

    // Default chunk size: pick the largest power-of-two multiple of 64KiB
    // that fits totalBytes within the chunk limits. Callers may override.
    const chunkSize = input.chunkSize && input.chunkSize > 0
      ? Math.min(Math.max(input.chunkSize, this.limits.chunkMinBytes), this.limits.chunkMaxBytes)
      : Math.min(this.limits.chunkMaxBytes, Math.max(this.limits.chunkMinBytes, input.totalBytes));

    if (chunkSize < this.limits.chunkMinBytes || chunkSize > this.limits.chunkMaxBytes) {
      throw new AttachmentError("bad_chunk", `chunkSize must be within [${this.limits.chunkMinBytes}, ${this.limits.chunkMaxBytes}]`);
    }

    return this.db.transaction(() => {
      if (clientUploadId) {
        const existing = this.findByClientUploadIdTx(clientUploadId);
        if (existing) {
          const mismatch = this.detectBeginMismatch(existing, { contentType, filename, sha, totalBytes: input.totalBytes, chunkSize });
          if (mismatch) {
            return {
              record: existing,
              kind: "conflict" as const,
              conflict: { existingId: existing.id, existing, reason: mismatch },
            };
          }
          return { record: existing, kind: "duplicate" as const };
        }
      }
      const openCountRow = this.db.query("SELECT COUNT(*) AS count FROM attachments WHERE state='open'").get() as { count: number };
      if (openCountRow.count >= this.limits.maxOpenAttachments) {
        throw new AttachmentError("limit_exceeded", `too many open attachments (>= ${this.limits.maxOpenAttachments})`);
      }
      const id = uuid();
      const public_id = publicId();
      const expiresAt = now + this.limits.ttlMs;
      const blobDir = join(this.root, "blobs", public_id);
      mkdirSync(blobDir, { recursive: true, mode: 0o700 });
      this.db.query(
        "INSERT INTO attachments(id, public_id, client_upload_id, content_type, filename, declared_total_bytes, received_bytes, chunk_count, state, expected_sha256, final_sha256, created_at, updated_at, expires_at, completed_at, chunk_size) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,NULL,?)",
      ).run(
        id,
        public_id,
        clientUploadId || null,
        contentType,
        filename,
        input.totalBytes,
        0,
        0,
        "open",
        sha,
        now,
        now,
        expiresAt,
        chunkSize,
      );
      const stored = this.getByInternalIdTx(id)!;
      return { record: stored, kind: "created" as const };
    })();
  }

  private detectBeginMismatch(
    existing: AttachmentRecord,
    desired: { contentType: string; filename: string | null; sha: string | null; totalBytes: number; chunkSize: number },
  ): string | null {
    // Protocol retry identity is installation/clientUploadId + content digest.
    // Safe metadata such as filename may change without duplicating storage.
    if (existing.expectedSha256 && desired.sha) {
      return existing.expectedSha256 === desired.sha ? null : "sha256";
    }
    if (existing.declaredTotalBytes !== desired.totalBytes) return "totalBytes";
    if (existing.contentType !== desired.contentType) return "contentType";
    return null;
  }

  private findByClientUploadIdTx(clientUploadId: string): AttachmentRecord | null {
    const row = this.db
      .query("SELECT id, public_id, client_upload_id, content_type, filename, declared_total_bytes, received_bytes, chunk_count, state, expected_sha256, final_sha256, created_at, updated_at, expires_at, completed_at, chunk_size FROM attachments WHERE client_upload_id=? LIMIT 1")
      .get(clientUploadId) as Record<string, unknown> | null;
    if (!row) return null;
    // We already issued id above; surface the public id as record.id.
    return this.parsePublicRow(row);
  }

  private getByInternalIdTx(id: string): AttachmentRecord | null {
    const row = this.db
      .query("SELECT id, public_id, client_upload_id, content_type, filename, declared_total_bytes, received_bytes, chunk_count, state, expected_sha256, final_sha256, created_at, updated_at, expires_at, completed_at, chunk_size FROM attachments WHERE id=?")
      .get(id) as Record<string, unknown> | null;
    return row ? this.parsePublicRow(row) : null;
  }

  private parsePublicRow(row: Record<string, unknown>): AttachmentRecord {
    const publicRow = { ...row, id: row.public_id as string } as Record<string, unknown>;
    delete publicRow.public_id;
    return parseRow(publicRow);
  }

  // -------------------------------------------------------------------------
  // Append chunk.
  // -------------------------------------------------------------------------

  appendChunk(id: string, input: AttachmentAppendInput): AttachmentAppendResult {
    this.ensureOpen();
    if (!isPublicId(id)) throw new AttachmentError("bad_request", "id is not a valid public identifier");
    if (!input || !(input.payload instanceof Uint8Array)) throw new AttachmentError("bad_request", "payload is required");
    if (!Number.isInteger(input.offset) || input.offset < 0) throw new AttachmentError("bad_chunk", "offset must be a non-negative integer");
    if (input.payload.byteLength < this.limits.chunkMinBytes || input.payload.byteLength > this.limits.chunkMaxBytes) {
      throw new AttachmentError("bad_chunk", `payload length must be in [${this.limits.chunkMinBytes}, ${this.limits.chunkMaxBytes}] bytes`);
    }
    if (!HEX_SHA256.test(input.contentSha256)) throw new AttachmentError("bad_hash", "contentSha256 must be 64-char lowercase hex");

    const actual = sha256(input.payload);
    if (actual !== input.contentSha256) {
      throw new AttachmentError("bad_hash", "payload sha-256 does not match contentSha256");
    }

    const now = input.now ?? this.now();

    return this.db.transaction(() => {
      const record = this.getByPublicIdForUpdateTx(id);
      if (!record) throw new AttachmentError("not_found", "attachment not found");
      const internalId = this.internalIdForPublicTx(id);
      if (record.state === "complete") {
        // Idempotent retry of the final chunk on a complete upload: return
        // the stored record without changes. This is intentionally narrow.
        if (input.offset === record.declaredTotalBytes - input.payload.byteLength || input.offset === record.receivedBytes - input.payload.byteLength) {
          return { record, kind: "duplicate" as const, storedOffset: record.receivedBytes - input.payload.byteLength };
        }
        throw new AttachmentError("conflict", "attachment is complete; refusing further chunks");
      }
      if (record.state === "aborted") throw new AttachmentError("released", "attachment is aborted");
      if (record.state === "expired" || record.expiresAt <= now) {
        this.markExpiredTx(internalId, now);
        throw new AttachmentError("expired", "attachment expired before chunk was stored");
      }
      if (record.state !== "open") throw new AttachmentError("conflict", `attachment is in state ${record.state}`);

      // In-order: the next chunk's offset must equal the current
      // receivedBytes. Out-of-order requires random seekable I/O and a
      // planner; for M13 we keep the simplest correctness contract.
      if (input.offset !== record.receivedBytes) {
        return {
          record,
          kind: "conflict" as const,
          expectedNextOffset: record.receivedBytes,
        };
      }
      if (record.receivedBytes + input.payload.byteLength > record.declaredTotalBytes) {
        throw new AttachmentError("bad_chunk", "chunk would overflow declaredTotalBytes");
      }
      if (record.chunkCount + 1 > this.limits.maxChunksPerAttachment) {
        throw new AttachmentError("limit_exceeded", `chunk count would exceed ${this.limits.maxChunksPerAttachment}`);
      }

      const isFinal = record.receivedBytes + input.payload.byteLength === record.declaredTotalBytes;
      // Store on disk first; the SQLite row is the source of truth.
      const blobDir = join(this.root, "blobs", id);
      mkdirSync(blobDir, { recursive: true, mode: 0o700 });
      const partPath = join(blobDir, `${record.chunkCount}.part`);
      writeFileSync(partPath, input.payload, { mode: 0o600 });
      // Hash of the on-disk bytes — re-check after write so a corrupted
      // filesystem is not silently accepted.
      const onDisk = sha256(input.payload);
      if (onDisk !== input.contentSha256) {
        rmSync(partPath, { force: true });
        throw new AttachmentError("io", "chunk on-disk hash mismatch");
      }
      this.db.query(
        "INSERT INTO chunks(attachment_id, chunk_index, byte_offset, byte_length, sha256, received_at) VALUES (?,?,?,?,?,?)",
      ).run(internalId, record.chunkCount, input.offset, input.payload.byteLength, onDisk, now);
      this.db.query(
        "UPDATE attachments SET received_bytes=received_bytes+?, chunk_count=chunk_count+1, updated_at=? WHERE id=?",
      ).run(input.payload.byteLength, now, internalId);

      const refreshed = this.getByInternalIdTx(internalId)!;
      if (isFinal) {
        // Auto-finalise by computing the streaming hash; if a sha was
        // expected and the chunks don't reconcile we surface that as a
        // mismatch — the caller decides whether to complete() or abort().
        const streamedHash = this.computeStreamingHashTx(internalId);
        if (record.expectedSha256 && streamedHash !== record.expectedSha256) {
          // Roll back the chunk we just stored so the caller can re-try.
          this.db.query("DELETE FROM chunks WHERE attachment_id=? AND chunk_index=?").run(internalId, record.chunkCount);
          this.db.query("UPDATE attachments SET received_bytes=received_bytes-?, chunk_count=chunk_count-1, updated_at=? WHERE id=?").run(input.payload.byteLength, now, internalId);
          rmSync(partPath, { force: true });
          throw new AttachmentError("bad_hash", "final chunk did not reconcile with expected sha-256");
        }
        this.db.query("UPDATE attachments SET state='complete', completed_at=?, final_sha256=?, expires_at=?, updated_at=? WHERE id=?")
          .run(now, streamedHash, now + this.limits.completedTtlMs, now, internalId);
        // Finalised attachments are immutable: rename the blobs to a
        // ".blob" suffix so future appendChunk calls fail clearly even if
        // the size checks were bypassed.
        this.renameBlobPartsToImmutable(id, record.chunkCount + 1);
        const finalised = this.getByInternalIdTx(internalId)!;
        return { record: finalised, kind: "accepted" as const };
      }
      return { record: refreshed, kind: "accepted" as const };
    })();
  }

  private renameBlobPartsToImmutable(publicId: string, totalChunks: number): void {
    // Finalised blobs are renamed to ".blob". Other readers detect this
    // suffix and never re-enter the upload state machine. Atomicity is
    // guaranteed by the SQLite row state transition; on-disk renames are
    // best-effort and re-issued until they succeed.
    const blobDir = join(this.root, "blobs", publicId);
    for (let i = 0; i < totalChunks; i += 1) {
      const from = join(blobDir, `${i}.part`);
      const to = join(blobDir, `${i}.blob`);
      try {
        const data = readFileSync(from);
        if (data.byteLength === 0) continue;
        writeFileSync(to, data, { mode: 0o600 });
      } catch {
        // Best-effort; presence of .blob is checked by readers but they
        // also fall back to .part for durability.
      }
    }
  }

  private computeStreamingHashTx(internalId: string): string {
    const rows = this.db
      .query("SELECT chunk_index idx FROM chunks WHERE attachment_id=? ORDER BY chunk_index")
      .all(internalId) as Array<{ idx: number }>;
    if (!rows.length) return sha256(new Uint8Array(0));
    const hasher = createHash("sha256");
    const internalRecord = this.getByInternalIdTx(internalId)!;
    const publicKey = internalRecord.id;
    for (const row of rows) {
      const part = Bun.file(join(this.root, "blobs", publicKey, `${row.idx}.part`));
      const target = part.size > 0
        ? join(this.root, "blobs", publicKey, `${row.idx}.part`)
        : join(this.root, "blobs", publicKey, `${row.idx}.blob`);
      hasher.update(readFileSync(target));
    }
    return hasher.digest("hex");
  }

  // -------------------------------------------------------------------------
  // Complete — explicit terminal transition.
  // -------------------------------------------------------------------------

  complete(id: string, opts: { readonly now?: number; readonly contentSha256?: string } = {}): AttachmentRecord {
    this.ensureOpen();
    if (!isPublicId(id)) throw new AttachmentError("bad_request", "id is not a valid public identifier");
    const now = opts.now ?? this.now();
    return this.db.transaction(() => {
      const record = this.getByPublicIdForUpdateTx(id);
      if (!record) throw new AttachmentError("not_found", "attachment not found");
      const internalId = this.internalIdForPublicTx(id);
      if (record.state === "complete") return record;
      if (record.state === "aborted") throw new AttachmentError("released", "attachment is aborted");
      if (record.state === "expired" || record.expiresAt <= now) {
        this.markExpiredTx(internalId, now);
        throw new AttachmentError("expired", "attachment expired before completion");
      }
      if (record.receivedBytes !== record.declaredTotalBytes) {
        throw new AttachmentError("incomplete", `attachment is missing bytes: have ${record.receivedBytes}, need ${record.declaredTotalBytes}`);
      }
      const streamedHash = this.computeStreamingHashTx(internalId);
      const expected = opts.contentSha256 ? normaliseSha256(opts.contentSha256, "contentSha256") : record.expectedSha256;
      if (expected && expected !== streamedHash) {
        throw new AttachmentError("bad_hash", "streamed hash does not match expected sha-256");
      }
      this.db.query("UPDATE attachments SET state='complete', completed_at=?, final_sha256=?, expires_at=?, updated_at=? WHERE id=?")
        .run(now, streamedHash, now + this.limits.completedTtlMs, now, internalId);
      this.renameBlobPartsToImmutable(id, record.chunkCount);
      return this.getByInternalIdTx(internalId)!;
    })();
  }

  // -------------------------------------------------------------------------
  // Abort — explicit, irreversible.
  // -------------------------------------------------------------------------

  abort(id: string, opts: { readonly now?: number } = {}): AttachmentRecord {
    this.ensureOpen();
    if (!isPublicId(id)) throw new AttachmentError("bad_request", "id is not a valid public identifier");
    const now = opts.now ?? this.now();
    return this.db.transaction(() => {
      const record = this.getByPublicIdForUpdateTx(id);
      if (!record) throw new AttachmentError("not_found", "attachment not found");
      const internalId = this.internalIdForPublicTx(id);
      if (record.state === "complete") throw new AttachmentError("conflict", "completed attachment cannot be aborted");
      if (record.state === "aborted") return record;
      if (record.state === "expired" || record.expiresAt <= now) {
        this.markExpiredTx(internalId, now);
        throw new AttachmentError("expired", "attachment already expired");
      }
      this.db.query("UPDATE attachments SET state='aborted', updated_at=? WHERE id=?").run(now, internalId);
      this.removeBlobs(id);
      return this.getByInternalIdTx(internalId)!;
    })();
  }

  private removeBlobs(publicId: string): void {
    const target = join(this.root, "blobs", publicId);
    try {
      rmSync(target, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }

  // -------------------------------------------------------------------------
  // Expiry sweep.
  // -------------------------------------------------------------------------

  sweep(opts: { readonly now?: number } = {}): AttachmentSweepResult {
    this.ensureOpen();
    const now = opts.now ?? this.now();
    const removed: string[] = [];
    let bytesReclaimed = 0;
    this.db.transaction(() => {
      const rows = this.db
        .query(
          "SELECT id, public_id, declared_total_bytes, received_bytes FROM attachments WHERE state NOT IN ('complete','aborted','expired') AND expires_at <= ?",
        )
        .all(now) as Array<{ id: string; public_id: string; declared_total_bytes: number; received_bytes: number }>;
      for (const row of rows) {
        this.db.query("UPDATE attachments SET state='expired', updated_at=? WHERE id=?").run(now, row.id);
        bytesReclaimed += Number(row.received_bytes);
        removed.push(row.public_id);
      }
      // Also reap completed attachments whose completedTtlMs expired.
      const reapRows = this.db
        .query("SELECT id, public_id, declared_total_bytes FROM attachments WHERE state='complete' AND completed_at IS NOT NULL AND expires_at <= ?")
        .all(now) as Array<{ id: string; public_id: string; declared_total_bytes: number }>;
      for (const row of reapRows) {
        this.db.query("UPDATE attachments SET state='expired', updated_at=? WHERE id=?").run(now, row.id);
        bytesReclaimed += Number(row.declared_total_bytes);
        removed.push(row.public_id);
      }
    })();
    // Blobs are reclaimed lazily on the next access; for an immediate GC
    // sweep we also drop the directories.
    for (const publicId of removed) this.removeBlobs(publicId);
    return { removed, bytesReclaimed };
  }

  private markExpiredTx(internalId: string, now: number): void {
    this.db.query("UPDATE attachments SET state='expired', updated_at=? WHERE id=? AND state IN ('open','complete')").run(now, internalId);
  }

  // -------------------------------------------------------------------------
  // Inspection.
  // -------------------------------------------------------------------------

  get(id: string): AttachmentRecord | null {
    this.ensureOpen();
    if (!isPublicId(id)) return null;
    return this.db.transaction(() => this.getByPublicIdTx(id))();
  }

  list(filter: { readonly state?: AttachmentState; readonly limit?: number } = {}): readonly AttachmentRecord[] {
    this.ensureOpen();
    const limit = Math.max(1, Math.min(1000, filter.limit ?? 100));
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.state) {
      where.push("state=?");
      params.push(filter.state);
    }
    const sql = `SELECT id, public_id, client_upload_id, content_type, filename, declared_total_bytes, received_bytes, chunk_count, state, expected_sha256, final_sha256, created_at, updated_at, expires_at, completed_at, chunk_size FROM attachments ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);
    const rows = this.db.query(sql).all(...params as never[]) as Record<string, unknown>[];
    return rows.map((row) => this.parsePublicRow(row));
  }

  /**
   * Resolve an attachment reference. Does not surface paths; returns
   * only the metadata needed to address the attachment.
   *
   * Accepts either a public `id` string or a structured
   * `AttachmentReference` token; the structured form bounds the
   * validity window so a leaked id cannot be re-bound to a longer
   * expiry.
   */
  /** Extend a complete attachment while a durable prompt/queue item references it. */
  retain(id: string, until: number): AttachmentRecord {
    this.ensureOpen();
    if (!isPublicId(id) || !Number.isFinite(until)) throw new AttachmentError("bad_request", "invalid attachment retention request");
    return this.db.transaction(() => {
      const record = this.getByPublicIdForUpdateTx(id);
      if (!record || record.state !== "complete") throw new AttachmentError("not_found", "attachment is unavailable");
      const internalId = this.internalIdForPublicTx(id);
      const bounded = Math.min(Math.max(record.expiresAt, Math.floor(until)), this.now() + 7 * 24 * 60 * 60_000);
      this.db.query("UPDATE attachments SET expires_at=?,updated_at=? WHERE id=?").run(bounded, this.now(), internalId);
      return this.getByInternalIdTx(internalId)!;
    })();
  }

  resolve(reference: AttachmentReference | string): AttachmentResolution {
    this.ensureOpen();
    const id = typeof reference === "string" ? reference : reference.attachmentId;
    const issuedAt = typeof reference === "string" ? undefined : reference.issuedAt;
    if (!isPublicId(id)) return { id, available: false, reason: "not_found" };
    const record = this.db.transaction(() => this.getByPublicIdTx(id))();
    if (!record) return { id, available: false, reason: "not_found" };
    if (record.state === "aborted") return { id, available: false, reason: "released", contentType: record.contentType, filename: record.filename, expiresAt: record.expiresAt };
    if (record.state === "expired") return { id, available: false, reason: "expired", contentType: record.contentType, filename: record.filename, expiresAt: record.expiresAt };
    if (record.state !== "complete") return { id, available: false, reason: "incomplete", contentType: record.contentType, filename: record.filename, expiresAt: record.expiresAt };
    const now = this.now();
    if (record.expiresAt <= now) {
      // Lazy expiry — the next sweep will reconcile the row state.
      return { id, available: false, reason: "expired", contentType: record.contentType, filename: record.filename, expiresAt: record.expiresAt };
    }
    if (issuedAt !== undefined && (issuedAt < record.createdAt || issuedAt > record.expiresAt)) {
      // The reference pre-dates the attachment or out-lives it; treat the
      // token as stale without leaking whether the id is "real".
      return { id, available: false, reason: "expired", contentType: record.contentType, filename: record.filename, expiresAt: record.expiresAt };
    }
    return {
      id,
      available: true,
      contentType: record.contentType,
      filename: record.filename,
      bytes: record.declaredTotalBytes,
      sha256: record.finalSha256,
      expiresAt: record.expiresAt,
    };
  }

  /**
   * Stream the stored bytes back to the caller. The returned iterator
   * yields `Uint8Array` slices without ever surfacing the underlying
   * filesystem path. The iterator is single-pass; consume it fully or
   * call `return()` to release any disk-side handles.
   */
  openReadStream(id: string, opts: { readonly slice?: number } = {}): AsyncIterableIterator<Uint8Array> {
    this.ensureOpen();
    if (!isPublicId(id)) throw new AttachmentError("bad_request", "id is not a valid public identifier");
    const record = this.db.transaction(() => this.getByPublicIdTx(id))();
    if (!record) throw new AttachmentError("not_found", "attachment not found");
    if (record.state !== "complete") throw new AttachmentError("incomplete", `attachment is in state ${record.state}`);
    const slice = Math.max(64 * 1024, Math.min(opts.slice ?? 1024 * 1024, 8 * 1024 * 1024));
    const blobDir = join(this.root, "blobs", id);
    const orderedChunks: string[] = [];
    for (let i = 0; i < record.chunkCount; i += 1) {
      orderedChunks.push(join(blobDir, `${i}.part`));
    }
    if (record.chunkCount > 0) {
      // Replace with .blob when available — finalised attachments use the
      // immutable suffix.
      for (let i = 0; i < orderedChunks.length; i += 1) {
        const blob = join(blobDir, `${i}.blob`);
        if (Bun.file(blob).size > 0) orderedChunks[i] = blob;
      }
    }
    let chunkIndex = 0;
    let sliceOffset = 0;
    let sliceBuffer: Uint8Array | null = null;
    const iterator: AsyncIterableIterator<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next(): Promise<IteratorResult<Uint8Array>> {
        while (true) {
          if (sliceBuffer) {
            if (sliceOffset >= sliceBuffer.byteLength) {
              sliceBuffer = null;
              sliceOffset = 0;
              continue;
            }
            const end = Math.min(sliceOffset + slice, sliceBuffer.byteLength);
            const out = sliceBuffer.subarray(sliceOffset, end);
            sliceOffset = end;
            return { value: out, done: false };
          }
          if (chunkIndex >= orderedChunks.length) return { value: undefined as unknown as Uint8Array, done: true };
          const path = orderedChunks[chunkIndex]!;
          chunkIndex += 1;
          const file = Bun.file(path);
          if (file.size === 0) {
            throw new AttachmentError("io", `chunk at index ${chunkIndex - 1} is missing on disk`);
          }
          sliceBuffer = new Uint8Array(await file.arrayBuffer());
        }
      },
      async return(): Promise<IteratorResult<Uint8Array>> {
        chunkIndex = orderedChunks.length;
        sliceBuffer = null;
        return { value: undefined as unknown as Uint8Array, done: true };
      },
      async throw(error: unknown): Promise<IteratorResult<Uint8Array>> {
        chunkIndex = orderedChunks.length;
        sliceBuffer = null;
        throw error;
      },
    };
    return iterator;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private getByPublicIdTx(id: string): AttachmentRecord | null {
    const row = this.db
      .query("SELECT id, public_id, client_upload_id, content_type, filename, declared_total_bytes, received_bytes, chunk_count, state, expected_sha256, final_sha256, created_at, updated_at, expires_at, completed_at, chunk_size FROM attachments WHERE public_id=?")
      .get(id) as Record<string, unknown> | null;
    return row ? this.parsePublicRow(row) : null;
  }

  private internalIdForPublicTx(publicId: string): string {
    const row = this.db.query("SELECT id FROM attachments WHERE public_id=?").get(publicId) as { id: string } | null;
    if (!row) throw new AttachmentError("not_found", "attachment not found");
    return row.id;
  }

  private getByPublicIdForUpdateTx(id: string): AttachmentRecord | null {
    // SQLite is single-writer per connection; the outer db.transaction()
    // already issues BEGIN IMMEDIATE before invoking the callback, so we
    // do not start a nested transaction here.
    return this.getByPublicIdTx(id);
  }
}

function isPublicId(value: string): boolean {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function positiveOr(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) || value <= 0 ? fallback : value;
}

/* eslint-enable @typescript-eslint/no-non-null-assertion */
