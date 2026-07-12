#!/usr/bin/env bun
/**
 * Top-level M1 validation entrypoint.
 *
 * Runs every static, fixture, documentation, security, dependency, schema
 * drift, unit, and Bun-compiled-bridge check. Exits non-zero when any
 * individual step fails. Flutter checks are optional and skipped when the
 * SDK is not runnable on the host.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

const SEQUENCE: Array<{ label: string; cmd: readonly string[]; optional: boolean }> = [
  { label: "setup", cmd: ["bun", "run", "scripts/setup.ts"], optional: false },
  { label: "format", cmd: ["bun", "run", "scripts/format.ts"], optional: false },
  { label: "lint", cmd: ["bun", "run", "scripts/lint.ts"], optional: false },
  { label: "typecheck", cmd: ["bun", "run", "scripts/typecheck.ts"], optional: false },
  { label: "fixtures:check", cmd: ["bun", "run", "scripts/fixtures-check.ts"], optional: false },
  { label: "schema:check", cmd: ["bun", "run", "scripts/schema-check.ts"], optional: false },
  { label: "docs:check", cmd: ["bun", "run", "scripts/docs-check.ts"], optional: false },
  { label: "security:check", cmd: ["bun", "run", "scripts/security-check.ts"], optional: false },
  { label: "deps:check", cmd: ["bun", "run", "scripts/deps-check.ts"], optional: false },
  { label: "test", cmd: ["bun", "run", "scripts/test.ts"], optional: false },
  { label: "build", cmd: ["bun", "run", "scripts/build.ts"], optional: false },
];

function run(label: string, cmd: readonly string[]): number {
  process.stdout.write(`\n==== ${label} ====\n`);
  const result = spawnSync(cmd[0]!, cmd.slice(1), {
    cwd: ROOT,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

function main(): number {
  if (!existsSync(join(ROOT, "node_modules"))) {
    process.stderr.write("all: node_modules missing; running bun install first\n");
    const install = spawnSync("bun", ["install"], { cwd: ROOT, stdio: "inherit" });
    if (install.status !== 0) return install.status ?? 1;
  }
  for (const step of SEQUENCE) {
    const code = run(step.label, step.cmd);
    if (code !== 0) {
      if (step.optional) continue;
      process.stderr.write(`all: ${step.label} failed with exit ${code}\n`);
      return code;
    }
  }
  process.stdout.write("\nall ok\n");
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
