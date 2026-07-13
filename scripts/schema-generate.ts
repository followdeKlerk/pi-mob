#!/usr/bin/env bun
/** Generate deterministic protocol schemas and catalogue artefacts. */

import { spawnSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;

function main(): number {
  const result = spawnSync("bun", ["run", "cmd/generate.ts"], {
    cwd: `${ROOT}/packages/protocol-schema`,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

if (import.meta.main) {
  process.exit(main());
}
