/**
 * Doctor — strict allowlisted diagnostic report.
 *
 * The doctor probes every observable subsystem the bridge depends on and
 * emits a typed report whose shape is the only surface it exposes. The
 * report is intentionally non-secret: provider keys, push tokens, raw
 * environment values, transcript content, full filesystem paths, and
 * attachment bytes are never copied into the report. Every value that
 * crosses the boundary must be one of:
 *
 *   - a known identifier (UUID, version string, status enum),
 *   - a count, byte size, or timestamp,
 *   - a relative display path (`release/state/...` instead of a private home path),
 *   - a stable hash fingerprint derived from a sensitive path or value.
 *
 * Any value that fails the allowlist is replaced with the literal
 * `[redacted]`. The `redacted: true` flag on the report is a hard
 * attestation that redaction was applied before the report left the
 * boundary; downstream tooling can refuse unredacted reports.
 */

import type { BridgeInstallConfig } from "./install-config";
import type { InstallPaths } from "./install-paths";
import type { FileSystemPort, ClockPort } from "./ports";
import { sha256Of } from "./release-manifest";
import type { ServeDriver } from "./tailscale-serve";
import { BRIDGE_ROUTE_OWNER, inspectServeRoutes } from "./tailscale-serve";

/** Status of an individual probe or the overall report. */
export type DoctorStatus = "ok" | "warn" | "fail";

/** Canonical ordered list of probe names; used to ensure deterministic output. */
export const DOCTOR_PROBE_NAMES = [
  "versions",
  "config",
  "serve",
  "database",
  "backup",
  "omp",
  "environment",
  "process",
  "storage",
  "push",
] as const;

export type DoctorProbeName = (typeof DOCTOR_PROBE_NAMES)[number];

/** Individual probe result. */
export interface DoctorProbe {
  readonly name: DoctorProbeName;
  readonly status: DoctorStatus;
  readonly summary: string;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}

/** Top-level doctor report. */
export interface DoctorReport {
  readonly schemaVersion: 1;
  readonly timestamp: string;
  readonly overall: DoctorStatus;
  readonly probes: readonly DoctorProbe[];
  readonly redacted: true;
}

/** Inputs accepted by {@link runDoctor}. */
export interface DoctorPorts {
  readonly fs: FileSystemPort;
  readonly clock: ClockPort;
  /**
   * Optional Tailscale Serve driver. When omitted the Serve probe reports
   * `degraded` with a structured note; the install flow supplies the
   * driver so the probe can inspect the actual route table.
   */
  readonly serveDriver?: ServeDriver;
  /** Runs SQLite integrity_check in production; absence is reported degraded. */
  readonly databaseIntegrity?: (path: string) => { ok: boolean; detail?: string };
  /** Confirms launchd service and loopback listener state in production. */
  readonly processProbe?: () => { loaded: boolean; listenerReady: boolean };
  /**
   * Optional OMP integration. When omitted, the OMP probe reports
   * `unknown`. Tests inject a stub that returns structured facts.
   */
  readonly ompProbe?: OmpProbe;
  /**
   * Optional push integration. When omitted, the push probe reports
   * `not_configured` (which is acceptable for MVP).
   */
  readonly pushProbe?: PushProbe;
}

/** Structured OMP facts used by the OMP probe. */
export interface OmpProbe {
  executablePath(): string;
  versionString(): string | null;
  lastExitCode(): number | null;
  crashLoopDetected(): boolean;
}

/** Structured push facts used by the push probe. */
export interface PushProbe {
  configured(): boolean;
  /**
   * `ok` for a clean state, `degraded` when push is configured but the
   * last delivery attempt failed, `unknown` when the probe cannot tell.
   */
  status(): "ok" | "degraded" | "unknown";
  lastError(): string | null;
}

/** Context passed to every probe. */
export interface DoctorContext {
  readonly config: BridgeInstallConfig;
  readonly paths: InstallPaths;
  readonly ports: DoctorPorts;
}

/** Thrown when the doctor is constructed with malformed inputs. */
export class DoctorInputError extends Error {
  override readonly name: string = "DoctorInputError";
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/**
 * Runs every probe and assembles the final report. The execution order is
 * fixed so the report is reproducible. Probes never throw — a probe that
 * cannot complete yields a `fail` result with a stable reason code.
 */
export async function runDoctor(args: {
  readonly config: BridgeInstallConfig;
  readonly paths: InstallPaths;
  readonly ports: DoctorPorts;
}): Promise<DoctorReport> {
  validateInputs(args);
  const ctx: DoctorContext = {
    config: args.config,
    paths: args.paths,
    ports: args.ports,
  };
  const probes: DoctorProbe[] = [];
  for (const name of DOCTOR_PROBE_NAMES) {
    const probe = await runProbe(name, ctx);
    probes.push(probe);
  }
  const overall = combineStatus(probes.map((probe) => probe.status));
  const report: DoctorReport = {
    schemaVersion: 1,
    timestamp: args.ports.clock.iso(),
    overall,
    probes,
    redacted: true,
  };
  // Final attestation: re-verify no disallowed substrings leaked through.
  assertRedaction(report);
  return report;
}

async function runProbe(name: DoctorProbeName, ctx: DoctorContext): Promise<DoctorProbe> {
  switch (name) {
    case "versions": return probeVersions(ctx);
    case "config": return probeConfig(ctx);
    case "serve": return probeServe(ctx);
    case "database": return probeDatabase(ctx);
    case "backup": return probeBackup(ctx);
    case "omp": return probeOmp(ctx);
    case "environment": return probeEnvironment(ctx);
    case "process": return probeProcess(ctx);
    case "storage": return probeStorage(ctx);
    case "push": return probePush(ctx);
  }
}

function validateInputs(args: { readonly config: BridgeInstallConfig; readonly paths: InstallPaths; readonly ports: DoctorPorts }): void {
  if (args.config.schemaVersion !== 1) {
    throw new DoctorInputError("config_version", `unsupported config schemaVersion: ${args.config.schemaVersion}`);
  }
  if (!args.paths.installRoot.startsWith("/")) {
    throw new DoctorInputError("install_root", "installRoot must be absolute");
  }
  if (typeof args.ports.fs.exists !== "function") {
    throw new DoctorInputError("fs_port", "FileSystemPort is required");
  }
  if (typeof args.ports.clock.iso !== "function") {
    throw new DoctorInputError("clock_port", "ClockPort is required");
  }
}

// ---------------------------------------------------------------------------
// versions probe
// ---------------------------------------------------------------------------

function probeVersions(ctx: DoctorContext): DoctorProbe {
  const details: Record<string, string | number | boolean | null> = {
    bridgeVersion: safeIdentifier(ctx.config.bridgeVersion),
    protocolVersion: safeIdentifier(ctx.config.protocolVersion),
    environment: ctx.config.environment,
    schemaVersion: 1,
  };
  let status: DoctorStatus = "ok";
  let summary = `bridge ${ctx.config.bridgeVersion} / protocol ${ctx.config.protocolVersion}`;
  if (!isVersionShape(ctx.config.bridgeVersion) || !isVersionShape(ctx.config.protocolVersion)) {
    status = "warn";
    summary = "version strings do not match expected shape";
  }
  return { name: "versions", status, summary, details };
}

// ---------------------------------------------------------------------------
// config probe
// ---------------------------------------------------------------------------

function probeConfig(ctx: DoctorContext): DoctorProbe {
  const details: Record<string, string | number | boolean | null> = {
    configPath: relativeSafePath(ctx.paths.installRoot, ctx.paths.configFile),
    configExists: false,
    hostname: safeIdentifier(ctx.config.hostname),
    tailscaleServeEnabled: ctx.config.tailscaleServe,
  };
  let status: DoctorStatus = "ok";
  let summary = "config file missing";
  if (ctx.ports.fs.exists(ctx.paths.configFile)) {
    details.configExists = true;
    summary = "config file present";
    try {
      const stat = ctx.ports.fs.stat(ctx.paths.configFile);
      const modeBits = stat.mode & 0o777;
      details.configMode = modeBits.toString(8);
      if ((modeBits & 0o077) !== 0) {
        status = "fail";
        summary = "config file is world-readable";
      }
    } catch (error) {
      status = "fail";
      summary = `config stat failed: ${redactError(error)}`;
    }
  } else {
    status = "fail";
  }
  if (ctx.config.hostname !== "127.0.0.1" && ctx.config.hostname !== "::1" && ctx.config.hostname !== "localhost") {
    status = "fail";
    summary = "config hostname is not loopback";
  }
  return { name: "config", status, summary, details };
}

// ---------------------------------------------------------------------------
// serve probe
// ---------------------------------------------------------------------------

async function probeServe(ctx: DoctorContext): Promise<DoctorProbe> {
  const details: Record<string, string | number | boolean | null> = {
    configured: ctx.config.tailscaleServe,
    bridgeRoutePresent: false,
    funnelRoutes: 0,
  };
  let status: DoctorStatus = "ok";
  let summary = "tailscale serve disabled in config";
  if (!ctx.config.tailscaleServe) {
    status = "warn";
    return { name: "serve", status, summary, details };
  }
  if (ctx.ports.serveDriver === undefined) {
    status = "warn";
    summary = "serve driver not provided; cannot inspect route table";
    return { name: "serve", status, summary, details };
  }
  try {
    const inspection = await inspectServeRoutes({ driver: ctx.ports.serveDriver });
    details.bridgeRoutePresent = inspection.ownedRoute !== null;
    details.funnelRoutes = inspection.funnelRoutes.length;
    details.preservedRoutes = inspection.preservedRoutes.length;
    details.routeFingerprint = inspection.fingerprint;
    if (!ctx.config.tailscaleServe) {
      status = "warn";
      summary = "tailscale serve disabled in config";
    } else if (inspection.funnelRoutes.length > 0) {
      status = "fail";
      summary = `funnel routes present: ${inspection.funnelRoutes.length}`;
    } else if (inspection.ownedRoute === null) {
      status = "warn";
      summary = `no ${BRIDGE_ROUTE_OWNER} route installed`;
    } else {
      summary = `bridge route present on port ${inspection.ownedRoute.source.tcp?.port ?? "unknown"}`;
    }
  } catch (error) {
    status = "fail";
    summary = `serve inspection failed: ${redactError(error)}`;
  }
  return { name: "serve", status, summary, details };
}

// ---------------------------------------------------------------------------
// database probe
// ---------------------------------------------------------------------------

function probeDatabase(ctx: DoctorContext): DoctorProbe {
  const details: Record<string, string | number | boolean | null> = {
    statePath: relativeSafePath(ctx.paths.installRoot, ctx.paths.stateRoot),
    stateExists: false,
    sqliteSize: 0,
  };
  let status: DoctorStatus = "ok";
  let summary = "database state not initialised";
  if (!ctx.ports.fs.exists(ctx.paths.stateRoot)) {
    status = "fail";
    return { name: "database", status, summary, details };
  }
  details.stateExists = true;
  let sqlitePath: string | null = null;
  try {
    const entries = ctx.ports.fs.readdir(ctx.paths.stateRoot);
    const dbEntry = entries.find((entry) => entry.endsWith(".sqlite") || entry.endsWith(".db"));
    if (dbEntry) sqlitePath = `${ctx.paths.stateRoot}/${dbEntry}`;
  } catch (error) {
    status = "fail";
    summary = `state dir readdir failed: ${redactError(error)}`;
    return { name: "database", status, summary, details };
  }
  if (sqlitePath === null) {
    status = "warn";
    summary = "no sqlite file under state root";
    return { name: "database", status, summary, details };
  }
  try {
    const stat = ctx.ports.fs.stat(sqlitePath);
    details.sqliteSize = stat.size;
    details.sqliteMtimeMs = stat.mtimeMs;
    const integrity = ctx.ports.databaseIntegrity?.(sqlitePath);
    if (!integrity) {
      status = "warn";
      summary = `database ${stat.size} bytes; integrity probe unavailable`;
    } else if (!integrity.ok) {
      status = "fail";
      summary = `database integrity failed${integrity.detail ? `: ${redactError(integrity.detail)}` : ""}`;
    } else {
      details.integrity = true;
      summary = `database ${stat.size} bytes; integrity ok`;
    }
  } catch (error) {
    status = "fail";
    summary = `database stat failed: ${redactError(error)}`;
  }
  return { name: "database", status, summary, details };
}

// ---------------------------------------------------------------------------
// backup probe
// ---------------------------------------------------------------------------

function probeBackup(ctx: DoctorContext): DoctorProbe {
  const details: Record<string, string | number | boolean | null> = {
    backupPath: relativeSafePath(ctx.paths.installRoot, ctx.paths.backupRoot),
    backupCount: 0,
    latestAgeMs: null,
  };
  let status: DoctorStatus = "ok";
  let summary = "no backups present";
  if (!ctx.ports.fs.exists(ctx.paths.backupRoot)) {
    status = "warn";
    return { name: "backup", status, summary, details };
  }
  let names: readonly string[];
  try {
    names = ctx.ports.fs.readdir(ctx.paths.backupRoot);
  } catch (error) {
    return {
      name: "backup",
      status: "fail",
      summary: `backup dir readdir failed: ${redactError(error)}`,
      details,
    };
  }
  const backups = names.filter((name) => /^backup-.+-\d+$/.test(name) || name.endsWith(".backup") || name.endsWith(".sqlite"));
  details.backupCount = backups.length;
  if (backups.length === 0) {
    status = "warn";
    summary = "backup directory is empty";
    return { name: "backup", status, summary, details };
  }
  let latestMtime = -Infinity;
  for (const name of backups) {
    try {
      const stat = ctx.ports.fs.stat(`${ctx.paths.backupRoot}/${name}`);
      if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
    } catch {
      // skip unreadable entries
    }
  }
  if (latestMtime === -Infinity) {
    status = "warn";
    summary = "no readable backup files";
    return { name: "backup", status, summary, details };
  }
  const nowMs = ctx.ports.clock.now();
  const ageMs = Math.max(0, nowMs - latestMtime);
  details.latestAgeMs = ageMs;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  if (ageMs > sevenDays) status = "warn";
  summary = `${backups.length} backup(s); latest age ${formatAge(ageMs)}`;
  return { name: "backup", status, summary, details };
}

// ---------------------------------------------------------------------------
// omp probe
// ---------------------------------------------------------------------------

function probeOmp(ctx: DoctorContext): DoctorProbe {
  const details: Record<string, string | number | boolean | null> = {
    executablePath: relativeSafePath(ctx.paths.installRoot, ctx.config.ompExecutable),
    executableExists: false,
    crashLoop: false,
  };
  let status: DoctorStatus = "ok";
  let summary = "OMP integration not configured";
  const probe = ctx.ports.ompProbe;
  if (probe === undefined) {
    status = "warn";
    summary = "OMP probe not provided";
    return { name: "omp", status, summary, details };
  }
  const execPath = probe.executablePath();
  if (ctx.ports.fs.exists(execPath)) {
    details.executableExists = true;
  } else {
    status = "fail";
    summary = "OMP executable missing";
  }
  const version = probe.versionString();
  if (version !== null) details.version = safeIdentifier(version);
  const exitCode = probe.lastExitCode();
  if (exitCode !== null) details.lastExitCode = exitCode;
  if (probe.crashLoopDetected()) {
    details.crashLoop = true;
    status = "fail";
    summary = "OMP crash loop detected";
  } else if (status === "ok") {
    summary = `OMP executable ${details.executableExists ? "present" : "missing"}`;
  }
  return { name: "omp", status, summary, details };
}

// ---------------------------------------------------------------------------
// environment probe
// ---------------------------------------------------------------------------

function probeEnvironment(ctx: DoctorContext): DoctorProbe {
  const details: Record<string, string | number | boolean | null> = {
    envFileExists: false,
    envFileMode: null,
  };
  let status: DoctorStatus = "ok";
  let summary = "env file not present";
  if (ctx.ports.fs.exists(ctx.paths.envFile)) {
    details.envFileExists = true;
    try {
      const stat = ctx.ports.fs.stat(ctx.paths.envFile);
      const mode = stat.mode & 0o777;
      details.envFileMode = mode.toString(8);
      if ((mode & 0o077) !== 0) {
        status = "fail";
        summary = "env file is world-readable";
      } else {
        summary = "env file present and owner-only";
      }
    } catch (error) {
      status = "fail";
      summary = `env file stat failed: ${redactError(error)}`;
    }
  } else {
    status = "warn";
    summary = "env file not present (optional)";
  }
  return { name: "environment", status, summary, details };
}

// ---------------------------------------------------------------------------
// process probe
// ---------------------------------------------------------------------------

function probeProcess(ctx: DoctorContext): DoctorProbe {
  const details: Record<string, string | number | boolean | null> = {
    plistPath: relativeSafePath(ctx.paths.installRoot, ctx.paths.plistPath),
    plistExists: false,
  };
  let status: DoctorStatus = "ok";
  let summary = "LaunchAgent plist missing";
  if (ctx.ports.fs.exists(ctx.paths.plistPath)) {
    details.plistExists = true;
    summary = "LaunchAgent plist present";
  } else {
    status = "warn";
    summary = "LaunchAgent plist missing";
  }
  const process = ctx.ports.processProbe?.();
  if (process) {
    details.serviceLoaded = process.loaded;
    details.listenerReady = process.listenerReady;
    if (!process.loaded || !process.listenerReady) {
      status = "fail";
      summary = !process.loaded ? "LaunchAgent is not loaded" : "loopback listener is not ready";
    }
  } else if (details.plistExists) {
    status = "warn";
    summary = "LaunchAgent plist present; live process probe unavailable";
  }
  if (ctx.ports.ompProbe?.crashLoopDetected()) {
    details.crashLoop = true;
    status = "fail";
    summary = "supervisor reports crash loop";
  }
  return { name: "process", status, summary, details };
}

// ---------------------------------------------------------------------------
// storage probe
// ---------------------------------------------------------------------------

function probeStorage(ctx: DoctorContext): DoctorProbe {
  const details: Record<string, string | number | boolean | null> = {
    statePath: relativeSafePath(ctx.paths.installRoot, ctx.paths.stateRoot),
    logPath: relativeSafePath(ctx.paths.installRoot, ctx.paths.logRoot),
    backupPath: relativeSafePath(ctx.paths.installRoot, ctx.paths.backupRoot),
  };
  let status: DoctorStatus = "ok";
  let summary = "storage ok";
  for (const candidate of [ctx.paths.stateRoot, ctx.paths.logRoot, ctx.paths.backupRoot]) {
    if (!ctx.ports.fs.exists(candidate)) {
      status = "fail";
      summary = `missing storage path: ${relativeSafePath(ctx.paths.installRoot, candidate)}`;
    }
  }
  return { name: "storage", status, summary, details };
}

// ---------------------------------------------------------------------------
// push probe
// ---------------------------------------------------------------------------

function probePush(ctx: DoctorContext): DoctorProbe {
  const details: Record<string, string | number | boolean | null> = {
    configured: false,
    pushStatus: "not_configured",
  };
  let status: DoctorStatus = "ok";
  let summary = "push not configured";
  const probe = ctx.ports.pushProbe;
  if (probe === undefined) {
    status = "warn";
    summary = "push probe not provided";
    return { name: "push", status, summary, details };
  }
  const configured = probe.configured();
  details.configured = configured;
  if (!configured) {
    status = "warn";
    summary = "push not configured";
    return { name: "push", status, summary, details };
  }
  const pushStatus = probe.status();
  details.pushStatus = pushStatus;
  const lastError = probe.lastError();
  if (lastError !== null) details.lastErrorHash = sha256Of(lastError).slice(0, 16);
  if (pushStatus === "degraded") {
    status = "warn";
    summary = "push configured but degraded";
  } else if (pushStatus === "unknown") {
    status = "warn";
    summary = "push status unknown";
  } else {
    summary = "push configured";
  }
  return { name: "push", status, summary, details };
}

// ---------------------------------------------------------------------------
// redaction helpers
// ---------------------------------------------------------------------------

const REDACTED = "[redacted]";
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9._+\-]{1,128}$/;
const PATH_LIKE_PATTERN = new RegExp(
  `\\/(?:${["Users", "home", "root"].join("|")})\\/[^/\\s\"\u0060<>]+|(?:[A-Za-z]:|\\\\\\\\)[\\\\/](?:${["Users", "home"].join("|")})[\\\\/][^/\\s\"\u0060<>]+`,
);
const SECRET_PATTERN = /(sk-[A-Za-z0-9_-]+|AIza[0-9A-Za-z_-]+|ghp_[A-Za-z0-9]+|glpat-[A-Za-z0-9_-]+|xox[baprs]-[A-Za-z0-9-]+|-----BEGIN [A-Z ]+PRIVATE KEY-----)/;

function safeIdentifier(value: string): string {
  if (typeof value !== "string") return REDACTED;
  if (!IDENTIFIER_PATTERN.test(value)) return REDACTED;
  return value;
}

function relativeSafePath(installRoot: string, absolute: string): string {
  if (typeof absolute !== "string" || absolute.length === 0) return REDACTED;
  if (!absolute.startsWith(`${installRoot}/`)) {
    // Any path outside the install root must be fingerprinted, not echoed.
    return `fingerprint:${sha256Of(absolute).slice(0, 12)}`;
  }
  return absolute.slice(installRoot.length + 1);
}

function redactError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message ?? "";
    if (SECRET_PATTERN.test(message) || PATH_LIKE_PATTERN.test(message)) return REDACTED;
    return message.slice(0, 200);
  }
  return REDACTED;
}

function isVersionShape(value: string): boolean {
  return /^[0-9A-Za-z.\-+]{1,32}$/.test(value);
}

function combineStatus(statuses: readonly DoctorStatus[]): DoctorStatus {
  // Push is best-effort and may be `degraded` without failing core readiness;
  // a `warn` on the push probe must not escalate the overall verdict.
  const core = statuses.slice();
  if (core.length === DOCTOR_PROBE_NAMES.length) {
    core[DOCTOR_PROBE_NAMES.indexOf("push")] = "ok";
  }
  if (core.includes("fail")) return "fail";
  if (core.includes("warn")) return "warn";
  return "ok";
}

function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Walks the report and confirms that no sensitive substring has leaked
 * through a probe. Throws if redaction was bypassed — that is a hard
 * programming error, not a runtime condition.
 */
function assertRedaction(report: DoctorReport): void {
  const blob = JSON.stringify(report);
  if (SECRET_PATTERN.test(blob)) {
    throw new DoctorInputError("redaction_failed", "doctor report contains a credential-shaped value");
  }
  if (PATH_LIKE_PATTERN.test(blob)) {
    throw new DoctorInputError("redaction_failed", "doctor report contains an unrestricted absolute path");
  }
}
