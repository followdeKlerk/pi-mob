/**
 * Allowlisted environment builder for the daemon LaunchAgent.
 *
 * The bridge subprocess (Pi RPC, the daemon itself) never inherits the user
 * shell environment. This module produces the exact `Record<string,string>`
 * map that the LaunchAgent and the supervised RPC subprocess will receive.
 *
 * Rules:
 *
 *   1. Only allow-listed keys may appear. Every other key is dropped.
 *   2. `LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_INSERT_LIBRARIES`,
 *      `DYLD_LIBRARY_PATH`, `NODE_OPTIONS`, `BUN_CONFIG_*`, `PI_*` injection
 *      keys are always refused.
 *   3. `PATH` is *rebuilt* from `pathDirs`, not inherited.
 *   4. Values must be printable ASCII or UTF-8 without control characters.
 */

export const DEFAULT_ENV_ALLOWLIST: readonly string[] = [
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "USER",
  "LOGNAME",
  "XDG_RUNTIME_DIR",
];

export const FORBIDDEN_ENV_KEYS: readonly string[] = [
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PYTHONPATH",
  "RUBYOPT",
  "BUN_CONFIG",
  "BUN_LOCKFILE_VERSION",
  "BUN_INSTALL",
];

export const PATH_ENV_KEY = "PATH";

export interface BuildEnvironmentOptions {
  /** Allow-list override. Defaults to {@link DEFAULT_ENV_ALLOWLIST}. */
  readonly allowlist?: readonly string[];
  /** Additional allow-listed entries to merge in (still subject to forbidden check). */
  readonly extras?: Readonly<Record<string, string>>;
  /** Ordered list of directories that compose `PATH`. */
  readonly pathDirs: readonly string[];
  /** Optional source map; only entries whose key is in the allow-list are copied. */
  readonly source?: Readonly<Record<string, string | undefined>>;
  /** Optional override for `HOME`; the allow-list check still applies. */
  readonly home?: string;
  /** Optional override for `TMPDIR`. */
  readonly tmpdir?: string;
  /** Optional override for `LANG`. */
  readonly lang?: string;
  /** Optional override for `TZ`. */
  readonly tz?: string;
}

export interface EnvironmentBuildResult {
  readonly env: Readonly<Record<string, string>>;
  readonly pathDirs: readonly string[];
  readonly rejectedKeys: readonly string[];
  readonly forbiddenKeys: readonly string[];
}

/**
 * Builds the allow-listed environment. The returned map is immutable from
 * the caller's perspective; mutations require a re-build.
 */
export function buildEnvironment(options: BuildEnvironmentOptions): EnvironmentBuildResult {
  if (options.pathDirs.length === 0) {
    throw new EnvironmentBuildError("path_dirs", "pathDirs must contain at least one absolute directory");
  }
  for (const dir of options.pathDirs) {
    if (!isAbsolutePath(dir)) {
      throw new EnvironmentBuildError("path_dirs", `pathDirs entry must be absolute: ${JSON.stringify(dir)}`);
    }
    if (dir.includes("\0")) {
      throw new EnvironmentBuildError("path_dirs", `pathDirs entry must not contain NUL: ${JSON.stringify(dir)}`);
    }
  }
  const allow = new Set<string>(options.allowlist ?? DEFAULT_ENV_ALLOWLIST);
  allow.add(PATH_ENV_KEY);
  const forbidden = new Set<string>(FORBIDDEN_ENV_KEYS);
  for (const key of Object.keys(options.extras ?? {})) {
    if (forbidden.has(key)) {
      throw new EnvironmentBuildError("forbidden", `extras key is forbidden: ${key}`);
    }
    if (key !== key.toUpperCase()) {
      throw new EnvironmentBuildError("extras", `extras key must be uppercase: ${key}`);
    }
    allow.add(key);
  }
  for (const key of allow) {
    if (forbidden.has(key)) {
      throw new EnvironmentBuildError("forbidden", `allow-list contains forbidden key: ${key}`);
    }
  }

  const env: Record<string, string> = {};
  const rejectedKeys: string[] = [];
  const source = options.source ?? {};
  for (const [rawKey, value] of Object.entries(source)) {
    const key = rawKey.toUpperCase();
    if (!allow.has(key)) {
      rejectedKeys.push(rawKey);
      continue;
    }
    if (forbidden.has(key)) {
      rejectedKeys.push(rawKey);
      continue;
    }
    if (value === undefined) continue;
    env[key] = value;
  }

  // Apply explicit overrides last so they win over `source`.
  if (options.home !== undefined) env.HOME = options.home;
  if (options.tmpdir !== undefined) env.TMPDIR = options.tmpdir;
  if (options.lang !== undefined) env.LANG = options.lang;
  if (options.tz !== undefined) env.TZ = options.tz;

  if (options.extras) {
    for (const [key, value] of Object.entries(options.extras)) {
      env[key] = value;
    }
  }

  env[PATH_ENV_KEY] = options.pathDirs.join(":");
  validateEnvironment(env);
  return {
    env: Object.freeze({ ...env }),
    pathDirs: Object.freeze([...options.pathDirs]),
    rejectedKeys: Object.freeze([...rejectedKeys]),
    forbiddenKeys: Object.freeze(FORBIDDEN_ENV_KEYS.filter((key) => forbidden.has(key))),
  };
}

/**
 * Validates that every value is printable. Throws on control characters,
 * NUL, or empty values.
 */
export function validateEnvironment(env: Readonly<Record<string, string>>): void {
  for (const [key, value] of Object.entries(env)) {
    if (value.length === 0) {
      throw new EnvironmentBuildError("empty_value", `env value for ${key} must not be empty`);
    }
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code === 0) {
        throw new EnvironmentBuildError("nul_value", `env value for ${key} must not contain NUL`);
      }
      if (code < 0x20 && code !== 0x09) {
        throw new EnvironmentBuildError("control_value", `env value for ${key} contains control character 0x${code.toString(16)}`);
      }
    }
  }
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/");
}

/** Thrown when an environment build step fails. */
export class EnvironmentBuildError extends Error {
  override readonly name = "EnvironmentBuildError";
  constructor(readonly code: string, message: string) {
    super(message);
  }
}
