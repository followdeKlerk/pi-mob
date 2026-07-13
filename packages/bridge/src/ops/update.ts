/**
 * Update planning and transactional execution.
 *
 * The update flow is the single mutation surface for an installed bridge.
 * Every install/lifecycle change (binary swap, schema migration, generation
 * reset) flows through {@link executeUpdate} so the run is observable,
 * checkpointed, and recoverable from a known-good backup.
 *
 * Stage ordering depends on the migration class declared by the target
 * manifest:
 *
 *   - `binary_only`: preflight -> checksum-verify -> backup -> swap -> post-verify -> finalize
 *   - `reversible_migration`: preflight -> checksum-verify -> backup -> migrate -> swap -> post-verify -> finalize
 *   - `restore_required`: preflight -> checksum-verify -> backup -> migrate -> generation-reset -> swap -> post-verify -> finalize
 *
 * The executor is *transactional*: if any stage throws, it restores the most
 * recent backup, marks the result as `rolledBack: true`, and returns the
 * failing stage.
 */

import { sha256Of } from "./release-manifest";
import type { ReleaseManifest } from "./release-manifest";
import type { ClockPort, FileSystemPort } from "./ports";

export type MigrationClass = "binary_only" | "reversible_migration" | "restore_required";

export type UpdateStage =
  | "preflight"
  | "checksum-verify"
  | "backup"
  | "migrate"
  | "generation-reset"
  | "swap"
  | "post-verify"
  | "finalize";

export interface UpdatePlan {
  readonly planId: string;
  readonly planVersion: 1;
  readonly migrationClass: MigrationClass;
  readonly fromVersion: string;
  readonly targetVersion: string;
  readonly targetRoot: string;
  readonly targetManifest: ReleaseManifest;
  readonly stages: readonly UpdateStage[];
}

/** Thrown when an update plan or execution step fails structural validation. */
export class UpdatePlanError extends Error {
  override readonly name = "UpdatePlanError";
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/**
 * Computes a deterministic plan from inputs. The `planId` is stable across
 * runs given the same inputs; the executor does not randomise it.
 */
export interface PlanUpdateInput {
  readonly currentVersion: string;
  readonly targetManifest: ReleaseManifest;
  readonly targetRoot: string;
  readonly migrationClass: MigrationClass;
  /** Optional caller-supplied planId; defaults to a stable hash. */
  readonly planId?: string;
}

export function planUpdate(input: PlanUpdateInput): UpdatePlan {
  if (input.targetRoot.length === 0) {
    throw new UpdatePlanError("target_root", "targetRoot must not be empty");
  }
  if (input.targetManifest.version.length === 0) {
    throw new UpdatePlanError("target_version", "targetManifest.version must not be empty");
  }
  if (input.currentVersion === input.targetManifest.version) {
    throw new UpdatePlanError(
      "same_version",
      `current and target versions match (${input.currentVersion}); nothing to update`,
    );
  }
  const stages = stagesForMigrationClass(input.migrationClass);
  const planId = input.planId ?? computePlanId({
    migrationClass: input.migrationClass,
    currentVersion: input.currentVersion,
    targetVersion: input.targetManifest.version,
    targetRoot: input.targetRoot,
  });
  return {
    planId,
    planVersion: 1,
    migrationClass: input.migrationClass,
    fromVersion: input.currentVersion,
    targetVersion: input.targetManifest.version,
    targetRoot: input.targetRoot,
    targetManifest: input.targetManifest,
    stages,
  };
}

/** Returns the ordered stages for a migration class. Pure helper. */
export function stagesForMigrationClass(migrationClass: MigrationClass): readonly UpdateStage[] {
  switch (migrationClass) {
    case "binary_only":
      return ["preflight", "checksum-verify", "backup", "swap", "post-verify", "finalize"];
    case "reversible_migration":
      return ["preflight", "checksum-verify", "backup", "migrate", "swap", "post-verify", "finalize"];
    case "restore_required":
      return [
        "preflight",
        "checksum-verify",
        "backup",
        "migrate",
        "generation-reset",
        "swap",
        "post-verify",
        "finalize",
      ];
  }
}

function computePlanId(input: {
  readonly migrationClass: MigrationClass;
  readonly currentVersion: string;
  readonly targetVersion: string;
  readonly targetRoot: string;
}): string {
  const payload = [
    "plan-v1",
    input.migrationClass,
    input.currentVersion,
    input.targetVersion,
    input.targetRoot,
  ].join("\n");
  return sha256Of(payload).slice(0, 32);
}

export interface UpdateHooks {
  readonly preflight?: UpdateStageHook;
  readonly verifyTarget?: UpdateStageHook;
  readonly backup?: UpdateBackupHook;
  readonly migrate?: UpdateStageHook;
  readonly generationReset?: UpdateStageHook;
  readonly swap?: UpdateStageHook;
  readonly postVerify?: UpdateStageHook;
  readonly finalize?: UpdateStageHook;
}

export interface UpdateRollbackHooks {
  /** Restore state/bin/config from the backup directory. */
  readonly restore?: UpdateStageHook;
  /** Reset host generation as part of restore_required rollback. */
  readonly generationReset?: UpdateStageHook;
}

export type UpdateStageHook = () => void | Promise<void>;

export interface UpdateBackupHook {
  (): string | Promise<string>;
}

export interface UpdatePorts {
  readonly fs: FileSystemPort;
  readonly clock: ClockPort;
}

export interface UpdateResult {
  readonly planId: string;
  readonly ok: boolean;
  readonly completed: readonly UpdateStage[];
  readonly backupId: string | null;
  readonly rolledBack: boolean;
  readonly error: { readonly stage: UpdateStage; readonly message: string } | null;
  readonly timestamp: string;
}

/**
 * Runs an update plan. The hook for each declared stage is invoked in
 * order; if any throws, the rollback hooks restore the backup and (for
 * `restore_required`) reset the host generation. The returned
 * {@link UpdateResult} records every observed state.
 */
export async function executeUpdate(args: {
  readonly plan: UpdatePlan;
  readonly ports: UpdatePorts;
  readonly hooks: UpdateHooks;
  readonly rollback: UpdateRollbackHooks;
}): Promise<UpdateResult> {
  validatePlan(args.plan);
  const completed: UpdateStage[] = [];
  let backupId: string | null = null;
  let failedStage: UpdateStage | null = null;
  let failureMessage: string | null = null;

  for (const stage of args.plan.stages) {
    try {
      const hookOutput = await invokeStageHook(stage, args.hooks, args.ports);
      if (stage === "backup" && typeof hookOutput === "string") {
        backupId = hookOutput;
      }
      completed.push(stage);
    } catch (error) {
      failedStage = stage;
      failureMessage = (error as Error).message;
      break;
    }
  }

  const timestamp = args.ports.clock.iso();
  if (failedStage === null) {
    return {
      planId: args.plan.planId,
      ok: true,
      completed,
      backupId,
      rolledBack: false,
      error: null,
      timestamp,
    };
  }

  let rolledBack = false;
  if (backupId !== null && args.rollback.restore) {
    try {
      await args.rollback.restore();
      rolledBack = true;
    } catch (rollbackError) {
      // Rollback failure is surfaced alongside the original failure but
      // does not change `rolledBack` semantics; the executor reports both.
      failureMessage = `${failureMessage}; rollback failed: ${(rollbackError as Error).message}`;
    }
  }
  if (args.plan.migrationClass === "restore_required" && args.rollback.generationReset) {
    try {
      await args.rollback.generationReset();
    } catch (resetError) {
      failureMessage = `${failureMessage}; generation reset failed: ${(resetError as Error).message}`;
    }
  }

  return {
    planId: args.plan.planId,
    ok: false,
    completed,
    backupId,
    rolledBack,
    error: { stage: failedStage, message: failureMessage ?? "unknown failure" },
    timestamp,
  };
}

async function invokeStageHook(
  stage: UpdateStage,
  hooks: UpdateHooks,
  _ports: UpdatePorts,
): Promise<string | void> {
  switch (stage) {
    case "preflight":
      await hooks.preflight?.();
      return;
    case "checksum-verify":
      await hooks.verifyTarget?.();
      return;
    case "backup": {
      const hook = hooks.backup;
      if (!hook) return;
      const result = await hook();
      return result;
    }
    case "migrate":
      await hooks.migrate?.();
      return;
    case "generation-reset":
      await hooks.generationReset?.();
      return;
    case "swap":
      await hooks.swap?.();
      return;
    case "post-verify":
      await hooks.postVerify?.();
      return;
    case "finalize":
      await hooks.finalize?.();
      return;
  }
}

function validatePlan(plan: UpdatePlan): void {
  if (plan.planVersion !== 1) {
    throw new UpdatePlanError("plan_version", `unsupported planVersion: ${plan.planVersion}`);
  }
  if (plan.stages.length === 0) {
    throw new UpdatePlanError("stages", "plan stages must not be empty");
  }
  const expected = stagesForMigrationClass(plan.migrationClass);
  if (!arraysEqual(plan.stages, expected)) {
    throw new UpdatePlanError(
      "stages",
      `plan stages do not match migration class ${plan.migrationClass}: got [${plan.stages.join(",")}], expected [${expected.join(",")}]`,
    );
  }
  if (plan.migrationClass === "restore_required" && !plan.stages.includes("generation-reset")) {
    throw new UpdatePlanError(
      "migration_class",
      "restore_required plan must include a generation-reset stage",
    );
  }
}

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
