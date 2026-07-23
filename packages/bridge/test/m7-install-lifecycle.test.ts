// pi-mob:security-test-fixture — deliberate private-path environment probes.
/**
 * M7 install/lifecycle ops — full-coverage test suite.
 *
 * Coverage targets:
 *   - release-manifest: parse, format (canonical), verify (sha256)
 *   - install-paths: layout, absolute/traversal invariants, 0o700/0o600 modes
 *   - install-config: validation, loopback hostname, port range, owner-only read
 *   - install-environment: allowlist, forbidden keys, PATH rebuild
 *   - launch-agent: spec validation, no shell, RunAtLoad/KeepAlive
 *   - update: deterministic plan, transactional execute, generation reset for
 *     restore_required, no migrate for binary_only
 *   - rollback: restore before one generation reset, refuses missing callback
 *   - uninstall: retain_data / remove_state / full modes, Pi session dir
 *     preserved by default even in full mode
 *
 * All filesystem work goes through an in-memory `FileSystemPort` so tests
 * never touch the real user filesystem or invoke `launchctl`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildEnvironment,
  buildInstallPaths,
  defaultInstallConfig,
  ensureInstallPaths,
  EnvironmentBuildError,
  executeRollback,
  executeUninstall,
  executeUpdate,
  FILE_MODE,
  formatManifest,
  type FileSystemPort,
  type FileSystemStat,
  formatInstallConfig,
  InstallConfigValidationError,
  InstallPathError,
  LaunchAgentSpecError,
  parseInstallConfig,
  parseManifest,
  planRollback,
  planUninstall,
  planUpdate,
  renderPlist,
  sha256Of,
  systemClock,
  UninstallPlanError,
  validateInstallConfig,
  validateSpec,
  verifyManifest,
  writeInstallConfig,
  writePlist,
  readInstallConfig,
  ManifestError,
  DEFAULT_ENV_ALLOWLIST,
  FORBIDDEN_ENV_KEYS,
  DEFAULT_LAUNCH_AGENT_LABEL,
  DIRECTORY_MODE,
} from "../src/ops";

// Type-only import for `MigrationClass` so the test file can be
// self-documenting about which migration classes it exercises.
type MigrationClass = import("../src/ops").MigrationClass;
void (null as MigrationClass | null);

// ---------------------------------------------------------------------------
// In-memory FileSystemPort (no real disk touches, no launchctl).
// ---------------------------------------------------------------------------

interface FsNode {
  readonly kind: "file" | "dir";
  readonly mode: number;
  readonly content: Buffer;
  readonly mtimeMs: number;
}

class InMemoryFileSystem implements FileSystemPort {
  private readonly nodes = new Map<string, FsNode>();
  private readonly clock = { now: 0 };
  setClockMs(ms: number): void { this.clock.now = ms; }

  private touch(path: string, mode: number, kind: "file" | "dir", content: Buffer = Buffer.alloc(0)): void {
    this.nodes.set(path, { kind, mode, content, mtimeMs: this.clock.now });
  }

  exists(path: string): boolean { return this.nodes.has(path); }

  stat(path: string): FileSystemStat {
    const node = this.nodes.get(path);
    if (!node) throw new Error(`ENOENT: ${path}`);
    return {
      isFile: node.kind === "file",
      isDirectory: node.kind === "dir",
      mode: node.mode,
      size: node.content.length,
      mtimeMs: node.mtimeMs,
    };
  }

  readFile(path: string): Buffer {
    const node = this.nodes.get(path);
    if (!node) throw new Error(`ENOENT: ${path}`);
    if (node.kind !== "file") throw new Error(`EISDIR: ${path}`);
    return Buffer.from(node.content);
  }

  writeFile(path: string, data: Buffer | string, mode: number): void {
    const buffer = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
    this.touch(path, mode, "file", buffer);
  }

  mkdir(path: string, options: { recursive: boolean; mode: number }): void {
    if (this.nodes.has(path)) {
      const node = this.nodes.get(path)!;
      if (node.kind !== "dir") throw new Error(`ENOTDIR: ${path}`);
      this.nodes.set(path, { ...node, mode: options.mode });
      return;
    }
    if (options.recursive) {
      const segments = path.split("/").filter((segment) => segment.length > 0);
      let cursor = path.startsWith("/") ? "" : "";
      for (const segment of segments) {
        cursor = `${cursor}/${segment}`;
        if (!this.nodes.has(cursor)) {
          this.touch(cursor, options.mode, "dir");
        }
      }
      return;
    }
    this.touch(path, options.mode, "dir");
  }

  chmod(path: string, mode: number): void {
    const node = this.nodes.get(path);
    if (!node) throw new Error(`ENOENT: ${path}`);
    this.nodes.set(path, { ...node, mode });
  }

  rm(path: string, options: { recursive: boolean; force: boolean }): void {
    if (!this.nodes.has(path)) {
      if (options.force) return;
      throw new Error(`ENOENT: ${path}`);
    }
    if (options.recursive) {
      const prefix = `${path}/`;
      for (const key of Array.from(this.nodes.keys())) {
        if (key === path || key.startsWith(prefix)) this.nodes.delete(key);
      }
      return;
    }
    this.nodes.delete(path);
  }

  rename(from: string, to: string): void {
    const node = this.nodes.get(from);
    if (!node) throw new Error(`ENOENT: ${from}`);
    this.nodes.delete(from);
    this.nodes.set(to, node);
  }

  readdir(path: string): readonly string[] {
    const prefix = `${path}/`;
    const out = new Set<string>();
    for (const key of this.nodes.keys()) {
      if (key === path) continue;
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        if (!rest.includes("/")) out.add(rest);
      }
    }
    return Array.from(out).sort();
  }

  // Test helpers
  snapshot(): Map<string, FsNode> { return new Map(this.nodes); }
  hasMode(path: string, mode: number): boolean {
    const node = this.nodes.get(path);
    return node !== undefined && (node.mode & mode) === mode;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(args: {
  version?: string;
  architecture?: "arm64" | "x64";
  artifacts?: { name: string; content: Buffer }[];
  licenses?: { name: string; content: Buffer }[];
}): import("../src/ops").ReleaseManifest {
  const version = args.version ?? "1.2.3";
  const architecture = args.architecture ?? "arm64";
  const artifactEntries = args.artifacts ?? [{ name: "bridge", content: Buffer.from("bridge-binary-v1") }];
  const licenseEntries = args.licenses ?? [{ name: "MIT", content: Buffer.from("MIT License text") }];
  return {
    schemaVersion: 1,
    product: "pi-mob-bridge",
    version,
    architecture,
    bun: { minimum: "1.3.14" },
    protocolVersion: "1.0",
    minMacos: "13.0",
    artifacts: artifactEntries.map((entry) => ({
      name: entry.name,
      kind: "daemon-binary" as const,
      path: `/releases/${version}/${entry.name}`,
      sha256: sha256Of(entry.content),
      size: entry.content.length,
    })),
    licenses: licenseEntries.map((entry) => ({
      name: entry.name,
      kind: "spdx" as const,
      path: `/releases/${version}/licenses/${entry.name}`,
      sha256: sha256Of(entry.content),
    })),
  };
}

const ROOT_PREFIX = mkdtempSync(join(tmpdir(), "pi-mob-m7-"));

function absoluteInstallRoot(label: string): string {
  return `${ROOT_PREFIX}/${label}`;
}

function newFs(): InMemoryFileSystem {
  return new InMemoryFileSystem();
}

beforeEach(() => {
  // Reset clock on each test by clearing; in-memory FS resets per instance.
});

afterEach(() => {
  // No global filesystem to clean up; mkdtempSync root lives until the
  // process exits.
});

// ---------------------------------------------------------------------------
// Release manifest
// ---------------------------------------------------------------------------

describe("release-manifest", () => {
  test("parseManifest round-trips through formatManifest", () => {
    const manifest = makeManifest({});
    const formatted = formatManifest(manifest);
    const parsed = parseManifest(formatted);
    expect(parsed).toEqual(manifest);
  });

  test("formatManifest emits canonical JSON (key order independent)", () => {
    const a = makeManifest({});
    const shuffled = {
      version: a.version,
      product: a.product,
      architecture: a.architecture,
      licenses: a.licenses,
      artifacts: a.artifacts,
      bun: a.bun,
      protocolVersion: a.protocolVersion,
      minMacos: a.minMacos,
      schemaVersion: a.schemaVersion,
    };
    const canonicalA = formatManifest(a);
    const canonicalShuffled = formatManifest(shuffled as import("../src/ops").ReleaseManifest);
    expect(canonicalA).toBe(canonicalShuffled);
    // canonical JSON has no whitespace
    expect(canonicalA.includes("\n")).toBe(false);
    expect(canonicalA.includes(" ")).toBe(false);
  });

  test("parseManifest rejects non-JSON input", () => {
    expect(() => parseManifest("{not-json")).toThrow(ManifestError);
  });

  test("parseManifest rejects unsupported schemaVersion", () => {
    const json = JSON.stringify({ ...makeManifest({}), schemaVersion: 99 });
    expect(() => parseManifest(json)).toThrow(/unsupported schemaVersion/);
  });

  test("parseManifest rejects unknown architecture", () => {
    const json = JSON.stringify({ ...makeManifest({}), architecture: "ppc" });
    expect(() => parseManifest(json)).toThrow(/architecture/);
  });

  test("parseManifest rejects missing fields", () => {
    expect(() => parseManifest(JSON.stringify({ schemaVersion: 1 }))).toThrow(ManifestError);
  });

  test("sha256Of is stable across runs", () => {
    const value = "deterministic-input";
    expect(sha256Of(value)).toBe(sha256Of(value));
    expect(sha256Of(value)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("verifyManifest accepts matching checksums", () => {
    const fs = newFs();
    const artifactBodies: Array<{ name: string; content: Buffer }> = [
      { name: "bridge", content: Buffer.from("payload-v1") },
      { name: "schema", content: Buffer.from("schema-v1") },
    ];
    const manifest = makeManifest({
      artifacts: artifactBodies,
      licenses: [{ name: "MIT", content: Buffer.from("MIT body") }],
    });
    for (const body of artifactBodies) {
      const target = manifest.artifacts.find((a) => a.name === body.name);
      if (!target) throw new Error(`test setup: missing artifact ${body.name}`);
      fs.writeFile(target.path, body.content, 0o600);
    }
    fs.writeFile(manifest.licenses[0]!.path, Buffer.from("MIT body"), 0o600);
    const result = verifyManifest(manifest, fs);
    expect(result.ok).toBe(true);
    expect(result.artifacts.every((entry) => entry.ok)).toBe(true);
    expect(result.licenses.every((entry) => entry.ok)).toBe(true);
  });

  test("verifyManifest flags missing artifacts", () => {
    const fs = newFs();
    const manifest = makeManifest({});
    const result = verifyManifest(manifest, fs);
    expect(result.ok).toBe(false);
    expect(result.artifacts[0]!.reason).toBe("missing");
  });

  test("verifyManifest flags checksum mismatches", () => {
    const fs = newFs();
    const manifest = makeManifest({ artifacts: [{ name: "bridge", content: Buffer.from("real") }] });
    fs.writeFile(manifest.artifacts[0]!.path, Buffer.from("tampered"), 0o600);
    const result = verifyManifest(manifest, fs);
    expect(result.ok).toBe(false);
    expect(result.artifacts[0]!.reason).toBe("checksum_mismatch");
  });

  test("verifyManifest flags size mismatches (lying manifest size, intact checksum)", () => {
    // The size_mismatch check protects against a manifest that lies about
    // its artifact size while keeping the correct checksum. We construct
    // that scenario by hand: the on-disk content matches the checksum, but
    // we re-create the manifest with an inflated size field.
    const fs = newFs();
    const realContent = Buffer.from("real");
    fs.writeFile("/releases/1.2.3/bridge", realContent, 0o600);
    const manifest: import("../src/ops").ReleaseManifest = {
      schemaVersion: 1,
      product: "pi-mob-bridge",
      version: "1.2.3",
      architecture: "arm64",
      bun: { minimum: "1.3.14" },
      protocolVersion: "1.0",
      minMacos: "13.0",
      artifacts: [
        { name: "bridge", kind: "daemon-binary", path: "/releases/1.2.3/bridge", sha256: sha256Of(realContent), size: realContent.length + 1024 },
      ],
      licenses: [],
    };
    const result = verifyManifest(manifest, fs);
    expect(result.ok).toBe(false);
    expect(result.artifacts[0]!.reason).toBe("size_mismatch");
  });
});

// ---------------------------------------------------------------------------
// Install paths
// ---------------------------------------------------------------------------

describe("install-paths", () => {
  test("buildInstallPaths returns absolute, root-anchored layout", () => {
    const paths = buildInstallPaths({ installRoot: absoluteInstallRoot("paths") });
    for (const candidate of [
      paths.installRoot, paths.configFile, paths.stateRoot, paths.secretsRoot,
      paths.logRoot, paths.backupRoot, paths.binRoot, paths.plistPath,
      paths.envFile, paths.launchAgentsRoot,
    ]) {
      expect(candidate.startsWith("/")).toBe(true);
      expect(candidate.startsWith(paths.installRoot)).toBe(true);
    }
    expect(paths.launchAgentLabel).toBe(DEFAULT_LAUNCH_AGENT_LABEL);
  });

  test("buildInstallPaths rejects relative installRoot", () => {
    expect(() => buildInstallPaths({ installRoot: "relative/path" })).toThrow(InstallPathError);
  });

  test("buildInstallPaths rejects traversal segments", () => {
    expect(() => buildInstallPaths({ installRoot: `${ROOT_PREFIX}/a/../b` })).toThrow(/traversal/);
  });

  test("buildInstallPaths accepts custom label", () => {
    const paths = buildInstallPaths({ installRoot: absoluteInstallRoot("custom"), launchAgentLabel: "com.example.bridge" });
    expect(paths.plistPath.endsWith("com.example.bridge.plist")).toBe(true);
  });

  test("buildInstallPaths rejects malformed label", () => {
    expect(() => buildInstallPaths({ installRoot: absoluteInstallRoot("custom"), launchAgentLabel: "bad label!" })).toThrow(InstallPathError);
  });

  test("ensureInstallPaths creates directories at 0o700 and touches files at 0o600", () => {
    const fs = newFs();
    const paths = buildInstallPaths({ installRoot: absoluteInstallRoot("ensure") });
    ensureInstallPaths(paths, fs);
    for (const dir of [paths.installRoot, `${paths.installRoot}/release`, paths.stateRoot,
      paths.secretsRoot, paths.logRoot, paths.backupRoot, paths.binRoot, paths.launchAgentsRoot]) {
      expect(fs.exists(dir)).toBe(true);
      const stat = fs.stat(dir);
      expect(stat.isDirectory).toBe(true);
      expect(stat.mode & 0o777).toBe(DIRECTORY_MODE);
    }
    expect(fs.exists(paths.configFile)).toBe(true);
    const configStat = fs.stat(paths.configFile);
    expect(configStat.mode & 0o777).toBe(FILE_MODE);
  });
});

// ---------------------------------------------------------------------------
// Install config
// ---------------------------------------------------------------------------

describe("install-config", () => {
  function basePaths() { return buildInstallPaths({ installRoot: absoluteInstallRoot("cfg") }); }

  test("defaultInstallConfig produces a valid, loopback-only config", () => {
    const config = defaultInstallConfig({
      paths: basePaths(),
      piExecutable: "/opt/pi/0.80.6/bin/pi",
      bridgeExecutable: "/opt/pi-mob/release/bin/bridge",
      bridgeVersion: "0.0.0-m7",
      protocolVersion: "1.0",
    });
    expect(config.schemaVersion).toBe(1);
    expect(config.hostname).toBe("127.0.0.1");
    expect(config.port).toBeGreaterThan(0);
    for (const key of ["piExecutable", "bridgeExecutable", "stateRoot", "logRoot",
      "backupRoot", "secretsRoot"] as const) {
      expect(config[key].startsWith("/")).toBe(true);
    }
  });

  test("defaultInstallConfig rejects non-loopback hostname", () => {
    expect(() => defaultInstallConfig({
      paths: basePaths(),
      piExecutable: "/opt/pi/bin/pi",
      bridgeExecutable: "/opt/pi-mob/bin/bridge",
      bridgeVersion: "0",
      protocolVersion: "1.0",
      hostname: "192.168.1.10",
    })).toThrow(/loopback/);
  });

  test("validateInstallConfig rejects bad port", () => {
    expect(() => defaultInstallConfig({
      paths: basePaths(),
      piExecutable: "/opt/pi/bin/pi",
      bridgeExecutable: "/opt/pi-mob/bin/bridge",
      bridgeVersion: "0",
      protocolVersion: "1.0",
      port: 70000,
    })).toThrow(/port/);
  });

  test("parseInstallConfig round-trips with formatInstallConfig", () => {
    const paths = basePaths();
    const config = defaultInstallConfig({
      paths,
      piExecutable: "/opt/pi/bin/pi",
      bridgeExecutable: "/opt/pi-mob/bin/bridge",
      bridgeVersion: "0.0.0-m7",
      protocolVersion: "1.0",
    });
    const formatted = formatInstallConfig(config);
    const parsed = parseInstallConfig(formatted);
    expect(parsed).toEqual(config);
  });

  test("writeInstallConfig writes with 0o600 and readInstallConfig parses", () => {
    const fs = newFs();
    const paths = basePaths();
    ensureInstallPaths(paths, fs);
    const config = defaultInstallConfig({
      paths,
      piExecutable: "/opt/pi/bin/pi",
      bridgeExecutable: "/opt/pi-mob/bin/bridge",
      bridgeVersion: "0.0.0-m7",
      protocolVersion: "1.0",
    });
    writeInstallConfig(paths.configFile, config, fs);
    const stat = fs.stat(paths.configFile);
    expect(stat.mode & 0o777).toBe(FILE_MODE);
    const readBack = readInstallConfig(paths.configFile, fs);
    expect(readBack).toEqual(config);
  });

  test("readInstallConfig rejects world-readable files", () => {
    const fs = newFs();
    const paths = basePaths();
    ensureInstallPaths(paths, fs);
    const config = defaultInstallConfig({
      paths,
      piExecutable: "/opt/pi/bin/pi",
      bridgeExecutable: "/opt/pi-mob/bin/bridge",
      bridgeVersion: "0",
      protocolVersion: "1.0",
    });
    writeInstallConfig(paths.configFile, config, fs);
    fs.chmod(paths.configFile, 0o644);
    expect(() => readInstallConfig(paths.configFile, fs)).toThrow(/owner-only/);
  });

  test("parseInstallConfig rejects path traversal", () => {
    const source = [
      `schema_version = 1`,
      `environment = "release"`,
      `bridge_version = "0"`,
      `protocol_version = "1.0"`,
      `pi_executable = "/opt/pi/bin/pi"`,
      `bridge_executable = "/opt/pi-mob/bin/bridge"`,
      `state_root = "/opt/../etc/state"`,
      `log_root = "/opt/pi-mob/release/logs"`,
      `backup_root = "/opt/pi-mob/release/backups"`,
      `secrets_root = "/opt/pi-mob/release/secrets"`,
      `hostname = "127.0.0.1"`,
      `port = 8788`,
      `tailscale_serve = true`,
    ].join("\n");
    expect(() => parseInstallConfig(source)).toThrow(/traversal/);
  });

  test("validateInstallConfig rejects non-loopback hostname", () => {
    const json = {
      schemaVersion: 1, environment: "release", bridgeVersion: "0", protocolVersion: "1.0",
      piExecutable: "/opt/pi/bin/pi", bridgeExecutable: "/opt/pi-mob/bin/bridge",
      stateRoot: "/opt/pi-mob/release/state", logRoot: "/opt/pi-mob/release/logs",
      backupRoot: "/opt/pi-mob/release/backups", secretsRoot: "/opt/pi-mob/release/secrets",
      hostname: "0.0.0.0", port: 8788, tailscaleServe: true,
    };
    // Object-level validation: catches non-loopback hostnames before any
    // TOML round-trip, which is what the install CLI hits first.
    expect(() => validateInstallConfig(json)).toThrow(/loopback/);
    // TOML round-trip: ensure the snake_case → camelCase mapping and the
    // hostname check both fire on real config input.
    const toml = [
      `schema_version = 1`,
      `environment = "release"`,
      `bridge_version = "0"`,
      `protocol_version = "1.0"`,
      `pi_executable = "/opt/pi/bin/pi"`,
      `bridge_executable = "/opt/pi-mob/bin/bridge"`,
      `state_root = "/opt/pi-mob/release/state"`,
      `log_root = "/opt/pi-mob/release/logs"`,
      `backup_root = "/opt/pi-mob/release/backups"`,
      `secrets_root = "/opt/pi-mob/release/secrets"`,
      `hostname = "0.0.0.0"`,
      `port = 8788`,
      `tailscale_serve = true`,
    ].join("\n");
    expect(() => parseInstallConfig(toml)).toThrow(/loopback/);
  });
});

// ---------------------------------------------------------------------------
// Install environment
// ---------------------------------------------------------------------------

describe("install-environment", () => {
  test("buildEnvironment composes PATH from pathDirs and merges allowed source keys", () => {
    const result = buildEnvironment({
      pathDirs: ["/opt/pi-mob/bin", "/usr/bin", "/bin"],
      source: { HOME: "/Users/test", LANG: "en_US.UTF-8", LD_PRELOAD: "/evil.so" },
    });
    expect(result.env.PATH).toBe("/opt/pi-mob/bin:/usr/bin:/bin");
    expect(result.env.HOME).toBe("/Users/test");
    expect(result.env.LANG).toBe("en_US.UTF-8");
    expect(result.rejectedKeys).toContain("LD_PRELOAD");
    expect(result.env.LD_PRELOAD).toBeUndefined();
  });

  test("buildEnvironment refuses forbidden keys even in extras", () => {
    expect(() => buildEnvironment({
      pathDirs: ["/usr/bin"],
      extras: { LD_PRELOAD: "/evil.so" },
    })).toThrow(EnvironmentBuildError);
  });

  test("buildEnvironment rejects empty pathDirs", () => {
    expect(() => buildEnvironment({ pathDirs: [] })).toThrow(EnvironmentBuildError);
  });

  test("buildEnvironment rejects non-absolute pathDirs entries", () => {
    expect(() => buildEnvironment({ pathDirs: ["relative/bin"] })).toThrow(EnvironmentBuildError);
  });

  test("buildEnvironment rejects keys containing NUL", () => {
    expect(() => buildEnvironment({
      pathDirs: ["/usr/bin"],
      source: { LANG: "en\u0000US" },
    })).toThrow(/NUL/);
  });

  test("buildEnvironment applies explicit overrides after source", () => {
    const result = buildEnvironment({
      pathDirs: ["/usr/bin"],
      source: { HOME: "/old/home" },
      home: "/new/home",
    });
    expect(result.env.HOME).toBe("/new/home");
  });

  test("default allow-list contains expected keys", () => {
    for (const key of ["HOME", "LANG", "TZ", "TMPDIR"]) {
      expect(DEFAULT_ENV_ALLOWLIST).toContain(key);
    }
    expect(FORBIDDEN_ENV_KEYS).toContain("LD_PRELOAD");
    expect(FORBIDDEN_ENV_KEYS).toContain("DYLD_INSERT_LIBRARIES");
    expect(FORBIDDEN_ENV_KEYS).toContain("NODE_OPTIONS");
  });
});

// ---------------------------------------------------------------------------
// LaunchAgent
// ---------------------------------------------------------------------------

describe("launch-agent", () => {
  function basePaths() { return buildInstallPaths({ installRoot: absoluteInstallRoot("plist") }); }

  test("validateSpec requires absolute program", () => {
    expect(() => validateSpec({
      label: "com.example.bridge",
      program: "relative/path",
      programArguments: ["relative/path"],
      workingDirectory: "/tmp",
      environment: {},
      stdoutPath: "/tmp/out",
      stderrPath: "/tmp/err",
    })).toThrow(LaunchAgentSpecError);
  });

  test("validateSpec refuses shell-like programArguments", () => {
    expect(() => validateSpec({
      label: "com.example.bridge",
      program: "/opt/pi-mob/bin/bridge",
      programArguments: ["/opt/pi-mob/bin/bridge", "--cfg=/etc/config", "echo hi"],
      workingDirectory: "/tmp",
      environment: {},
      stdoutPath: "/tmp/out",
      stderrPath: "/tmp/err",
    })).toThrow(LaunchAgentSpecError);
  });

  test("validateSpec refuses spaces in absolute programArguments", () => {
    expect(() => validateSpec({
      label: "com.example.bridge",
      program: "/opt/pi-mob/bin/bridge",
      programArguments: ["/opt/pi-mob/bin/bridge", "/opt/pi mob/bin/extra"],
      workingDirectory: "/tmp",
      environment: {},
      stdoutPath: "/tmp/out",
      stderrPath: "/tmp/err",
    })).toThrow(LaunchAgentSpecError);
  });

  test("validateSpec requires programArguments[0] to match program (no shell)", () => {
    expect(() => validateSpec({
      label: "com.example.bridge",
      program: "/opt/pi-mob/bin/bridge",
      programArguments: ["/bin/sh", "-c", "bridge"],
      workingDirectory: "/tmp",
      environment: {},
      stdoutPath: "/tmp/out",
      stderrPath: "/tmp/err",
    })).toThrow(/no shell/);
  });

  test("validateSpec refuses non-Background processType", () => {
    expect(() => validateSpec({
      label: "com.example.bridge",
      program: "/opt/pi-mob/bin/bridge",
      programArguments: ["/opt/pi-mob/bin/bridge"],
      workingDirectory: "/tmp",
      environment: {},
      stdoutPath: "/tmp/out",
      stderrPath: "/tmp/err",
      processType: "Interactive" as "Background",
    })).toThrow(/Background/);
  });

  test("renderPlist emits RunAtLoad, KeepAlive, and absolute program arguments", () => {
    const paths = basePaths();
    const xml = renderPlist({
      label: "com.pi-mob.bridge",
      program: "/opt/pi-mob/release/bin/bridge",
      programArguments: ["/opt/pi-mob/release/bin/bridge", "--config", paths.configFile],
      workingDirectory: paths.installRoot,
      environment: { HOME: paths.installRoot, PATH: "/opt/pi-mob/bin:/usr/bin" },
      stdoutPath: `${paths.logRoot}/bridge.out`,
      stderrPath: `${paths.logRoot}/bridge.err`,
    });
    expect(xml).toContain("<key>Label</key><string>com.pi-mob.bridge</string>");
    expect(xml).toContain("<key>RunAtLoad</key><true/>");
    expect(xml).toContain("<key>KeepAlive</key><true/>");
    expect(xml).toContain("<key>ProcessType</key><string>Background</string>");
    expect(xml).toContain("<string>/opt/pi-mob/release/bin/bridge</string>");
    expect(xml).toContain("<string>--config</string>");
    expect(xml).toContain(`<string>${paths.configFile}</string>`);
    expect(xml).toContain("<key>HOME</key><string>");
    expect(xml).toContain("<key>PATH</key><string>/opt/pi-mob/bin:/usr/bin</string>");
    expect(xml.startsWith("<?xml")).toBe(true);
    expect(xml.trim().endsWith("</plist>")).toBe(true);
  });

  test("writePlist writes the plist with 0o600 and validates first", () => {
    const fs = newFs();
    const paths = basePaths();
    ensureInstallPaths(paths, fs);
    const plistPath = paths.plistPath;
    writePlist(plistPath, {
      label: "com.pi-mob.bridge",
      program: "/opt/pi-mob/release/bin/bridge",
      programArguments: ["/opt/pi-mob/release/bin/bridge", "--config", paths.configFile],
      workingDirectory: paths.installRoot,
      environment: { HOME: paths.installRoot, PATH: "/opt/pi-mob/bin:/usr/bin" },
      stdoutPath: `${paths.logRoot}/bridge.out`,
      stderrPath: `${paths.logRoot}/bridge.err`,
    }, fs);
    const stat = fs.stat(plistPath);
    expect(stat.mode & 0o777).toBe(FILE_MODE);
    const written = fs.readFile(plistPath).toString("utf8");
    expect(written).toContain("<key>Label</key><string>com.pi-mob.bridge</string>");
  });

  test("writePlist refuses to write an invalid spec", () => {
    const fs = newFs();
    const paths = basePaths();
    ensureInstallPaths(paths, fs);
    expect(() => writePlist(paths.plistPath, {
      label: "bad label!",
      program: "/opt/pi-mob/release/bin/bridge",
      programArguments: ["/opt/pi-mob/release/bin/bridge"],
      workingDirectory: paths.installRoot,
      environment: { HOME: paths.installRoot },
      stdoutPath: `${paths.logRoot}/bridge.out`,
      stderrPath: `${paths.logRoot}/bridge.err`,
    }, fs)).toThrow(LaunchAgentSpecError);
    expect(fs.exists(paths.plistPath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

describe("update", () => {
  function basePaths() { return buildInstallPaths({ installRoot: absoluteInstallRoot("upd") }); }

  function planWith(migrationClass: "binary_only" | "reversible_migration" | "restore_required") {
    return planUpdate({
      currentVersion: "1.0.0",
      targetManifest: makeManifest({ version: "2.0.0" }),
      targetRoot: basePaths().installRoot,
      migrationClass,
    });
  }

  test("planUpdate produces stable, deterministic planId", () => {
    const a = planWith("binary_only");
    const b = planWith("binary_only");
    expect(a.planId).toBe(b.planId);
    expect(a.planId).toMatch(/^[0-9a-f]{32}$/);
  });

  test("planUpdate rejects identical versions", () => {
    expect(() => planUpdate({
      currentVersion: "1.0.0",
      targetManifest: makeManifest({ version: "1.0.0" }),
      targetRoot: basePaths().installRoot,
      migrationClass: "binary_only",
    })).toThrow(/match/);
  });

  test("binary_only plan has no migrate or generation-reset", () => {
    const plan = planWith("binary_only");
    expect(plan.stages).toEqual(["preflight", "checksum-verify", "backup", "swap", "post-verify", "finalize"]);
    expect(plan.stages.includes("migrate")).toBe(false);
    expect(plan.stages.includes("generation-reset")).toBe(false);
  });

  test("reversible_migration plan includes migrate but no generation-reset", () => {
    const plan = planWith("reversible_migration");
    expect(plan.stages).toEqual(["preflight", "checksum-verify", "backup", "migrate", "swap", "post-verify", "finalize"]);
    expect(plan.stages.includes("migrate")).toBe(true);
    expect(plan.stages.includes("generation-reset")).toBe(false);
  });

  test("restore_required plan includes generation-reset after migrate", () => {
    const plan = planWith("restore_required");
    expect(plan.stages).toEqual([
      "preflight", "checksum-verify", "backup", "migrate", "generation-reset", "swap", "post-verify", "finalize",
    ]);
    expect(plan.stages.indexOf("generation-reset")).toBeGreaterThan(plan.stages.indexOf("migrate"));
    expect(plan.stages.indexOf("generation-reset")).toBeLessThan(plan.stages.indexOf("swap"));
  });

  test("executeUpdate runs every stage and records success", async () => {
    const plan = planWith("binary_only");
    const calls: string[] = [];
    const result = await executeUpdate({
      plan,
      ports: { fs: newFs(), clock: systemClock() },
      hooks: {
        preflight: () => { calls.push("preflight"); },
        verifyTarget: () => { calls.push("checksum-verify"); },
        backup: () => { calls.push("backup"); return "backup-1.0.0-1234"; },
        swap: () => { calls.push("swap"); },
        postVerify: () => { calls.push("post-verify"); },
        finalize: () => { calls.push("finalize"); },
      },
      rollback: {
        restore: () => { calls.push("restore"); },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.completed).toEqual(plan.stages);
    expect(result.backupId).toBe("backup-1.0.0-1234");
    expect(result.error).toBeNull();
    // Hooks map: verifyTarget ↔ checksum-verify, postVerify ↔ post-verify.
    expect(calls).toEqual([...plan.stages]);
  });

  test("executeUpdate rolls back when a stage throws and records the failing stage", async () => {
    const plan = planWith("binary_only");
    const calls: string[] = [];
    const result = await executeUpdate({
      plan,
      ports: { fs: newFs(), clock: systemClock() },
      hooks: {
        preflight: () => { calls.push("preflight"); },
        verifyTarget: () => { calls.push("verifyTarget"); },
        backup: () => { calls.push("backup"); return "backup-1.0.0-1234"; },
        swap: () => { calls.push("swap"); throw new Error("swap exploded"); },
        postVerify: () => { calls.push("postVerify"); },
        finalize: () => { calls.push("finalize"); },
      },
      rollback: {
        restore: () => { calls.push("restore"); },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(result.backupId).toBe("backup-1.0.0-1234");
    expect(result.error).not.toBeNull();
    expect(result.error?.stage).toBe("swap");
    expect(result.error?.message).toContain("swap exploded");
    expect(calls).toContain("restore");
    expect(calls).not.toContain("postVerify");
    expect(calls).not.toContain("finalize");
  });

  test("executeUpdate invokes generation-reset for restore_required", async () => {
    const plan = planWith("restore_required");
    const calls: string[] = [];
    const result = await executeUpdate({
      plan,
      ports: { fs: newFs(), clock: systemClock() },
      hooks: {
        preflight: () => { calls.push("preflight"); },
        verifyTarget: () => { calls.push("verifyTarget"); },
        backup: () => { calls.push("backup"); return "backup-1.0.0-1234"; },
        migrate: () => { calls.push("migrate"); },
        generationReset: () => { calls.push("generationReset"); },
        swap: () => { calls.push("swap"); },
        postVerify: () => { calls.push("postVerify"); },
        finalize: () => { calls.push("finalize"); },
      },
      rollback: { restore: () => { calls.push("restore"); } },
    });
    expect(result.ok).toBe(true);
    expect(calls).toContain("generationReset");
    expect(calls.indexOf("generationReset")).toBeGreaterThan(calls.indexOf("migrate"));
    expect(calls.indexOf("generationReset")).toBeLessThan(calls.indexOf("swap"));
  });

  test("executeUpdate refuses to skip rollback hooks on failure", async () => {
    const plan = planWith("binary_only");
    const result = await executeUpdate({
      plan,
      ports: { fs: newFs(), clock: systemClock() },
      hooks: {
        backup: () => "backup-1.0.0-1234",
        swap: () => { throw new Error("swap failed"); },
      },
      rollback: {}, // no restore hook
    });
    expect(result.ok).toBe(false);
    expect(result.rolledBack).toBe(false);
    expect(result.error?.message).toContain("swap failed");
  });

  test("executeUpdate timestamp is provided by the injected clock", async () => {
    const plan = planWith("binary_only");
    let observed = "";
    const fixedClock = { now: () => 0, iso: () => "1970-01-01T00:00:00.000Z" };
    const result = await executeUpdate({
      plan,
      ports: { fs: newFs(), clock: fixedClock },
      hooks: {
        preflight: () => { observed = fixedClock.iso(); },
        backup: () => "backup-1.0.0-1234",
      },
      rollback: {},
    });
    expect(observed).toBe("1970-01-01T00:00:00.000Z");
    expect(result.timestamp).toBe("1970-01-01T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

describe("rollback", () => {
  test("planRollback stages for binary_only do not include generation-reset", () => {
    const plan = planRollback({
      currentVersion: "2.0.0",
      backupId: "backup-1.0.0-1234",
      migrationClass: "binary_only",
    });
    expect(plan.requiresGenerationReset).toBe(false);
    expect(plan.stages).toEqual(["preflight", "verify-backup", "swap", "verify-target", "finalize"]);
  });

  test("planRollback stages for restore_required restore before generation-reset", () => {
    const plan = planRollback({
      currentVersion: "2.0.0",
      backupId: "backup-1.0.0-1234",
      migrationClass: "restore_required",
    });
    expect(plan.requiresGenerationReset).toBe(true);
    expect(plan.stages).toEqual([
      "preflight", "verify-backup", "swap", "generation-reset", "verify-target", "finalize",
    ]);
    expect(plan.stages.indexOf("swap")).toBeLessThan(plan.stages.indexOf("generation-reset"));
  });

  test("executeRollback invokes generationReset after swap for restore_required", async () => {
    const plan = planRollback({
      currentVersion: "2.0.0",
      backupId: "backup-1.0.0-1234",
      migrationClass: "restore_required",
    });
    const calls: string[] = [];
    const result = await executeRollback({
      plan,
      ports: { clock: systemClock() },
      hooks: {
        preflight: () => { calls.push("preflight"); },
        verifyBackup: () => { calls.push("verify-backup"); },
        generationReset: () => { calls.push("generationReset"); },
        swap: () => { calls.push("swap"); },
        verifyTarget: () => { calls.push("verifyTarget"); },
        finalize: () => { calls.push("finalize"); },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.generationResetInvoked).toBe(true);
    expect(calls.indexOf("swap")).toBeLessThan(calls.indexOf("generationReset"));
  });

  test("executeRollback refuses to proceed without generationReset hook for restore_required", async () => {
    const plan = planRollback({
      currentVersion: "2.0.0",
      backupId: "backup-1.0.0-1234",
      migrationClass: "restore_required",
    });
    const result = await executeRollback({
      plan,
      ports: { clock: systemClock() },
      hooks: { swap: () => { throw new Error("must not be called"); } },
    });
    expect(result.ok).toBe(false);
    expect(result.generationResetInvoked).toBe(false);
    expect(result.error?.stage).toBe("generation-reset");
  });

  test("executeRollback binary_only does not invoke generation reset", async () => {
    const plan = planRollback({
      currentVersion: "2.0.0",
      backupId: "backup-1.0.0-1234",
      migrationClass: "binary_only",
    });
    const calls: string[] = [];
    const result = await executeRollback({
      plan,
      ports: { clock: systemClock() },
      hooks: {
        preflight: () => { calls.push("preflight"); },
        verifyBackup: () => { calls.push("verify-backup"); },
        swap: () => { calls.push("swap"); },
        verifyTarget: () => { calls.push("verifyTarget"); },
        finalize: () => { calls.push("finalize"); },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.generationResetInvoked).toBe(false);
    expect(calls).not.toContain("generationReset");
  });

  test("executeRollback reports failing stage when swap throws", async () => {
    const plan = planRollback({
      currentVersion: "2.0.0",
      backupId: "backup-1.0.0-1234",
      migrationClass: "reversible_migration",
    });
    const result = await executeRollback({
      plan,
      ports: { clock: systemClock() },
      hooks: {
        preflight: () => undefined,
        verifyBackup: () => undefined,
        swap: () => { throw new Error("swap failed"); },
        verifyTarget: () => undefined,
        finalize: () => undefined,
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error?.stage).toBe("swap");
    expect(result.error?.message).toContain("swap failed");
  });
});

// ---------------------------------------------------------------------------
// Uninstall
// ---------------------------------------------------------------------------

describe("uninstall", () => {
  function basePaths(piSessionDir: string) {
    const base = buildInstallPaths({ installRoot: absoluteInstallRoot("uninst") });
    return { ...base, piSessionDir };
  }

  test("planUninstall retain_data preserves state, secrets, logs, backups, and the Pi session dir", () => {
    const paths = basePaths("/Users/test/pi-mob-sessions");
    const plan = planUninstall({
      mode: "retain_data",
      paths,
      fs: newFs(),
      clock: systemClock(),
    });
    expect(plan.remove).toContain(paths.plistPath);
    expect(plan.remove).toContain(paths.binRoot);
    expect(plan.remove).toContain(paths.configFile);
    expect(plan.preserve).toContain(paths.stateRoot);
    expect(plan.preserve).toContain(paths.secretsRoot);
    expect(plan.preserve).toContain(paths.logRoot);
    expect(plan.preserve).toContain(paths.backupRoot);
    expect(plan.preserve).toContain(paths.envFile);
    expect(plan.preserve).toContain(paths.piSessionDir);
    expect(plan.piSessionDirRemoved).toBe(false);
  });

  test("planUninstall remove_state removes state, secrets, logs, backups; preserves Pi session dir", () => {
    const paths = basePaths("/Users/test/pi-mob-sessions");
    const plan = planUninstall({
      mode: "remove_state",
      paths,
      fs: newFs(),
      clock: systemClock(),
    });
    expect(plan.remove).toContain(paths.stateRoot);
    expect(plan.remove).toContain(paths.secretsRoot);
    expect(plan.remove).toContain(paths.logRoot);
    expect(plan.remove).toContain(paths.backupRoot);
    expect(plan.remove).toContain(paths.envFile);
    expect(plan.remove).toContain(paths.installRoot);
    expect(plan.preserve).toContain(paths.piSessionDir);
    expect(plan.piSessionDirRemoved).toBe(false);
  });

  test("planUninstall full still preserves the Pi session dir by default", () => {
    const paths = basePaths("/Users/test/pi-mob-sessions");
    const plan = planUninstall({
      mode: "full",
      paths,
      fs: newFs(),
      clock: systemClock(),
    });
    expect(plan.remove).toContain(paths.installRoot);
    expect(plan.remove).toContain(paths.binRoot);
    expect(plan.remove).toContain(paths.plistPath);
    expect(plan.preserve).toContain(paths.piSessionDir);
    expect(plan.piSessionDirRemoved).toBe(false);
  });

  test("planUninstall full + removePiSessionDir removes the Pi session dir", () => {
    const paths = basePaths("/Users/test/pi-mob-sessions");
    const plan = planUninstall({
      mode: "full",
      paths,
      fs: newFs(),
      clock: systemClock(),
      removePiSessionDir: true,
    });
    expect(plan.remove).toContain(paths.piSessionDir);
    expect(plan.piSessionDirRemoved).toBe(true);
  });

  test("executeUninstall actually removes the planned files and reports them", () => {
    const fs = newFs();
    const paths = basePaths("/Users/test/pi-mob-sessions");
    ensureInstallPaths(paths, fs);
    // Touch the plist so it exists before uninstall.
    fs.writeFile(paths.plistPath, Buffer.from("<plist/>"), 0o600);
    fs.writeFile(`${paths.binRoot}/bridge`, Buffer.from("binary"), 0o600);
    fs.writeFile(paths.configFile, formatInstallConfig(defaultInstallConfig({
      paths, piExecutable: "/opt/pi/bin/pi", bridgeExecutable: "/opt/pi-mob/bin/bridge",
      bridgeVersion: "0", protocolVersion: "1.0",
    })), 0o600);
    const result = executeUninstall({
      mode: "retain_data",
      paths,
      fs,
      clock: systemClock(),
    });
    expect(result.removed).toContain(paths.plistPath);
    expect(result.removed).toContain(paths.binRoot);
    expect(result.removed).toContain(paths.configFile);
    expect(result.piSessionDirRemoved).toBe(false);
    expect(fs.exists(paths.stateRoot)).toBe(true);
    expect(fs.exists(paths.secretsRoot)).toBe(true);
    expect(fs.exists(paths.logRoot)).toBe(true);
    expect(fs.exists(paths.backupRoot)).toBe(true);
  });

  test("executeUninstall full mode does not remove the Pi session dir", () => {
    const fs = newFs();
    const paths = basePaths("/Users/test/pi-mob-sessions");
    ensureInstallPaths(paths, fs);
    fs.writeFile(`${paths.binRoot}/bridge`, Buffer.from("binary"), 0o600);
    // pretend the Pi session dir exists on a different root
    fs.mkdir(paths.piSessionDir, { recursive: true, mode: 0o700 });
    fs.writeFile(`${paths.piSessionDir}/session-1.json`, Buffer.from("{}"), 0o600);
    const result = executeUninstall({
      mode: "full",
      paths,
      fs,
      clock: systemClock(),
    });
    expect(fs.exists(paths.piSessionDir)).toBe(true);
    expect(fs.exists(`${paths.piSessionDir}/session-1.json`)).toBe(true);
    expect(result.piSessionDirRemoved).toBe(false);
  });

  test("executeUninstall with removePiSessionDir=true removes the Pi session dir", () => {
    const fs = newFs();
    const paths = basePaths("/Users/test/pi-mob-sessions");
    ensureInstallPaths(paths, fs);
    fs.mkdir(paths.piSessionDir, { recursive: true, mode: 0o700 });
    fs.writeFile(`${paths.piSessionDir}/session-1.json`, Buffer.from("{}"), 0o600);
    const result = executeUninstall({
      mode: "full",
      paths,
      fs,
      clock: systemClock(),
      removePiSessionDir: true,
    });
    expect(fs.exists(paths.piSessionDir)).toBe(false);
    expect(result.piSessionDirRemoved).toBe(true);
    expect(result.removed).toContain(paths.piSessionDir);
  });

  test("planUninstall refuses filesystem roots as recursive removal targets", () => {
    const paths = { ...basePaths("/Users/test/pi-mob-sessions"), installRoot: "/" };
    expect(() => planUninstall({ mode: "full", paths, fs: newFs(), clock: systemClock() })).toThrow(/too broad/);
    expect(() => planUninstall({ mode: "full", paths: { ...basePaths("/Users/test/pi-mob-sessions"), piSessionDir: "/" }, removePiSessionDir: true, fs: newFs(), clock: systemClock() })).toThrow(/too broad/);
  });

  test("planUninstall refuses non-absolute Pi session dir", () => {
    const paths = basePaths("relative/pi-sessions");
    expect(() => planUninstall({
      mode: "retain_data",
      paths,
      fs: newFs(),
      clock: systemClock(),
    })).toThrow(InstallPathError);
  });

  test("executeUninstall refuses paths outside installRoot by default", () => {
    const fs = newFs();
    const paths = basePaths("/Users/test/pi-mob-sessions");
    // Manually craft a configFile that escapes the install root via '..'.
    // planUninstall validates absolute + traversal before any FS work, so
    // this test exercises the safety guard without touching disk.
    const badPaths = { ...paths, configFile: `${paths.installRoot}/../etc/passwd` };
    expect(() => planUninstall({
      mode: "full",
      paths: badPaths,
      fs,
      clock: systemClock(),
    })).toThrow(/path-traversal/);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: barrel exports surface + composition
// ---------------------------------------------------------------------------

describe("ops barrel composition", () => {
  test("plan + execute a full restore_required flow end-to-end (in-memory)", async () => {
    const fs = newFs();
    const paths = buildInstallPaths({ installRoot: absoluteInstallRoot("e2e") });
    ensureInstallPaths(paths, fs);

    // Stage 1: install initial 1.0.0 release
    fs.writeFile(`${paths.binRoot}/bridge`, Buffer.from("bridge-1.0.0"), 0o600);
    const initialConfig = defaultInstallConfig({
      paths,
      piExecutable: "/opt/pi/bin/pi",
      bridgeExecutable: `${paths.binRoot}/bridge`,
      bridgeVersion: "1.0.0",
      protocolVersion: "1.0",
    });
    writeInstallConfig(paths.configFile, initialConfig, fs);

    // Stage 2: produce target 2.0.0 manifest
    const newContent = Buffer.from("bridge-2.0.0");
    const targetManifest = makeManifest({
      version: "2.0.0",
      artifacts: [{ name: "bridge", content: newContent }],
      licenses: [],
    });
    fs.writeFile(targetManifest.artifacts[0]!.path, newContent, 0o600);
    const verified = verifyManifest(targetManifest, fs);
    expect(verified.ok).toBe(true);

    // Stage 3: plan and execute the update
    const plan = planUpdate({
      currentVersion: "1.0.0",
      targetManifest,
      targetRoot: paths.installRoot,
      migrationClass: "restore_required",
    });

    let backed = "";
    let generationResetInvocations = 0;
    const result = await executeUpdate({
      plan,
      ports: { fs, clock: systemClock() },
      hooks: {
        preflight: () => undefined,
        verifyTarget: () => undefined,
        backup: () => { backed = `backup-${initialConfig.bridgeVersion}-e2e`; return backed; },
        migrate: () => undefined,
        generationReset: () => { generationResetInvocations += 1; },
        swap: () => {
          // Simulate swap by replacing the binary on the install root.
          fs.writeFile(`${paths.binRoot}/bridge`, newContent, 0o600);
        },
        postVerify: () => undefined,
        finalize: () => undefined,
      },
      rollback: {
        restore: () => undefined,
        generationReset: () => { generationResetInvocations += 1; },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.backupId).toBe(backed);
    expect(generationResetInvocations).toBe(1);
    expect(fs.readFile(`${paths.binRoot}/bridge`).toString("utf8")).toBe("bridge-2.0.0");
  });

  test("ManifestError and migration-class error types are exported", () => {
    expect(typeof ManifestError).toBe("function");
    expect(typeof UninstallPlanError).toBe("function");
    expect(typeof InstallConfigValidationError).toBe("function");
    expect(typeof InstallPathError).toBe("function");
    expect(typeof LaunchAgentSpecError).toBe("function");
  });
});

// Type-only export guard: keep TypeScript honest about which types the
// barrel re-exports. The void-cast reference below resolves the type but
// produces no runtime code.
type _Expected = MigrationClass;
void (null as _Expected | null);
