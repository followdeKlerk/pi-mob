/**
 * Dependency-injection ports for the M7 install/lifecycle ops.
 *
 * Production code uses {@link createNodeFileSystemPort}, which delegates to
 * `node:fs`. Tests inject in-memory implementations so they run hermetically
 * without touching the real filesystem, the real user `~/Library` tree, or
 * `launchctl`.
 *
 * Every port is intentionally narrow: ops call exactly the methods they need
 * and never reach into a global `fs` module. That keeps the install flow
 * deterministic and lets tests assert on every observed filesystem event.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";

/** Snapshot returned by {@link FileSystemPort.stat}. */
export interface FileSystemStat {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly mode: number;
  readonly size: number;
  readonly mtimeMs: number;
}

/**
 * Filesystem surface used by every ops module.
 *
 * The port never throws on missing paths from `exists`/`stat`; instead it
 * returns `false`/throws a structured error that callers translate into a
 * typed ops error. `writeFile` and `mkdir` always accept an explicit mode;
 * callers must pass `0o600` for files and `0o700` for directories.
 */
export interface FileSystemPort {
  exists(path: string): boolean;
  stat(path: string): FileSystemStat;
  readFile(path: string): Buffer;
  writeFile(path: string, data: Buffer | string, mode: number): void;
  mkdir(path: string, options: { readonly recursive: boolean; readonly mode: number }): void;
  chmod(path: string, mode: number): void;
  rm(path: string, options: { readonly recursive: boolean; readonly force: boolean }): void;
  rename(from: string, to: string): void;
  readdir(path: string): readonly string[];
}

/** Minimal process surface. Ops never spawn shells; this exists for symmetry. */
export interface ProcessSpawnResult {
  readonly pid: number | undefined;
}

export interface ProcessPort {
  spawn(args: {
    readonly command: string;
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
    readonly cwd: string;
    readonly detached: boolean;
  }): ProcessSpawnResult;
}

/** Clock port so the test suite can pin time. */
export interface ClockPort {
  now(): number;
  iso(): string;
}

export function systemClock(): ClockPort {
  return {
    now: () => Date.now(),
    iso: () => new Date().toISOString(),
  };
}

/** Production implementation backed by `node:fs`. */
export function createNodeFileSystemPort(): FileSystemPort {
  return {
    exists(path) {
      try {
        return existsSync(path);
      } catch {
        return false;
      }
    },
    stat(path) {
      const s = statSync(path);
      return {
        isFile: s.isFile(),
        isDirectory: s.isDirectory(),
        mode: s.mode,
        size: s.size,
        mtimeMs: s.mtimeMs,
      };
    },
    readFile(path) {
      return readFileSync(path);
    },
    writeFile(path, data, mode) {
      writeFileSync(path, data, { mode });
    },
    mkdir(path, options) {
      mkdirSync(path, { recursive: options.recursive, mode: options.mode });
    },
    chmod(path, mode) {
      chmodSync(path, mode);
    },
    rm(path, options) {
      rmSync(path, { recursive: options.recursive, force: options.force });
    },
    rename(from, to) {
      renameSync(from, to);
    },
    readdir(path) {
      return readdirSync(path);
    },
  };
}

/**
 * No-op process port. The install/lifecycle ops never spawn the daemon or
 * `launchctl` themselves — that responsibility belongs to the launchd
 * integration code that is intentionally out of scope here. The port exists
 * so future modules can compose without rewriting the call sites.
 */
export function createNoopProcessPort(): ProcessPort {
  return {
    spawn() {
      return { pid: undefined };
    },
  };
}

/** Thrown when a path argument violates the absolute/owner-only invariants. */
export class InstallPathError extends Error {
  override readonly name: string = "InstallPathError";
  constructor(readonly code: "not_absolute" | "traversal" | "outside_root" | "mode_invalid", message: string) {
    super(message);
  }
}

/** Thrown when a configuration value fails structural validation. */
export class InstallConfigError extends Error {
  override readonly name: string = "InstallConfigError";
  constructor(readonly code: string, message: string) {
    super(message);
  }
}
