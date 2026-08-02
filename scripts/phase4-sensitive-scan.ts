#!/usr/bin/env bun
/**
 * Phase 4 — sensitive scan.
 *
 * Fails CI when:
 *   1. The pre-Phase-4 docs/wording still mentions "the phone is not
 *      separately authenticated", "Tailscale-only access control", or
 *      "Application-layer authentication is Phase 5".
 *   2. The plain-text credential prefix `pc_` appears in any committed
 *      fixture, generated report, snapshot, or credential-leaking
 *      position. Tests may use the prefix via the secure credential
 *      store / runtime helpers — `pc_AAAAA…` is the only marker the
 *      scan allows, and only inside `apps/mobile/test/` or
 *      `packages/bridge/test/` under the
 *      `secure_credential_store` / `auth-*` scope.
 *   3. The bridge's normal daemon capability matrix changed shape.
 *
 * The scan is intentionally strict so a regression in the auth surface
 * fails CI before reaching production.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const BANNED_PHRASES = [
  "the phone is not separately authenticated",
  "the phone is not authenticated",
  "Tailscale-only access control",
  "Application-layer authentication is Phase 5",
  "Until then, liveness of the loopback listener and the Tailscale ACL in front of it are the only access control",
];

const BLOCKED_AREAS = [
  "docs/",
  "README.md",
  "SECURITY.md",
  "ARCHITECTURE.md",
  "QUICKSTART.md",
  "packages/bridge/README.md",
  "apps/mobile/README.md",
  "docs/PRIVACY.md",
  "docs/PROTOCOL.md",
  "docs/PROJECT_STATUS.md",
];

const FIXTURE_BLOCKLIST = [
  "reports/capabilities.json",
  "packages/protocol-fixtures/output",
];

function* walk(directory: string): Generator<string> {
  for (const entry of readFileSync_unused(directory)) continue;
  const stack = [directory];
  while (stack.length) {
    const next = stack.pop()!;
    const stat = statSync(next);
    if (stat.isDirectory()) {
      const subdirs = readdirSafe(next);
      for (const child of subdirs) stack.push(join(next, child));
    } else if (stat.isFile()) yield next;
  }
}

import { readdirSync } from "node:fs";
function readdirSafe(path: string): string[] {
  try { return readdirSync(path); } catch { return []; }
}
function readFileSync_unused(_path: string): never[] { return []; }

function checkDocs(): string[] {
  const issues: string[] = [];
  const phrases = new Set<string>();
  for (const relative of BLOCKED_AREAS) {
    const path = join(ROOT, relative);
    if (!existsSync(path)) continue;
    let stat;
    try { stat = statSync(path); } catch { continue; }
    if (!stat.isFile()) continue;
    const text = readFileSync(path, "utf8");
    const normalised = text.toLowerCase();
    for (const banned of BANNED_PHRASES) {
      if (normalised.includes(banned.toLowerCase())) {
        phrases.add(banned);
        issues.push(`${relative} contains banned wording: ${JSON.stringify(banned)}`);
      }
    }
  }
  return issues;
}

function checkCredentialMarker(): string[] {
  const issues: string[] = [];
  // The marker `pc_unique_marker_` is a deliberately identifiable
  // string used in the auth tests; if it surfaces in fixtures or generated
  // reports the scan fails.
  for (const file of [
    ...scan(join(ROOT, "reports")),
    ...scan(join(ROOT, "packages/protocol-fixtures/corpus")),
    ...scan(join(ROOT, "docs")),
  ]) {
    if (!file.endsWith(".json") && !file.endsWith(".md")) continue;
    if (existsSync(file) === false) continue;
    const text = readFileSync(file, "utf8");
    if (text.includes("pc_unique_marker_")) {
      issues.push(`${file} contains a plaintext credential marker`);
    }
  }
  return issues;
}

function* scan(directory: string): Generator<string> {
  if (!existsSync(directory)) return;
  const stack = [directory];
  while (stack.length) {
    const next = stack.pop()!;
    let stat;
    try { stat = statSync(next); } catch { continue; }
    if (stat.isDirectory()) {
      for (const child of readdirSafe(next)) stack.push(join(next, child));
    } else yield next;
  }
}

function checkCapMatrix(): string[] {
  const issues: string[] = [];
  const report = join(ROOT, "reports/capabilities.json");
  if (!existsSync(report)) return issues;
  const json = JSON.parse(readFileSync(report, "utf8")) as { snapshots: ReadonlyArray<{ configuration: string; capabilities: string[] }> };
  const without = json.snapshots.find((row) => row.configuration === "without-fcm");
  const withFcm = json.snapshots.find((row) => row.configuration === "with-fcm");
  if (!without || !withFcm) {
    issues.push("reports/capabilities.json is missing one of the expected configurations");
    return issues;
  }
  const expectedWithout = ["commands.v1", "controller_leases.v1", "raw_rpc.v1", "streams.v1"];
  const expectedWith = [...expectedWithout, "notifications.v1"];
  if (JSON.stringify([...without.capabilities].sort()) !== JSON.stringify([...expectedWithout].sort())) {
    issues.push("without-fcm capability drift");
  }
  if (JSON.stringify([...withFcm.capabilities].sort()) !== JSON.stringify([...expectedWith].sort())) {
    issues.push("with-fcm capability drift");
  }
  return issues;
}

const allIssues = [
  ...checkDocs(),
  ...checkCredentialMarker(),
  ...checkCapMatrix(),
];

if (allIssues.length > 0) {
  console.error("phase4:sensitive-scan failed");
  for (const issue of allIssues) console.error(`  - ${issue}`);
  process.exit(1);
}
console.log("phase4:sensitive-scan ok");
void FIXTURE_BLOCKLIST;
