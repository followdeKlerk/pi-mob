#!/usr/bin/env bun
/**
 * Root lint orchestrator.
 *
 * Runs strict TypeScript checks for scripts and Dart analysis for mobile.
 * Both toolchains are required by the cross-language checkpoint gate.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const TSC = join(ROOT, "node_modules", ".bin", "tsc");
const DART = Bun.which("dart") ?? Bun.which("flutter")?.replace(/\/flutter$/, "/cache/dart-sdk/bin/dart");

interface Step {
  readonly label: string;
  readonly cmd: readonly string[];
  readonly cwd?: string;
  readonly optional: boolean;
}

function buildSteps(): Step[] {
  const steps: Step[] = [
    {
      label: "tsc --noEmit (scripts)",
      cmd: [TSC, "--noEmit", "--project", "scripts/tsconfig.json"],
      optional: false,
    },
  ];
  if (DART && existsSync(DART)) {
    steps.push({
      label: "dart analyze",
      cmd: [DART, "analyze"],
      cwd: "apps/mobile",
      optional: false,
    });
  }
  return steps;
}

function run(step: Step): number {
  process.stdout.write(`==> ${step.label}\n`);
  const result = spawnSync(step.cmd[0]!, step.cmd.slice(1), {
    cwd: step.cwd ? `${ROOT}/${step.cwd}` : ROOT,
    stdio: "inherit",
    timeout: 60_000,
  });
  const code = result.status ?? 1;
  if (code !== 0) {
    if (result.error || result.signal === "SIGTERM") {
      process.stderr.write(`<== ${step.label} unavailable: SDK command did not become runnable within 60 seconds\n`);
    }
    return code;
  }
  return 0;
}

function main(): number {
  if (!DART || !existsSync(DART)) {
    process.stderr.write("dart analyze unavailable: Flutter Dart SDK is required\n");
    return 1;
  }
  for (const step of buildSteps()) {
    const code = run(step);
    if (code !== 0) return code;
  }
  process.stdout.write("lint ok\n");
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
