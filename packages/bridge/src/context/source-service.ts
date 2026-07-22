import { LIMITS, CONTEXTS_CAPABILITY } from "@pi-mob/protocol-schema";

/** R4 — Closed status values for `ContextCapability`. Mirrors the
 * `CapabilityStatusSchema` discriminated union from F0. */
export type ContextCapabilityState = "available" | "degraded" | "unavailable" | "stale";

export interface ContextCapability {
  readonly state: ContextCapabilityState;
  readonly reason?: string;
  readonly remediation?: string;
  readonly source?: string;
  readonly revision?: string;
  readonly lastRefreshedAt?: string;
}

export interface ContextModel {
  readonly provider: string;
  readonly modelId: string;
}

export interface ContextPinnedFile {
  readonly path: string;
  readonly pinnedAt: string;
  readonly ranges?: readonly { readonly startLine: number; readonly endLine: number }[];
  readonly revision: string;
}

export interface ContextTokenUsage {
  readonly inputTokens: string;
  readonly outputTokens: string;
  readonly cacheReadTokens?: string;
  readonly cacheWriteTokens?: string;
  readonly contextWindowTokens?: string;
  readonly usagePercent?: number;
}

export interface ContextSource {
  readonly sourceId: string;
  readonly sourceKind: string;
  readonly summary: string;
  readonly stale: boolean;
  readonly capability: ContextCapability;
  readonly revision?: string;
  readonly lastRefreshedAt?: string;
}

/** R4 — The bounded, authoritative context snapshot for one session.
 * Mirrors `ContextSnapshotSchema` from F0. */
export interface ContextSnapshot {
  readonly sessionId: string;
  readonly revision: string;
  readonly source: string;
  readonly stale: boolean;
  readonly capability: { readonly state: "available" } & Partial<Omit<ContextCapability, "state">>;
  readonly model?: ContextModel;
  readonly thinkingLevel?: string;
  readonly instructions?: string;
  readonly pinnedFiles?: readonly ContextPinnedFile[];
  readonly tokenUsage?: ContextTokenUsage;
  readonly compacted?: boolean;
  readonly compactRevision?: string;
  readonly compactedAt?: string;
  readonly sources?: readonly ContextSource[];
  readonly lastRefreshedAt: string;
}

/** R4 — Truthful no-context surface. The schema forbids embedding this
 * shape inside `context.snapshot.result`; the bridge surfaces it
 * through the host-stream `context.unavailable` event then rejects the
 * synchronous response with `unsupported_capability`. */
export interface ContextUnavailable {
  readonly sessionId: string;
  readonly capability: typeof CONTEXTS_CAPABILITY;
  readonly status: {
    readonly state: "unavailable" | "degraded" | "stale";
    readonly reason: string;
    readonly remediation: string;
  };
}

/** R4 — Discriminated union returned by `ContextSourceService.snapshot()`. */
export type ContextSourceResult = ContextSnapshot | ContextUnavailable;

/** R4 — Discriminating helper. */
export function isContextUnavailable(value: ContextSourceResult): value is ContextUnavailable {
  return (value as ContextUnavailable).capability === CONTEXTS_CAPABILITY && "status" in value;
}

/** R4 — Re-exported mutation target type narrowed from the protocol
 * schema so the bridge service does not need to import the schema's
 * generic union directly. */
export type ContextMutationTarget =
  | { readonly kind: "file"; readonly path: string; readonly ranges?: readonly { readonly startLine: number; readonly endLine: number }[]; readonly revision?: string }
  | { readonly kind: "source"; readonly sourceId: string; readonly revision?: string }
  | { readonly kind: "all" };

/** R4 — Optional injected authority for the context inspector. The
 * bridge installs nothing by default; mobile renders the truthful
 * unavailable surface and the bridge advertises `contexts.v1` only when
 * an instance is provided. */
export interface ContextSourceService {
  /** Returns the closed context snapshot for the requested session, or
   * `ContextUnavailable` when the surface is truthfully unavailable. */
  snapshot(input: { sessionId: string; signal?: AbortSignal }): Promise<ContextSourceResult>;
  /** R4 — Applies an authoritative context mutation (pin/unpin/exclude/
   * refresh). Implementations MUST be durable commands with command IDs,
   * lease/revision checks, idempotency, and replayable outcomes per
   * D-037. Returns the next snapshot revision (or `null` when the
   * service rejects the mutation). */
  mutate(input: {
    sessionId: string;
    type: "context.pin" | "context.unpin" | "context.exclude" | "context.refresh";
    target: ContextMutationTarget;
    expectedRevision: string;
    signal?: AbortSignal;
  }): Promise<{ readonly accepted: boolean; readonly revision: string | null; readonly rejectionReason?: string }>;
}

/** R4 — Bound the snapshot to the protocol limits so a service that
 * accidentally returns oversized data cannot bypass the closed schema. */
export function boundContextSnapshot(value: ContextSnapshot): ContextSnapshot {
  const source = value.source.length > LIMITS.maxCapabilitySourceLength
    ? value.source.slice(0, LIMITS.maxCapabilitySourceLength)
    : value.source;
  const pinnedFiles = value.pinnedFiles
    ? value.pinnedFiles.slice(0, LIMITS.maxPinnedFiles).map((file): ContextPinnedFile => {
        const ranges = file.ranges
          ? file.ranges.slice(0, LIMITS.maxPinnedRanges).map((range) => ({
              startLine: Math.max(1, Math.floor(range.startLine)),
              endLine: Math.max(range.startLine, Math.floor(range.endLine)),
            }))
          : undefined;
        return ranges === undefined
          ? { path: file.path, pinnedAt: file.pinnedAt, revision: file.revision }
          : { path: file.path, pinnedAt: file.pinnedAt, ranges, revision: file.revision };
      })
    : undefined;
  const sources = value.sources
    ? value.sources.slice(0, 64).map((item): ContextSource => ({
        sourceId: item.sourceId.length > LIMITS.maxContextSourceIdLength
          ? item.sourceId.slice(0, LIMITS.maxContextSourceIdLength)
          : item.sourceId,
        sourceKind: item.sourceKind.length > LIMITS.maxContextSourceKindLength
          ? item.sourceKind.slice(0, LIMITS.maxContextSourceKindLength)
          : item.sourceKind,
        summary: item.summary.length > LIMITS.maxContextSourceSummary
          ? item.summary.slice(0, LIMITS.maxContextSourceSummary)
          : item.summary,
        stale: Boolean(item.stale),
        capability: item.capability,
        ...(item.revision !== undefined ? { revision: item.revision } : {}),
        ...(item.lastRefreshedAt !== undefined ? { lastRefreshedAt: item.lastRefreshedAt } : {}),
      }))
    : undefined;
  const instructions = value.instructions !== undefined
    ? (value.instructions.length > LIMITS.maxContextInstructions
        ? value.instructions.slice(0, LIMITS.maxContextInstructions)
        : value.instructions)
    : undefined;
  return {
    sessionId: value.sessionId,
    revision: value.revision,
    source,
    stale: Boolean(value.stale),
    capability: { state: "available" as const },
    ...(value.model ? { model: { provider: value.model.provider.slice(0, 128), modelId: value.model.modelId.slice(0, 128) } } : {}),
    ...(value.thinkingLevel ? { thinkingLevel: value.thinkingLevel.slice(0, 32) } : {}),
    ...(instructions !== undefined ? { instructions } : {}),
    ...(pinnedFiles ? { pinnedFiles } : {}),
    ...(value.tokenUsage ? { tokenUsage: value.tokenUsage } : {}),
    ...(value.compacted !== undefined ? { compacted: value.compacted } : {}),
    ...(value.compactRevision ? { compactRevision: value.compactRevision } : {}),
    ...(value.compactedAt ? { compactedAt: value.compactedAt } : {}),
    ...(sources ? { sources } : {}),
    lastRefreshedAt: value.lastRefreshedAt,
  };
}
