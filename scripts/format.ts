#!/usr/bin/env bun
/** Repository formatting gate. */

import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const TEXT_EXTENSIONS = new Set([".dart", ".json", ".ts", ".yaml", ".yml"]);
const SKIP_DIRS = new Set([".dart_tool", ".git", ".omx", "build", "dist", "node_modules"]);

function textFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRS.has(entry) || (entry.startsWith(".") && entry !== ".github")) continue;
    const path = join(directory, entry);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) files.push(...textFiles(path));
    else if (TEXT_EXTENSIONS.has(extname(entry))) files.push(path);
  }
  return files;
}

function main(): number {
  for (const file of textFiles(ROOT)) {
    const text = readFileSync(file, "utf8");
    if (!text.endsWith("\n") || text.split("\n").some((line) => /[ \t]+$/.test(line))) {
      process.stderr.write(`format: whitespace drift in ${file.slice(ROOT.length)}\n`);
      return 1;
    }
  }

  const dart = Bun.which("dart");
  if (!dart) {
    process.stderr.write("format: Dart SDK is required\n");
    return 1;
  }
  const result = spawnSync(
    dart,
    ["format", "--output=none", "--set-exit-if-changed", "lib", "test"],
    { cwd: join(ROOT, "apps", "mobile"), stdio: "inherit" },
  );
  if (result.status !== 0) return result.status ?? 1;
  process.stdout.write("format ok\n");
  return 0;
}

if (import.meta.main) process.exit(main());
