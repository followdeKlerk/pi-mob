#!/usr/bin/env bun
/**
 * Phase 1 sensitive-identifier scan over the public docs and source
 * touched by the Phase 1 change set.
 *
 * The scan is intentionally limited to the explicit allow-list of
 * files below so it stays scoped to the Phase 1 PR. It refuses to
 * echo any secret value; the only output is the file path and the
 * pattern name that matched.
 *
 * Patterns detected:
 *   - provider API keys (sk-, AIza, ghp_, glpat-, xoxb-, etc.),
 *   - APNs/FCM private key blocks,
 *   - absolute personal paths (`/Users/<name>/...`),
 *   - Tailscale tailnet hostnames (`*.ts.net`),
 *   - IP literals,
 *   - Firebase project / app identifiers.
 *
 * The script is deliberately a single Bun program with no extra
 * dependencies so it can run on the minimal CI harness.
 */

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

const PHASE1_FILES: readonly string[] = [
  "README.md",
  "SECURITY.md",
  "package.json",
  "scripts/all.ts",
  "scripts/phase1-doc-check.ts",
  "scripts/test/phase1-doc-check.test.ts",
  "docs/ARCHITECTURE.md",
  "docs/CHANGELOG.md",
  "docs/PRIVACY.md",
  "docs/PROJECT_STATUS.md",
  "docs/PROTOCOL.md",
  "docs/QUICKSTART.md",
  "apps/mobile/README.md",
  "apps/mobile/lib/src/ui/shell/app_shell.dart",
  "apps/mobile/lib/src/ui/shell/shortcut_intents.dart",
  "apps/mobile/test/ui/r12_shortcuts_test.dart",
  "packages/bridge/README.md",
];

// The scanner owns its own pattern catalogue, so it intentionally
// matches its own literal regex sources. It is excluded from the
// file list above to avoid spurious self-hits.

const PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "openai-sk", re: /sk-[A-Za-z0-9]{16,}/ },
  { name: "anthropic-sk", re: /sk-ant-[A-Za-z0-9\-]{16,}/ },
  { name: "google-api", re: /AIza[0-9A-Za-z_\-]{16,}/ },
  { name: "github-pat", re: /ghp_[A-Za-z0-9]{16,}/ },
  { name: "gitlab-pat", re: /glpat-[A-Za-z0-9_\-]{16,}/ },
  { name: "slack-token", re: /xox[baprs]-[A-Za-z0-9\-]{10,}/ },
  { name: "apns-p8", re: /-----BEGIN PRIVATE KEY-----/ },
  { name: "personal-path", re: /\/Users\/[A-Za-z0-9._-]+\// },
  { name: "tailscale-hostname", re: /[A-Za-z0-9-]+\.ts\.net\b/ },
  { name: "ip-literal", re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/ },
  { name: "firebase-appid", re: /\b1:[0-9]+:android:[0-9a-f]{16}\b/ },
  { name: "firebase-project-id", re: /\/projects\/[a-z0-9-]{6,30}\/messages:send/ },
];

interface Hit {
  readonly file: string;
  readonly pattern: string;
  readonly line: number;
  readonly column: number;
}

function scan(file: string): Hit[] {
  const full = join(ROOT, file);
  let text: string;
  try {
    text = readFileSync(full, "utf8");
  } catch {
    return [];
  }
  const hits: Hit[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    for (const { name, re } of PATTERNS) {
      const match = line.match(re);
      if (match && match.index !== undefined) {
        hits.push({
          file: relative(ROOT, full),
          pattern: name,
          line: i + 1,
          column: match.index + 1,
        });
      }
    }
  }
  return hits;
}

function main(): number {
  const hits: Hit[] = [];
  for (const file of PHASE1_FILES) hits.push(...scan(file));
  if (hits.length === 0) {
    process.stdout.write("phase1:sensitive-scan ok\n");
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(
      `phase1:sensitive-scan ${hit.pattern} ${hit.file}:${hit.line}:${hit.column}\n`,
    );
  }
  process.stderr.write(`phase1:sensitive-scan ${hits.length} hit(s)\n`);
  return 1;
}

if (import.meta.main) {
  process.exit(main());
}
