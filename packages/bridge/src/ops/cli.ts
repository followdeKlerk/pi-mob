/**
 * M7 injectable operations CLI.
 *
 * The CLI is the only entry point through which the bridge install,
 * lifecycle, serve, pairing, doctor, update, rollback, and uninstall
 * operations are driven from the outside. It is intentionally:
 *
 *   - **Flag-driven only.** Every command line is parsed into an explicit
 *     map of flags. There is no interactive shell or REPL; TTY state only
 *     selects human versus machine output for the pairing command.
 *   - **Dependency-injected.** `process.argv`, `process.env`, `launchctl`,
 *     the real filesystem, the real Tailscale Serve CLI, and `console.*`
 *     are never called from this module. Every dependency is supplied via
 *     {@link CliDeps} so the test suite runs hermetically.
 *   - **Destructive-action gated.** `update`, `rollback`, and `uninstall`
 *     require both an explicit `--confirm` flag and an explicit mode flag.
 *     The CLI refuses to dispatch without either of them.
 *   - **Pi-session-preserving.** The `uninstall` flow never removes the
 *     Pi session directory by default. The caller must opt in via
 *     `--remove-pi-session-dir=true`; even `uninstall --mode=full` keeps
 *     Pi sessions intact.
 *
 * The CLI is split into three layers:
 *
 *   - {@link parseArgs}: pure argv → {@link ParsedCommand} parser.
 *   - `<command>Handler` functions: pure dispatch with structured
 *     `<command>Result` returns (tested directly).
 *   - {@link runCli}: the user-facing entry point that wires the parser,
 *     the dispatchers, and the stdout/stderr sinks from {@link CliDeps}.
 */

import { validateBridgeEndpoint } from "./endpoint-guard";
import { captureLoginEnv, writeCapturedEnv } from "./login-env";
import {
  buildInstallPaths,
  DEFAULT_LAUNCH_AGENT_LABEL,
  ensureInstallPaths,
  FILE_MODE,
  type InstallPaths,
} from "./install-paths";
import {
  defaultInstallConfig,
  readInstallConfig,
  writeInstallConfig,
  type BridgeInstallConfig,
} from "./install-config";
import {
  renderPlist,
  type LaunchAgentSpec,
} from "./launch-agent";
import {
  applyServeRoute,
  BRIDGE_ROUTE_OWNER,
  inspectServeRoutes,
  type ServeDriver,
  type ServeRouteAccept,
} from "./tailscale-serve";
import {
  type FileSystemPort,
  type ClockPort,
} from "./ports";
import {
  parseManifest,
  type ReleaseManifest,
} from "./release-manifest";
import {
  executeUpdate,
  planUpdate,
  type MigrationClass,
} from "./update";
import {
  executeRollback,
  planRollback,
} from "./rollback";
import {
  executeUninstall,
  type UninstallMode,
  type UninstallPaths,
} from "./uninstall";
import { runDoctor, type PiProbe, type PushProbe } from "./doctor";

// ---------------------------------------------------------------------------
// Public type surface
// ---------------------------------------------------------------------------

/** All M7 commands the CLI understands. */
export type CliCommand =
  | "setup"
  | "start"
  | "stop"
  | "status"
  | "install"
  | "serve"
  | "pair"
  | "doctor"
  | "report"
  | "update"
  | "rollback"
  | "uninstall";

/** Canonical ordered list of supported commands. */
export const CLI_COMMANDS: readonly CliCommand[] = [
  "setup",
  "start",
  "stop",
  "status",
  "install",
  "serve",
  "pair",
  "doctor",
  "report",
  "update",
  "rollback",
  "uninstall",
];

/** Help text for the top-level CLI. */
export const CLI_HELP = [
  "pi-mob bridge ops CLI",
  "",
  "Usage: pi-mob <command> [flags]",
  "",
  "Commands:",
  "  setup       guided first-time setup (start with --workspace PATH)",
  "  start       idempotently start the configured bridge and owned Serve route",
  "  stop        idempotently stop the bridge and remove its owned Serve route",
  "  status      compact lifecycle, Serve, and pairing readiness",
  "  install     low-level install paths, config, LaunchAgent, and env file",
  "  serve       apply the owned Tailscale Serve route for the install",
  "  pair        emit a fresh HTTPS endpoint and one-time passcode (use --json for diagnostics)",
  "  doctor      run every probe and emit a redacted report",
  "  report      alias of doctor that prints only the typed JSON report",
  "  update      transactional update with explicit mode + confirmation",
  "  rollback    transactional rollback with explicit mode + confirmation",
  "  uninstall   explicit uninstall with explicit mode + confirmation",
  "",
  "Setup detects Tailscale and gives safe next steps; it never installs",
  "software or runs `tailscale up`. Low-level commands retain explicit flags.",
  "Pass `--help` after a command for help.",
].join("\n");

/**
 * Injected dependencies. None of these default to `process.*` or to a real
 * filesystem: the production caller (the bun entry script) supplies them.
 * Tests substitute in-memory implementations for every port.
 */
export interface LifecycleState {
  readonly launchAgentLoaded: boolean;
  readonly listenerReady: boolean;
}

export interface LifecycleDriver {
  installAndVerify(paths: InstallPaths, port: number): void | Promise<void>;
  startConfigured(port: number): Promise<{ readonly alreadyRunning: boolean }>;
  stopConfigured(): Promise<{ readonly alreadyStopped: boolean }>;
  lifecycleState(port: number): Promise<LifecycleState>;
  preflight(): void | Promise<void>;
  verifyTarget(manifest: ReleaseManifest): void | Promise<void>;
  backup(paths: InstallPaths, manifest: ReleaseManifest): string | Promise<string>;
  stop(): void | Promise<void>;
  swap(paths: InstallPaths, manifest: ReleaseManifest): void | Promise<void>;
  migrate(migrationClass: MigrationClass): void | Promise<void>;
  start(): void | Promise<void>;
  verifyRunning(): void | Promise<void>;
  verifyBackup(backupId: string): void | Promise<void>;
  restore(paths: InstallPaths, backupId: string): void | Promise<void>;
  generationReset(): void | Promise<void>;
  stopAndRemoveService(): void | Promise<void>;
  removeOwnedServe(): void | Promise<void>;
}

export interface TailscaleState {
  readonly installed: boolean;
  readonly loggedIn: boolean;
  readonly magicDnsName: string | null;
  readonly detail?: string;
}

export interface SetupDefaults {
  readonly installRoot: string;
  readonly launchAgentsRoot: string;
  readonly piExecutable: string | null;
  readonly sourceCliExecutable: string;
  readonly sourceBridgeExecutable: string;
  readonly piSessionDir: string;
  readonly bridgeVersion: string;
  readonly protocolVersion: string;
  readonly port?: number;
}

export interface CliDeps {
  readonly fs: FileSystemPort;
  readonly clock: ClockPort;
  readonly serveDriver: ServeDriver;
  /** Required for destructive lifecycle commands; absence fails closed. */
  readonly lifecycle?: LifecycleDriver;
  readonly databaseIntegrity?: (path: string) => { ok: boolean; detail?: string };
  readonly processProbe?: (port: number) => { loaded: boolean; listenerReady: boolean };
  /** Detection only: implementations must never install Tailscale or log in. */
  readonly tailscaleProbe?: () => Promise<TailscaleState>;
  /** Safe defaults used only by the public setup command. */
  readonly setupDefaults?: SetupDefaults;
  /** Reads the daemon-created canonical host identity after setup readiness. */
  readonly hostIdentity?: (databasePath: string) => { readonly hostId: string };
  /** Issues a one-time enrollment challenge after the bridge store exists. */
  readonly enrollmentChallenge?: (databasePath: string) => { readonly passcode: string; readonly expiresAt: number };
  /** Optional Pi integration; if absent, the doctor Pi probe reports warn. */
  readonly piProbe?: PiProbe;
  /** Optional push integration; if absent, the doctor push probe reports warn. */
  readonly pushProbe?: PushProbe;
  /** True when stdout is an interactive terminal; omitted means machine mode. */
  readonly interactive?: boolean;
  /** stdout sink; receives complete lines (the CLI appends a trailing `\n`). */
  readonly stdout: (chunk: string) => void;
  /** stderr sink; receives complete lines (the CLI appends a trailing `\n`). */
  readonly stderr: (chunk: string) => void;
  /** Captures the owner login environment before install writes begin. */
  readonly captureLoginEnv?: () => Promise<Record<string, string>>;
  /** argv (without `node` and without the script path). */
  readonly argv: readonly string[];
  /**
   * Optional exit sink; if omitted the CLI does not terminate the process.
   * Production wires this to `process.exit`; tests leave it undefined so
   * the test runner stays alive.
   */
  readonly exit?: (code: number) => void;
  /**
   * Whether `--yes` may substitute for `--confirm` on destructive commands.
   * Production defaults to `true` so a `pipe`-friendly wrapper can use it;
   * tests typically pass `false` so the explicit `--confirm` is required.
   */
  readonly acceptYes?: boolean;
}

/** What {@link runCli} returns. Useful for assertions in tests. */
export interface CliRunResult {
  readonly command: CliCommand | null;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly parsed: ParsedCommand | null;
  readonly data: unknown;
}

// ---------------------------------------------------------------------------
// Result shapes — returned by every handler; serialisable.
// ---------------------------------------------------------------------------

export interface InstallResult {
  readonly paths: InstallPaths;
  readonly config: BridgeInstallConfig;
  readonly envPath: string | null;
  readonly envPathWritten: boolean;
  readonly plistPath: string;
  readonly timestamp: string;
}

export interface SetupResult {
  readonly ready: boolean;
  readonly tailscale: TailscaleState;
  readonly installed: boolean;
  readonly install: InstallResult | null;
  readonly manualEndpoint: string | null;
  readonly nextActions: readonly string[];
  readonly timestamp: string;
}

export interface StartResult {
  readonly started: boolean;
  readonly alreadyRunning: boolean;
  readonly port: number;
  readonly ownedServePresent: boolean;
  readonly timestamp: string;
}

export interface StopResult {
  readonly stopped: boolean;
  readonly alreadyStopped: boolean;
  readonly timestamp: string;
}

export interface StatusResult {
  readonly installed: boolean;
  readonly launchAgentLoaded: boolean;
  readonly listenerReady: boolean;
  readonly ownedServePresent: boolean;
  readonly ownedServePort: number | null;
  readonly pairingAvailable: boolean;
  readonly pairingEndpoint: string | null;
  readonly pairingHostId: string | null;
  readonly remediation: readonly string[];
  readonly timestamp: string;
}

export interface ServeResult {
  readonly tcpPort: number;
  readonly changed: boolean;
  readonly ownedRoutePresent: boolean;
  readonly preservedRouteCount: number;
  readonly fingerprint: string;
  readonly timestamp: string;
}

export interface PairResult {
  readonly endpoint: string;
  readonly passcode: string;
  readonly expiresAt: string;
  readonly timestamp: string;
}

export type { DoctorReport } from "./doctor";

export interface CliUpdateResult {
  readonly planId: string;
  readonly ok: boolean;
  readonly completed: readonly string[];
  readonly backupId: string | null;
  readonly rolledBack: boolean;
  readonly error: { readonly stage: string; readonly message: string } | null;
  readonly timestamp: string;
}

export interface CliRollbackResult {
  readonly planId: string;
  readonly ok: boolean;
  readonly completed: readonly string[];
  readonly generationResetInvoked: boolean;
  readonly error: { readonly stage: string; readonly message: string } | null;
  readonly timestamp: string;
}

export interface CliUninstallResult {
  readonly mode: UninstallMode;
  readonly removed: readonly string[];
  readonly preserved: readonly string[];
  readonly piSessionDir: string;
  readonly piSessionDirRemoved: boolean;
  readonly timestamp: string;
}

// ---------------------------------------------------------------------------
// Argument parser
// ---------------------------------------------------------------------------

export interface ParsedCommand {
  readonly command: CliCommand;
  /**
   * Per-flag value. Most flags hold a `string` or `true` (boolean); flags
   * listed in {@link LIST_FLAG_KEYS} hold a `readonly string[]` accumulated
   * in argv order. Tests assert on the exact runtime shape via the typed
   * accessors below.
   */
  readonly flags: ReadonlyMap<string, string | boolean | readonly string[]>;
  readonly positional: readonly string[];
}

/**
 * Flags the parser is allowed to repeat. Repeated occurrences are appended
 * to a `string[]` in argv order so callers can collect `PATH` directories,
 * `accept` rules, and `env` overrides without inventing colon-separated
 * encodings. Anything not in this set keeps the original overwrite
 * semantics — repeating `--port` overwrites, never accumulates.
 */
const LIST_FLAG_KEYS: ReadonlySet<string> = new Set([
  "path-dir",
  "accept",
  "env",
]);

/** Thrown when argv cannot be parsed into a valid command. */
export class CliArgsError extends Error {
  override readonly name = "CliArgsError";
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const BOOLEAN_TRUE = new Set(["true", "1", "yes", "on"]);
const BOOLEAN_FALSE = new Set(["false", "0", "no", "off"]);

/**
 * Parses an argv vector into a {@link ParsedCommand}. The first token must
 * be a known command; flags are `--key=value` or `--key value` or `--flag`
 * (boolean). The parser never consults `process.env` or `process.argv`.
 */
export function parseArgs(argv: readonly string[]): ParsedCommand {
  if (argv.length === 0) {
    throw new CliArgsError("argv_empty", "argv is empty; pass at least a command");
  }
  const command = argv[0]!;
  if (!isCliCommand(command)) {
    throw new CliArgsError(
      "unknown_command",
      `unknown command ${JSON.stringify(command)}; expected one of ${CLI_COMMANDS.join(", ")}`,
    );
  }
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  let i = 1;
  while (i < argv.length) {
    const token = argv[i]!;
    if (token === "--") {
      // Rest-of-argv passthrough (rare; useful for testing).
      for (let j = i + 1; j < argv.length; j += 1) positional.push(argv[j]!);
      break;
    }
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq > 0) {
        const key = token.slice(2, eq);
        const value = token.slice(eq + 1);
        if (LIST_FLAG_KEYS.has(key)) {
          appendListFlag(flags, key, value);
        } else {
          flags.set(key, value);
        }
        i += 1;
        continue;
      }
      const key = token.slice(2);
      // Boolean flag if no value follows, or the next token is another flag.
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags.set(key, true);
        i += 1;
        continue;
      }
      if (LIST_FLAG_KEYS.has(key)) {
        appendListFlag(flags, key, next);
      } else {
        flags.set(key, next);
      }
      i += 2;
      continue;
    }
    positional.push(token);
    i += 1;
  }
  return { command, flags, positional };
}

function isCliCommand(value: string): value is CliCommand {
  return (CLI_COMMANDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Flag helpers — typed accessors used by every handler.
// ---------------------------------------------------------------------------

function getFlagString(args: ParsedCommand, key: string): string | undefined {
  const value = args.flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function getFlagStringRequired(args: ParsedCommand, key: string): string {
  const value = getFlagString(args, key);
  if (value === undefined || value.length === 0) {
    throw new CliArgsError("flag_missing", `missing required --${key}`);
  }
  return value;
}

function getFlagIntegerRequired(args: ParsedCommand, key: string): number {
  const raw = getFlagStringRequired(args, key);
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new CliArgsError("flag_invalid", `--${key} must be an integer in 0..65535 (got ${JSON.stringify(raw)})`);
  }
  return n;
}

function getFlagBoolean(args: ParsedCommand, key: string, fallback: boolean): boolean {
  const value = args.flags.get(key);
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") {
    throw new CliArgsError(
      "flag_invalid",
      `--${key} must not be repeated`,
    );
  }
  const lower = value.toLowerCase();
  if (BOOLEAN_TRUE.has(lower)) return true;
  if (BOOLEAN_FALSE.has(lower)) return false;
  throw new CliArgsError(
    "flag_invalid",
    `--${key} must be true/false/1/0/yes/no/on/off (got ${JSON.stringify(value)})`,
  );
}

function getFlagList(args: ParsedCommand, key: string): readonly string[] {
  const value = args.flags.get(key);
  if (value === undefined || typeof value === "boolean") return [];
  if (typeof value === "string") return [value];
  return value;
}

function appendListFlag(
  flags: Map<string, string | boolean | readonly string[]>,
  key: string,
  value: string,
): void {
  const existing = flags.get(key);
  if (Array.isArray(existing)) {
    flags.set(key, [...existing, value]);
    return;
  }
  flags.set(key, [value]);
}

function requireConfirm(args: ParsedCommand, deps: CliDeps): void {
  const confirm = args.flags.get("confirm") === true;
  const yes = args.flags.get("yes") === true;
  if (confirm) return;
  if (yes && (deps.acceptYes ?? true)) return;
  throw new CliArgsError(
    "confirmation_required",
    "destructive commands require --confirm (or --yes when enabled)",
  );
}

function requireAbsolute(label: string, value: string): string {
  if (!value.startsWith("/")) {
    throw new CliArgsError("flag_invalid", `--${label} must be an absolute path (got ${JSON.stringify(value)})`);
  }
  if (value.includes("..")) {
    throw new CliArgsError("flag_invalid", `--${label} must not contain '..' (got ${JSON.stringify(value)})`);
  }
  if (value.includes("\0")) {
    throw new CliArgsError("flag_invalid", `--${label} must not contain NUL (got ${JSON.stringify(value)})`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Shared install-path loader
// ---------------------------------------------------------------------------

/** Loads or builds the install paths from `--install-root`. */
function loadInstallPaths(args: ParsedCommand): InstallPaths {
  const installRoot = requireAbsolute("install-root", getFlagStringRequired(args, "install-root"));
  const labelFlag = getFlagString(args, "launch-agent-label");
  const launchAgentsRoot = getFlagString(args, "launch-agents-root");
  return buildInstallPaths({
    installRoot,
    ...(labelFlag !== undefined ? { launchAgentLabel: labelFlag } : {}),
    ...(launchAgentsRoot !== undefined ? { launchAgentsRoot: requireAbsolute("launch-agents-root", launchAgentsRoot) } : {}),
  });
}

// ---------------------------------------------------------------------------
// Public lifecycle UX
// ---------------------------------------------------------------------------

function configForLifecycle(args: ParsedCommand, deps: CliDeps): { paths: InstallPaths; config: BridgeInstallConfig } {
  const paths = loadInstallPaths(args);
  return { paths, config: readInstallConfig(paths.configFile, deps.fs) };
}

function setupInstallArgs(args: ParsedCommand, defaults: SetupDefaults): ParsedCommand {
  const workspace = requireAbsolute("workspace", getFlagStringRequired(args, "workspace"));
  if (!defaults.piExecutable) {
    throw new CliArgsError("pi_not_found", "Pi CLI was not found; install Pi, ensure `pi` is on PATH, then rerun pi-mob setup --workspace <path>");
  }
  const flags = new Map(args.flags);
  const put = (key: string, value: string): void => { if (!flags.has(key)) flags.set(key, value); };
  put("install-root", defaults.installRoot);
  put("launch-agents-root", defaults.launchAgentsRoot);
  put("pi-executable", defaults.piExecutable);
  put("bridge-executable", `${defaults.installRoot}/release/bin/bridge-daemon`);
  put("bridge-source", defaults.sourceBridgeExecutable);
  put("workspace", workspace);
  put("pi-session-dir", defaults.piSessionDir);
  put("bridge-version", defaults.bridgeVersion);
  put("protocol-version", defaults.protocolVersion);
  put("port", String(defaults.port ?? 8788));
  put("hostname", "127.0.0.1");
  put("environment", "release");
  return { command: "install", flags, positional: args.positional };
}

export async function handleSetup(args: ParsedCommand, deps: CliDeps): Promise<SetupResult> {
  assertCommand(args, "setup");
  if (!deps.tailscaleProbe) throw new CliArgsError("tailscale_probe_unavailable", "setup requires Tailscale detection support");
  const tailscale = await deps.tailscaleProbe();
  const nextActions: string[] = [];
  if (!tailscale.installed) {
    nextActions.push("Install the Tailscale macOS app from https://tailscale.com/download/mac, open it, and sign in.");
  } else if (!tailscale.loggedIn) {
    nextActions.push("Open the Tailscale app and sign in (or run the Tailscale CLI `up` yourself), then rerun setup.");
  } else if (!tailscale.magicDnsName) {
    nextActions.push("Enable MagicDNS in the Tailscale admin console, confirm `tailscale status --json` shows Self.DNSName, then rerun setup.");
  }
  if (nextActions.length > 0) {
    return { ready: false, tailscale, installed: false, install: null, manualEndpoint: null, nextActions, timestamp: deps.clock.iso() };
  }
  if (!deps.setupDefaults) throw new CliArgsError("setup_defaults_unavailable", "setup defaults are unavailable in this build");
  const sourceCliExecutable = requireAbsolute("source-cli-executable", deps.setupDefaults.sourceCliExecutable);
  if (!deps.fs.exists(sourceCliExecutable)) throw new CliArgsError("artifact_missing", `CLI source not found: ${sourceCliExecutable}`);
  const cliArtifact = deps.fs.readFile(sourceCliExecutable);
  const installArgs = setupInstallArgs(args, deps.setupDefaults);
  const install = await handleInstall(installArgs, deps);
  writeInstalledArtifact(deps.fs, `${install.paths.binRoot}/pi-mob`, cliArtifact, 0o700);
  writeInstalledArtifact(deps.fs, `${install.paths.binRoot}/pi-mob-ops`, cliArtifact, 0o700);
  const port = Number(getFlagStringRequired(installArgs, "port"));
  const portSuffix = port === 443 ? "" : `:${port}`;
  const manualEndpoint = `https://${tailscale.magicDnsName}${portSuffix}`;
  nextActions.push(`Run \`pi-mob pair\` after setup to display the endpoint and one-time passcode. Manual endpoint: ${manualEndpoint}.`);
  return { ready: true, tailscale, installed: true, install, manualEndpoint, nextActions, timestamp: deps.clock.iso() };
}

export async function handleStart(args: ParsedCommand, deps: CliDeps): Promise<StartResult> {
  assertCommand(args, "start");
  const { config } = configForLifecycle(args, deps);
  if (!deps.lifecycle) throw new CliArgsError("lifecycle_unavailable", "start requires the macOS lifecycle driver");
  const result = await deps.lifecycle.startConfigured(config.port);
  const serve = await inspectServeRoutes({ driver: deps.serveDriver });
  return { started: true, alreadyRunning: result.alreadyRunning, port: config.port, ownedServePresent: serve.ownedRoute?.source.tcp?.port === config.port, timestamp: deps.clock.iso() };
}

export async function handleStop(args: ParsedCommand, deps: CliDeps): Promise<StopResult> {
  assertCommand(args, "stop");
  configForLifecycle(args, deps);
  if (!deps.lifecycle) throw new CliArgsError("lifecycle_unavailable", "stop requires the macOS lifecycle driver");
  const result = await deps.lifecycle.stopConfigured();
  return { stopped: true, alreadyStopped: result.alreadyStopped, timestamp: deps.clock.iso() };
}

function pairingSnapshot(_paths: InstallPaths, _deps: CliDeps): { available: boolean; endpoint: string | null; hostId: string | null } {
  // Pairing is intentionally ephemeral. `pi-mob pair` stores only the hashed
  // challenge in the bridge database and never writes a pairing wrapper file.
  return { available: false, endpoint: null, hostId: null };
}

export async function handleStatus(args: ParsedCommand, deps: CliDeps): Promise<StatusResult> {
  assertCommand(args, "status");
  const paths = loadInstallPaths(args);
  const remediation: string[] = [];
  if (!deps.fs.exists(paths.configFile)) {
    remediation.push("Run `pi-mob setup --workspace <path>`.");
    return { installed: false, launchAgentLoaded: false, listenerReady: false, ownedServePresent: false, ownedServePort: null, pairingAvailable: false, pairingEndpoint: null, pairingHostId: null, remediation, timestamp: deps.clock.iso() };
  }
  const config = readInstallConfig(paths.configFile, deps.fs);
  const state = deps.lifecycle ? await deps.lifecycle.lifecycleState(config.port) : { launchAgentLoaded: false, listenerReady: false };
  let ownedServePort: number | null = null;
  try { ownedServePort = (await inspectServeRoutes({ driver: deps.serveDriver })).ownedRoute?.source.tcp?.port ?? null; }
  catch { remediation.push("Open Tailscale, sign in, and rerun status."); }
  const pairing = pairingSnapshot(paths, deps);
  if (!state.launchAgentLoaded || !state.listenerReady || ownedServePort !== config.port) remediation.push("Run `pi-mob start`.");
  if (!pairing.available) remediation.push("Run `pi-mob pair` to display a fresh endpoint and one-time passcode.");
  return { installed: deps.fs.exists(paths.plistPath), launchAgentLoaded: state.launchAgentLoaded, listenerReady: state.listenerReady, ownedServePresent: ownedServePort === config.port, ownedServePort, pairingAvailable: pairing.available, pairingEndpoint: pairing.endpoint, pairingHostId: pairing.hostId, remediation, timestamp: deps.clock.iso() };
}

// ---------------------------------------------------------------------------
// install
// ---------------------------------------------------------------------------

export interface InstallArgs extends ParsedCommand {
  readonly command: "install";
}

/** Builds the install payload and writes everything to disk atomically. */
export async function handleInstall(args: ParsedCommand, deps: CliDeps): Promise<InstallResult> {
  assertCommand(args, "install");

  // Phase 1 — validate every flag and build the in-memory payload before
  // any filesystem write happens. A validation failure here leaves the
  // install root untouched so the user can fix and retry.
  const installRoot = requireAbsolute("install-root", getFlagStringRequired(args, "install-root"));
  const piExecutable = requireAbsolute("pi-executable", getFlagStringRequired(args, "pi-executable"));
  const bridgeExecutable = requireAbsolute("bridge-executable", getFlagStringRequired(args, "bridge-executable"));
  const bridgeSourceFlag = getFlagString(args, "bridge-source");
  const bridgeSource = bridgeSourceFlag === undefined ? null : requireAbsolute("bridge-source", bridgeSourceFlag);
  const workspaceRoot = requireAbsolute("workspace", getFlagStringRequired(args, "workspace"));
  const piSessionDir = requireAbsolute("pi-session-dir", getFlagStringRequired(args, "pi-session-dir"));
  let bridgeArtifact: Buffer | null = null;
  if (bridgeSource !== null) {
    if (!deps.fs.exists(bridgeSource)) throw new CliArgsError("artifact_missing", `bridge source not found: ${bridgeSource}`);
    bridgeArtifact = deps.fs.readFile(bridgeSource);
  }
  const bridgeVersion = getFlagStringRequired(args, "bridge-version");
  const protocolVersion = getFlagStringRequired(args, "protocol-version");
  const port = getFlagIntegerRequired(args, "port");
  const hostname = getFlagStringRequired(args, "hostname");
  const environmentRaw = getFlagStringRequired(args, "environment");
  if (environmentRaw !== "dev" && environmentRaw !== "release") {
    throw new CliArgsError("flag_invalid", `--environment must be 'dev' or 'release' (got ${JSON.stringify(environmentRaw)})`);
  }
  const tailscaleServe = getFlagBoolean(args, "tailscale-serve", true);
  const launchAgentLabel = getFlagString(args, "launch-agent-label") ?? DEFAULT_LAUNCH_AGENT_LABEL;
  const launchAgentsRoot = requireAbsolute("launch-agents-root", getFlagStringRequired(args, "launch-agents-root"));
  const envFileEnabled = getFlagBoolean(args, "env-file", true);
  const paths = buildInstallPaths({ installRoot, launchAgentLabel, launchAgentsRoot });
  if (bridgeArtifact !== null) {
    const expectedBridge = `${paths.binRoot}/bridge-daemon`;
    if (bridgeExecutable !== expectedBridge) {
      throw new CliArgsError("flag_invalid", `artifact copy target must be ${expectedBridge}`);
    }
  }

  // defaultInstallConfig validates port + hostname + absolute paths.
  const config = defaultInstallConfig({
    paths,
    piExecutable,
    bridgeExecutable,
    bridgeVersion,
    protocolVersion,
    port,
    hostname,
    environment: environmentRaw,
    tailscaleServe,
  });

  // Capture before any filesystem write. A failed capture leaves the install
  // root untouched rather than falling back to a narrow or incomplete env.
  const capturedEnv = await (deps.captureLoginEnv ?? captureLoginEnv)();

  // Validate the LaunchAgent spec by rendering it. renderPlist throws on
  // any spec violation (no-shell, absolute paths, Background process type).
  // The bridge no longer injects a default policy extension; Pi runs
  // with no --extension flag unless the operator supplies one.
  const plistSpec: LaunchAgentSpec = {
    label: paths.launchAgentLabel,
    program: bridgeExecutable,
    programArguments: [
      bridgeExecutable,
      "--config", paths.configFile,
      "--workspace", workspaceRoot,
      "--session-dir", piSessionDir,
    ],
    workingDirectory: workspaceRoot,
    environment: capturedEnv,
    stdoutPath: `${paths.logRoot}/bridge.out`,
    stderrPath: `${paths.logRoot}/bridge.err`,
  };
  const plistXml = renderPlist(plistSpec);

  if (!deps.lifecycle) throw new CliArgsError("lifecycle_unavailable", "install requires the macOS lifecycle driver");

  // Phase 2 — perform the filesystem writes. Each writer validates again
  // (writeInstallConfig / renderPlist) and re-checks permissions.
  ensureInstallPaths(paths, deps.fs);
  if (bridgeArtifact !== null) {
    writeInstalledArtifact(deps.fs, bridgeExecutable, bridgeArtifact, 0o700);
  }
  writeInstallConfig(paths.configFile, config, deps.fs);
  if (envFileEnabled) {
    writeCapturedEnv(paths.envFile, capturedEnv, deps.fs);
  }
  deps.fs.writeFile(paths.plistPath, plistXml, FILE_MODE);
  deps.fs.chmod(paths.plistPath, FILE_MODE);
  await deps.lifecycle.installAndVerify(paths, port);

  return {
    paths,
    config,
    envPath: envFileEnabled ? paths.envFile : null,
    envPathWritten: envFileEnabled,
    plistPath: paths.plistPath,
    timestamp: deps.clock.iso(),
  };
}

function writeInstalledArtifact(fs: FileSystemPort, path: string, data: Buffer, mode: number): void {
  const temporary = `${path}.next`;
  fs.writeFile(temporary, data, mode);
  fs.chmod(temporary, mode);
  fs.rename(temporary, path);
  fs.chmod(path, mode);
}

// ---------------------------------------------------------------------------
// serve
// ---------------------------------------------------------------------------

export interface ServeArgs extends ParsedCommand {
  readonly command: "serve";
}

/** Applies the owned Tailscale Serve route via the injected driver. */
export async function handleServe(args: ParsedCommand, deps: CliDeps): Promise<ServeResult> {
  assertCommand(args, "serve");
  // Reading the on-disk config is optional; if it is absent the CLI still
  // applies the requested route — useful for first-time bootstrap flows
  // where the doctor report has not yet been written.
  const paths = loadInstallPaths(args);
  if (deps.fs.exists(paths.configFile)) {
    readInstallConfig(paths.configFile, deps.fs);
  }
  const tcpPort = getFlagIntegerRequired(args, "tcp-port");
  if (tcpPort === 0 || tcpPort > 65535) {
    throw new CliArgsError("flag_invalid", `--tcp-port must be 1..65535 (got ${tcpPort})`);
  }
  const webAddress = getFlagString(args, "web-address");
  const acceptRaw = getFlagList(args, "accept");
  const accept: ServeRouteAccept[] = acceptRaw.map((entry) => parseAccept(entry));

  const result = await applyServeRoute({
    driver: deps.serveDriver,
    tcpPort,
    ...(webAddress !== undefined ? { webAddress } : {}),
    accept,
    ownerId: BRIDGE_ROUTE_OWNER,
  });

  // Persist the served-port fingerprint onto the state root so a future
  // doctor run can compare without invoking the driver.
  deps.fs.mkdir(paths.stateRoot, { recursive: true, mode: 0o700 });
  deps.fs.writeFile(
    `${paths.stateRoot}/serve-fingerprint.txt`,
    JSON.stringify({
      tcpPort,
      ownerId: BRIDGE_ROUTE_OWNER,
      ownedRoutePresent: result.ownedRoute !== null,
      routeFingerprint: JSON.stringify(result.ownedRoute ?? null),
      timestamp: deps.clock.iso(),
    }),
    FILE_MODE,
  );
  deps.fs.chmod(`${paths.stateRoot}/serve-fingerprint.txt`, FILE_MODE);

  return {
    tcpPort,
    changed: result.changed,
    ownedRoutePresent: result.ownedRoute !== null,
    preservedRouteCount: result.preservedRoutes.length,
    fingerprint: summariseRoutes(result.routes, BRIDGE_ROUTE_OWNER),
    timestamp: deps.clock.iso(),
  };
}

function parseAccept(entry: string): ServeRouteAccept {
  const colon = entry.indexOf(":");
  if (colon <= 0) {
    throw new CliArgsError("flag_invalid", `--accept must be NAME:FROM (got ${JSON.stringify(entry)})`);
  }
  const name = entry.slice(0, colon);
  const from = entry.slice(colon + 1);
  if (name.length === 0 || from.length === 0) {
    throw new CliArgsError("flag_invalid", `--accept NAME and FROM must be non-empty (got ${JSON.stringify(entry)})`);
  }
  return { name, from };
}

function summariseRoutes(routes: readonly unknown[], ownerId: string): string {
  return JSON.stringify({ ownerId, count: routes.length });
}

// ---------------------------------------------------------------------------
// pair
// ---------------------------------------------------------------------------

export interface PairArgs extends ParsedCommand {
  readonly command: "pair";
}

/**
 * Builds the canonical pairing payload and optionally renders the terminal
 * endpoint and passcode. The handler is pure: it does not consult `console`
 * and never spawns a UI subprocess.
 */
export async function handlePair(args: ParsedCommand, deps: CliDeps): Promise<PairResult> {
  assertCommand(args, "pair");
  const { paths, config } = configForLifecycle(args, deps);
  if (!config.tailscaleServe) {
    throw new CliArgsError("serve_unavailable", "pair requires tailscale Serve to be enabled in the installed config");
  }
  if (!deps.tailscaleProbe) {
    throw new CliArgsError("tailscale_probe_unavailable", "pair requires Tailscale status support");
  }
  const tailscale = await deps.tailscaleProbe();
  if (!tailscale.installed || !tailscale.loggedIn || !tailscale.magicDnsName) {
    throw new CliArgsError("serve_unavailable", "pair requires a signed-in Tailscale node with MagicDNS enabled");
  }
  if (!deps.processProbe) {
    throw new CliArgsError("listener_unavailable", "pair requires production listener readiness support");
  }
  const process = deps.processProbe(config.port);
  if (!process.loaded || !process.listenerReady) {
    throw new CliArgsError("listener_unavailable", `pair requires a ready bridge listener on port ${config.port}`);
  }
  const serve = await inspectServeRoutes({ driver: deps.serveDriver });
  const route = serve.ownedRoute;
  const hasForward = route?.handlers.some((handler) =>
    (handler.kind === "forward" || handler.kind === "https") &&
    handler.address === `http://127.0.0.1:${config.port}`,
  ) === true;
  const hasFunnel = route?.handlers.some((handler) => handler.kind === "funnel") === true;
  if (!route || route.source.tcp?.port !== config.port || !hasForward || hasFunnel) {
    throw new CliArgsError("serve_unavailable", "pair requires the configured bridge Tailscale Serve route");
  }
  if (!deps.enrollmentChallenge) {
    throw new CliArgsError("pairing_unavailable", "pair requires installed enrollment support");
  }

  const databasePath = `${paths.stateRoot}/bridge.sqlite`;
  const challenge = deps.enrollmentChallenge(databasePath);
  if (!/^\d{6}$/.test(challenge.passcode) || challenge.expiresAt <= deps.clock.now()) {
    throw new CliArgsError("pairing_unavailable", "pair passcode is unavailable or expired");
  }
  const endpoint = getFlagString(args, "endpoint") ?? `https://${tailscale.magicDnsName}:${config.port}`;
  validateBridgeEndpoint(endpoint);
  const result: PairResult = {
    endpoint,
    passcode: challenge.passcode,
    expiresAt: new Date(challenge.expiresAt).toISOString(),
    timestamp: deps.clock.iso(),
  };
  const output = getFlagString(args, "output");
  if (output !== undefined) {
    const outputPath = requireAbsolute("output", output);
    deps.fs.writeFile(outputPath, `${JSON.stringify(result)}\n`, FILE_MODE);
    deps.fs.chmod(outputPath, FILE_MODE);
  }
  return result;
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

export interface DoctorArgs extends ParsedCommand {
  readonly command: "doctor";
}

/** Runs every probe and returns the typed report. */
export async function handleDoctor(args: ParsedCommand, deps: CliDeps): Promise<import("./doctor").DoctorReport> {
  assertCommand(args, "doctor");
  const paths = loadInstallPaths(args);
  const config = readInstallConfig(paths.configFile, deps.fs);
  const ports: import("./doctor").DoctorPorts = {
    fs: deps.fs,
    clock: deps.clock,
    serveDriver: deps.serveDriver,
    ...(deps.databaseIntegrity ? { databaseIntegrity: deps.databaseIntegrity } : {}),
    ...(deps.processProbe ? { processProbe: () => deps.processProbe!(config.port) } : {}),
    ...(deps.piProbe !== undefined ? { piProbe: deps.piProbe } : {}),
    ...(deps.pushProbe !== undefined ? { pushProbe: deps.pushProbe } : {}),
  };
  return runDoctor({ config, paths, ports });
}

// ---------------------------------------------------------------------------
// report — strict JSON output of the doctor report.
// ---------------------------------------------------------------------------

export interface ReportArgs extends ParsedCommand {
  readonly command: "report";
}

/** Runs `doctor` and returns the JSON string for strict consumers. */
export async function handleReport(args: ParsedCommand, deps: CliDeps): Promise<{
  readonly report: import("./doctor").DoctorReport;
  readonly json: string;
}> {
  const report = await handleDoctor(args, deps);
  return { report, json: JSON.stringify(report) };
}

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

export interface UpdateArgs extends ParsedCommand {
  readonly command: "update";
}

const MIGRATION_CLASSES: readonly MigrationClass[] = [
  "binary_only",
  "reversible_migration",
  "restore_required",
];

/** Plans and executes an update transactionally. */
export async function handleUpdate(args: ParsedCommand, deps: CliDeps): Promise<CliUpdateResult> {
  assertCommand(args, "update");
  requireConfirm(args, deps);
  const paths = loadInstallPaths(args);
  const currentConfig = readInstallConfig(paths.configFile, deps.fs);
  const manifestPath = requireAbsolute("manifest-path", getFlagStringRequired(args, "manifest-path"));
  const migrationRaw = getFlagStringRequired(args, "migration-class");
  if (!MIGRATION_CLASSES.includes(migrationRaw as MigrationClass)) {
    throw new CliArgsError(
      "flag_invalid",
      `--migration-class must be one of ${MIGRATION_CLASSES.join("|")} (got ${JSON.stringify(migrationRaw)})`,
    );
  }
  const migrationClass = migrationRaw as MigrationClass;
  if (!deps.fs.exists(manifestPath)) {
    throw new CliArgsError("flag_invalid", `manifest not found: ${manifestPath}`);
  }
  const manifestBuffer = deps.fs.readFile(manifestPath);
  const manifest = parseManifest(manifestBuffer.toString("utf8")) as ReleaseManifest;
  const plan = planUpdate({
    currentVersion: currentConfig.bridgeVersion,
    targetManifest: manifest,
    targetRoot: paths.installRoot,
    migrationClass,
  });

  if (!deps.lifecycle) throw new CliArgsError("lifecycle_unavailable", "update requires a production lifecycle driver");
  const hooks = makeUpdateHooks(paths, manifest, migrationClass, deps.lifecycle);
  const rollback = makeUpdateRollbackHooks(paths, deps.lifecycle, migrationClass);

  const result = await executeUpdate({ plan, ports: { fs: deps.fs, clock: deps.clock }, hooks, rollback });
  return {
    planId: result.planId,
    ok: result.ok,
    completed: result.completed,
    backupId: result.backupId,
    rolledBack: result.rolledBack,
    error: result.error,
    timestamp: result.timestamp,
  };
}

function makeUpdateHooks(
  paths: InstallPaths,
  manifest: ReleaseManifest,
  migrationClass: MigrationClass,
  lifecycle: LifecycleDriver,
): import("./update").UpdateHooks {
  let backupId: string | null = null;
  return {
    preflight: () => lifecycle.preflight(),
    verifyTarget: () => lifecycle.verifyTarget(manifest),
    backup: async () => { await lifecycle.stop(); backupId = await lifecycle.backup(paths, manifest); return backupId; },
    migrate: () => lifecycle.migrate(migrationClass),
    generationReset: () => lifecycle.generationReset(),
    swap: () => lifecycle.swap(paths, manifest),
    postVerify: async () => { await lifecycle.start(); await lifecycle.verifyRunning(); },
    finalize: () => undefined,
  };
}

function makeUpdateRollbackHooks(
  paths: InstallPaths,
  lifecycle: LifecycleDriver,
  migrationClass: MigrationClass,
): import("./update").UpdateRollbackHooks {
  return {
    restore: async () => {
      await lifecycle.stop();
      await lifecycle.restore(paths, "latest");
      if (migrationClass !== "restore_required") {
        await lifecycle.start();
        await lifecycle.verifyRunning();
      }
    },
    generationReset: async () => {
      await lifecycle.generationReset();
      await lifecycle.start();
      await lifecycle.verifyRunning();
    },
  };
}

// ---------------------------------------------------------------------------
// rollback
// ---------------------------------------------------------------------------

export interface RollbackArgs extends ParsedCommand {
  readonly command: "rollback";
}

/** Plans and executes a rollback transactionally. */
export async function handleRollback(args: ParsedCommand, deps: CliDeps): Promise<CliRollbackResult> {
  assertCommand(args, "rollback");
  requireConfirm(args, deps);
  const paths = loadInstallPaths(args);
  const currentConfig = readInstallConfig(paths.configFile, deps.fs);
  const backupId = getFlagStringRequired(args, "backup-id");
  const migrationRaw = getFlagStringRequired(args, "migration-class");
  if (!MIGRATION_CLASSES.includes(migrationRaw as MigrationClass)) {
    throw new CliArgsError(
      "flag_invalid",
      `--migration-class must be one of ${MIGRATION_CLASSES.join("|")} (got ${JSON.stringify(migrationRaw)})`,
    );
  }
  const migrationClass = migrationRaw as MigrationClass;
  const plan = planRollback({
    currentVersion: currentConfig.bridgeVersion,
    backupId,
    migrationClass,
  });

  if (!deps.lifecycle) throw new CliArgsError("lifecycle_unavailable", "rollback requires a production lifecycle driver");
  const result = await executeRollback({
    plan,
    ports: { clock: deps.clock },
    hooks: {
      preflight: () => deps.lifecycle!.preflight(),
      verifyBackup: () => deps.lifecycle!.verifyBackup(backupId),
      generationReset: async () => { await deps.lifecycle!.stop(); await deps.lifecycle!.generationReset(); },
      swap: async () => {
        await deps.lifecycle!.stop();
        await deps.lifecycle!.restore(paths, backupId);
      },
      verifyTarget: async () => { await deps.lifecycle!.start(); await deps.lifecycle!.verifyRunning(); },
      finalize: () => undefined,
    },
  });
  return {
    planId: result.planId,
    ok: result.ok,
    completed: result.completed,
    generationResetInvoked: result.generationResetInvoked,
    error: result.error,
    timestamp: result.timestamp,
  };
}

// ---------------------------------------------------------------------------
// uninstall
// ---------------------------------------------------------------------------

export interface UninstallArgs extends ParsedCommand {
  readonly command: "uninstall";
}

const UNINSTALL_MODES: readonly UninstallMode[] = [
  "retain_data",
  "remove_state",
  "full",
];

/**
 * Plans and executes an uninstall. The Pi session directory is **always**
 * preserved unless `--remove-pi-session-dir=true` is explicitly passed;
 * even `--mode=full` keeps Pi sessions intact by default.
 */
export async function handleUninstall(args: ParsedCommand, deps: CliDeps): Promise<CliUninstallResult> {
  assertCommand(args, "uninstall");
  requireConfirm(args, deps);
  const paths = loadInstallPaths(args);
  const piSessionDir = requireAbsolute("pi-session-dir", getFlagStringRequired(args, "pi-session-dir"));
  const modeRaw = getFlagStringRequired(args, "mode");
  if (!UNINSTALL_MODES.includes(modeRaw as UninstallMode)) {
    throw new CliArgsError(
      "flag_invalid",
      `--mode must be one of ${UNINSTALL_MODES.join("|")} (got ${JSON.stringify(modeRaw)})`,
    );
  }
  const mode = modeRaw as UninstallMode;
  // Pi sessions retained by default — opt-in only.
  const removePiSessionDir = getFlagBoolean(args, "remove-pi-session-dir", false);

  if (!deps.lifecycle) throw new CliArgsError("lifecycle_unavailable", "uninstall requires a production lifecycle driver");
  await deps.lifecycle.stopAndRemoveService();
  await deps.lifecycle.removeOwnedServe();
  const uninstallPaths: UninstallPaths = { ...paths, piSessionDir };
  const result = executeUninstall({
    mode,
    paths: uninstallPaths,
    fs: deps.fs,
    clock: deps.clock,
    removePiSessionDir,
  });
  return {
    mode: result.mode,
    removed: result.removed,
    preserved: result.preserved,
    piSessionDir: result.plan.piSessionDir,
    piSessionDirRemoved: result.piSessionDirRemoved,
    timestamp: result.timestamp,
  };
}

// ---------------------------------------------------------------------------
// Dispatch / runCli
// ---------------------------------------------------------------------------

function assertCommand(args: ParsedCommand, expected: CliCommand): void {
  if (args.command !== expected) {
    throw new CliArgsError("command_mismatch", `expected command '${expected}' but got '${args.command}'`);
  }
}

/**
 * Dispatches a parsed command to the matching handler. The dispatcher is
 * pure with respect to the filesystem; it only types the result and returns
 * it. `runCli` is responsible for emitting the result to stdout/stderr.
 */
export async function dispatch(args: ParsedCommand, deps: CliDeps): Promise<unknown> {
  switch (args.command) {
    case "setup": return await handleSetup(args, deps);
    case "start": return await handleStart(args, deps);
    case "stop": return await handleStop(args, deps);
    case "status": return await handleStatus(args, deps);
    case "install": return await handleInstall(args, deps);
    case "serve": return await handleServe(args, deps);
    case "pair": return handlePair(args, deps);
    case "doctor": return await handleDoctor(args, deps);
    case "report": return await handleReport(args, deps);
    case "update": return await handleUpdate(args, deps);
    case "rollback": return await handleRollback(args, deps);
    case "uninstall": return await handleUninstall(args, deps);
  }
}

/** Stable, schema-versioned envelope around every handler result. */
function envelope(command: CliCommand, data: unknown, timestamp: string): string {
  const payload = { schemaVersion: 1, command, timestamp, data };
  return JSON.stringify(payload);
}

function humanPairOutput(result: PairResult): string {
  return [
    `Endpoint: ${result.endpoint}`,
    `Passcode: ${result.passcode}`,
    `Expires: ${result.expiresAt}`,
    "",
  ].join("\n");
}

/**
 * Top-level entry point. Parses argv, dispatches, prints the typed result
 * to stdout (JSON envelope) and any diagnostic to stderr, then optionally
 * invokes `deps.exit(code)` on error. The function never throws; failures
 * are surfaced through the exit code and stderr sink.
 */
export async function runCli(deps: CliDeps): Promise<CliRunResult> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const captureStdout = (chunk: string): void => {
    stdoutChunks.push(chunk);
    deps.stdout(chunk);
  };
  const captureStderr = (chunk: string): void => {
    stderrChunks.push(chunk);
    deps.stderr(chunk);
  };

  if (deps.argv[0] === "--help" || deps.argv[0] === "-h") {
    captureStdout(`${CLI_HELP}\n`);
    return { command: null, exitCode: 0, stdout: stdoutChunks.join(""), stderr: "", parsed: null, data: null };
  }

  let parsed: ParsedCommand | null = null;
  try {
    parsed = parseArgs(deps.argv);
    if (parsed.flags.get("help") === true) {
      captureStdout(`${CLI_HELP}\n`);
      return { command: parsed.command, exitCode: 0, stdout: stdoutChunks.join(""), stderr: "", parsed, data: null };
    }
  } catch (error) {
    captureStderr(`${(error as Error).message}\n`);
    captureStderr(`\n${CLI_HELP}\n`);
    deps.exit?.(2);
    return {
      command: null,
      exitCode: 2,
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
      parsed: null,
      data: null,
    };
  }

  let exitCode = 0;
  let data: unknown = null;
  try {
    data = await dispatch(parsed, deps);
    const jsonMode = getFlagBoolean(parsed, "json", false);
    if (parsed.command === "pair" && deps.interactive === true && !jsonMode) {
      captureStdout(`${humanPairOutput(data as PairResult)}\n`);
    } else {
      captureStdout(`${envelope(parsed.command, data, deps.clock.iso())}\n`);
    }
  } catch (error) {
    exitCode = 1;
    const err = error as Error;
    captureStderr(`${parsed.command}: ${err.name || "Error"}: ${err.message}\n`);
    data = {
      error: { name: err.name, message: err.message, code: (err as { code?: unknown }).code ?? null },
    };
    const jsonMode = getFlagBoolean(parsed, "json", false);
    if (!(parsed.command === "pair" && deps.interactive === true && !jsonMode)) {
      captureStdout(`${envelope(parsed.command, data, deps.clock.iso())}\n`);
    }
  }

  if (exitCode !== 0) deps.exit?.(exitCode);

  return {
    command: parsed.command,
    exitCode,
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
    parsed,
    data,
  };
}
