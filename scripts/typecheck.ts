#!/usr/bin/env bun
/**
 * Typecheck every TypeScript package and the root scripts using each
 * package's own `tsconfig.json`. The root `tsconfig.json` covers the
 * scripts and any source/test files not yet wired into a workspace
 * package.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const TSC = join(ROOT, "node_modules", ".bin", "tsc");

function packageDirs(): string[] {
  const packagesDir = join(ROOT, "packages");
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir)
    .map((name) => join(packagesDir, name))
    .filter((p) => statSync(p).isDirectory())
    .filter((p) => existsSync(join(p, "tsconfig.json")));
}

function tscProject(label: string, dir: string): number {
  process.stdout.write(`==> tsc --noEmit (${label})\n`);
  const result = spawnSync(TSC, ["--noEmit"], { cwd: dir, stdio: "inherit" });
  return result.status ?? 1;
}

function main(): number {
  let code = tscProject("root", ROOT);
  if (code !== 0) return code;
  for (const dir of packageDirs()) {
    code = tscProject(dir, dir);
    if (code !== 0) return code;
  }
  process.stdout.write("typecheck ok\n");
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
