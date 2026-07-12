#!/usr/bin/env bun
/**
 * Generate the protocol schema artefacts.
 *
 * M1 only emits a stub schema-manifest.json that the schema:check step can
 * compare against. The real TypeBox envelope generator, JSON Schema emitter,
 * and command/event catalogue land with M2.
 */

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
