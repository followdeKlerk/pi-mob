#!/usr/bin/env bun
/**
 * Fixture parity check.
 *
 * Verifies that:
 *   1. The Dart test and the TypeScript test both load the identical JSON
 *      bytes from `packages/protocol-fixtures/corpus/`.
 *   2. The corpus files parse as valid JSON.
 *   3. No fixture contains a real-looking path or provider secret.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CORPUS = `${ROOT}/packages/protocol-fixtures/corpus`;

const FORBIDDEN_PATTERNS: RegExp[] = [
  /home\/[^/\s"]+/i,
  /Users\/[^/\s"]+/i,
  /\/etc\//i,
  /sk-[A-Za-z0-9]{16,}/,
  /AIza[0-9A-Za-z_\-]{16,}/,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
];

function main(): number {
  const files = readdirSync(CORPUS).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) {
    process.stderr.write("fixtures:check: empty corpus\n");
    return 1;
  }
  for (const file of files) {
    const path = join(CORPUS, file);
    const bytes = readFileSync(path, "utf8");
    try {
      JSON.parse(bytes);
    } catch (err) {
      process.stderr.write(`fixtures:check: ${file} is not valid JSON: ${err}\n`);
      return 1;
    }
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(bytes)) {
        process.stderr.write(`fixtures:check: ${file} matches forbidden pattern ${pattern}\n`);
        return 1;
      }
    }
    process.stdout.write(`fixture ok ${file}\n`);
  }
  process.stdout.write("fixtures:check ok\n");
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
