/**
 * M13-06 / M13-07 — host-side HTML export registry.
 *
 * The bridge owns a single {@link ExportRegistry} per
 * {@link import("./one-session-adapter").OneSessionPiAdapter}. The
 * adapter calls into it when handling `session.export`; mobile learns
 * about the resulting artefact only through the **opaque** `exportId`
 * and a bounded metadata record. Host paths and raw file handles are
 * kept inside the registry and never serialised into durable events,
 * session state, or RPC responses.
 *
 * Invariants:
 *
 *  - Every public surface that mentions an export references it by
 *    `exportId`. `storagePath` is a host-private detail used only by
 *    the registry's download future (M13-07) and bounded disk sweep.
 *  - `bytes` and `sha256` are bounded integers / 64-hex digests. No
 *    path fields, hostnames, or signing material are exposed. This is
 *    what M13-09 (no public URL generation) relies on.
 *  - Records carry an explicit `status` and `completion.state` so
 *    the durable `session.export` event can report pending /
 *    completed / failed without requiring a separate replay to learn
 *    if Pi had already finished writing the file.
 *  - `purgeExpired(now)` and `sweepExpired()` drive both time-based
 *    expiry (TTL) and operator-initiated cleanup. The adapter calls
 *    `sweepExpired` opportunistically on every `session.export`
 *    dispatch and on shutdown so the bounded registry cannot leak
 *    entries.
 *  - Capacity (`maxExports`) is bounded; rejecting a registration
 *    with `ExportRegistryCapacityError` is the only way to keep the
 *    in-memory map from growing without limit.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

/** Public metadata shape. Everything that crosses the bridge boundary. */
export interface ExportMetadata {
  readonly exportId: string;
  readonly sessionId: string;
  readonly format: "html";
  readonly bytes: number;
  readonly sha256: string;
  readonly expiresAt: string;
  readonly status: "available" | "deleted" | "expired";
  readonly completion: {
    readonly state: "pending" | "completed" | "failed";
    readonly completedAt?: string;
    readonly reason?: string;
  };
  readonly createdAt: string;
}

/** Internal record; the `storagePath` is host-private and never returned. */
interface ExportRecord extends ExportMetadata {
  readonly storagePath: string;
}

export interface ExportRegistryOptions {
  /** Root directory the adapter hands to Pi's `export_html`. */
  readonly rootDir: string;
  /** Maximum concurrent exports. Default 16. Bounded 1..256. */
  readonly maxExports?: number;
  /** TTL in milliseconds. Default 24h. Bounded 1 minute..7 days. */
  readonly ttlMs?: number;
  /** Override clock for deterministic tests. */
  readonly now?: () => number;
  /** Override export id generator for deterministic tests. */
  readonly newExportId?: () => string;
}

export class ExportRegistryCapacityError extends Error {
  override readonly name = "ExportRegistryCapacityError";
  constructor(readonly active: number, readonly capacity: number) {
    super(`export_capacity: ${active}/${capacity} active exports and no eligible expired export to evict`);
  }
}

export class ExportRegistryInvalidInputError extends Error {
  override readonly name = "ExportRegistryInvalidInputError";
  constructor(message: string) { super(message); }
}

const SHA256_PLACEHOLDER = "0".repeat(64);

function boundInt(value: number, min: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ExportRegistryInvalidInputError(`${name} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

function ensureSha256Hex(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new ExportRegistryInvalidInputError("sha256 must be a 64-char hex digest");
  }
  return value;
}

function ensureBytes(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new ExportRegistryInvalidInputError("bytes must be a non-negative integer");
  }
  return value as number;
}

export class ExportRegistry {
  private readonly records = new Map<string, ExportRecord>();
  private readonly rootDir: string;
  private readonly maxExports: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly newExportId: () => string;

  constructor(options: ExportRegistryOptions) {
    if (typeof options.rootDir !== "string" || options.rootDir.length === 0) {
      throw new ExportRegistryInvalidInputError("rootDir must be a non-empty string");
    }
    this.rootDir = options.rootDir;
    this.maxExports = boundInt(options.maxExports ?? 16, 1, 256, "maxExports");
    this.ttlMs = boundInt(options.ttlMs ?? 24 * 60 * 60 * 1000, 60_000, 7 * 24 * 60 * 60 * 1000, "ttlMs");
    this.now = options.now ?? Date.now;
    this.newExportId = options.newExportId ?? (() => randomUUID().toLowerCase());
    mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
    this.load();
  }

  /** Returns the host-private root. The adapter hands one per session to Pi. */
  rootPath(): string { return this.rootDir; }

  /**
   * Reserve an `exportId` for a session export. The record starts as
   * `pending`; the adapter must call {@link markCompleted} or
   * {@link markFailed} once Pi settles.
   *
   * The host-private path the caller must hand to Pi is returned alongside
   * the metadata so the adapter can drive `export_html` without
   * inventing its own path scheme. The path is intentionally absent from
   * {@link ExportMetadata} so it cannot leak into durable events.
   */
  register(input: { sessionId: string; format: "html"; bytes?: number }): { metadata: ExportMetadata; storagePath: string } {
    if (input.format !== "html") throw new ExportRegistryInvalidInputError("only html export is supported");
    if (typeof input.sessionId !== "string" || input.sessionId.length === 0) {
      throw new ExportRegistryInvalidInputError("sessionId is required");
    }
    this.sweepExpired();
    const liveCount = this.liveCount();
    if (liveCount >= this.maxExports) {
      throw new ExportRegistryCapacityError(liveCount, this.maxExports);
    }
    const exportId = this.newExportId();
    const createdAt = new Date(this.now()).toISOString();
    const expiresAt = new Date(this.now() + this.ttlMs).toISOString();
    const storagePath = `${this.rootDir.replace(/\/+$/, "")}/${exportId}.html`;
    const record: ExportRecord = {
      exportId,
      sessionId: input.sessionId,
      format: "html",
      bytes: ensureBytes(input.bytes ?? 0),
      sha256: SHA256_PLACEHOLDER,
      expiresAt,
      createdAt,
      status: "available",
      completion: { state: "pending" },
      storagePath,
    };
    this.records.set(exportId, record);
    this.persist();
    return { metadata: this.publicView(record), storagePath };
  }

  /**
   * Mark the export completed once Pi has written the artefact.
   * `bytes` and `sha256` are bounded; `bytes === 0` is allowed (Pi
   * may produce a placeholder page for an empty session).
   */
  markCompleted(exportId: string, input: { bytes: number; sha256: string; completedAt?: number }): ExportMetadata | null {
    const record = this.records.get(exportId);
    if (!record) return null;
    const next: ExportRecord = {
      ...record,
      bytes: ensureBytes(input.bytes),
      sha256: ensureSha256Hex(input.sha256),
      completion: { state: "completed", completedAt: new Date(input.completedAt ?? this.now()).toISOString() },
    };
    this.records.set(exportId, next);
    this.persist();
    return this.publicView(next);
  }

  /**
   * Mark the export failed. The record stays available until its
   * `expiresAt` so mobile can surface the reason, then `sweepExpired`
   * will retire it.
   */
  markFailed(exportId: string, reason: string): ExportMetadata | null {
    const record = this.records.get(exportId);
    if (!record) return null;
    const trimmed = String(reason ?? "").slice(0, 500) || "rpc_error";
    const next: ExportRecord = {
      ...record,
      completion: { state: "failed", reason: trimmed, completedAt: new Date(this.now()).toISOString() },
    };
    this.records.set(exportId, next);
    this.persist();
    return this.publicView(next);
  }

  /**
   * Operator-initiated delete. The record is marked `deleted` and
   * `get` returns `null` thereafter. The storage path is untouched
   * (M13-07 cleanup is the host file-sweeper's responsibility).
   */
  delete(exportId: string): ExportMetadata | null {
    const record = this.records.get(exportId);
    if (!record) return null;
    const next: ExportRecord = { ...record, status: "deleted", completion: { ...record.completion } };
    this.records.set(exportId, next);
    this.persist();
    return this.publicView(next);
  }

  /**
   * Returns the public metadata if the export is available and not
   * expired. Expired / deleted / unknown exports all return `null` so
   * the durable `get` event used by mobile can collapse them into a
   * single `export_unavailable` error path.
   */
  get(exportId: string): ExportMetadata | null {
    const record = this.records.get(exportId);
    if (!record) return null;
    if (record.status === "deleted") return null;
    const deadline = Date.parse(record.expiresAt);
    if (Number.isFinite(deadline) && deadline <= this.now()) {
      this.records.set(exportId, { ...record, status: "expired" });
      this.persist();
      return null;
    }
    return this.publicView(record);
  }

  /** Internal download handle; callers receive bytes, never the host path. */
  file(exportId: string): ReturnType<typeof Bun.file> | null {
    if (!this.get(exportId)) return null;
    const record = this.records.get(exportId);
    return record ? Bun.file(record.storagePath) : null;
  }

  /** Snapshot of available exports for one session, newest-first. */
  list(sessionId: string): ExportMetadata[] {
    this.sweepExpired();
    const items: ExportMetadata[] = [];
    for (const record of this.records.values()) {
      if (record.sessionId !== sessionId) continue;
      if (record.status !== "available") continue;
      const deadline = Date.parse(record.expiresAt);
      if (Number.isFinite(deadline) && deadline <= this.now()) continue;
      items.push(this.publicView(record));
    }
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return items;
  }

  /** Count of currently-available records. */
  liveCount(): number {
    let count = 0;
    const now = this.now();
    for (const record of this.records.values()) {
      if (record.status !== "available") continue;
      const deadline = Date.parse(record.expiresAt);
      if (Number.isFinite(deadline) && deadline <= now) continue;
      count += 1;
    }
    return count;
  }

  /**
   * Sweep expired records. Marks them `expired` and returns the
   * affected public metadata so the adapter can journal a final
   * `session.export` event so mobile subscribers learn the id is no
   * longer usable.
   */
  sweepExpired(): ExportMetadata[] {
    const now = this.now();
    const swept: ExportMetadata[] = [];
    for (const [exportId, record] of this.records) {
      if (record.status !== "available") continue;
      const deadline = Date.parse(record.expiresAt);
      if (!Number.isFinite(deadline) || deadline > now) continue;
      const next: ExportRecord = { ...record, status: "expired" };
      this.records.set(exportId, next);
      swept.push(this.publicView(next));
    }
    if (swept.length > 0) this.persist();
    return swept;
  }

  private load(): void {
    try {
      const parsed = JSON.parse(readFileSync(`${this.rootDir}/exports.json`, "utf8")) as unknown;
      if (!Array.isArray(parsed)) return;
      for (const item of parsed.slice(0, this.maxExports)) {
        if (!item || typeof item !== "object") continue;
        const record = item as ExportRecord;
        if (typeof record.exportId !== "string" || typeof record.sessionId !== "string" || typeof record.storagePath !== "string") continue;
        this.records.set(record.exportId, record);
      }
    } catch { /* first run or malformed state starts empty */ }
  }

  private persist(): void {
    const path = `${this.rootDir}/exports.json`;
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, JSON.stringify([...this.records.values()]), { mode: 0o600 });
    renameSync(temporary, path);
  }

  private publicView(record: ExportRecord): ExportMetadata {
    return {
      exportId: record.exportId,
      sessionId: record.sessionId,
      format: record.format,
      bytes: record.bytes,
      sha256: record.sha256,
      expiresAt: record.expiresAt,
      status: record.status,
      completion: { ...record.completion },
      createdAt: record.createdAt,
    };
  }
}
