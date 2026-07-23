/**
 * Secure install path layout.
 *
 * Every install/lifecycle path is required to be:
 *
 *   - absolute (no relative paths, no `..` traversal),
 *   - owner-only on disk: directories `0o700`, files `0o600`.
 *
 * The install root is the only mutable top-level directory. The Pi session
 * directory is referenced but never owned by the bridge — the uninstall path
 * treats it as preserved-by-default.
 */

import { isAbsolute } from "node:path";

import { InstallPathError, type FileSystemPort } from "./ports";

/** Default LaunchAgent label. Reversed-DNS and unique per host. */
export const DEFAULT_LAUNCH_AGENT_LABEL = "com.pi-mob.bridge";

/** Mode bits used for every directory created by the install flow. */
export const DIRECTORY_MODE = 0o700;

/** Mode bits used for every file written by the install flow. */
export const FILE_MODE = 0o600;

export interface InstallPaths {
  readonly installRoot: string;
  readonly configFile: string;
  readonly stateRoot: string;
  readonly secretsRoot: string;
  readonly logRoot: string;
  readonly backupRoot: string;
  readonly binRoot: string;
  readonly plistPath: string;
  readonly envFile: string;
  readonly launchAgentsRoot: string;
  readonly launchAgentLabel: string;
}

export interface InstallPathsOptions {
  readonly installRoot: string;
  readonly launchAgentLabel?: string;
  readonly launchAgentsRoot?: string;
}

/**
 * Builds the canonical install path layout.
 *
 * The install root is expected to be absolute. The Pi session directory is
 * intentionally *not* part of this layout — it lives outside the install root
 * and the uninstall flow treats it as preserved-by-default.
 */
export function buildInstallPaths(options: InstallPathsOptions): InstallPaths {
  const installRoot = normalizeAbsolute(options.installRoot, "installRoot");
  const launchAgentLabel = options.launchAgentLabel ?? DEFAULT_LAUNCH_AGENT_LABEL;
  const launchAgentsRoot = options.launchAgentsRoot
    ? normalizeAbsolute(options.launchAgentsRoot, "launchAgentsRoot")
    : `${installRoot}/release/launch-agents`;
  assertLabel(launchAgentLabel);
  return {
    installRoot,
    configFile: `${installRoot}/release/config.toml`,
    stateRoot: `${installRoot}/release/state`,
    secretsRoot: `${installRoot}/release/secrets`,
    logRoot: `${installRoot}/release/logs`,
    backupRoot: `${installRoot}/release/backups`,
    binRoot: `${installRoot}/release/bin`,
    plistPath: `${launchAgentsRoot}/${launchAgentLabel}.plist`,
    envFile: `${installRoot}/release/secrets/env`,
    launchAgentsRoot,
    launchAgentLabel,
  };
}

/**
 * Creates every directory in the layout with `0o700` and touches every file
 * with `0o600`. Idempotent: re-running on an existing install is a no-op.
 *
 * The Pi session directory is *not* created here.
 */
export function ensureInstallPaths(paths: InstallPaths, fs: FileSystemPort): void {
  const directories: readonly string[] = [
    paths.installRoot,
    `${paths.installRoot}/release`,
    paths.stateRoot,
    paths.secretsRoot,
    paths.logRoot,
    paths.backupRoot,
    paths.binRoot,
    paths.launchAgentsRoot,
  ];
  for (const dir of directories) {
    fs.mkdir(dir, { recursive: true, mode: DIRECTORY_MODE });
    fs.chmod(dir, DIRECTORY_MODE);
  }
  // Touch sensitive files so a fresh install leaves a 0o600 marker even
  // before config is written. We do not pre-create the plist or env file
  // because those are produced by their dedicated writers.
  touchFile(fs, paths.configFile);
}

function touchFile(fs: FileSystemPort, path: string): void {
  if (fs.exists(path)) {
    try {
      fs.chmod(path, FILE_MODE);
      return;
    } catch {
      // fall through and recreate
    }
  }
  fs.writeFile(path, Buffer.alloc(0), FILE_MODE);
}

/** Throws {@link InstallPathError} when the value is not absolute. */
export function assertAbsolute(label: string, value: string): void {
  if (!isAbsolute(value)) {
    throw new InstallPathError("not_absolute", `${label} must be an absolute path (got ${JSON.stringify(value)})`);
  }
  if (value.includes("\0")) {
    throw new InstallPathError("not_absolute", `${label} must not contain NUL (got ${JSON.stringify(value)})`);
  }
}

/** Throws when the value contains `..` path-traversal segments. */
export function assertNoTraversal(label: string, value: string): void {
  const segments = value.split("/");
  for (const segment of segments) {
    if (segment === "..") {
      throw new InstallPathError("traversal", `${label} contains path-traversal segment '..' (got ${JSON.stringify(value)})`);
    }
  }
}

/**
 * Combines {@link assertAbsolute} and {@link assertNoTraversal}; returns the
 * validated path so callers can chain.
 */
export function normalizeAbsolute(value: string, label: string): string {
  assertAbsolute(label, value);
  assertNoTraversal(label, value);
  return value;
}

/** Throws when the launchd label is malformed. */
export function assertLabel(label: string): void {
  if (label.length === 0 || label.length > 256) {
    throw new InstallPathError("not_absolute", `launchAgentLabel must be 1..256 chars (got ${label.length})`);
  }
  if (!/^[a-z0-9.-]+$/i.test(label)) {
    throw new InstallPathError(
      "not_absolute",
      `launchAgentLabel must match /^[a-z0-9.-]+$/i (got ${JSON.stringify(label)})`,
    );
  }
}

/**
 * Validates that `paths.installRoot` is the longest common ancestor of every
 * other path in the layout. Refuses install roots that escape themselves.
 */
export function assertPathsContained(paths: InstallPaths): void {
  for (const candidate of allPaths(paths)) {
    if (!candidate.startsWith(`${paths.installRoot}/`) && candidate !== paths.installRoot) {
      throw new InstallPathError(
        "outside_root",
        `path ${candidate} escapes installRoot ${paths.installRoot}`,
      );
    }
  }
}

function allPaths(paths: InstallPaths): readonly string[] {
  return [
    paths.installRoot,
    paths.configFile,
    paths.stateRoot,
    paths.secretsRoot,
    paths.logRoot,
    paths.backupRoot,
    paths.binRoot,
    paths.plistPath,
    paths.envFile,
    paths.launchAgentsRoot,
  ];
}
