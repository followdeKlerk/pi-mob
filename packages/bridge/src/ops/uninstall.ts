/**
 * Uninstall planning and execution.
 *
 * Three uninstall modes:
 *
 *   - `retain_data`: remove the bridge install (plist, bin, config) but
 *     keep state, secrets, logs, and backups for forensic recovery.
 *   - `remove_state`: same as `retain_data`, plus delete state, secrets,
 *     logs, and backups.
 *   - `full`: same as `remove_state`, plus delete everything else
 *     associated with the install. The OMP session directory is **always**
 *     preserved unless the caller explicitly opts in via
 *     {@link UninstallOptions.removeOmpSessionDir}.
 *
 * The uninstall flow never removes the OMP session directory by default,
 * even in `full` mode.
 */

import {
  DIRECTORY_MODE,
  FILE_MODE,
  assertAbsolute,
  assertNoTraversal,
  type InstallPaths,
} from "./install-paths";
import type { ClockPort, FileSystemPort } from "./ports";

export type UninstallMode = "retain_data" | "remove_state" | "full";

export interface UninstallPaths extends InstallPaths {
  /** OMP session directory; never removed unless explicitly opted in. */
  readonly ompSessionDir: string;
}

export interface UninstallOptions {
  readonly mode: UninstallMode;
  readonly paths: UninstallPaths;
  readonly fs: FileSystemPort;
  readonly clock: ClockPort;
  /**
   * When true, the OMP session directory is included in the removal set.
   * Default `false`. Even `full` mode preserves the OMP session directory
   * unless this flag is set.
   */
  readonly removeOmpSessionDir?: boolean;
  /**
   * Optional safety guard. When true, refuses to remove anything that
   * resolves to a path outside `paths.installRoot`. Defaults to `true`.
   */
  readonly refusePathsOutsideRoot?: boolean;
}

export interface UninstallPlan {
  readonly mode: UninstallMode;
  readonly remove: readonly string[];
  readonly preserve: readonly string[];
  readonly ompSessionDir: string;
  readonly ompSessionDirRemoved: boolean;
  readonly timestamp: string;
}

export interface UninstallResult {
  readonly mode: UninstallMode;
  readonly plan: UninstallPlan;
  readonly removed: readonly string[];
  readonly preserved: readonly string[];
  readonly ompSessionDirRemoved: boolean;
  readonly timestamp: string;
}

/** Thrown when an uninstall plan or execution step fails structural validation. */
export class UninstallPlanError extends Error {
  override readonly name = "UninstallPlanError";
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/**
 * Computes the uninstall plan without performing any filesystem I/O. The
 * plan records which paths will be removed and which will be preserved.
 *
 * The OMP session directory is always preserved unless
 * {@link UninstallOptions.removeOmpSessionDir} is explicitly set.
 */
export function planUninstall(options: UninstallOptions): UninstallPlan {
  validateUninstallOptions(options);
  const refuseOutside = options.refusePathsOutsideRoot ?? true;
  const insideRoot = (path: string): boolean =>
    !refuseOutside || path === options.paths.installRoot || path.startsWith(`${options.paths.installRoot}/`);
  const toRemove: string[] = [];
  const toPreserve: string[] = [];

  // The plist is removed in every mode.
  if (insideRoot(options.paths.plistPath)) {
    toRemove.push(options.paths.plistPath);
  } else {
    toPreserve.push(options.paths.plistPath);
  }

  // The bin root is removed in every mode.
  if (insideRoot(options.paths.binRoot)) {
    toRemove.push(options.paths.binRoot);
  } else {
    toPreserve.push(options.paths.binRoot);
  }

  // The config file is removed in every mode.
  if (insideRoot(options.paths.configFile)) {
    toRemove.push(options.paths.configFile);
  } else {
    toPreserve.push(options.paths.configFile);
  }

  // The env file lives in secretsRoot; treated together with the secrets.
  if (insideRoot(options.paths.envFile)) {
    if (options.mode === "retain_data") {
      toPreserve.push(options.paths.envFile);
    } else {
      toRemove.push(options.paths.envFile);
    }
  } else {
    toPreserve.push(options.paths.envFile);
  }

  // State, secrets, logs, backups.
  for (const path of [options.paths.stateRoot, options.paths.secretsRoot, options.paths.logRoot, options.paths.backupRoot]) {
    if (!insideRoot(path)) {
      toPreserve.push(path);
      continue;
    }
    if (options.mode === "retain_data") {
      toPreserve.push(path);
    } else {
      toRemove.push(path);
    }
  }

  // The install root itself is removed only when its contents have been
  // emptied; we always include it as a removal candidate for `remove_state`
  // and `full` so the executor can attempt a recursive removal of any
  // residual files (config, plist, env, bin).
  if (insideRoot(options.paths.installRoot)) {
    if (options.mode === "retain_data") {
      toPreserve.push(options.paths.installRoot);
    } else {
      toRemove.push(options.paths.installRoot);
    }
  } else {
    toPreserve.push(options.paths.installRoot);
  }

  // OMP session directory: always preserved unless explicit opt-in.
  const ompSessionDirRemoved = options.removeOmpSessionDir === true;
  if (ompSessionDirRemoved) {
    toRemove.push(options.paths.ompSessionDir);
  } else {
    toPreserve.push(options.paths.ompSessionDir);
  }

  return {
    mode: options.mode,
    remove: dedupe(toRemove),
    preserve: dedupe(toPreserve),
    ompSessionDir: options.paths.ompSessionDir,
    ompSessionDirRemoved,
    timestamp: options.clock.iso(),
  };
}

/** Removes the install per the plan; returns the actually-removed paths. */
export function executeUninstall(options: UninstallOptions): UninstallResult {
  const plan = planUninstall(options);
  const removed: string[] = [];
  const preserved: string[] = [];

  for (const path of plan.preserve) {
    if (options.fs.exists(path)) preserved.push(path);
  }

  // We remove children first, then containers. Each rm is idempotent (the
  // port tolerates ENOENT in `force: true`).
  for (const path of plan.remove) {
    if (!options.fs.exists(path)) continue;
    try {
      options.fs.rm(path, { recursive: true, force: true });
      removed.push(path);
    } catch (error) {
      throw new UninstallPlanError(
        "remove_failed",
        `failed to remove ${path}: ${(error as Error).message}`,
      );
    }
  }

  return {
    mode: plan.mode,
    plan,
    removed,
    preserved,
    ompSessionDirRemoved: plan.ompSessionDirRemoved,
    timestamp: options.clock.iso(),
  };
}

function validateUninstallOptions(options: UninstallOptions): void {
  for (const [name, path] of [["installRoot", options.paths.installRoot], ["ompSessionDir", options.paths.ompSessionDir]] as const) {
    const segments = path.split("/").filter(Boolean);
    if (path === "/" || segments.length < 2) {
      throw new UninstallPlanError("unsafe_removal_root", `${name} is too broad for recursive removal`);
    }
  }
  for (const path of [options.paths.installRoot, options.paths.configFile, options.paths.stateRoot,
    options.paths.logRoot, options.paths.backupRoot, options.paths.secretsRoot, options.paths.binRoot,
    options.paths.plistPath, options.paths.envFile, options.paths.ompSessionDir]) {
    assertAbsolute(`paths.${describePath(options.paths, path)}`, path);
    assertNoTraversal(`paths.${describePath(options.paths, path)}`, path);
  }
}

function describePath(paths: UninstallPaths, path: string): string {
  if (path === paths.installRoot) return "installRoot";
  if (path === paths.configFile) return "configFile";
  if (path === paths.stateRoot) return "stateRoot";
  if (path === paths.logRoot) return "logRoot";
  if (path === paths.backupRoot) return "backupRoot";
  if (path === paths.secretsRoot) return "secretsRoot";
  if (path === paths.binRoot) return "binRoot";
  if (path === paths.plistPath) return "plistPath";
  if (path === paths.envFile) return "envFile";
  if (path === paths.ompSessionDir) return "ompSessionDir";
  return "unknown";
}

function dedupe(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

// Constants re-exported so install/uninstall flows agree on mode bits.
export { DIRECTORY_MODE, FILE_MODE };
