/**
 * Versioned config parser placeholder with dev/release state separation.
 *
 * M1 only defines the shape, the explicit "dev" and "release" roots, and the
 * loader entry point. Real config schema (workspace roots, lease durations,
 * retention windows, allowed Tailscale peers, etc.) lands with later
 * checkpoints. The parser intentionally refuses to read `.env` or
 * `bunfig.toml` from the working directory; only explicit versioned config
 * paths and owner-approved secret files are consulted.
 */

import { readFileSync, statSync } from "node:fs";

export type Environment = "dev" | "release";

export interface BridgeConfigPaths {
  readonly configFile: string;
  readonly stateRoot: string;
  readonly logRoot: string;
}

export interface BridgeConfig {
  readonly schemaVersion: 1;
  readonly environment: Environment;
  readonly protocolVersion: string;
  readonly paths: BridgeConfigPaths;
}

export interface ConfigLoadResult {
  readonly config: BridgeConfig;
  readonly source: "explicit-file";
}

const DEFAULT_PROTOCOL = "1.0";

export function buildDevPaths(rootDir: string): BridgeConfigPaths {
  return {
    configFile: `${rootDir}/dev/config.toml`,
    stateRoot: `${rootDir}/dev/state`,
    logRoot: `${rootDir}/dev/logs`,
  };
}

export function buildReleasePaths(rootDir: string): BridgeConfigPaths {
  return {
    configFile: `${rootDir}/release/config.toml`,
    stateRoot: `${rootDir}/release/state`,
    logRoot: `${rootDir}/release/logs`,
  };
}

/**
 * Parses a minimal TOML subset sufficient for the M1 placeholder. The parser
 * rejects:
 *   - any relative path that escapes the explicit root,
 *   - any environment value outside {"dev", "release"},
 *   - any schema_version other than 1.
 *
 * A full TOML parser arrives with M7 when the bridge reaches the install
 * checkpoint; this placeholder keeps the contract stable.
 */
export function parseConfig(source: string): BridgeConfig {
  const lines = source.split(/\r?\n/);
  const map = new Map<string, string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      throw new ConfigParseError(`invalid line: ${line}`);
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map.set(key, value);
  }
  const schemaVersion = Number(map.get("schema_version") ?? "0");
  if (schemaVersion !== 1) {
    throw new ConfigParseError(`unsupported schema_version: ${schemaVersion}`);
  }
  const environment = map.get("environment");
  if (environment !== "dev" && environment !== "release") {
    throw new ConfigParseError(
      `environment must be 'dev' or 'release' (got ${environment})`,
    );
  }
  const configFile = map.get("config_file");
  const stateRoot = map.get("state_root");
  const logRoot = map.get("log_root");
  if (!configFile || !stateRoot || !logRoot) {
    throw new ConfigParseError(
      "config_file, state_root, and log_root are required",
    );
  }
  for (const p of [configFile, stateRoot, logRoot]) {
    if (p.includes("..")) {
      throw new ConfigParseError(`path traversal not allowed: ${p}`);
    }
  }
  return {
    schemaVersion: 1,
    environment,
    protocolVersion: map.get("protocol_version") ?? DEFAULT_PROTOCOL,
    paths: { configFile, stateRoot, logRoot },
  };
}

export function loadConfig(filePath: string): ConfigLoadResult {
  if (!statSync(filePath).isFile()) {
    throw new ConfigParseError(`config file not found: ${filePath}`);
  }
  const source = readFileSync(filePath, "utf8");
  return { config: parseConfig(source), source: "explicit-file" };
}

export class ConfigParseError extends Error {
  override readonly name = "ConfigParseError";
}
