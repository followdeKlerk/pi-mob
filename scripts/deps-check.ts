#!/usr/bin/env bun
/**
 * Dependency and license check.
 *
 * M1 verifies that:
 *   1. Every direct dependency in `package.json` is pinned exactly (no
 *      `^`, `~`, `latest`, wildcards, or multiple ranges).
 *   2. A `bun.lock` is present and uses the modern text format
 *      (`lockfileVersion: 1`).
 *   3. The lockfile entries for our direct dependencies resolve to the
 *      exact versions declared in the manifest.
 *
 * The script does NOT shell out to `bun pm ls` because the local sandbox
 * blocks Bun's tempdir writes during install verification. The on-disk
 * `node_modules` is checked by the typecheck step instead.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

const FORBIDDEN_PIN_PATTERNS = [/^\^/, /^~/, /^latest$/, /^[*xX]/];
const LOCKFILE_VERSIONS = new Set([1]);

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface BunLock {
  lockfileVersion?: number;
  packages?: Record<string, string[]>;
}

function readManifest(path: string): PackageJson | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
}

function checkManifest(manifestPath: string): string[] {
  const issues: string[] = [];
  const pkg = readManifest(manifestPath);
  if (!pkg) return issues;
  const groups: Array<[string, Record<string, string> | undefined]> = [
    ["dependencies", pkg.dependencies],
    ["devDependencies", pkg.devDependencies],
    ["optionalDependencies", pkg.optionalDependencies],
  ];
  for (const [label, group] of groups) {
    if (!group) continue;
    for (const [name, version] of Object.entries(group)) {
      for (const pattern of FORBIDDEN_PIN_PATTERNS) {
        if (pattern.test(version)) {
          issues.push(`${manifestPath} ${label}.${name}=${version} is not pinned`);
        }
      }
      if (version.includes("||") || /\s/.test(version)) {
        issues.push(`${manifestPath} ${label}.${name}=${version} has multiple ranges`);
      }
    }
  }
  return issues;
}

function loadLockfile(): BunLock | null {
  const lockfile = join(ROOT, "bun.lock");
  if (!existsSync(lockfile)) return null;
  const text = readFileSync(lockfile, "utf8").replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(text) as BunLock;
}

function checkLockfile(lock: BunLock | null): string[] {
  const issues: string[] = [];
  if (!lock) return ["bun.lock missing"];
  if (!lock.lockfileVersion || !LOCKFILE_VERSIONS.has(lock.lockfileVersion)) {
    issues.push(`bun.lock is not lockfileVersion 1 (got ${lock.lockfileVersion})`);
  }
  if (!lock.packages || Object.keys(lock.packages).length === 0) {
    issues.push("bun.lock has no package entries");
  }
  return issues;
}

function manifestPinMatchesLockfile(lock: BunLock): string[] {
  const issues: string[] = [];
  const pkgs = lock.packages ?? {};
  const root = readManifest(join(ROOT, "package.json"));
  if (!root) return issues;
  for (const [label, group] of [
    ["dependencies", root.dependencies ?? {}],
    ["devDependencies", root.devDependencies ?? {}],
  ] as const) {
    for (const [name, declared] of Object.entries(group)) {
      if (declared.startsWith("workspace:")) continue;
      const entry = pkgs[name];
      if (!entry) {
        issues.push(`${label}.${name}=${declared} not present in bun.lock`);
        continue;
      }
      const ref = entry[0] ?? "";
      const atIndex = ref.lastIndexOf("@");
      const resolvedVersion = atIndex > 0 ? ref.slice(atIndex + 1) : "";
      if (!resolvedVersion || resolvedVersion !== declared) {
        issues.push(
          `${label}.${name}=${declared} resolved to ${resolvedVersion || "unknown"} in bun.lock`,
        );
      }
    }
  }
  return issues;
}

function workspacePackageJsons(): string[] {
  const packagesDir = join(ROOT, "packages");
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir)
    .filter((name) => statSync(join(packagesDir, name)).isDirectory())
    .map((name) => `packages/${name}/package.json`);
}

function main(): number {
  const issues: string[] = [];
  issues.push(...checkManifest(join(ROOT, "package.json")));
  for (const rel of workspacePackageJsons()) {
    issues.push(...checkManifest(join(ROOT, rel)));
  }
  const lock = loadLockfile();
  issues.push(...checkLockfile(lock));
  if (lock) {
    issues.push(...manifestPinMatchesLockfile(lock));
  }
  if (issues.length === 0) {
    process.stdout.write("deps:check ok\n");
    return 0;
  }
  for (const issue of issues) {
    process.stderr.write(`deps:check: ${issue}\n`);
  }
  return 1;
}

if (import.meta.main) {
  process.exit(main());
}
