#!/usr/bin/env bun
/**
 * Test orchestrator. Runs `bun test` in every TS package that declares tests.
 * Skips packages that have no test files. The Flutter test suite is run via
 * the separate mobile workflow when the SDK is available on the host.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

function packageTestDirs(): string[] {
  const packagesDir = join(ROOT, "packages");
  return readdirSync(packagesDir)
    .map((name) => join(packagesDir, name))
    .filter((p) => statSync(p).isDirectory())
    .filter((p) => existsSync(join(p, "test")));
}

function hasTests(dir: string): boolean {
  return readdirSync(join(dir, "test")).some((f) =>
    f.endsWith(".test.ts") || f.endsWith(".spec.ts"),
  );
}

function run(label: string, cmd: readonly string[], cwd?: string): number {
  process.stdout.write(`==> ${label}\n`);
  const result = spawnSync(cmd[0]!, cmd.slice(1), {
    cwd: cwd ?? ROOT,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

function main(): number {
  for (const dir of packageTestDirs()) {
    if (!hasTests(dir)) {
      process.stdout.write(`==> skip ${dir} (no test files)\n`);
      continue;
    }
    const code = run(`bun test (${dir})`, ["bun", "test"], dir);
    if (code !== 0) return code;
  }
  process.stdout.write("test ok\n");
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
