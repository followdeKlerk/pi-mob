#!/usr/bin/env bun
/**
 * Schema drift check.
 *
 * Regenerates the schema artefacts in a tmpdir (with a fixed timestamp so
 * the comparison is byte-stable) and diffs them against the checked-in
 * copies. Fails CI when the diff is non-empty. The real M2 generator lands
 * later; this placeholder only validates the deterministic-emit invariant.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const TARGET = `${ROOT}/packages/protocol-schema/generated/schema-manifest.json`;
const FIXED_TS = "2026-07-12T00:00:00.000Z";

function regenerate(into: string): void {
  const result = spawnSync("bun", ["run", "cmd/generate.ts"], {
    cwd: `${ROOT}/packages/protocol-schema`,
    env: {
      ...process.env,
      PROTOCOL_SCHEMA_OUT_DIR: into,
      PROTOCOL_SCHEMA_FIXED_TIMESTAMP: FIXED_TS,
    },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("regenerate failed");
  }
}

function main(): number {
  const tmp = mkdtempSync(join(tmpdir(), "schema-check-"));
  try {
    regenerate(tmp);
    const a = readFileSync(TARGET, "utf8");
    const b = readFileSync(join(tmp, "schema-manifest.json"), "utf8");
    if (a !== b) {
      process.stderr.write("schema drift detected; run bun run schema:generate\n");
      process.stderr.write(`--- checked-in\n${a}\n--- regenerated\n${b}\n`);
      return 1;
    }
    process.stdout.write("schema:check ok\n");
    return 0;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  process.exit(main());
}
