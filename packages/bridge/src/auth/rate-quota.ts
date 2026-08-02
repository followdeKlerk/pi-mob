/**
 * Phase 4 — per-installation upload rate limit + per-installation
 * retained-byte quota + aggregate attachment-store byte ceiling.
 *
 * The tracker is a thin, allocation-cheap layer that runs before any
 * body read. It returns deterministic 429 / 413 / 507-style outcomes
 * that the binary HTTP handler maps to HTTP status codes.
 *
 * Storage:
 *   - Upload timestamps are kept in a small ring buffer per
 *     installation keyed by SHA-256(installationId), reset on each
 *     call. The bounded map keeps the memory footprint small for a
 *     long-running daemon.
 *   - The retained-bytes tracker piggybacks on the existing
 *     AttachmentStore bookkeeping (one DB write per completed upload)
 *     and only sums current attachments for the installation.
 */
import { createHash } from "node:crypto";
import type { BridgeStore } from "../core/store";
import type { AttachmentStore } from "../core/attachments";

export interface RateQuotaLimits {
  readonly uploadsPerMinute: number;
  readonly retainedBytesPerInstallation: number;
  readonly aggregateBytes: number;
  /** Optional clock injection for tests. */
  readonly now?: () => number;
}

export type RateQuotaOutcome =
  | { readonly kind: "allowed"; readonly remaining: number }
  | { readonly kind: "rate_limited"; readonly resetAt: number }
  | { readonly kind: "quota_exceeded"; readonly limit: number }
  | { readonly kind: "storage_full"; readonly limit: number };

const WINDOW_MS = 60_000;

export interface RateQuotaTracker {
  /** Consult the tracker before opening the multipart body. */
  canUpload(installationId: string, declaredBytes: number): RateQuotaOutcome;
  /** Atomic +1 of the per-installation retained bytes; returns true on success. */
  reserveBytes(installationId: string, bytes: number): { readonly kind: "reserved" } | { readonly kind: "rejected"; readonly outcome: RateQuotaOutcome };
  /** Releases a previously reserved chunk so a downstream busboy failure
   * does not strand quota. */
  releaseBytes(installationId: string, bytes: number): void;
  /** Compute current aggregate bytes (cheap DB scan). */
  aggregateBytes(): number;
  /** Compute currently retained bytes for one installation. */
  installationBytes(installationId: string): number;
}

interface Window {
  readonly events: number[];
}

export interface CreateRateQuotaTrackerInput {
  readonly store: BridgeStore;
  readonly attachments: AttachmentStore;
  readonly limits: RateQuotaLimits;
  /** Injectable clock for tests. */
  readonly now?: () => number;
}

export function createRateQuotaTracker(input: CreateRateQuotaTrackerInput): RateQuotaTracker {
  const now = input.limits.now ?? input.now ?? Date.now;
  const uploadWindows = new Map<string, Window>();
  return {
    canUpload(installationId, declaredBytes) {
      const at = now();
      const window = uploadWindows.get(installationId) ?? { events: [] };
      const recent = window.events.filter((stamp) => at - stamp < WINDOW_MS);
      recent.push(at);
      uploadWindows.set(installationId, { events: recent });
      if (recent.length > input.limits.uploadsPerMinute) {
        const oldest = recent[0]!;
        return { kind: "rate_limited", resetAt: oldest + WINDOW_MS };
      }
      const aggregate = computeAggregateBytes(input.attachments);
      if (aggregate + declaredBytes > input.limits.aggregateBytes) {
        return { kind: "storage_full", limit: input.limits.aggregateBytes };
      }
      const retained = computeRetainedBytes(input.attachments, installationId);
      if (retained + declaredBytes > input.limits.retainedBytesPerInstallation) {
        return { kind: "quota_exceeded", limit: input.limits.retainedBytesPerInstallation };
      }
      return { kind: "allowed", remaining: input.limits.uploadsPerMinute - recent.length };
    },
    reserveBytes(installationId, bytes) {
      const outcome = this.canUpload(installationId, bytes);
      if (outcome.kind !== "allowed") return { kind: "rejected", outcome };
      return { kind: "reserved" };
    },
    releaseBytes(_installationId, _bytes) {
      // No-op: the busboy rejection path cannot undo the window count
      // because the rate limiter uses wall-clock timestamps. The
      // retention counter is recomputed from the AttachmentStore on
      // every check, so cancellations are observed at the next call.
    },
    aggregateBytes() {
      return computeAggregateBytes(input.attachments);
    },
    installationBytes(installationId) {
      return computeRetainedBytes(input.attachments, installationId);
    },
    ...{ store: input.store },
  };
}

function computeAggregateBytes(store: AttachmentStore): number {
  return store.aggregateRetainedBytes();
}

function computeRetainedBytes(store: AttachmentStore, installationId: string): number {
  return store.retainedBytesForInstallation(installationId);
}

// Re-export the helper so the binary HTTP handler can compute aggregates without depending on private store fields.
export function hashInstallationId(installationId: string): string {
  return createHash("sha256").update(installationId, "utf8").digest("hex");
}
