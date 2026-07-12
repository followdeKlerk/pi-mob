#!/usr/bin/env bun
/**
 * Root format orchestrator.
 *
 * M1 placeholder: Bun 1.3.14 does not ship a built-in formatter. The repo
 * is small enough at M1 that hand-formatting is acceptable; the canonical
 * formatter is selected during M2 (likely `dprint` once Bun updates ship a
 * stable `bun fmt`). This script stays as the M1 entrypoint so the `all`
 * orchestrator and the future formatter can swap in without changing the
 * command surface.
 *
 * The script returns 0 when the tree is well-formed (no obvious issues
 * found by the placeholder check) and emits a notice about the future
 * formatter selection.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

function main(): number {
  process.stdout.write("format: M1 placeholder (formatter selected during M2)\n");
  const tsconfigRoot = join(ROOT, "tsconfig.json");
  if (!existsSync(tsconfigRoot)) {
    process.stderr.write(`format: missing root ${tsconfigRoot}\n`);
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
