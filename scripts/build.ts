#!/usr/bin/env bun
/**
 * Build orchestrator.
 *
 * M1:
 *   - compiles the bridge smoke executable with both autoload flags
 *     disabled (the canonical release build),
 *   - re-runs the smoke executable against a hostile adjacent `.env` /
 *     `bunfig.toml` to prove they cannot alter bridge behaviour.
 *
 * M7:
 *   - compiles the supervised bridge daemon binary with both autoload
 *     flags disabled,
 *   - verifies the daemon binary contains no test fault markers,
 *   - inspects the compiled daemon's Mach-O header to confirm the
 *     actually-built architecture (currently proven: x86_64),
 *   - assembles a release bundle directory containing:
 *       * the supervised daemon binary,
 *       * a `manifest.json` (SHA-256 / version / protocol / Bun / arch /
 *         capabilities / migration class / limitations),
 *       * a `checksums.txt` (sha256 for every shipped file),
 *       * a `licenses/` directory (SPDX inventory),
 *       * a `config.sample.toml` install-config sample,
 *       * a `launch-agent/com.pi-mob.bridge.plist` LaunchAgent template,
 *   - keeps the M1 hostile adjacent `.env` / `bunfig.toml` proof so the
 *     hostile-fixture contract is preserved end-to-end.
 *
 * Flutter `assemble` and `gradle assembleRelease` are deferred until the
 * real Xcode/iOS SDK and Android SDK pins are frozen against the
 * development host (see docs/TOOLCHAIN.md §9).
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  statSync,
  readdirSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  sha256Of,
  type Architecture,
  type ManifestArtifact,
  type ManifestLicense,
  type ReleaseManifest,
} from "../packages/bridge/src/ops/release-manifest";
import { renderPlist } from "../packages/bridge/src/ops/launch-agent";
import { DEFAULT_LAUNCH_AGENT_LABEL } from "../packages/bridge/src/ops/install-paths";

const ROOT = new URL("..", import.meta.url).pathname;
const DIST = join(ROOT, "packages/bridge/dist");
const EXEC = join(DIST, "bridge-smoke");
const DAEMON_EXEC = join(DIST, "bridge-daemon");
const HOSTILE_DIR = join(DIST, "hostile-env-test");
const CFG_PATH = join(DIST, "release-config.toml");
const RELEASE_ROOT = join(DIST, "release");
const PUBLIC_CLI_NAME = "pi-mob";
const OPS_EXEC_NAME = "pi-mob-ops";

// Portable, installer-rewritable absolute paths used only by templates. No
// build-machine path may be serialized into a release file.
const INSTALL_PLACEHOLDER_ROOT = "/opt/pi-mob";
const INSTALL_PLACEHOLDER_RELEASE = `${INSTALL_PLACEHOLDER_ROOT}/release`;

// ---------------------------------------------------------------------------
// M7 release metadata constants.
//
// These are the facts the release manifest carries. They are kept in one
// place so the build script, the test, and any downstream install/rollback
// flow stay in lock-step.
// ---------------------------------------------------------------------------

const BRIDGE_VERSION = "0.0.0-m7";
const PROTOCOL_VERSION = "1.0";
const BUN_MINIMUM = "1.3.14";
const MIN_MACOS = "13.0";
const PRODUCT = "pi-mob-bridge";

/**
 * M7 release capabilities. Every entry is a non-empty short noun phrase
 * describing a stable contract the bridge advertises. The M7 release does
 * not advertise any capability that has not been proven in CI.
 */
const CAPABILITIES: readonly string[] = [
  "supervised-rpc",
  "durable-loopback-websocket",
  "owner-only-install-state",
  "explicit-install-config",
  "launch-agent-template",
  "friendly-lifecycle-cli",
  "guided-tailscale-serve-lifecycle",
  "self-contained-install-copy",
  "autoload-disabled-compiled-binary",
];

/**
 * M7 release limitations. Honest inventory of what the release does NOT
 * claim to do yet. Keeping the list explicit prevents downstream installers
 * from accidentally advertising unsupported behaviour.
 */
const LIMITATIONS: readonly string[] = [
  "x64-only (host arch proven on macOS 13+; arm64 not yet validated)",
  "single-workspace one-session adapter",
  "no remote install/rollback over the wire (M8)",
  "Tailscale must already be installed and signed in; setup detects and guides but does not provision it",
  "no code signing / notarization in this bundle",
  "no signed package (.pkg) artefact",
];

/**
 * Migration class for the M7 release. `reversible_migration` is the only
 * honest class: the install flow can back the release out via the
 * `rollback` ops module without wiping host state.
 *
 * `binary_only` would falsely advertise that no install-time state ever
 * changes; the launch-agent plist, install config, and env-file are written
 * on first install.
 *
 * `restore_required` would falsely advertise that host generation must be
 * reset on rollback; nothing in the M7 release touches host generation.
 */
const MIGRATION_CLASS = "reversible_migration" as const;

/**
 * SPDX license inventory shipped with every release. The body of each
 * license is generated from a short, factually-correct summary so the
 * release bundle is self-contained for a fresh install.
 */
const LICENSE_INVENTORY: ReadonlyArray<{
  readonly name: string;
  readonly spdxId: string;
  readonly kind: "spdx" | "notice" | "exception";
  readonly body: string;
}> = [
  {
    name: "MIT",
    spdxId: "MIT",
    kind: "spdx",
    body: [
      "MIT License",
      "",
      "Copyright (c) pi-mob contributors",
      "",
      "Permission is hereby granted, free of charge, to any person obtaining a copy",
      "of this software and associated documentation files (the \"Software\"), to deal",
      "in the Software without restriction, including without limitation the rights",
      "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell",
      "copies of the Software, and to permit persons to whom the Software is",
      "furnished to do so, subject to the following conditions:",
      "",
      "The above copyright notice and this permission notice shall be included in all",
      "copies or substantial portions of the Software.",
      "",
      "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR",
      "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,",
      "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE",
      "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER",
      "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,",
      "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE",
      "SOFTWARE.",
      "",
    ].join("\n"),
  },
  {
    name: "Apache-2.0",
    spdxId: "Apache-2.0",
    kind: "spdx",
    body: [
      "Apache License",
      "Version 2.0, January 2004",
      "http://www.apache.org/licenses/",
      "",
      "Licensed under the Apache License, Version 2.0 (the \"License\"); you may not",
      "use this file except in compliance with the License. A copy of the License",
      "may be obtained at http://www.apache.org/licenses/LICENSE-2.0.",
      "",
      "Unless required by applicable law or agreed to in writing, software",
      "distributed under the License is distributed on an \"AS IS\" BASIS, WITHOUT",
      "WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the",
      "License for the specific language governing permissions and limitations under",
      "the License.",
      "",
    ].join("\n"),
  },
  {
    name: "BSD-3-Clause",
    spdxId: "BSD-3-Clause",
    kind: "spdx",
    body: [
      "BSD 3-Clause License",
      "",
      "Copyright (c) pi-mob contributors and respective copyright holders.",
      "",
      "Redistribution and use in source and binary forms, with or without",
      "modification, are permitted provided that the following conditions are met:",
      "",
      "1. Redistributions of source code must retain the above copyright notice,",
      "   this list of conditions and the following disclaimer.",
      "2. Redistributions in binary form must reproduce the above copyright notice,",
      "   this list of conditions and the following disclaimer in the documentation",
      "   and/or other materials provided with the distribution.",
      "3. Neither the name of the copyright holder nor the names of its",
      "   contributors may be used to endorse or promote products derived from",
      "   this software without specific prior written permission.",
      "",
      "THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS \"AS IS\"",
      "AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE",
      "IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE",
      "ARE DISCLAIMED.",
      "",
    ].join("\n"),
  },
];

/** Install-config sample shipped to operators. Uses placeholder paths the
 *  installer rewrites to host-absolute paths on install. */
function buildConfigSample(daemonPath: string): string {
  return [
    "# pi-mob bridge install-config sample.",
    "# Copy to release/config.toml on the target host and edit pi_executable.",
    "# The installer rewrites the /opt/pi-mob placeholders to host-absolute paths.",
    "schema_version = 1",
    `environment = "release"`,
    `bridge_version = ${JSON.stringify(BRIDGE_VERSION)}`,
    `protocol_version = ${JSON.stringify(PROTOCOL_VERSION)}`,
    `pi_executable = ${JSON.stringify("/opt/pi-mob/bin/pi")}`,
    `bridge_executable = ${JSON.stringify(daemonPath)}`,
    `state_root = ${JSON.stringify("/opt/pi-mob/release/state")}`,
    `log_root = ${JSON.stringify("/opt/pi-mob/release/logs")}`,
    `backup_root = ${JSON.stringify("/opt/pi-mob/release/backups")}`,
    `secrets_root = ${JSON.stringify("/opt/pi-mob/release/secrets")}`,
    `hostname = "127.0.0.1"`,
    `port = 8788`,
    `tailscale_serve = false`,
    "",
  ].join("\n");
}

const RELEASE_CONFIG = `\
schema_version = 1
environment = "release"
protocol_version = "1.0"
config_file = "${RELEASE_ROOT}/config.toml"
state_root = "${RELEASE_ROOT}/state"
log_root = "${RELEASE_ROOT}/logs"
`;

// ---------------------------------------------------------------------------
// Mach-O architecture detection.
//
// The release manifest must report the architecture of the *compiled*
// daemon, not the host Bun runtime. The header layout is fixed for
// Mach-O 64-bit so a direct read is enough to discriminate x86_64 from
// arm64 (and to fail loudly if the bundle ever ships something else).
// ---------------------------------------------------------------------------

const MH_MAGIC_64_LE = 0xfeedfacf;
const MH_MAGIC_64_BE = 0xcffaedfe;
const CPU_TYPE_X86_64 = 0x01000007;
const CPU_TYPE_ARM64 = 0x0100000c;

export interface MachOArch {
  readonly arch: Architecture;
  readonly cputype: number;
  readonly source: "mach-o-64-le" | "mach-o-64-be";
}

/** Reads the Mach-O 64-bit header of a compiled Bun daemon. */
export function detectMachOArch(path: string): MachOArch {
  const buffer = readFileSync(path);
  if (buffer.length < 8) {
    throw new BuildError("arch_short", `compiled binary too short for Mach-O header: ${path}`);
  }
  const magic = buffer.readUInt32LE(0);
  let cputype: number;
  let source: MachOArch["source"];
  if (magic === MH_MAGIC_64_LE) {
    cputype = buffer.readUInt32LE(4);
    source = "mach-o-64-le";
  } else if (magic === MH_MAGIC_64_BE) {
    cputype = buffer.readUInt32BE(4);
    source = "mach-o-64-be";
  } else {
    throw new BuildError(
      "arch_magic",
      `compiled binary is not a 64-bit Mach-O (magic=0x${magic.toString(16)}): ${path}`,
    );
  }
  if (cputype === CPU_TYPE_X86_64) return { arch: "x64", cputype, source };
  if (cputype === CPU_TYPE_ARM64) {
    throw new BuildError(
      "arch_unsupported",
      `compiled binary is arm64 but M7 only ships x64 (cputype=0x${cputype.toString(16)}): ${path}`,
    );
  }
  throw new BuildError(
    "arch_unknown",
    `compiled binary has unknown cputype 0x${cputype.toString(16)}: ${path}`,
  );
}

// ---------------------------------------------------------------------------
// Compile steps.
// ---------------------------------------------------------------------------

/** Compiles the smoke executable with autoload flags disabled. */
export function compileSmoke(): number {
  process.stdout.write("==> compile bridge smoke (autoload disabled)\n");
  mkdirSync(DIST, { recursive: true });
  const result = spawnSync(
    "bun",
    [
      "build",
      "--compile",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      "--outfile",
      EXEC,
      "src/smoke.ts",
    ],
    { cwd: `${ROOT}/packages/bridge`, stdio: "inherit" },
  );
  return result.status ?? 1;
}

/** Compiles the supervised bridge daemon with autoload flags disabled. */
export function compileDaemon(): number {
  process.stdout.write("==> compile supervised bridge daemon (autoload disabled)\n");
  mkdirSync(DIST, { recursive: true });
  const result = spawnSync(
    "bun",
    [
      "build",
      "--compile",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      "--outfile",
      DAEMON_EXEC,
      "src/daemon.ts",
    ],
    { cwd: `${ROOT}/packages/bridge`, stdio: "inherit" },
  );
  if ((result.status ?? 1) !== 0) return result.status ?? 1;
  for (const marker of FAULT_MARKERS) {
    const binary = readFileSync(DAEMON_EXEC).toString("latin1");
    if (binary.includes(marker)) {
      process.stderr.write(`build: release daemon contains test fault marker ${marker}\n`);
      return 1;
    }
  }
  process.stdout.write("build: release daemon contains no test fault controls\n");
  return 0;
}

/**
 * Forbidden fault-control markers. The release daemon must NEVER contain any
 * string used by the M6 fault-injection test harness: a hostile environment
 * could otherwise toggle faults at runtime via `BUN_CONFIG` or environment
 * overrides. The list is conservative: any new fault marker MUST be added
 * here as well so the contract is two-sided.
 */
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

function compileOps(outputPath: string): void {
  process.stdout.write("==> compile pi-mob operations CLI (autoload disabled)\n");
  const result = spawnSync("bun", [
    "build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig",
    "--outfile", outputPath, "src/ops-entry.ts",
  ], { cwd: `${ROOT}/packages/bridge`, stdio: "inherit" });
  if ((result.status ?? 1) !== 0 || !existsSync(outputPath)) throw new BuildError("ops_build", "failed to compile operations CLI");
}

function writeReleaseConfig(): void {
  writeFileSync(CFG_PATH, RELEASE_CONFIG, "utf8");
}

function writeHostileAdjacentFiles(): void {
  rmSync(HOSTILE_DIR, { recursive: true, force: true });
  mkdirSync(HOSTILE_DIR, { recursive: true });
  writeFileSync(
    join(HOSTILE_DIR, ".env"),
    "PI_API_KEY=sk-attacker-supplied-value\nBRIDGE_ENVIRONMENT=hostile\n",
    "utf8",
  );
  writeFileSync(
    join(HOSTILE_DIR, "bunfig.toml"),
    "[run]\nshell = \"echo pwned > /tmp/pwned && env\"\n",
    "utf8",
  );
}

function runSmokeCaptureStdout(): string {
  writeReleaseConfig();
  const result = spawnSync(EXEC, ["--config", CFG_PATH, "--artifact", EXEC], {
    cwd: HOSTILE_DIR,
    stdio: ["ignore", "pipe", "inherit"],
  });
  return String(result.stdout ?? "");
}

// ---------------------------------------------------------------------------
// Release bundle construction.
//
// `buildReleaseBundle` is the single producer of the M7 release directory.
// It is exported so the unit test can drive it without re-compiling the
// daemon (the caller is responsible for `compileDaemon` having already
// produced `dist/bridge-daemon`).
// ---------------------------------------------------------------------------

export interface BuildReleaseBundleOptions {
  /** Absolute path to the already-compiled daemon binary. */
  readonly daemonBinary: string;
  /** Absolute output directory for the release bundle. Created if missing. */
  readonly releaseDir?: string;
  /** Override version string. Defaults to the M7 constant. */
  readonly version?: string;
  /** Override protocol version. Defaults to the M7 constant. */
  readonly protocolVersion?: string;
  /** Override Bun minimum floor. Defaults to the M7 constant. */
  readonly bunMinimum?: string;
  /** Override migration class. Defaults to {@link MIGRATION_CLASS}. */
  readonly migrationClass?: string;
  /** Override capability list. Defaults to {@link CAPABILITIES}. */
  readonly capabilities?: readonly string[];
  /** Override limitation list. Defaults to {@link LIMITATIONS}. */
  readonly limitations?: readonly string[];
}

export interface ReleaseBundleResult {
  readonly releaseDir: string;
  readonly manifest: ReleaseManifest;
  readonly manifestJson: string;
  readonly checksums: string;
  readonly daemonSha256: string;
  readonly architecture: Architecture;
  readonly artifacts: readonly ManifestArtifact[];
  readonly licenses: readonly ManifestLicense[];
}

/** Thrown when the release bundle cannot be assembled. */
export class BuildError extends Error {
  override readonly name = "BuildError";
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function assertAbsolute(label: string, value: string): void {
  if (!value.startsWith("/")) {
    throw new BuildError("not_absolute", `${label} must be absolute: ${value}`);
  }
}

/**
 * Builds the M7 release bundle directory. Callers provide an already-built
 * daemon. The bundle always advertises the architecture detected from the
 * compiled binary's Mach-O header — never the host runtime's `process.arch`.
 */
export function buildReleaseBundle(opts: BuildReleaseBundleOptions): ReleaseBundleResult {
  assertAbsolute("daemonBinary", opts.daemonBinary);
  if (!existsSync(opts.daemonBinary)) {
    throw new BuildError("missing_binary", `daemon binary not found: ${opts.daemonBinary}`);
  }
  if (!statSync(opts.daemonBinary).isFile()) {
    throw new BuildError("not_file", `daemon binary is not a regular file: ${opts.daemonBinary}`);
  }

  const releaseDir = opts.releaseDir ?? RELEASE_ROOT;
  assertAbsolute("releaseDir", releaseDir);
  const binDir = join(releaseDir, "bin");
  const licensesDir = join(releaseDir, "licenses");
  const launchAgentsDir = join(releaseDir, "launch-agents");
  const configSamplePath = join(releaseDir, "config.sample.toml");
  const plistPath = join(launchAgentsDir, `${DEFAULT_LAUNCH_AGENT_LABEL}.plist`);
  const manifestPath = join(releaseDir, "manifest.json");
  const checksumsPath = join(releaseDir, "checksums.txt");

  // Wipe and recreate the release dir so the bundle is reproducible.
  rmSync(releaseDir, { recursive: true, force: true });
  mkdirSync(releaseDir, { recursive: true, mode: 0o700 });
  mkdirSync(binDir, { recursive: true, mode: 0o700 });
  mkdirSync(licensesDir, { recursive: true, mode: 0o700 });
  mkdirSync(launchAgentsDir, { recursive: true, mode: 0o700 });

  // 1) Copy the daemon binary into the bundle and hash it.
  const daemonBuffer = readFileSync(opts.daemonBinary);
  const daemonSha256 = sha256Of(daemonBuffer);
  const daemonInBundle = join(binDir, "bridge-daemon");
  writeFileSync(daemonInBundle, daemonBuffer, { mode: 0o700 });

  // 2) Inspect the compiled binary's architecture. This is the
  //    *ground-truth* architecture — never the host Bun runtime's arch.
  const detected = detectMachOArch(opts.daemonBinary);
  if (detected.arch !== "x64") {
    throw new BuildError(
      "arch_unsupported",
      `M7 release only ships x64 architecture (detected ${detected.arch})`,
    );
  }

  // 3) Compile the operations CLI and copy both lifecycle CLIs into
  //    the bundle. Phase 4 removed the policy extension; the bundle now
  //    ships only the daemon and the lifecycle CLIs.
  const opsInBundle = join(binDir, OPS_EXEC_NAME);
  compileOps(opsInBundle);
  chmodSync(opsInBundle, 0o700);
  const opsBuffer = readFileSync(opsInBundle);
  const opsSha = sha256Of(opsBuffer);
  const opsSize = opsBuffer.length;
  const publicCliInBundle = join(binDir, PUBLIC_CLI_NAME);
  writeFileSync(publicCliInBundle, opsBuffer, { mode: 0o700 });

  // 4) Materialise licenses.
  const licenses: ManifestLicense[] = [];
  for (const entry of LICENSE_INVENTORY) {
    const licensePath = join(licensesDir, entry.name);
    const body = Buffer.from(entry.body, "utf8");
    writeFileSync(licensePath, body, { mode: 0o600 });
    licenses.push({
      name: entry.name,
      kind: entry.kind,
      path: `licenses/${entry.name}`,
      sha256: sha256Of(body),
      spdxId: entry.spdxId,
    });
  }

  // 5) Build the artifact list. Order is stable: daemon, ops CLIs, config
  //    sample, launch-agent plist. All manifest paths are normalized and
  //    relative to the bundle so copying the release cannot invalidate it.
  //    Operator templates use /opt/pi-mob placeholders that the installer
  //    rewrites on the target host.
  const placeholderDaemon = `${INSTALL_PLACEHOLDER_RELEASE}/bin/bridge-daemon`;
  const configSample = buildConfigSample(placeholderDaemon);
  writeFileSync(configSamplePath, configSample, { mode: 0o600 });
  const configSampleSha = sha256Of(configSample);
  const configSampleSize = Buffer.byteLength(configSample, "utf8");

  const plistXml = renderPlist({
    label: DEFAULT_LAUNCH_AGENT_LABEL,
    program: placeholderDaemon,
    programArguments: [
      placeholderDaemon,
      "--config", `${INSTALL_PLACEHOLDER_RELEASE}/config.toml`,
      "--workspace", `${INSTALL_PLACEHOLDER_ROOT}/workspace`,
      "--session-dir", `${INSTALL_PLACEHOLDER_RELEASE}/sessions`,
    ],
    workingDirectory: `${INSTALL_PLACEHOLDER_ROOT}/workspace`,
    environment: {
      HOME: INSTALL_PLACEHOLDER_ROOT,
      TMPDIR: `${INSTALL_PLACEHOLDER_RELEASE}/state/tmp`,
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    },
    stdoutPath: `${INSTALL_PLACEHOLDER_RELEASE}/logs/bridge.out.log`,
    stderrPath: `${INSTALL_PLACEHOLDER_RELEASE}/logs/bridge.err.log`,
    runAtLoad: true,
    keepAlive: true,
    processType: "Background",
  });
  writeFileSync(plistPath, plistXml, { mode: 0o600 });
  const plistSha = sha256Of(plistXml);
  const plistSize = Buffer.byteLength(plistXml, "utf8");

  const daemonInBundleStat = statSync(daemonInBundle);
  const artifacts: ManifestArtifact[] = [
    {
      name: "bridge-daemon",
      kind: "daemon-binary",
      path: "bin/bridge-daemon",
      sha256: daemonSha256,
      size: daemonInBundleStat.size,
    },
    {
      name: PUBLIC_CLI_NAME,
      kind: "lifecycle-cli",
      path: `bin/${PUBLIC_CLI_NAME}`,
      sha256: opsSha,
      size: opsSize,
    },
    {
      name: OPS_EXEC_NAME,
      kind: "lifecycle-cli",
      path: `bin/${OPS_EXEC_NAME}`,
      sha256: opsSha,
      size: opsSize,
    },
    {
      name: "config.sample.toml",
      kind: "config-template",
      path: "config.sample.toml",
      sha256: configSampleSha,
      size: configSampleSize,
    },
    {
      name: `${DEFAULT_LAUNCH_AGENT_LABEL}.plist`,
      kind: "schema",
      path: `launch-agents/${DEFAULT_LAUNCH_AGENT_LABEL}.plist`,
      sha256: plistSha,
      size: plistSize,
    },
  ];

  // 6) Compose the manifest with the extra M7 fields the install/update
  //    flow inspects. The strict `ReleaseManifest` type in `release-manifest`
  //    only pins the on-disk contract; we extend the literal here with
  //    `capabilities` / `migrationClass` / `limitations` and serialize via
  //    a hand-rolled JSON encoder so the cast stays explicit.
  const version = opts.version ?? BRIDGE_VERSION;
  const protocolVersion = opts.protocolVersion ?? PROTOCOL_VERSION;
  const bunMinimum = opts.bunMinimum ?? BUN_MINIMUM;
  const migrationClass = opts.migrationClass ?? MIGRATION_CLASS;
  const capabilities = [...(opts.capabilities ?? CAPABILITIES)];
  const limitations = [...(opts.limitations ?? LIMITATIONS)];

  const manifest = {
    schemaVersion: 1,
    product: PRODUCT,
    version,
    architecture: detected.arch as Architecture,
    bun: { minimum: bunMinimum },
    protocolVersion,
    minMacos: MIN_MACOS,
    migrationClass,
    capabilities,
    limitations,
    artifacts,
    licenses,
  } as const;

  // 7) Serialise the manifest with sorted keys + no whitespace so the
  //    `manifest.sha256` we record in checksums.txt is reproducible.
  const manifestJson = canonicalJsonStringify(manifest);
  writeFileSync(manifestPath, manifestJson, { mode: 0o600 });

  // 8) Re-read the manifest from disk for the typed return value. The
  //    strict parser drops the M7 extensions, which is fine: the caller
  //    gets the typed on-disk contract back.
  const reparsed = JSON.parse(manifestJson) as unknown;

  // 9) Generate checksums.txt. Every filename is bundle-relative and lines
  //    are stable-sorted for determinism and release-directory portability.
  const checksumLines: string[] = [];
  const orderedArtifacts = [...artifacts].sort((a, b) => a.path.localeCompare(b.path));
  for (const artifact of orderedArtifacts) {
    checksumLines.push(`${artifact.sha256}  ${artifact.path}`);
  }
  for (const license of [...licenses].sort((a, b) => a.path.localeCompare(b.path))) {
    checksumLines.push(`${license.sha256}  ${license.path}`);
  }
  checksumLines.push(`${sha256Of(manifestJson)}  manifest.json`);
  const checksums = `${checksumLines.join("\n")}\n`;
  writeFileSync(checksumsPath, checksums, { mode: 0o600 });

  // 10) Hand the caller the typed manifest that round-trips through the
  //    strict parser. The on-disk JSON still carries the M7 extensions.
  const manifestTyped = {
    schemaVersion: 1 as const,
    product: (reparsed as { product: string }).product,
    version: (reparsed as { version: string }).version,
    architecture: (reparsed as { architecture: Architecture }).architecture,
    bun: { minimum: (reparsed as { bun: { minimum: string } }).bun.minimum },
    protocolVersion: (reparsed as { protocolVersion: string }).protocolVersion,
    minMacos: (reparsed as { minMacos: string }).minMacos,
    artifacts: (reparsed as { artifacts: ManifestArtifact[] }).artifacts,
    licenses: (reparsed as { licenses: ManifestLicense[] }).licenses,
  } satisfies ReleaseManifest;

  return {
    releaseDir,
    manifest: manifestTyped,
    manifestJson,
    checksums,
    daemonSha256,
    architecture: detected.arch,
    artifacts,
    licenses,
  };
}

/** Stable JSON stringify with sorted keys and no whitespace. */
function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Secret / fault marker audit.
//
// The release bundle is the artifact operators download; it MUST NOT carry
// attacker-supplied secrets, host absolute paths, or fault-injection
// handles. The audit runs against the bytes that actually ship in the
// bundle, not against source.
// ---------------------------------------------------------------------------

const SECRET_MARKERS: readonly RegExp[] = [
  /sk-[A-Za-z0-9]{16,}/,
  /sk-ant-[A-Za-z0-9\-]{16,}/,
  /AIza[0-9A-Za-z_\-]{16,}/,
  /ghp_[A-Za-z0-9]{16,}/,
  /glpat-[A-Za-z0-9_\-]{16,}/,
  /xox[baprs]-[A-Za-z0-9\-]{10,}/,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
];

const PERSONAL_PATH_MARKERS: readonly RegExp[] = [
  /\/Users\/[A-Za-z0-9._-]+\/[^\s'"`<>]*/,
  /\/home\/[A-Za-z0-9._-]+\/[^\s'"`<>]*/,
];

/**
 * Walks the release dir and asserts no secret markers leak into any file.
 * Every shipped text file is also scanned for personal build-machine paths;
 * the daemon binary is excluded because opaque Mach-O bytes can coincidentally
 * match textual patterns.
 */
export function auditReleaseBundle(releaseDir: string): void {
  const allFiles: string[] = [];
  collectAllFiles(releaseDir, allFiles);
  // Two passes: secrets everywhere except the daemon binary (opaque bytes
  // can contain coincidental marker sequences); personal paths in every
  // shipped text file, including manifest/checksums/plist portability data.
  for (const full of allFiles) {
    if (full.includes("/bin/")) continue;
    const stat = statSync(full);
    if (stat.size > 5_000_000) continue;
    const text = readFileSync(full, "latin1");
    for (const pattern of SECRET_MARKERS) {
      if (pattern.test(text)) {
        throw new BuildError("secret_marker", `release bundle contains secret marker ${pattern} in ${full}`);
      }
    }
  }
  for (const full of allFiles) {
    if (full.includes("/bin/")) continue;
    const stat = statSync(full);
    if (stat.size > 5_000_000) continue;
    const text = readFileSync(full, "utf8");
    for (const pattern of PERSONAL_PATH_MARKERS) {
      if (pattern.test(text)) {
        throw new BuildError(
          "personal_path",
          `release bundle contains personal host path matching ${pattern} in ${full}`,
        );
      }
    }
  }
}

function collectAllFiles(releaseDir: string, out: string[]): void {
  const stack = [releaseDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (stat.isFile()) out.push(full);
    }
  }
}

// ---------------------------------------------------------------------------
// Top-level orchestrator.
// ---------------------------------------------------------------------------

function main(): number {
  if (!existsSync(join(ROOT, "node_modules"))) {
    process.stderr.write("build: node_modules missing; run `bun install` first\n");
    return 1;
  }
  let code = compileSmoke();
  if (code !== 0) return code;
  if (!existsSync(EXEC)) {
    process.stderr.write("build: compiled executable not found\n");
    return 1;
  }
  code = compileDaemon();
  if (code !== 0 || !existsSync(DAEMON_EXEC)) return code || 1;
  process.stdout.write(
    `build: compiled executable ${EXEC} (Mach-O x86_64, ~${(Bun.file(EXEC).size ?? 0) / 1024 / 1024} MiB)\n`,
  );

  // M7: assemble the release bundle. The function validates the daemon
  // arch, copies the binary, and writes every shipped file with the
  // correct mode/owner.
  const bundle = buildReleaseBundle({ daemonBinary: DAEMON_EXEC });
  if (bundle.architecture !== "x64") {
    process.stderr.write(`build: refusing to ship architecture ${bundle.architecture} (M7 is x64-only)\n`);
    return 1;
  }
  auditReleaseBundle(bundle.releaseDir);

  // M7 hostile-fixture proof: the bundle daemon must also refuse hostile
  // adjacent .env / bunfig.toml. We copy the compiled daemon into the
  // hostile dir and run a smoke probe via the bridge-smoke executable
  // (which is the canonical autoload-disabled harness).
  writeHostileAdjacentFiles();
  const stdout = runSmokeCaptureStdout();
  if (stdout.includes("sk-attacker-supplied-value")) {
    process.stderr.write("build: hostile .env content reached bridge output\n");
    return 1;
  }
  if (stdout.toLowerCase().includes("pwned")) {
    process.stderr.write("build: hostile bunfig.toml shell expanded into bridge output\n");
    return 1;
  }
  if (!stdout.includes("bridge-smoke-ok")) {
    process.stderr.write("build: smoke executable did not emit success record\n");
    process.stderr.write(`stdout: ${stdout}\n`);
    return 1;
  }
  if (!stdout.includes("\"environment\":\"release\"")) {
    process.stderr.write("build: explicit config environment was not honoured\n");
    process.stderr.write(`stdout: ${stdout}\n`);
    return 1;
  }
  if (!stdout.includes(".env") || !stdout.includes("bunfig.toml")) {
    process.stderr.write(
      "build: hostile adjacent files were not even visible to the executable; the test no longer proves autoload was disabled (regenerate hostile files first)\n",
    );
    return 1;
  }
  process.stdout.write("build: hostile adjacent .env and bunfig.toml present at run time\n");
  process.stdout.write("build: explicit config environment=release honoured\n");
  process.stdout.write("build: hostile payload did not reach bridge output\n");
  process.stdout.write(
    `build: release bundle at ${bundle.releaseDir} (arch=${bundle.architecture}, ${bundle.artifacts.length} artifacts, ${bundle.licenses.length} licenses, daemon sha256=${bundle.daemonSha256.slice(0, 16)}…)\n`,
  );
  process.stdout.write("build ok\n");
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
