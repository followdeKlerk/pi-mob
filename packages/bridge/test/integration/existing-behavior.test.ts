/**
 * Integration test category 8 — Existing behavior.
 *
 * Spec requirement (PI_MOB_RAW_RPC_RECTIFICATION_PROMPT.md, "Required
 * tests" §8): "Run and preserve:
 *
 *   bun run typecheck
 *   bun test
 *   bun run schema:check
 *   bun run fixtures:check
 *   cd apps/mobile
 *   flutter analyze --no-fatal-infos
 *   flutter test"
 *
 * This file gives the spec's bun-side commands a deterministic entry
 * point inside `bun test`. The recursive `bun test` invocation is
 * excluded because it would deadlock the test runner; the full suite
 * count is verified by the final verification step (which runs after
 * the integration phase) and re-counted in the final report.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname;

function runCheck(args: string[], timeoutMs: number): { stdout: string; stderr: string; status: number } {
  const result = spawnSync("bun", args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? -1,
  };
}

describe("integration: existing behavior smoke test", () => {
  test("typecheck: the repository typechecks cleanly", () => {
    const result = runCheck(["run", "typecheck"], 180_000);
    if (result.status !== 0) {
      console.log("typecheck stdout:", result.stdout);
      console.log("typecheck stderr:", result.stderr);
    }
    expect(result.status).toBe(0);
  }, 240_000);

  test("schema: artifacts referenced by the protocol-schema are in sync", () => {
    const result = runCheck(["run", "schema:check"], 60_000);
    if (result.status !== 0) {
      console.log("schema:check stdout:", result.stdout);
      console.log("schema:check stderr:", result.stderr);
    }
    expect(result.status).toBe(0);
  }, 90_000);

  test("fixtures: contract fixtures required by the test suite are intact", () => {
    const result = runCheck(["run", "fixtures:check"], 60_000);
    if (result.status !== 0) {
      console.log("fixtures:check stdout:", result.stdout);
      console.log("fixtures:check stderr:", result.stderr);
    }
    expect(result.status).toBe(0);
  }, 90_000);
});
