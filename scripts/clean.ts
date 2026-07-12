#!/usr/bin/env bun
/**
 * Clean orchestrator. Removes generated artefacts and Bun-managed
 * dependencies. Flutter's build cache is intentionally left in place to
 * match the platform default; `flutter clean` is available per-package.
 */

import { existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const TARGETS = ["node_modules", "packages/bridge/dist", "packages/protocol-schema/generated", "build"];

function safeRm(target: string): void {
  const full = join(ROOT, target);
  if (!existsSync(full)) return;
  rmSync(full, { recursive: true, force: true });
  process.stdout.write(`clean ${target}\n`);
}

function main(): number {
  for (const t of TARGETS) safeRm(t);
  // Strip generated per-package node_modules dirs only at the top level
  // (the workspace root's `node_modules` is removed above). The workspace
  // root owns the dependency tree.
  const packagesDir = join(ROOT, "packages");
  if (existsSync(packagesDir)) {
    for (const name of readdirSync(packagesDir)) {
      const full = join(packagesDir, name);
      if (!statSync(full).isDirectory()) continue;
      const nm = join(full, "node_modules");
      if (existsSync(nm)) {
        rmSync(nm, { recursive: true, force: true });
        process.stdout.write(`clean packages/${name}/node_modules\n`);
      }
    }
  }
  process.stdout.write("clean ok\n");
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
