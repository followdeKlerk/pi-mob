#!/usr/bin/env bun
/** Validates relative links in the public documentation set. */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const TARGETS = ["README.md", "CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md", "docs", "apps/mobile/README.md", "packages/bridge/README.md", "packages/pi-extension/README.md", "packages/protocol-schema/README.md", "packages/protocol-fixtures/README.md"];

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (path.endsWith(".md")) files.push(path);
  }
  return files;
}

function markdownFiles(): string[] {
  return TARGETS.flatMap((target) => {
    const path = join(ROOT, target);
    if (!existsSync(path)) return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function main(): number {
  const expression = /\[[^\]]+\]\(([^)]+)\)/g;
  let failed = false;
  for (const file of markdownFiles()) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      for (const match of lines[index]!.matchAll(expression)) {
        const link = match[1]!;
        if (/^[a-z]+:\/\//i.test(link) || link.startsWith("mailto:") || link.startsWith("#")) continue;
        const target = link.split("#")[0]!;
        if (target && !existsSync(join(file, "..", target))) {
          process.stderr.write(`docs:check link: ${relative(ROOT, file)}:${index + 1} ${link} (missing target)\n`);
          failed = true;
        }
      }
    }
  }
  if (!failed) process.stdout.write("docs:check ok\n");
  return failed ? 1 : 0;
}

if (import.meta.main) process.exit(main());
