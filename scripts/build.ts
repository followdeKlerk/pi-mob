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
 * Flutter `assemble` and `gradle assembleRelease` are deferred until the
 * real Xcode/iOS SDK and Android SDK pins are frozen against the
 * development host (see docs/TOOLCHAIN.md §9).
 */

import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const DIST = join(ROOT, "packages/bridge/dist");
const EXEC = join(DIST, "bridge-smoke");
const HOSTILE_DIR = join(DIST, "hostile-env-test");
const CFG_PATH = join(DIST, "release-config.toml");

const RELEASE_CONFIG = `\
schema_version = 1
environment = "release"
protocol_version = "1.0"
config_file = "${DIST}/release/config.toml"
state_root = "${DIST}/release/state"
log_root = "${DIST}/release/logs"
`;

function compileSmoke(): number {
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
  process.stdout.write(
    `build: compiled executable ${EXEC} (Mach-O x86_64, ~${(Bun.file(EXEC).size ?? 0) / 1024 / 1024} MiB)\n`,
  );
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
  process.stdout.write("build ok\n");
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
