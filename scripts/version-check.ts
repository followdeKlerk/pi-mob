#!/usr/bin/env bun
/**
 * Single authoritative version source gate (Phase 2).
 *
 * The repository previously advertised five different version strings:
 *   - root `package.json` `0.0.0`
 *   - `packages/bridge/package.json` `0.0.0`
 *   - `apps/mobile/pubspec.yaml` `0.0.0+1`
 *   - `apps/mobile/lib/main.dart` hardcoded `appVersion: '0.0.0'` (twice)
 *   - `apps/mobile/lib/src/connection/connection_coordinator.dart` handshake
 *     `'mobileVersion': '0.0.0'`
 *   - `apps/mobile/lib/src/data/app_database.dart` seed `appVersion: '0.0.0'`
 *   - `packages/bridge/src/daemon.ts` fallback `"0.0.0-m8"`
 *   - `packages/bridge/src/smoke.ts` fallback `"0.0.0-m1"`
 *   - `packages/bridge/src/ops-entry.ts` fallback `"0.0.0"`
 *   - `scripts/build.ts` `DEFAULT_BRIDGE_VERSION = "0.0.0-m7"`
 *   - `packages/bridge/dist/release/manifest.json` baked `"0.0.0-m7"`
 *   - `packages/bridge/dist/release/config.sample.toml` `bridge_version = "0.0.0-m7"`
 *
 * The fix is a single source of truth at `VERSION` (canonical semver without
 * a leading `v`). The repository's release contract is `0.0.3-alpha.1`.
 *
 * Layered model:
 *
 *   VERSION               root, authoritative (no leading `v`).
 *   packages/bridge/src/version.ts   generated at sync-time; imported by
 *                                    `daemon.ts`, `smoke.ts`, `ops-entry.ts`,
 *                                    and `build.ts`. No milestone fallbacks.
 *   apps/mobile/lib/src/version.dart generated at sync-time; imported by
 *                                    `main.dart`, `connection_coordinator.dart`,
 *                                    and `app_database.dart`.
 *   apps/mobile/pubspec.yaml          `version: <VERSION>+<CODE>` —
 *                                    `flutter.versionName` / `flutter.versionCode`.
 *   package.json (root, packages)     synced to VERSION for tooling.
 *   docs/                             every public doc that references the
 *                                    version must use the canonical form.
 *
 * `checkVersion` is exported so the Bun test harness can exercise the
 * failure path with synthetic drifted inputs. The executable `main()`
 * reads the real working tree and delegates to the same pure checker.
 *
 * Run via `bun run scripts/version-check.ts`. Wired into `scripts/all.ts`
 * so it runs as part of the regular CI sequence.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

export interface VersionCheckFileInput {
  /** Map of repository-relative file paths to their textual contents. */
  readonly files: Readonly<Record<string, string>>;
}

export interface VersionDrift {
  readonly file: string;
  readonly field: string;
  readonly observed: string;
  readonly expected: string;
}

export interface VersionCheckResult {
  readonly ok: boolean;
  readonly canonicalVersion: string | null;
  readonly drifts: ReadonlyArray<VersionDrift>;
  readonly warnings: ReadonlyArray<string>;
}

interface CheckRule {
  readonly id: string;
  readonly description: string;
  /** Read the observed value from the file map. Returns null when absent. */
  readonly read: (files: Record<string, string>) => string | null;
  /** Expected value derived from the canonical version. */
  readonly expected: (canonical: string, files: Record<string, string>) => string;
}

const VERSION_PATH = "VERSION";

const BRIDGE_VERSION_PATH = "packages/bridge/src/version.ts";
const MOBILE_VERSION_DART_PATH = "apps/mobile/lib/src/version.dart";

/** Reads a `key: "value"` JSON field from package.json text. */
function readJsonStringField(text: string, key: string): string | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const value = parsed[key];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Reads a Dart top-level `const String <name> = '<value>';` declaration.
 * Returns null when missing or the value is empty.
 */
function readDartStringConst(text: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b(?:const\\s+)?String\\s+${escaped}\\s*=\\s*['"]([^'"]+)['"]`);
  const match = re.exec(text);
  return match ? match[1]! : null;
}

/** Reads the Flutter `version: <semver>+<build>` line from pubspec.yaml. */
function readPubspecVersion(text: string): { version: string; build: number } | null {
  const match = /^version:\s*(\S+)\+(\d+)\s*$/m.exec(text);
  if (!match) return null;
  const version = match[1]!;
  const build = Number.parseInt(match[2]!, 10);
  if (!Number.isFinite(build)) return null;
  return { version, build };
}

/** Reads a `version = "<value>"` TOML line. */
function readTomlStringField(text: string, key: string): string | null {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"\\s*$`, "m");
  const match = re.exec(text);
  return match ? match[1]! : null;
}

/** Reads the first concrete current release version from a public Markdown document. */
function readMarkdownCurrentVersion(text: string): string | null {
  const match = /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/.exec(text);
  return match ? match[1]! : null;
}

/** Reads the canonical version from the VERSION file. */
function readCanonicalVersion(files: Record<string, string>): string | null {
  const text = files[VERSION_PATH];
  if (text === undefined) return null;
  // VERSION may contain trailing metadata lines (e.g. `androidCode: 3`).
  // The first non-empty line is the canonical semver; everything below
  // is metadata consumed by other readers.
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.includes(":")) continue;
    return trimmed.replace(/^v/, "");
  }
  return null;
}

/**
 * Reads the canonical Android versionCode. Phase 2 keeps the existing
 * `1`; future pre-release bumps may override via `VERSION.androidCode`.
 */
function readCanonicalAndroidCode(files: Record<string, string>): number {
  const text = files[VERSION_PATH] ?? "";
  const match = /^androidCode:\s*(\d+)\s*$/m.exec(text);
  return match ? Number.parseInt(match[1]!, 10) : 1;
}

/** Reads the `BRIDGE_VERSION` exported from the generated bridge module. */
function readBridgeVersionTs(files: Record<string, string>): string | null {
  const text = files[BRIDGE_VERSION_PATH];
  if (text === undefined) return null;
  // The generated module exports `BRIDGE_VERSION` as a string literal.
  // We accept both `export const BRIDGE_VERSION = "<x>";` and
  // `export const BRIDGE_VERSION: string = "<x>";`.
  const re = /export\s+const\s+BRIDGE_VERSION(?:\s*:\s*string)?\s*=\s*"([^"]+)"\s*;/;
  const match = re.exec(text);
  return match ? match[1]! : null;
}

/** Reads `kMobileAppVersion` from the generated Dart module. */
function readMobileVersionDart(files: Record<string, string>): string | null {
  const text = files[MOBILE_VERSION_DART_PATH];
  if (text === undefined) return null;
  return readDartStringConst(text, "kMobileAppVersion");
}

/**
 * Locate every remaining milestone fallback (`0.0.0-m<n>`) inside the
 * provided Dart/TS source files. The Phase 2 contract forbids these
 * strings from ever re-entering the production paths.
 */
const MILESTONE_FALLBACK_RE = /0\.0\.0-m[0-9]+/g;

function findMilestoneFallbacks(
  files: Record<string, string>,
  paths: readonly string[],
): Array<{ file: string; line: number; snippet: string }> {
  const hits: Array<{ file: string; line: number; snippet: string }> = [];
  for (const path of paths) {
    const text = files[path];
    if (text === undefined) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (MILESTONE_FALLBACK_RE.test(line)) {
        hits.push({ file: path, line: i + 1, snippet: line.trim().slice(0, 120) });
      }
      MILESTONE_FALLBACK_RE.lastIndex = 0;
    }
  }
  return hits;
}

const MOBILE_FALLBACK_RE = /(['"])0\.0\.0\1/g;

function findMobileHardcodedFallbacks(
  files: Record<string, string>,
  paths: readonly string[],
): Array<{ file: string; line: number; snippet: string }> {
  const hits: Array<{ file: string; line: number; snippet: string }> = [];
  for (const path of paths) {
    const text = files[path];
    if (text === undefined) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (MOBILE_FALLBACK_RE.test(line)) {
        hits.push({ file: path, line: i + 1, snippet: line.trim().slice(0, 120) });
      }
      MOBILE_FALLBACK_RE.lastIndex = 0;
    }
  }
  return hits;
}

interface FieldRule {
  readonly field: string;
  readonly read: (files: Record<string, string>) => string | null;
  readonly expected: (canonical: string, files: Record<string, string>) => string;
}

/**
 * The flat list of fields every check rule inspects. Each entry is one
 * (file, field, expected) triple. Adding a new source means adding a
 * new entry here so the rule lives next to the field definition.
 */
const FIELD_RULES: ReadonlyArray<{ file: string; rule: FieldRule }> = [
  {
    file: "package.json",
    rule: {
      field: "version",
      read: (files) => readJsonStringField(files["package.json"] ?? "", "version"),
      expected: (canonical) => canonical,
    },
  },
  {
    file: "packages/bridge/package.json",
    rule: {
      field: "version",
      read: (files) => readJsonStringField(files["packages/bridge/package.json"] ?? "", "version"),
      expected: (canonical) => canonical,
    },
  },
  {
    file: "packages/protocol-schema/package.json",
    rule: {
      field: "version",
      read: (files) =>
        readJsonStringField(files["packages/protocol-schema/package.json"] ?? "", "version"),
      expected: (canonical) => canonical,
    },
  },
  {
    file: BRIDGE_VERSION_PATH,
    rule: {
      field: "BRIDGE_VERSION",
      read: (files) => readBridgeVersionTs(files),
      expected: (canonical) => canonical,
    },
  },
  {
    file: MOBILE_VERSION_DART_PATH,
    rule: {
      field: "kMobileAppVersion",
      read: (files) => readMobileVersionDart(files),
      expected: (canonical) => canonical,
    },
  },
  {
    file: "apps/mobile/pubspec.yaml",
    rule: {
      field: "version",
      read: (files) => {
        const pubspec = files["apps/mobile/pubspec.yaml"] ?? "";
        const parsed = readPubspecVersion(pubspec);
        return parsed ? `${parsed.version}+${parsed.build}` : null;
      },
      expected: (canonical, files) => {
        const build = readCanonicalAndroidCode(files);
        return `${canonical}+${build}`;
      },
    },
  },
  ...["README.md", "CHANGELOG.md", "docs/PROJECT_STATUS.md", "docs/PROTOCOL.md", "docs/QUICKSTART.md"].map((file) => ({
    file,
    rule: {
      field: "current release version",
      read: (files: Record<string, string>) => readMarkdownCurrentVersion(files[file] ?? ""),
      expected: (canonical: string) => canonical,
    },
  })),
];

/**
 * Paths scanned for stray milestone fallbacks. Phase 2 forbids any
 * `0.0.0-m<n>` string from re-entering these production files. Test
 * fixtures under `packages/bridge/test/*` are intentionally excluded
 * because they exercise the install-config parser with arbitrary
 * historical input strings; treating them as production source would
 * couple test data to the canonical release identifier.
 */
const NO_MILESTONE_FALLBACK_PATHS: ReadonlyArray<string> = [
  "packages/bridge/src/daemon.ts",
  "packages/bridge/src/smoke.ts",
  "packages/bridge/src/ops-entry.ts",
  "packages/bridge/src/build-metadata.ts",
  "scripts/build.ts",
  "packages/bridge/src/version.ts",
];

/**
 * Paths scanned for hardcoded mobile `'0.0.0'` literals. Phase 2
 * forbids the legacy string from any production Dart file (including
 * the database seed and the WebSocket handshake payload).
 */
const NO_MOBILE_HARDCODED_PATHS: ReadonlyArray<string> = [
  "apps/mobile/lib/main.dart",
  "apps/mobile/lib/src/connection/connection_coordinator.dart",
  "apps/mobile/lib/src/data/app_database.dart",
];

/**
 * Pure checker. Accepts a map of repository-relative file paths to
 * their textual contents and returns a structured result. Testable
 * without disk I/O so the Bun harness can exercise both the clean
 * path and the failing path against synthetic fixtures.
 */
export function checkVersion(input: VersionCheckFileInput): VersionCheckResult {
  const files: Record<string, string> = { ...input.files };
  const drifts: VersionDrift[] = [];
  const warnings: string[] = [];
  const canonical = readCanonicalVersion(files);
  if (canonical === null) {
    drifts.push({
      file: VERSION_PATH,
      field: "canonical",
      observed: "<missing>",
      expected: "<0.0.x-alpha.y semver without leading `v`>",
    });
    return { ok: false, canonicalVersion: null, drifts, warnings };
  }
  if (canonical !== canonical.replace(/^v/, "")) {
    warnings.push(
      `${VERSION_PATH}: leading 'v' stripped — canonical form is '${canonical.replace(/^v/, "")}'`,
    );
  }
  for (const { file, rule } of FIELD_RULES) {
    const observed = rule.read(files);
    const expected = rule.expected(canonical, files);
    if (observed === null) {
      drifts.push({ file, field: rule.field, observed: "<missing>", expected });
      continue;
    }
    if (observed !== expected) {
      drifts.push({ file, field: rule.field, observed, expected });
    }
  }
  // Milestone fallbacks are forbidden everywhere on the production path.
  const milestoneHits = findMilestoneFallbacks(files, NO_MILESTONE_FALLBACK_PATHS);
  for (const hit of milestoneHits) {
    drifts.push({
      file: hit.file,
      field: `line ${hit.line}`,
      observed: hit.snippet,
      expected: `<no 0.0.0-m<n> literal; canonical ${canonical}>`,
    });
  }
  const mobileHits = findMobileHardcodedFallbacks(files, NO_MOBILE_HARDCODED_PATHS);
  for (const hit of mobileHits) {
    drifts.push({
      file: hit.file,
      field: `line ${hit.line}`,
      observed: hit.snippet,
      expected: `<import kMobileAppVersion from ${MOBILE_VERSION_DART_PATH}>`,
    });
  }
  return { ok: drifts.length === 0, canonicalVersion: canonical, drifts, warnings };
}

/**
 * Files the executable reads from disk. Keep the list in lock-step
 * with the test fixtures and the sync-version generator.
 */
const EXECUTABLE_FILES: ReadonlyArray<string> = [
  VERSION_PATH,
  "package.json",
  "packages/bridge/package.json",
  "packages/protocol-schema/package.json",
  BRIDGE_VERSION_PATH,
  "scripts/build.ts",
  "packages/bridge/src/daemon.ts",
  "packages/bridge/src/smoke.ts",
  "packages/bridge/src/ops-entry.ts",
  "packages/bridge/src/build-metadata.ts",
  "apps/mobile/pubspec.yaml",
  MOBILE_VERSION_DART_PATH,
  "apps/mobile/lib/main.dart",
  "apps/mobile/lib/src/connection/connection_coordinator.dart",
  "apps/mobile/lib/src/data/app_database.dart",
  "README.md",
  "CHANGELOG.md",
  "docs/PROJECT_STATUS.md",
  "docs/PROTOCOL.md",
  "docs/QUICKSTART.md",
];

function main(): number {
  const files: Record<string, string> = {};
  for (const file of EXECUTABLE_FILES) {
    const full = join(ROOT, file);
    if (!existsSync(full)) {
      // Missing source files are tolerable on first run; the checker
      // records "<missing>" so the next sync-version run produces them.
      continue;
    }
    files[file] = readFileSync(full, "utf8");
  }
  const result = checkVersion({ files });
  if (result.ok) {
    process.stdout.write(
      `version:check ok (canonical=${result.canonicalVersion ?? "<missing>"})\n`,
    );
    return 0;
  }
  process.stderr.write(
    `version:check FAILED canonical=${result.canonicalVersion ?? "<missing>"} ${result.drifts.length} drift(s)\n`,
  );
  for (const drift of result.drifts) {
    process.stderr.write(
      `version:check ${drift.file}:${drift.field} observed=${JSON.stringify(drift.observed)} expected=${JSON.stringify(drift.expected)}\n`,
    );
  }
  for (const warning of result.warnings) {
    process.stderr.write(`version:check warning: ${warning}\n`);
  }
  return 1;
}

if (import.meta.main) {
  process.exit(main());
}
