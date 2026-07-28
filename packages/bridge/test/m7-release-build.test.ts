/**
 * M7 release-bundle build tests.
 *
 * Validates the artifacts produced by `scripts/build.ts`'s M7 release
 * pipeline WITHOUT redundantly compiling the bridge. The test imports
 * the exported builder directly so:
 *
 *   - the daemon binary is compiled at most once via `compileDaemon()`,
 *     reused across every assertion,
 *   - every shipped file is hashed and cross-checked against
 *     `manifest.json` and `checksums.txt`,
 *   - the bundle is scanned for secret and fault-injection markers,
 *   - the manifest advertises only `x64` (never `arm64`).
 *
 * The fixture is created in a per-suite temp directory under
 * `mkdtempSync(...)`, so the test never disturbs the real
 * `packages/bridge/dist/release` tree that the build script populates
 * during a normal `bun run build`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  statSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  auditReleaseBundle,
  buildReleaseBundle,
  BuildError,
  compileDaemon,
  compileSmoke,
  detectMachOArch,
} from "../../../scripts/build";
import {
  DEFAULT_LAUNCH_AGENT_LABEL,
} from "../src/ops/install-paths";
import {
  renderPlist,
} from "../src/ops/launch-agent";
import {
  type FileSystemPort,
  type FileSystemStat,
} from "../src/ops/ports";
import {
  parseManifest,
  sha256Of,
  verifyManifest,
} from "../src/ops/release-manifest";

// ---------------------------------------------------------------------------
// Constants — kept in lock-step with scripts/build.ts.
// ---------------------------------------------------------------------------

const DEFAULT_BRIDGE_VERSION = "0.0.0-m7";
const BRIDGE_VERSION = process.env.PI_MOB_VERSION?.trim() || DEFAULT_BRIDGE_VERSION;
const PROTOCOL_VERSION = "1.0";
const BUN_MINIMUM = "1.3.14";
const MIN_MACOS = "13.0";
const PRODUCT = "pi-mob-bridge";
const MIGRATION_CLASS = "reversible_migration";
const ARCHITECTURE = "x64" as const;
const EXTENSION_BUNDLE_NAME = "pi-mob-extension.js";
const PUBLIC_CLI_NAME = "pi-mob";
const OPS_CLI_NAME = "pi-mob-ops";
const PLACEHOLDER_ROOT = "/opt/pi-mob";
const PLACEHOLDER_RELEASE = `${PLACEHOLDER_ROOT}/release`;

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const DIST = join(REPO_ROOT, "packages", "bridge", "dist");
const DAEMON_BINARY = join(DIST, "bridge-daemon");
const SMOKE_BINARY = join(DIST, "bridge-smoke");

const FAULT_MARKERS: readonly string[] = [
  "TestFaultInjector",
  "TEST_FAULT_NAMES",
  "FaultPlan",
  "fault-injector",
  "close_after_accept",
  "close_after_dispatch",
  "pause_outbound",
  "kill_pi_after_events",
  "kill_bridge_after_transition",
  "oversized_tool_output",
  "cleanup_timeout",
];

const SECRET_MARKERS: readonly RegExp[] = [
  /sk-[A-Za-z0-9]{16,}/,
  /sk-ant-[A-Za-z0-9\-]{16,}/,
  /AIza[0-9A-Za-z_\-]{16,}/,
  /ghp_[A-Za-z0-9]{16,}/,
  /glpat-[A-Za-z0-9_\-]{16,}/,
  /xox[baprs]-[A-Za-z0-9\-]{10,}/,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
];

// ---------------------------------------------------------------------------
// Suite-scoped fixture.
//
// `compileDaemon()` runs once and the daemon binary is reused by every
// `buildReleaseBundle()` call. The release directory is a per-suite temp
// tree, so the test never overwrites a real `dist/release` install target.
// ---------------------------------------------------------------------------

const SUITE_ROOT = mkdtempSync(join(tmpdir(), "pi-mob-m7-release-build-"));
let daemonSha = "";

beforeAll(() => {
  // Compile the supervised daemon if it is not already present. The
  // build script always produces this artefact first, so on a freshly
  // bootstrapped machine the test compiles once and every test below
  // reuses the binary.
  if (!existsSync(DAEMON_BINARY)) {
    const code = compileDaemon();
    expect(code).toBe(0);
  }
  if (!existsSync(DAEMON_BINARY)) {
    throw new Error(`daemon binary missing after compileDaemon: ${DAEMON_BINARY}`);
  }
  // Compile the smoke binary too so the hostile-fixture proof has the
  // canonical autoload-disabled harness to drive. This mirrors the
  // build-script top-level flow.
  if (!existsSync(SMOKE_BINARY)) {
    const code = compileSmoke();
    expect(code).toBe(0);
  }
  daemonSha = sha256Of(readFileSync(DAEMON_BINARY));
});

afterAll(() => {
  rmSync(SUITE_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Mach-O architecture detection (ground truth for the manifest).
// ---------------------------------------------------------------------------

describe("Mach-O architecture detection", () => {
  test("detectMachOArch recognises the compiled daemon as x86_64", () => {
    const detected = detectMachOArch(DAEMON_BINARY);
    expect(detected.arch).toBe("x64");
    expect(detected.cputype).toBe(0x01000007); // CPU_TYPE_X86_64
    expect(detected.source).toBe("mach-o-64-le");
  });

  test("detectMachOArch rejects a non-Mach-O blob", () => {
    const notABinary = join(SUITE_ROOT, "not-a-binary.bin");
    writeFileSync(notABinary, "definitely not a Mach-O file");
    expect(() => detectMachOArch(notABinary)).toThrow(BuildError);
  });

  test("detectMachOArch rejects a too-short file", () => {
    const short = join(SUITE_ROOT, "short.bin");
    writeFileSync(short, "abcd");
    expect(() => detectMachOArch(short)).toThrow(/too short for Mach-O header/);
  });
});

// ---------------------------------------------------------------------------
// Release bundle construction.
//
// A single `buildReleaseBundle` call produces the canonical M7 layout.
// Subsequent assertions in this describe block reuse the same bundle
// instead of rebuilding, so the on-disk SHA-256 stays stable across
// assertions.
// ---------------------------------------------------------------------------

const RELEASE_DIR = join(SUITE_ROOT, "release");

let manifestPath = "";
let checksumsPath = "";
let configSamplePath = "";
let plistPath = "";
let licensesDir = "";
let daemonInBundle = "";
let publicCliInBundle = "";
let opsCliInBundle = "";
let manifest: ReturnType<typeof JSON.parse> = {};
let manifestRaw = "";

beforeAll(() => {
  const bundle = buildReleaseBundle({ daemonBinary: DAEMON_BINARY, releaseDir: RELEASE_DIR });
  manifestPath = join(RELEASE_DIR, "manifest.json");
  if (!existsSync(manifestPath)) {
    // Diagnostic: list what was actually written so a future failure
    // is not a wild goose chase.
    throw new Error(
      `buildReleaseBundle did not write ${manifestPath}; bundle.releaseDir=${bundle.releaseDir}`,
    );
  }
  checksumsPath = join(RELEASE_DIR, "checksums.txt");
  configSamplePath = join(RELEASE_DIR, "config.sample.toml");
  plistPath = join(RELEASE_DIR, "launch-agents", `${DEFAULT_LAUNCH_AGENT_LABEL}.plist`);
  licensesDir = join(RELEASE_DIR, "licenses");
  daemonInBundle = join(RELEASE_DIR, "bin", "bridge-daemon");
  publicCliInBundle = join(RELEASE_DIR, "bin", PUBLIC_CLI_NAME);
  opsCliInBundle = join(RELEASE_DIR, "bin", OPS_CLI_NAME);
  manifestRaw = readFileSync(manifestPath, "utf8");
  manifest = JSON.parse(manifestRaw);
  // Pin the bundle result for diagnostics on failure.
  void bundle;
});

describe("release bundle: layout", () => {
  test("produces every required file with the correct ownership", () => {
    const expectedFiles: ReadonlyArray<{ path: string; mode: number }> = [
      { path: RELEASE_DIR, mode: 0o700 },
      { path: join(RELEASE_DIR, "bin"), mode: 0o700 },
      { path: join(RELEASE_DIR, "licenses"), mode: 0o700 },
      { path: join(RELEASE_DIR, "launch-agents"), mode: 0o700 },
      { path: manifestPath, mode: 0o600 },
      { path: checksumsPath, mode: 0o600 },
      { path: configSamplePath, mode: 0o600 },
      { path: plistPath, mode: 0o600 },
      { path: join(licensesDir, "MIT"), mode: 0o600 },
      { path: join(licensesDir, "Apache-2.0"), mode: 0o600 },
      { path: join(licensesDir, "BSD-3-Clause"), mode: 0o600 },
      { path: daemonInBundle, mode: 0o700 },
      { path: publicCliInBundle, mode: 0o700 },
      { path: opsCliInBundle, mode: 0o700 },
    ];
    for (const entry of expectedFiles) {
      expect(existsSync(entry.path)).toBe(true);
      const stat = statSync(entry.path);
      expect(stat.mode & 0o777).toBe(entry.mode);
    }
  });

  test("does not bundle the removed policy extension", () => {
    const extensionsDir = join(RELEASE_DIR, "extensions");
    expect(existsSync(extensionsDir)).toBe(false);
    const extensionArtifact = manifest.artifacts.find(
      (artifact: { kind: string }) => artifact.kind === "extension",
    );
    expect(extensionArtifact).toBeUndefined();
  });

  test("daemon in the bundle is byte-for-byte the compiled daemon", () => {
    const bundleSha = sha256Of(readFileSync(daemonInBundle));
    expect(bundleSha).toBe(daemonSha);
    // Mach-O arch is preserved through the copy.
    expect(detectMachOArch(daemonInBundle).arch).toBe("x64");
  });

  test("bundles the friendly and advanced lifecycle CLI names from the same executable", () => {
    expect(readFileSync(publicCliInBundle)).toEqual(readFileSync(opsCliInBundle));
    const lifecycleNames = manifest.artifacts
      .filter((artifact: { kind: string }) => artifact.kind === "lifecycle-cli")
      .map((artifact: { name: string }) => artifact.name)
      .sort();
    expect(lifecycleNames).toEqual([PUBLIC_CLI_NAME, OPS_CLI_NAME].sort());
  });

  test("manifest.json is canonical (sorted keys, no structural whitespace)", () => {
    // JSON.stringify produces no inter-token whitespace, but JSON string
    // values may legitimately contain spaces (e.g. limitation prose).
    // Canonical-JSON contracts are:
    //   - no `\n` / `\r` / `\t` characters anywhere,
    //   - top-level keys sorted alphabetically,
    //   - first non-`{` byte starts a value (no leading whitespace).
    expect(/[\n\r\t]/.test(manifestRaw)).toBe(false);
    expect(manifestRaw.startsWith("{")).toBe(true);
    const keys = Object.keys(manifest).sort();
    expect(Object.keys(manifest)).toEqual(keys);
  });

  test("manifest.json round-trips through the strict release-manifest parser", () => {
    const parsed = parseManifest(manifestRaw);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.product).toBe(PRODUCT);
    expect(parsed.version).toBe(BRIDGE_VERSION);
    expect(parsed.architecture).toBe(ARCHITECTURE);
    expect(parsed.bun.minimum).toBe(BUN_MINIMUM);
    expect(parsed.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(parsed.minMacos).toBe(MIN_MACOS);
  });
});

// ---------------------------------------------------------------------------
// Manifest content (extensions + ground-truth architecture).
// ---------------------------------------------------------------------------

describe("release bundle: manifest fields", () => {
  test("architecture is x64 and never arm64", () => {
    expect(manifest.architecture).toBe("x64");
    expect(manifest.architecture).not.toBe("arm64");
  });

  test("version / protocol / Bun floor / product are present and stable", () => {
    expect(manifest.version).toBe(BRIDGE_VERSION);
    expect(manifest.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(manifest.bun.minimum).toBe(BUN_MINIMUM);
    expect(manifest.product).toBe(PRODUCT);
  });

  test("M7 capabilities and limitations are recorded", () => {
    expect(Array.isArray(manifest.capabilities)).toBe(true);
    expect(manifest.capabilities.length).toBeGreaterThan(0);
    for (const cap of manifest.capabilities) {
      expect(typeof cap).toBe("string");
      expect(cap.length).toBeGreaterThan(0);
    }
    expect(Array.isArray(manifest.limitations)).toBe(true);
    expect(manifest.limitations.length).toBeGreaterThan(0);
    // Honest limitation: arm64 is not yet validated.
    expect(manifest.limitations.some((l: string) => /x64-only/i.test(l))).toBe(true);
  });

  test("migration class is reversible_migration (honest for M7)", () => {
    expect(manifest.migrationClass).toBe(MIGRATION_CLASS);
  });

  test("artifacts array carries daemon, lifecycle CLIs, config template, and plist (no extension)", () => {
    const names = manifest.artifacts.map((a: { name: string }) => a.name).sort();
    expect(names).toContain("bridge-daemon");
    expect(names).toContain(PUBLIC_CLI_NAME);
    expect(names).toContain(OPS_CLI_NAME);
    expect(names).toContain("config.sample.toml");
    expect(names).toContain(`${DEFAULT_LAUNCH_AGENT_LABEL}.plist`);
    expect(names).not.toContain(EXTENSION_BUNDLE_NAME);
    for (const artifact of manifest.artifacts) {
      expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(artifact.size).toBeGreaterThan(0);
      expect(artifact.path.startsWith("/")).toBe(false);
    }
  });

  test("artifact and license paths are normalized and bundle-relative", () => {
    for (const entry of [...manifest.artifacts, ...manifest.licenses]) {
      expect(entry.path).toMatch(/^[^/\\]+(?:\/[^/\\]+)*$/);
      expect(entry.path.split("/")).not.toContain(".");
      expect(entry.path.split("/")).not.toContain("..");
    }
  });

  test("manifest parser and rooted verifier reject traversal", () => {
    const traversing = structuredClone(manifest);
    traversing.artifacts[0].path = "../outside";
    expect(() => parseManifest(JSON.stringify(traversing))).toThrow(/bundle-relative/);

    const absolute = structuredClone(manifest);
    absolute.artifacts[0].path = daemonInBundle;
    const parsedLegacy = parseManifest(JSON.stringify(absolute));
    expect(() => verifyManifest(parsedLegacy, RELEASE_DIR, makeNodeFsPort())).toThrow(/bundle-relative/);
  });

  test("licenses array carries every shipped license with spdxId + sha256", () => {
    const ids = manifest.licenses.map((l: { spdxId?: string }) => l.spdxId).sort();
    expect(ids).toEqual(["Apache-2.0", "BSD-3-Clause", "MIT"]);
    for (const license of manifest.licenses) {
      expect(license.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(license.path.startsWith("/")).toBe(false);
      expect(existsSync(joinBundlePath(RELEASE_DIR, license.path))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Checksums cross-validation.
// ---------------------------------------------------------------------------

describe("release bundle: checksums", () => {
  test("checksum paths are normalized and traversal is rejected", () => {
    const lines = readFileSync(checksumsPath, "utf8").trim().split("\n");
    for (const line of lines) {
      const match = /^[0-9a-f]{64}\s{2}(.+)$/.exec(line);
      expect(match).not.toBeNull();
      if (match) expect(() => joinBundlePath(RELEASE_DIR, match[1]!)).not.toThrow();
    }
    expect(() => joinBundlePath(RELEASE_DIR, "../outside")).toThrow(/traversal/);
    expect(() => joinBundlePath(RELEASE_DIR, "/absolute/outside")).toThrow(/bundle-relative/);
    expect(() => joinBundlePath(RELEASE_DIR, "bin//bridge-daemon")).toThrow(/bundle-relative/);
  });

  test("every entry in checksums.txt matches the file on disk", () => {
    const text = readFileSync(checksumsPath, "utf8");
    const lines = text.trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const match = /^([0-9a-f]{64})\s{2}([^/].*)$/.exec(line);
      expect(match).not.toBeNull();
      if (!match) continue;
      const expected = match[1]!;
      const path = joinBundlePath(RELEASE_DIR, match[2]!);
      const actual = sha256Of(readFileSync(path));
      expect(actual).toBe(expected);
    }
  });

  test("manifest artifact entries match the actual on-disk files", () => {
    for (const artifact of manifest.artifacts) {
      const actual = sha256Of(readFileSync(joinBundlePath(RELEASE_DIR, artifact.path)));
      expect(actual).toBe(artifact.sha256);
    }
  });

  test("manifest license entries match the actual on-disk files", () => {
    for (const license of manifest.licenses) {
      const actual = sha256Of(readFileSync(joinBundlePath(RELEASE_DIR, license.path)));
      expect(actual).toBe(license.sha256);
    }
  });

  test("verifyManifest from release-manifest ops returns ok=true", () => {
    // Use the strict parser (which drops M7 extensions) and the
    // FileSystemPort-shaped verification API. The ops API requires a
    // FileSystemPort, so we build a thin node-fs-backed adapter.
    const parsed = parseManifest(manifestRaw);
    const fs = makeNodeFsPort();
    const result = verifyManifest(parsed, RELEASE_DIR, fs);
    expect(result.ok).toBe(true);
    expect(result.artifacts.every((entry) => entry.ok)).toBe(true);
    expect(result.licenses.every((entry) => entry.ok)).toBe(true);
  });

  test("manifest and checksums still verify after copying the release", () => {
    const copiedRelease = join(SUITE_ROOT, "copied", "release");
    cpSync(RELEASE_DIR, copiedRelease, { recursive: true });
    const copiedManifest = parseManifest(readFileSync(join(copiedRelease, "manifest.json"), "utf8"));
    const result = verifyManifest(copiedManifest, copiedRelease, makeNodeFsPort());
    expect(result.ok).toBe(true);

    const copiedChecksums = readFileSync(join(copiedRelease, "checksums.txt"), "utf8").trim().split("\n");
    for (const line of copiedChecksums) {
      const match = /^([0-9a-f]{64})\s{2}([^/].*)$/.exec(line);
      expect(match).not.toBeNull();
      if (!match) continue;
      expect(sha256Of(readFileSync(joinBundlePath(copiedRelease, match[2]!)))).toBe(match[1]!);
    }
  });
});

// ---------------------------------------------------------------------------
// Secret and fault-marker audit.
// ---------------------------------------------------------------------------

describe("release bundle: secret and fault audit", () => {
  test("no fault-injection markers appear in any shipped file", () => {
    const allFiles = listFiles(RELEASE_DIR);
    for (const file of allFiles) {
      // Daemon binary is Mach-O; decode as latin1 so any ASCII marker
      // embedded in the binary is still observable.
      const bytes = readFileSync(file, "latin1");
      for (const marker of FAULT_MARKERS) {
        expect(bytes.includes(marker)).toBe(false);
      }
    }
  });

  test("no provider secret markers appear in any shipped text/structured file", () => {
    // The compiled Mach-O binary legitimately contains opaque bytes that
    // can match `sk-...` patterns as coincidence (symbol-table fragments,
    // runtime constants). The secret audit therefore scans every file
    // *except* compiled binaries.
    const allFiles = listFiles(RELEASE_DIR);
    for (const file of allFiles) {
      if (file.includes("/bin/")) continue;
      const bytes = readFileSync(file, "latin1");
      for (const pattern of SECRET_MARKERS) {
        expect(pattern.test(bytes)).toBe(false);
      }
    }
  });

  test("config sample uses placeholder paths, not host-absolute paths", () => {
    const sample = readFileSync(configSamplePath, "utf8");
    // No real /Users/<user> in the operator-facing sample.
    expect(/\/Users\/[A-Za-z0-9._-]+\//.test(sample)).toBe(false);
    expect(/\/home\/[A-Za-z0-9._-]+\//.test(sample)).toBe(false);
    // No build-machine path may leak into the portable metadata/templates.
    for (const file of [manifestPath, checksumsPath, plistPath]) {
      const contents = readFileSync(file, "utf8");
      expect(contents).not.toContain(REPO_ROOT);
      expect(contents).not.toContain(SUITE_ROOT);
      expect(contents).not.toMatch(/\/(?:Users|home)\/[A-Za-z0-9._-]+\//);
    }
    // Installer-rewritable placeholders and release-tag-consistent metadata
    // are present.
    expect(sample).toContain(`bridge_version = ${JSON.stringify(BRIDGE_VERSION)}`);
    expect(sample).toContain(`${PLACEHOLDER_RELEASE}/state`);
    expect(sample).toContain(`${PLACEHOLDER_RELEASE}/logs`);
  });

  test("auditReleaseBundle passes for the freshly-produced bundle", () => {
    expect(() => auditReleaseBundle(RELEASE_DIR)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// LaunchAgent template.
// ---------------------------------------------------------------------------

describe("release bundle: LaunchAgent plist", () => {
  test("plist declares the canonical Label, RunAtLoad, KeepAlive, Background", () => {
    const xml = readFileSync(plistPath, "utf8");
    expect(xml).toContain(`<key>Label</key><string>${DEFAULT_LAUNCH_AGENT_LABEL}</string>`);
    expect(xml).toContain("<key>RunAtLoad</key><true/>");
    expect(xml).toContain("<key>KeepAlive</key><true/>");
    expect(xml).toContain("<key>ProcessType</key><string>Background</string>");
  });

  test("plist ProgramArguments use portable placeholders and every required flag", () => {
    const xml = readFileSync(plistPath, "utf8");
    expect(xml).toContain(`<string>${PLACEHOLDER_RELEASE}/bin/bridge-daemon</string>`);
    expect(xml).toContain(`<string>--config</string>\n<string>${PLACEHOLDER_RELEASE}/config.toml</string>`);
    expect(xml).toContain(`<string>--workspace</string>\n<string>${PLACEHOLDER_ROOT}/workspace</string>`);
    expect(xml).toContain(`<string>--session-dir</string>\n<string>${PLACEHOLDER_RELEASE}/sessions</string>`);
    // Phase 4: no --extension flag in the LaunchAgent.
    expect(xml).not.toContain("--extension");
    // No `bash -c` / `sh -c` wrapper anywhere in the plist.
    expect(/bash -c|sh -c|\/bin\/(ba)?sh/.test(xml)).toBe(false);
  });

  test("plist environment contains only absolute-path values", () => {
    const xml = readFileSync(plistPath, "utf8");
    // Locate the EnvironmentVariables dict and assert each <string> starts with `/`.
    const envBlock = xml.match(/<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/);
    expect(envBlock).not.toBeNull();
    if (!envBlock) return;
    const values = Array.from(envBlock[1]!.matchAll(/<string>([^<]+)<\/string>/g)).map((m) => m[1]!);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value.startsWith("/")).toBe(true);
    }
  });

  test("plist re-renders identically via launch-agent.renderPlist", () => {
    const xml = readFileSync(plistPath, "utf8");
    // The shipped plist must be byte-identical to a fresh render with the
    // same portable installer placeholders.
    const placeholderDaemon = `${PLACEHOLDER_RELEASE}/bin/bridge-daemon`;
    const reRendered = renderPlist({
      label: DEFAULT_LAUNCH_AGENT_LABEL,
      program: placeholderDaemon,
      programArguments: [
        placeholderDaemon,
        "--config", `${PLACEHOLDER_RELEASE}/config.toml`,
        "--workspace", `${PLACEHOLDER_ROOT}/workspace`,
        "--session-dir", `${PLACEHOLDER_RELEASE}/sessions`,
      ],
      workingDirectory: `${PLACEHOLDER_ROOT}/workspace`,
      environment: {
        HOME: PLACEHOLDER_ROOT,
        TMPDIR: `${PLACEHOLDER_RELEASE}/state/tmp`,
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      },
      stdoutPath: `${PLACEHOLDER_RELEASE}/logs/bridge.out.log`,
      stderrPath: `${PLACEHOLDER_RELEASE}/logs/bridge.err.log`,
      runAtLoad: true,
      keepAlive: true,
      processType: "Background",
    });
    expect(reRendered).toBe(xml);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function listFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) stack.push(full);
      else if (stat.isFile()) out.push(full);
    }
  }
  return out.sort();
}

function joinBundlePath(root: string, relativePath: string): string {
  if (!/^[^/\\]+(?:\/[^/\\]+)*$/.test(relativePath)) {
    throw new Error(`path is not normalized and bundle-relative: ${relativePath}`);
  }
  const segments = relativePath.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`path contains traversal: ${relativePath}`);
  }
  return join(root, ...segments);
}

/** Minimal node-fs FileSystemPort implementation for verifyManifest.
 *  The remaining methods are unimplemented because verifyManifest only
 *  calls `exists`, `stat`, and `readFile`. */
function makeNodeFsPort(): FileSystemPort {
  const statOnly = (p: string): FileSystemStat => {
    const s = statSync(p);
    return { isFile: s.isFile(), isDirectory: s.isDirectory(), mode: s.mode, size: s.size, mtimeMs: s.mtimeMs };
  };
  const throwUnimplemented = (method: string) => () => {
    throw new Error(`FileSystemPort.${method} not implemented for verifyManifest helper`);
  };
  return {
    exists: (p) => existsSync(p),
    stat: statOnly,
    readFile: (p) => readFileSync(p),
    writeFile: throwUnimplemented("writeFile"),
    mkdir: throwUnimplemented("mkdir"),
    chmod: throwUnimplemented("chmod"),
    rm: throwUnimplemented("rm"),
    rename: throwUnimplemented("rename"),
    readdir: throwUnimplemented("readdir"),
  };
}

// (intentionally no further helpers)
