#!/usr/bin/env bun
/**
 * Single-source-of-truth version sync script (Phase 2).
 *
 * Reads the canonical version from the root `VERSION` file and
 * rewrites every derived file so the release identity never drifts:
 *
 *   - `package.json` (root + every workspace)
 *   - `apps/mobile/pubspec.yaml` (`version: <semver>+<code>`)
 *   - `packages/bridge/src/version.ts` (generated, exported `BRIDGE_VERSION`)
 *   - `apps/mobile/lib/src/version.dart` (generated, `kMobileAppVersion`)
 *
 * The script is idempotent: re-running it against an already-aligned
 * tree is a no-op. Re-running it after bumping `VERSION` rewrites the
 * derived files in place. The companion `scripts/version-check.ts`
 * fails the CI gate when any of the derived files drift from
 * `VERSION`.
 *
 * The script never touches `docs/` or release artefacts under
 * `packages/bridge/dist/release/` — those are produced by
 * `scripts/build.ts` and the bridge smoke executable at release time.
 *
 * Release builds are still permitted to override the bridge version
 * via `PI_MOB_VERSION` so an ad-hoc smoke build does not require a
 * `VERSION` bump; release builds assert the override matches the
 * canonical value.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

interface PackageJsonTarget {
  readonly path: string;
  readonly label: string;
}

const PACKAGE_JSON_TARGETS: ReadonlyArray<PackageJsonTarget> = [
  { path: "package.json", label: "root workspace" },
  { path: "packages/bridge/package.json", label: "@pi-mob/bridge workspace" },
  { path: "packages/protocol-schema/package.json", label: "@pi-mob/protocol-schema workspace" },
  { path: "packages/protocol-fixtures/package.json", label: "@pi-mob/protocol-fixtures workspace" },
  { path: "packages/typescript-config/package.json", label: "@pi-mob/typescript-config workspace" },
];

const BRIDGE_VERSION_PATH = "packages/bridge/src/version.ts";
const MOBILE_VERSION_DART_PATH = "apps/mobile/lib/src/version.dart";
const PUBSPEC_PATH = "apps/mobile/pubspec.yaml";

interface CanonicalVersion {
  readonly version: string;
  readonly androidCode: number;
}

function readCanonicalVersion(): CanonicalVersion | null {
  const full = join(ROOT, "VERSION");
  if (!existsSync(full)) {
    process.stderr.write("sync-version: VERSION file missing at repo root\n");
    return null;
  }
  const text = readFileSync(full, "utf8");
  let version: string | null = null;
  let androidCode = 1;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const codeMatch = /^androidCode:\s*(\d+)\s*$/.exec(trimmed);
    if (codeMatch) {
      androidCode = Number.parseInt(codeMatch[1]!, 10);
      continue;
    }
    if (trimmed.includes(":")) continue;
    version = trimmed.replace(/^v/, "");
  }
  if (!version) {
    process.stderr.write("sync-version: VERSION file is empty\n");
    return null;
  }
  return { version, androidCode };
}

function syncPackageJson(target: PackageJsonTarget, version: string): boolean {
  const full = join(ROOT, target.path);
  if (!existsSync(full)) {
    process.stderr.write(`sync-version: skip missing ${target.path}\n`);
    return false;
  }
  const text = readFileSync(full, "utf8");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    process.stderr.write(`sync-version: ${target.path} is not valid JSON: ${(error as Error).message}\n`);
    return false;
  }
  if (parsed["version"] === version) return false;
  parsed["version"] = version;
  // Preserve insertion order; Bun writes a stable JSON without whitespace.
  writeFileSync(full, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  process.stdout.write(`sync-version: ${target.path} -> ${version}\n`);
  return true;
}

function syncPubspec(version: string, androidCode: number): boolean {
  const full = join(ROOT, PUBSPEC_PATH);
  if (!existsSync(full)) {
    process.stderr.write(`sync-version: skip missing ${PUBSPEC_PATH}\n`);
    return false;
  }
  const text = readFileSync(full, "utf8");
  const desired = `${version}+${androidCode}`;
  const match = /^version:\s*(\S+)\+(\d+)\s*$/m.exec(text);
  if (match && match[0]?.trim() === `version: ${desired}`) return false;
  const updated = text.replace(
    /^version:\s*\S+\+\d+\s*$/m,
    `version: ${desired}`,
  );
  if (updated === text) {
    process.stderr.write(`sync-version: pubspec.yaml has no version line; refusing to rewrite\n`);
    return false;
  }
  writeFileSync(full, updated, "utf8");
  process.stdout.write(`sync-version: ${PUBSPEC_PATH} -> ${desired}\n`);
  return true;
}

function generateBridgeVersion(version: string): string {
  return [
    "/**",
    " * Generated bridge version module.",
    " *",
    " * This file is produced by `scripts/sync-version.ts` from the root",
    " * `VERSION` file and must not be edited by hand. The bridge daemon,",
    " * smoke executable, ops entrypoint, and build script all import",
    " * `BRIDGE_VERSION` from here so the canonical release identifier",
    " * travels with the compiled binary without depending on a",
    " * repository-relative file at runtime.",
    " *",
    " * The fallback constant is intentionally forbidden: callers must",
    " * fail clearly when the source-of-truth build artefact is missing",
    " * rather than ship a \"0.0.0-m<n>\" stub. The `version:check` script",
    " * fails the CI gate whenever this string drifts from `VERSION`.",
    " */",
    "",
    `export const BRIDGE_VERSION = "${version}";`,
    "",
  ].join("\n");
}

function generateMobileVersion(version: string): string {
  return [
    "/// Generated mobile version module.",
    "///",
    "/// This file is produced by `scripts/sync-version.ts` from the root",
    "/// `VERSION` file and must not be edited by hand. The Flutter app",
    "/// imports `kMobileAppVersion` everywhere the canonical release",
    "/// identifier is needed (notification registration, the WebSocket",
    "/// handshake payload, the database seed row, and the runtime",
    "/// constructors).",
    "///",
    "/// The `version:check` script fails the CI gate whenever this",
    "/// constant drifts from `VERSION`. There is no fallback: a missing",
    "/// generated file is a build-time bug, not a runtime concern.",
    "library;",
    "",
    `const String kMobileAppVersion = '${version}';`,
    "",
  ].join("\n");
}

function syncGenerated(file: string, generator: (version: string) => string, version: string): boolean {
  const full = join(ROOT, file);
  const desired = generator(version);
  if (existsSync(full) && readFileSync(full, "utf8") === desired) return false;
  writeFileSync(full, desired, "utf8");
  process.stdout.write(`sync-version: ${file} generated\n`);
  return true;
}

function main(): number {
  const canonical = readCanonicalVersion();
  if (!canonical) return 1;
  process.stdout.write(`sync-version: canonical=${canonical.version} androidCode=${canonical.androidCode}\n`);
  let touched = false;
  for (const target of PACKAGE_JSON_TARGETS) {
    if (syncPackageJson(target, canonical.version)) touched = true;
  }
  if (syncPubspec(canonical.version, canonical.androidCode)) touched = true;
  if (syncGenerated(BRIDGE_VERSION_PATH, generateBridgeVersion, canonical.version)) touched = true;
  if (syncGenerated(MOBILE_VERSION_DART_PATH, generateMobileVersion, canonical.version)) touched = true;
  process.stdout.write(touched ? "sync-version: ok\n" : "sync-version: already aligned\n");
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
