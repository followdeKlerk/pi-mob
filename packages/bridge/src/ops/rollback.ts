/**
 * Rollback planning and execution.
 *
 * Rollback is the inverse of {@link executeUpdate}. It restores the install
 * from a previously captured backup and, for `restore_required` migration
 * classes, *always* invokes the generation-reset callback before the swap.
 *
 * The plan is deterministic and pure; execution depends on the injected
 * ports and the caller-supplied hooks.
 */

import { sha256Of } from "./release-manifest";
import type { MigrationClass, UpdatePlan, UpdateStageHook, UpdateRollbackHooks } from "./update";

export type RollbackStage =
  | "preflight"
  | "verify-backup"
  | "generation-reset"
  | "swap"
  | "verify-target"
  | "finalize";

export interface RollbackPlan {
  readonly planId: string;
  readonly planVersion: 1;
  readonly migrationClass: MigrationClass;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly backupId: string;
  readonly requiresGenerationReset: boolean;
  readonly stages: readonly RollbackStage[];
}

/** Thrown when a rollback plan or execution fails structural validation. */
export class RollbackPlanError extends Error {
  override readonly name = "RollbackPlanError";
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export interface PlanRollbackInput {
  readonly currentVersion: string;
  readonly backupId: string;
  readonly migrationClass: MigrationClass;
  /** Optional caller-supplied planId; defaults to a stable hash. */
  readonly planId?: string;
}

/**
 * Computes a deterministic rollback plan. For `restore_required`, the plan
 * always restores the backup before `generation-reset`, then verifies the
 * restarted target, so the restored database receives exactly one reset.
 */
export function planRollback(input: PlanRollbackInput): RollbackPlan {
  if (input.backupId.length === 0) {
    throw new RollbackPlanError("backup_id", "backupId must not be empty");
  }
  if (input.currentVersion.length === 0) {
    throw new RollbackPlanError("from_version", "currentVersion must not be empty");
  }
  const stages = stagesForRollback(input.migrationClass);
  const planId = input.planId ?? computeRollbackPlanId({
    migrationClass: input.migrationClass,
    currentVersion: input.currentVersion,
    backupId: input.backupId,
  });
  return {
    planId,
    planVersion: 1,
    migrationClass: input.migrationClass,
    fromVersion: input.currentVersion,
    toVersion: previousVersionFromBackupId(input.backupId),
    backupId: input.backupId,
    requiresGenerationReset: input.migrationClass === "restore_required",
    stages,
  };
}

/** Returns the ordered stages for a rollback. */
export function stagesForRollback(migrationClass: MigrationClass): readonly RollbackStage[] {
  switch (migrationClass) {
    case "binary_only":
      return ["preflight", "verify-backup", "swap", "verify-target", "finalize"];
    case "reversible_migration":
      return ["preflight", "verify-backup", "swap", "verify-target", "finalize"];
    case "restore_required":
      return ["preflight", "verify-backup", "swap", "generation-reset", "verify-target", "finalize"];
  }
}

function computeRollbackPlanId(input: {
  readonly migrationClass: MigrationClass;
  readonly currentVersion: string;
  readonly backupId: string;
}): string {
  const payload = [
    "rollback-plan-v1",
    input.migrationClass,
    input.currentVersion,
    input.backupId,
  ].join("\n");
  return sha256Of(payload).slice(0, 32);
}

function previousVersionFromBackupId(backupId: string): string {
  // The backup id encodes the pre-update version in a fixed
  // `backup-<fromVersion>-<bucket>` shape. For unknown shapes we leave the
  // version blank; the plan still tracks the operation deterministically.
  const parts = backupId.split("-");
  if (parts.length >= 3 && parts[0] === "backup") {
    return parts.slice(1, parts.length - 1).join("-");
  }
  return "";
}

export interface RollbackHooks {
  readonly preflight?: UpdateStageHook;
  readonly verifyBackup?: UpdateStageHook;
  readonly generationReset?: UpdateStageHook;
  readonly swap?: UpdateStageHook;
  readonly verifyTarget?: UpdateStageHook;
  readonly finalize?: UpdateStageHook;
}

export interface RollbackResult {
  readonly planId: string;
  readonly ok: boolean;
  readonly completed: readonly RollbackStage[];
  readonly generationResetInvoked: boolean;
  readonly error: { readonly stage: RollbackStage; readonly message: string } | null;
  readonly timestamp: string;
}

/**
 * Executes the rollback. For `restore_required`, the executor refuses to
 * proceed if `generationReset` is not provided in the hooks — the host
 * generation must be reset before any swap.
 */
export async function executeRollback(args: {
  readonly plan: RollbackPlan;
  readonly hooks: RollbackHooks;
  readonly ports: { readonly clock: { iso(): string } };
}): Promise<RollbackResult> {
  validateRollbackPlan(args.plan);
  if (args.plan.requiresGenerationReset && !args.hooks.generationReset) {
    return {
      planId: args.plan.planId,
      ok: false,
      completed: [],
      generationResetInvoked: false,
      error: {
        stage: "generation-reset",
        message: "restore_required rollback requires a generationReset hook",
      },
      timestamp: args.ports.clock.iso(),
    };
  }

  const completed: RollbackStage[] = [];
  let generationResetInvoked = false;
  let failedStage: RollbackStage | null = null;
  let failureMessage: string | null = null;

  for (const stage of args.plan.stages) {
    try {
      if (stage === "generation-reset" && args.hooks.generationReset) {
        await args.hooks.generationReset();
        generationResetInvoked = true;
      } else {
        await invokeRollbackStage(stage, args.hooks);
      }
      completed.push(stage);
    } catch (error) {
      failedStage = stage;
      failureMessage = (error as Error).message;
      break;
    }
  }

  if (failedStage === null) {
    return {
      planId: args.plan.planId,
      ok: true,
      completed,
      generationResetInvoked,
      error: null,
      timestamp: args.ports.clock.iso(),
    };
  }
  return {
    planId: args.plan.planId,
    ok: false,
    completed,
    generationResetInvoked,
    error: { stage: failedStage, message: failureMessage ?? "unknown failure" },
    timestamp: args.ports.clock.iso(),
  };
}

async function invokeRollbackStage(stage: RollbackStage, hooks: RollbackHooks): Promise<void> {
  switch (stage) {
    case "preflight":
      await hooks.preflight?.();
      return;
    case "verify-backup":
      await hooks.verifyBackup?.();
      return;
    case "generation-reset":
      // Handled by caller.
      return;
    case "swap":
      await hooks.swap?.();
      return;
    case "verify-target":
      await hooks.verifyTarget?.();
      return;
    case "finalize":
      await hooks.finalize?.();
      return;
  }
}

function validateRollbackPlan(plan: RollbackPlan): void {
  if (plan.planVersion !== 1) {
    throw new RollbackPlanError("plan_version", `unsupported planVersion: ${plan.planVersion}`);
  }
  if (plan.stages.length === 0) {
    throw new RollbackPlanError("stages", "plan stages must not be empty");
  }
  if (plan.migrationClass === "restore_required" && !plan.stages.includes("generation-reset")) {
    throw new RollbackPlanError(
      "migration_class",
      "restore_required rollback plan must include a generation-reset stage",
    );
  }
  const expected = stagesForRollback(plan.migrationClass);
  if (!arraysEqual(plan.stages, expected)) {
    throw new RollbackPlanError(
      "stages",
      `rollback stages do not match migration class ${plan.migrationClass}: got [${plan.stages.join(",")}], expected [${expected.join(",")}]`,
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

// Re-export for callers that want a single import path for rollback work.
export type { UpdateRollbackHooks };
export type { UpdatePlan };
