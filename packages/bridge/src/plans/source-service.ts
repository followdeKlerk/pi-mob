import { LIMITS, PLAN_CAPABILITY } from "@pi-mob/protocol-schema";

/** R2 — Closed status values for `PlanStep.status`.
 * Frozen by F0/D-036; tests pin every value. */
export type PlanStepStatus = "pending" | "running" | "completed" | "blocked" | "skipped";

/** R2 — A single bounded plan step. The schema forbids private siblings. */
export interface PlanStep {
  readonly stepId: string;
  readonly title: string;
  readonly status: PlanStepStatus;
  readonly blocker?: string;
}

/** R2 — The bounded, authoritative plan snapshot for one session/turn.
 * Mirrors `PlanSnapshotSchema` from F0 (planId/revision/sessionId/turnId/
 * source/stale/capability/steps). */
export interface PlanSnapshot {
  readonly planId: string;
  readonly revision: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly source: string;
  readonly stale: boolean;
  readonly capability: {
    readonly state: "available";
    readonly source?: string;
    readonly lastRefreshedAt?: string;
  };
  readonly steps: readonly PlanStep[];
}

/** R2 — Truthful no-plan surface. The schema forbids embedding this
 * shape inside `plan.snapshot.result`; the bridge must surface it
 * through the host-stream `plan.unavailable` event then reject the
 * synchronous response with `unsupported_capability`. */
export interface PlanUnavailable {
  readonly capability: typeof PLAN_CAPABILITY;
  readonly status: {
    readonly state: "unavailable";
    readonly reason: string;
    readonly remediation: string;
  };
}

/** R2 — Discriminated union returned by `PlanSourceService.snapshot()`. */
export type PlanSourceResult = PlanSnapshot | PlanUnavailable;

/** R2 — Optional injected authority for structured plans. The bridge
 * installs nothing by default; mobile renders the truthful unavailable
 * surface and the bridge advertises `plans.v1` only when an instance is
 * provided. A real implementation must source steps from a vetted Pi
 * extension or bridge event — never from Markdown/prose inference. */
export interface PlanSourceService {
  /** Returns the closed plan snapshot for the requested session/turn, or
   * `PlanUnavailable` when the surface is truthfully unavailable. */
  snapshot(input: { sessionId: string; turnId: string; signal?: AbortSignal }): Promise<PlanSourceResult>;
}

/** R2 — Discriminating helper. */
export function isPlanUnavailable(value: PlanSourceResult): value is PlanUnavailable {
  return (value as PlanUnavailable).capability === PLAN_CAPABILITY && "status" in value;
}

/** R2 — Bound the snapshot to the protocol limits so a service that
 * accidentally returns oversized data cannot bypass the closed schema. */
export function boundPlanSnapshot(value: PlanSnapshot): PlanSnapshot {
  const planId = value.planId.length > LIMITS.maxPlanIdLength ? value.planId.slice(0, LIMITS.maxPlanIdLength) : value.planId;
  const revision = value.revision;
  const turnId = value.turnId.length > LIMITS.maxTurnIdLength ? value.turnId.slice(0, LIMITS.maxTurnIdLength) : value.turnId;
  const source = value.source.length > LIMITS.maxCapabilitySourceLength ? value.source.slice(0, LIMITS.maxCapabilitySourceLength) : value.source;
  const steps = value.steps.slice(0, LIMITS.maxPlanSteps).map((step): PlanStep => {
    const clippedBlocker = step.blocker && step.blocker.length > LIMITS.maxPlanBlockerLength ? step.blocker.slice(0, LIMITS.maxPlanBlockerLength) : step.blocker;
    return clippedBlocker === undefined
      ? { stepId: step.stepId.length > LIMITS.maxStepIdLength ? step.stepId.slice(0, LIMITS.maxStepIdLength) : step.stepId, title: step.title.length > LIMITS.maxRecipeTitleLength ? step.title.slice(0, LIMITS.maxRecipeTitleLength) : step.title, status: step.status }
      : { stepId: step.stepId.length > LIMITS.maxStepIdLength ? step.stepId.slice(0, LIMITS.maxStepIdLength) : step.stepId, title: step.title.length > LIMITS.maxRecipeTitleLength ? step.title.slice(0, LIMITS.maxRecipeTitleLength) : step.title, status: step.status, blocker: clippedBlocker };
  });
  return { planId, revision, sessionId: value.sessionId, turnId, source, stale: Boolean(value.stale), capability: { state: "available" as const }, steps };
}
