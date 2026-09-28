/**
 * Versioned install config.
 *
 * The install config is the on-disk TOML that `daemon.ts` reads at startup.
 * M7 replaces the M1 placeholder parser with a strict versioned schema and
 * 0600 file ownership. The shape is intentionally narrow — workspace trust
 * and read-only policy land in M8.
 *
 * Path invariants:
 *   - `piExecutable` is absolute; the daemon refuses relative Pi paths.
 *   - `stateRoot`, `logRoot`, `backupRoot`, `secretsRoot` are absolute.
 *   - `port` is a valid loopback TCP port (1..65535) when used by the bridge.
 *   - `hostname` is loopback (`127.0.0.1` or `::1`); plain-LAN hosts are
 *     rejected by the install flow.
 */

import { InstallConfigError, type FileSystemPort } from "./ports";
import {
  assertAbsolute,
  assertNoTraversal,
  FILE_MODE,
  type InstallPaths,
} from "./install-paths";

export type InstallEnvironment = "dev" | "release";

export interface BridgeInstallConfig {
  readonly schemaVersion: 1;
  readonly environment: InstallEnvironment;
  readonly bridgeVersion: string;
  readonly protocolVersion: string;
  readonly piExecutable: string;
  readonly bridgeExecutable: string;
  readonly stateRoot: string;
  readonly logRoot: string;
  readonly backupRoot: string;
  readonly secretsRoot: string;
  readonly hostname: string;
  readonly port: number;
  readonly tailscaleServe: boolean;
  /** Optional owner-only Google service-account path for FCM. */
  readonly fcmServiceAccount?: string;
}

/** Thrown when an install-config value fails validation. */
export class InstallConfigValidationError extends InstallConfigError {
  override readonly name: string = "InstallConfigValidationError";
}

/** Default install config used when the user does not override values. */
export interface DefaultInstallConfigOptions {
  readonly paths: InstallPaths;
  readonly piExecutable: string;
  readonly bridgeExecutable: string;
  readonly bridgeVersion: string;
  readonly protocolVersion: string;
  readonly port?: number;
  readonly hostname?: string;
  readonly environment?: InstallEnvironment;
  readonly tailscaleServe?: boolean;
  readonly fcmServiceAccount?: string;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function defaultInstallConfig(options: DefaultInstallConfigOptions): BridgeInstallConfig {
  const port = options.port ?? 8788;
  const hostname = options.hostname ?? "127.0.0.1";
  validatePort(port);
  validateHostname(hostname);
  return {
    schemaVersion: 1,
    environment: options.environment ?? "release",
    bridgeVersion: options.bridgeVersion,
    protocolVersion: options.protocolVersion,
    piExecutable: options.piExecutable,
    bridgeExecutable: options.bridgeExecutable,
    stateRoot: options.paths.stateRoot,
    logRoot: options.paths.logRoot,
    backupRoot: options.paths.backupRoot,
    secretsRoot: options.paths.secretsRoot,
    hostname,
    port,
    tailscaleServe: options.tailscaleServe ?? true,
    ...(options.fcmServiceAccount !== undefined ? { fcmServiceAccount: options.fcmServiceAccount } : {}),
  };
}

/** Validates an already-parsed config object and returns a typed view. */
export function validateInstallConfig(value: unknown): BridgeInstallConfig {
  if (!isPlainObject(value)) {
    throw new InstallConfigValidationError("shape", "install config must be an object");
  }
  if (value.schemaVersion !== 1) {
    throw new InstallConfigValidationError("schema_version", `unsupported schemaVersion: ${String(value.schemaVersion)}`);
  }
  const environment = value.environment;
  if (environment !== "dev" && environment !== "release") {
    throw new InstallConfigValidationError("environment", `environment must be 'dev' or 'release' (got ${stringify(environment)})`);
  }
  const requiredStrings: readonly (keyof BridgeInstallConfig)[] = [
    "bridgeVersion",
    "protocolVersion",
    "piExecutable",
    "bridgeExecutable",
    "stateRoot",
    "logRoot",
    "backupRoot",
    "secretsRoot",
    "hostname",
  ];
  for (const key of requiredStrings) {
    const value_ = value[key as string];
    if (typeof value_ !== "string" || value_.length === 0) {
      throw new InstallConfigValidationError("missing_string", `${String(key)} must be a non-empty string`);
    }
  }
  const absPaths: readonly (keyof BridgeInstallConfig)[] = [
    "piExecutable",
    "bridgeExecutable",
    "stateRoot",
    "logRoot",
    "backupRoot",
    "secretsRoot",
  ];
  for (const key of absPaths) {
    const value_ = value[key as string] as string;
    assertAbsolute(String(key), value_);
    assertNoTraversal(String(key), value_);
  }
  if (value.fcmServiceAccount !== undefined) {
    if (typeof value.fcmServiceAccount !== "string" || value.fcmServiceAccount.length === 0) {
      throw new InstallConfigValidationError("fcm_service_account", "fcmServiceAccount must be an absolute path");
    }
    assertAbsolute("fcmServiceAccount", value.fcmServiceAccount);
    assertNoTraversal("fcmServiceAccount", value.fcmServiceAccount);
  }
  validatePort(value.port);
  validateHostname(value.hostname as string);
  if (typeof value.tailscaleServe !== "boolean") {
    throw new InstallConfigValidationError("tailscale_serve", "tailscaleServe must be boolean");
  }
  return {
    schemaVersion: 1,
    environment,
    bridgeVersion: value.bridgeVersion as string,
    protocolVersion: value.protocolVersion as string,
    piExecutable: value.piExecutable as string,
    bridgeExecutable: value.bridgeExecutable as string,
    stateRoot: value.stateRoot as string,
    logRoot: value.logRoot as string,
    backupRoot: value.backupRoot as string,
    secretsRoot: value.secretsRoot as string,
    hostname: value.hostname as string,
    port: value.port,
    tailscaleServe: value.tailscaleServe,
    ...(value.fcmServiceAccount !== undefined ? { fcmServiceAccount: value.fcmServiceAccount as string } : {}),
  };
}

/** Parses the install config TOML subset. */
export function parseInstallConfig(source: string): BridgeInstallConfig {
  return validateInstallConfig(parseTomlSubset(source));
}

/** Serializes an install config to the canonical TOML subset. */
export function formatInstallConfig(config: BridgeInstallConfig): string {
  // We hand-format the TOML subset to keep the output stable without pulling
  // in a full TOML library. The shape is fixed and small.
  const lines: string[] = [];
  lines.push(`schema_version = 1`);
  lines.push(`environment = ${tomlString(config.environment)}`);
  lines.push(`bridge_version = ${tomlString(config.bridgeVersion)}`);
  lines.push(`protocol_version = ${tomlString(config.protocolVersion)}`);
  lines.push(`pi_executable = ${tomlString(config.piExecutable)}`);
  lines.push(`bridge_executable = ${tomlString(config.bridgeExecutable)}`);
  lines.push(`state_root = ${tomlString(config.stateRoot)}`);
  lines.push(`log_root = ${tomlString(config.logRoot)}`);
  lines.push(`backup_root = ${tomlString(config.backupRoot)}`);
  lines.push(`secrets_root = ${tomlString(config.secretsRoot)}`);
  lines.push(`hostname = ${tomlString(config.hostname)}`);
  lines.push(`port = ${config.port}`);
  lines.push(`tailscale_serve = ${config.tailscaleServe ? "true" : "false"}`);
  if (config.fcmServiceAccount !== undefined) lines.push(`fcm_service_account = ${tomlString(config.fcmServiceAccount)}`);
  return `${lines.join("\n")}\n`;
}

/** Writes the config to disk with `0o600` ownership. */
export function writeInstallConfig(path: string, config: BridgeInstallConfig, fs: FileSystemPort): void {
  // validatePort/validateHostname throw on invalid configs but we re-validate
  // defensively so writes cannot smuggle in untyped data.
  validatePort(config.port);
  validateHostname(config.hostname);
  for (const key of ["piExecutable", "bridgeExecutable", "stateRoot", "logRoot", "backupRoot", "secretsRoot"] as const) {
    assertAbsolute(key, config[key]);
    assertNoTraversal(key, config[key]);
  }
  if (config.fcmServiceAccount !== undefined) {
    assertAbsolute("fcmServiceAccount", config.fcmServiceAccount);
    assertNoTraversal("fcmServiceAccount", config.fcmServiceAccount);
  }
  fs.writeFile(path, formatInstallConfig(config), FILE_MODE);
  fs.chmod(path, FILE_MODE);
}

/** Reads the install config from disk and validates it. */
export function readInstallConfig(path: string, fs: FileSystemPort): BridgeInstallConfig {
  if (!fs.exists(path)) {
    throw new InstallConfigValidationError("not_found", `install config not found: ${path}`);
  }
  const stat = fs.stat(path);
  if (!stat.isFile) {
    throw new InstallConfigValidationError("not_file", `install config is not a file: ${path}`);
  }
  const buffer = fs.readFile(path);
  const parsed = parseInstallConfig(buffer.toString("utf8"));
  // Warn (as exception) if the on-disk file is world-readable. The
  // install-config owner must be the only reader.
  if ((stat.mode & 0o077) !== 0) {
    throw new InstallConfigValidationError(
      "permissions",
      `install config must be owner-only (mode ${(stat.mode & 0o777).toString(8)} contains group/other bits)`,
    );
  }
  return parsed;
}

function validatePort(port: unknown): asserts port is number {
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new InstallConfigValidationError("port", `port must be an integer in 1..65535 (got ${stringify(port)})`);
  }
}

function validateHostname(hostname: unknown): asserts hostname is string {
  if (typeof hostname !== "string" || hostname.length === 0) {
    throw new InstallConfigValidationError("hostname", "hostname must be a non-empty string");
  }
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new InstallConfigValidationError(
      "hostname",
      `hostname must be loopback (127.0.0.1, ::1, localhost); got ${JSON.stringify(hostname)}`,
    );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringify(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Parses a minimal TOML subset sufficient for the install config. Keys are
 * restricted to `[a-z_]+` and values are restricted to strings, integers, and
 * booleans. Anything else throws a typed error so a hostile config file
 * cannot smuggle in arbitrary sections.
 *
 * Snake-case keys are mapped to the camelCase object shape so the rest of
 * the validator does not need to know about TOML's idiomatic naming.
 */
function parseTomlSubset(source: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) {
      throw new InstallConfigValidationError("toml", `invalid TOML line: ${rawLine}`);
    }
    const key = line.slice(0, eq).trim();
    const valueText = line.slice(eq + 1).trim();
    if (!/^[a-z_][a-z0-9_]*$/.test(key)) {
      throw new InstallConfigValidationError("toml_key", `invalid key: ${key}`);
    }
    const mapped = TOML_KEY_MAP[key] ?? key;
    out[mapped] = parseTomlValue(valueText);
  }
  return out;
}

/** Snake-case TOML key → camelCase object key. */
const TOML_KEY_MAP: Record<string, string> = {
  schema_version: "schemaVersion",
  bridge_version: "bridgeVersion",
  protocol_version: "protocolVersion",
  pi_executable: "piExecutable",
  bridge_executable: "bridgeExecutable",
  state_root: "stateRoot",
  log_root: "logRoot",
  backup_root: "backupRoot",
  secrets_root: "secretsRoot",
  tailscale_serve: "tailscaleServe",
  fcm_service_account: "fcmServiceAccount",
};

function parseTomlValue(text: string): unknown {
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
  throw new InstallConfigValidationError("toml_value", `unsupported TOML value: ${text}`);
}
