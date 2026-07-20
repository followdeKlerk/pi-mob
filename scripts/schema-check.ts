#!/usr/bin/env bun
/**
 * Schema drift check.
 *
 * Regenerates the schema artefacts in a tmpdir (with a fixed timestamp so
 * the comparison is byte-stable) and diffs them against the checked-in
 * copies. Fails CI when any generated schema or catalogue differs.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const TARGET_DIR = `${ROOT}/packages/protocol-schema/generated`;
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
    const expected = readdirSync(TARGET_DIR).sort();
    const actual = readdirSync(tmp).sort();
    if (expected.join("\n") !== actual.join("\n")) {
      process.stderr.write("schema drift detected; run bun run schema:generate\n");
      return 1;
    }
    for (const file of expected) {
      if (readFileSync(join(TARGET_DIR, file), "utf8") !== readFileSync(join(tmp, file), "utf8")) {
        process.stderr.write(`schema drift detected in ${file}; run bun run schema:generate\n`);
        return 1;
      }
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
