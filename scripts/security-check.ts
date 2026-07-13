#!/usr/bin/env bun
/**
 * Security/privacy scan.
 *
 * Rejects tracked files containing:
 *   - provider API keys (sk-, AIza, ghp_, glpat-, xoxb-, etc.),
 *   - APNs/FCM private key blocks,
 *   - absolute personal paths (`/Users/<name>/...`).
 *
 * Files marked with the `pi-mob:security-test-fixture` marker are
 * intentionally allowlisted: they exist solely to validate that the
 * scanner recognises the literal shapes it should reject elsewhere.
 *
 * The scan walks the working tree without depending on `git` so it also
 * runs on freshly-cloned CI agents. The scanner is allowlisted for
 * `docs/compatibility/` (existing evidence), `apps/mobile/ios/Flutter/`
 * (Flutter-generated host paths during development), and `scripts/`
 * (the scanner itself owns the pattern catalogue).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

const ALLOWLIST = new Set([
  "docs/compatibility",
  ".git",
  "node_modules",
  ".dart_tool",
  ".flutter-plugins-dependencies",
  "build",
  ".neuralmemory",
  ".omx",
  ".tmp",
  ".bun-install",
  ".bun-cache",
  "dist",
]);

const ALLOWLIST_PATH_PREFIXES = [
  "apps/mobile/ios/Flutter/",
  "apps/mobile/android/",
  "scripts/",
];

const TEST_FIXTURE_MARKER = "pi-mob:security-test-fixture";

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "openai-sk", re: /sk-[A-Za-z0-9]{16,}/ },
  { name: "anthropic-sk", re: /sk-ant-[A-Za-z0-9\-]{16,}/ },
  { name: "google-api", re: /AIza[0-9A-Za-z_\-]{16,}/ },
  { name: "github-pat", re: /ghp_[A-Za-z0-9]{16,}/ },
  { name: "gitlab-pat", re: /glpat-[A-Za-z0-9_\-]{16,}/ },
  { name: "slack-token", re: /xox[baprs]-[A-Za-z0-9\-]{10,}/ },
  { name: "apns-p8", re: /-----BEGIN PRIVATE KEY-----/ },
  { name: "personal-path", re: /\/Users\/[A-Za-z0-9._-]+\/[^\s'"`<>]*/ },
];

function isAllowlisted(relPath: string): boolean {
  for (const prefix of ALLOWLIST_PATH_PREFIXES) {
    if (relPath.startsWith(prefix)) return true;
  }
  return false;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (ALLOWLIST.has(entry)) continue;
    const full = join(dir, entry);
    if (tryIsDir(full)) {
      out.push(...walk(full));
    } else if (tryFileSize(full) < 1_000_000) {
      out.push(full);
    }
  }
  return out;
}

function tryIsDir(p: string): boolean {
  try {
    const entries = readdirSync(p);
    return Array.isArray(entries);
  } catch {
    return false;
  }
}

function tryFileSize(p: string): number {
  try {
    return Bun.file(p).size ?? 0;
  } catch {
    return 0;
  }
}

function main(): number {
  const files = walk(ROOT);
  let code = 0;
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (isAllowlisted(rel)) continue;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (text.includes(TEST_FIXTURE_MARKER)) continue;
    for (const { name, re } of PATTERNS) {
      if (re.test(text)) {
        process.stderr.write(
          `security:check ${name} in ${rel}\n`,
        );
        code = 1;
      }
    }
  }
  if (code === 0) process.stdout.write("security:check ok\n");
  return code;
}

if (import.meta.main) {
  process.exit(main());
}
