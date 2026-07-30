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
const FLUTTER = Bun.which("flutter");

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

function bridgeIntegrationTests(dir: string): string[] {
  return readdirSync(join(dir, "test", "integration"))
    .filter((f) => f.endsWith(".test.ts"))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => join(dir, "test", "integration", file));
}

function run(
  label: string,
  cmd: readonly string[],
  cwd?: string,
  timeoutMs = 3 * 60_000,
): number {
  process.stdout.write(`==> ${label}\n`);
  const result = spawnSync(cmd[0]!, cmd.slice(1), {
    cwd: cwd ?? ROOT,
    stdio: "inherit",
    timeout: timeoutMs,
  });
  if (result.signal === "SIGTERM") {
    process.stderr.write(
      `==> ${label} timed out after ${Math.round(timeoutMs / 1000)} seconds\n`,
    );
  }
  return result.status ?? 1;
}

function runPackageTests(dir: string): number {
  if (dir === join(ROOT, "packages", "bridge")) {
    const nonIntegration = run(
      `bun test (${dir} without integration)`,
      ["bun", "test", "--path-ignore-patterns=test/integration/**"],
      dir,
    );
    if (nonIntegration !== 0) return nonIntegration;
    for (const file of bridgeIntegrationTests(dir)) {
      const code = run(`bun test (${file})`, ["bun", "test", file], dir);
      if (code !== 0) return code;
    }
    return 0;
  }
  return run(`bun test (${dir})`, ["bun", "test"], dir);
}

function main(): number {
  for (const dir of packageTestDirs()) {
    if (!hasTests(dir)) {
      process.stdout.write(`==> skip ${dir} (no test files)\n`);
      continue;
    }
    const code = runPackageTests(dir);
    if (code !== 0) return code;
  }
  const scriptsTestDir = join(ROOT, "scripts", "test");
  if (
    existsSync(scriptsTestDir) &&
    readdirSync(scriptsTestDir).some((f) =>
      f.endsWith(".test.ts") || f.endsWith(".spec.ts"),
    )
  ) {
    const code = run("bun test (scripts/test)", ["bun", "test"], scriptsTestDir);
    if (code !== 0) return code;
  }
  if (FLUTTER && existsSync(FLUTTER)) {
    // The full Flutter suite routinely approaches one minute before process
    // finalization. A larger bound avoids SIGTERM racing flutter_tools cleanup
    // while still preventing an indefinitely wedged CI job.
    const mobile = run(
      "flutter test (apps/mobile)",
      [FLUTTER, "test"],
      `${ROOT}/apps/mobile`,
      5 * 60_000,
    );
    if (mobile !== 0) return mobile;
  } else {
    process.stderr.write("flutter test unavailable: Flutter SDK is not installed\n");
    return 1;
  }
  process.stdout.write("test ok\n");
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
