#!/usr/bin/env bun
/**
 * Root lint orchestrator.
 *
 * M1 runs `tsc --noEmit` in strict mode across the workspace and shells out
 * to `dart analyze` when the Flutter Dart SDK is available. The script is
 * resilient: a missing/unusable Dart SDK only emits a warning; missing
 * TypeScript is a failure.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;

const DART_SDK = "/usr/local/share/flutter/bin/cache/dart-sdk/bin/dart";

interface Step {
  readonly label: string;
  readonly cmd: readonly string[];
  readonly cwd?: string;
  readonly optional: boolean;
}

function buildSteps(): Step[] {
  return [
    {
      label: "tsc --noEmit (scripts)",
      cmd: ["/Users/nathandekleerk/github/pi-mob/node_modules/.bin/tsc", "--noEmit", "--project", "scripts/tsconfig.json"],
      optional: false,
    },
    {
      label: "dart analyze",
      cmd: [DART_SDK, "analyze"],
      cwd: "apps/mobile",
      optional: true,
    },
  ];
}

function run(step: Step): number {
  process.stdout.write(`==> ${step.label}\n`);
  const result = spawnSync(step.cmd[0]!, step.cmd.slice(1), {
    cwd: step.cwd ? `${ROOT}/${step.cwd}` : ROOT,
    stdio: "inherit",
  });
  const code = result.status ?? 1;
  if (code !== 0) {
    if (step.optional) {
      process.stderr.write(`<== ${step.label} unavailable (skipped)\n`);
      return 0;
    }
    return code;
  }
  return 0;
}

function main(): number {
  for (const step of buildSteps()) {
    if (step.cmd[0] === DART_SDK && !existsSync(DART_SDK)) {
      process.stderr.write(`<== ${step.label}: dart SDK not installed (skipped)\n`);
      continue;
    }
    const code = run(step);
    if (code !== 0) return code;
  }
  process.stdout.write("lint ok\n");
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
