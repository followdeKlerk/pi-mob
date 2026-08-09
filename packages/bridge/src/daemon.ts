/**
 * Bridge daemon: supervises the configured OMP backend and serves the
 * durable mobile workspace over the loopback WebSocket transport.
 *
 * The bridge owns persistence, leases, attachments, exports, notifications,
 * and protocol semantics; OMP owns only backend execution.
 *
 * CLI:
 *
 *   bun packages/bridge/src/daemon.ts \
 *     --workspace /absolute/repo \
 *     --omp-executable /absolute/omp \
 *     --port 8788 \
 *     --state-dir /absolute/state
 *
 *   --workspace <abs path>            workspace root (also becomes OMP's cwd)
 *   --omp-executable <abs path>       OMP executable
 *   --port <int>                      loopback port to bind (default 8788)
 *   --state-dir <abs path>            durable SQLite directory (default /tmp/pi-mob-state)
 *   --omp-session-dir <abs path>      OMP session directory (default $TMPDIR/pi-mob-sessions)
 *   --display-name <str>              human-readable workspace name (defaults to basename)
 *   --fcm-service-account <abs path>  absolute path to a Google service-account JSON file;
 *                                     enables FCM push and starts a BridgeNotificationService
 *   --help                            print usage
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, basename, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { OmpSession, createOmpSessionFactory, type OmpSessionFactory } from "./omp";
import { OneSessionPiAdapter, type OneSessionWorkspaceConfig } from "./pi/one-session-adapter";
import { BridgeStore, StoreError } from "./core/store";
import { DurableBridgeRuntime } from "./core/runtime";
import { createBridgeServer, type BridgeServer } from "./core/server";
import { AttachmentStore } from "./core/attachments";
import { createBinaryHttpHandler } from "./core/binary-http";
import { createRateQuotaTracker } from "./auth/rate-quota";
import { ExportRegistry } from "./pi/export-registry";
import { Database } from "bun:sqlite";
import { PiDiagnosticsSink } from "./session-events/diagnostics";
import { CanonicalSessionStore } from "./session-events/canonical-session-store";
import { CanonicalEventTransport } from "./session-events/canonical-event-transport";
import type { NotificationService } from "./notifications";
import { BridgeNotificationService } from "./notifications/service";
import { FcmAdapter, type FcmConfig } from "./notifications/transports/fcm";
import type {
  NotificationPlatform,
  NotificationTransport,
  TransportResult,
} from "./notifications/types";
import { createRedactingLogger, type RedactingLogger } from "./logger";
import { parseInstallConfig } from "./ops/install-config";
import {
  canonicalize,
  deriveRootId,
  type CanonicalPath,
  type WorkspaceRootId,
  type HostPolicyMode,
} from "./core/workspace-policy";
import { BRIDGE_VERSION } from "./version";

const PROTOCOL_VERSION = "1.0";
const LEGACY_COMPACTION_PROGRESS_DELAY_MS = 25;
const LEGACY_COMPACTION_IDLE_DELAY_MS = 15 * 60_000;

export interface DaemonOptions {
  readonly workspace: string;
  readonly ompExecutable: string;
  readonly port?: number;
  readonly stateDir?: string;
  readonly ompSessionDir?: string;
  readonly displayName?: string;
  /** Release/build version reported in hello and lifecycle output. */
  readonly bridgeVersion?: string;
  readonly rpcArgs?: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly logger?: RedactingLogger;
  /**
   * @deprecated The bridge no longer owns a host policy. The field is
   * preserved for back-compat with persisted install configs that still
   * record `policyMode`; the value is always coerced to `"full"` and a
   * warning is logged when a non-full value is supplied.
   */
  readonly policyMode?: HostPolicyMode;
  /**
   * @deprecated The bridge no longer maintains a multi-root allowlist;
   * only the single configured `--workspace` is exposed. The field is
   * accepted but ignored, kept for back-compat with persisted configs.
   */
  readonly allowedRoots?: readonly string[];
  /** Explicit developer roots available to the shallow workspace picker. */
  readonly searchRoots?: readonly string[];
  /** M15 configured host-side APNs/FCM service. Omit to advertise push unavailable. */
  readonly notificationService?: NotificationService;
  /** M15 — FCM provider configuration. When present, runDaemon constructs a
   *  BridgeNotificationService using {@link FcmAdapter} (FCM) and an
   *  unavailable APNs transport. Mutually independent from `notificationService`. */
  readonly fcm?: FcmConfig;
}

/** Result of validating a Google service-account JSON file for FCM. */
export interface LoadedFcmServiceAccount {
  readonly projectId: string;
  readonly serviceAccountEmail: string;
  /** PEM-encoded RSA private key. Held only in memory; never logged. */
  readonly privateKey: string;
}

/**
 * Validate an already-parsed Google service-account JSON object for FCM use.
 * Errors never echo the private key; they only identify the missing or
 * malformed field so logs and CLI failures stay safe.
 */
export function parseFcmServiceAccountJson(raw: unknown): LoadedFcmServiceAccount {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("fcm service account must be a JSON object");
  const obj = raw as Record<string, unknown>;
  if (obj.type !== "service_account") throw new Error("fcm service account type must be 'service_account'");
  if (typeof obj.project_id !== "string" || obj.project_id.trim().length === 0) throw new Error("fcm service account must include a non-empty project_id");
  if (typeof obj.client_email !== "string" || obj.client_email.trim().length === 0) throw new Error("fcm service account must include a non-empty client_email");
  if (typeof obj.private_key !== "string") throw new Error("fcm service account must include a private_key string");
  const key = obj.private_key;
  if (!key.includes("BEGIN PRIVATE KEY") || !key.includes("END PRIVATE KEY")) {
    throw new Error("fcm service account private_key must be a PEM-encoded RSA PRIVATE KEY");
  }
  if (key.length > 16_384) throw new Error("fcm service account private_key is implausibly large");
  return { projectId: obj.project_id.trim(), serviceAccountEmail: obj.client_email.trim(), privateKey: key };
}

/**
 * Load and validate a Google service-account JSON file from disk.
 * The path must be absolute; the file must exist and parse as a service account.
 * Error messages identify which step failed without including secret text.
 */
export function loadFcmServiceAccount(path: string): LoadedFcmServiceAccount {
  if (!isAbsolute(path)) throw new Error("--fcm-service-account path must be absolute");
  if (!existsSync(path)) throw new Error("--fcm-service-account file not found");
  const metadata = statSync(path);
  if (!metadata.isFile()) throw new Error("--fcm-service-account must be a regular file");
  if ((metadata.mode & 0o077) !== 0) throw new Error("--fcm-service-account must not be accessible by group or other users");
  let raw: string;
  try { raw = readFileSync(path, "utf8"); }
  catch (error) { throw new Error(`--fcm-service-account could not be read: ${(error as Error).message}`); }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch (error) { throw new Error(`--fcm-service-account is not valid JSON: ${(error as Error).message}`); }
  return parseFcmServiceAccountJson(parsed);
}

/**
 * Internal APNs transport used when FCM-only mode is configured. APNs is
 * explicitly out of scope for the daemon CLI; this transport refuses every
 * send with a transient failure carrying `apns_not_configured` so the
 * notification pipeline never silently claims a delivery that did not
 * happen. Never reports `delivered`.
 */
export class UnavailableApnsTransport implements NotificationTransport {
  readonly platform: NotificationPlatform = "apns";
  async send(): Promise<TransportResult> {
    return { kind: "transient_failure", reason: "apns_not_configured" };
  }
}

export interface DaemonHandle {
  readonly server: BridgeServer;
  readonly runtime: DurableBridgeRuntime;
  readonly adapter: OneSessionPiAdapter;
  readonly rpc: OmpSession;
  readonly store: BridgeStore;
  readonly workspace: OneSessionWorkspaceConfig;
  readonly canonicalSessionStore: CanonicalSessionStore;
  readonly rpcStarted: boolean;
  close(): Promise<void>;
}
function assertAbsolute(label: string, value: string): void {
  if (!isAbsolute(value)) throw new Error(`${label} must be an absolute path (got ${JSON.stringify(value)})`);
}



function defaultWorkspaceSearchRoots(workspace: string): string[] {
  const home = homedir();
  const candidates = [
    join(home, "GitHub"),
    join(home, "github"),
    home,
    workspace,
  ];
  const roots: string[] = [];
  for (const candidate of candidates) {
    try {
      const metadata = lstatSync(candidate);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) continue;
      const resolved = resolve(candidate);
      if (!roots.includes(resolved)) roots.push(resolved);
    } catch {
      // A conventional folder may not exist on this host.
    }
  }
  return roots;
}

export async function runDaemon(options: DaemonOptions): Promise<DaemonHandle> {
  assertAbsolute("ompExecutable", options.ompExecutable);
  if (!existsSync(options.workspace)) throw new Error(`workspace does not exist: ${options.workspace}`);
  if (!existsSync(options.ompExecutable)) throw new Error(`OMP executable does not exist: ${options.ompExecutable}`);

  if (options.policyMode && options.policyMode !== "full") {
    options.logger?.log({ class: "warning", event: "policy-mode-deprecated" });
  }
  if (options.allowedRoots && options.allowedRoots.length > 0) {
    options.logger?.log({ class: "warning", event: "allowed-root-deprecated" });
  }
  if (options.searchRoots) {
    for (const candidate of options.searchRoots) {
      assertAbsolute("search-root", candidate);
      let metadata: ReturnType<typeof lstatSync>;
      try { metadata = lstatSync(candidate); }
      catch { throw new Error(`search-root does not exist: ${candidate}`); }
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`search-root must be a real directory: ${candidate}`);
    }
  }

  const stateDir = resolve(options.stateDir ?? join(tmpdir(), "pi-mob-state"));
  const ompSessionDir = resolve(options.ompSessionDir ?? join(tmpdir(), "pi-mob-sessions"));
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  mkdirSync(ompSessionDir, { recursive: true, mode: 0o700 });

  const store = new BridgeStore(join(stateDir, "bridge.sqlite"));
  const logger = options.logger ?? createRedactingLogger();
  void logger;
  const displayName = options.displayName ?? basename(options.workspace);
  let canonicalWorkspacePath: CanonicalPath;
  try { canonicalWorkspacePath = canonicalize(options.workspace); }
  catch { canonicalWorkspacePath = options.workspace; }
  const workspaceId: WorkspaceRootId = deriveRootId(canonicalWorkspacePath);
  const fingerprint = hashFingerprint(canonicalWorkspacePath);
  const hostStream = `host:${store.identity().hostId}`;
  const canonicalSessionStore = new CanonicalSessionStore(store);
  const canonicalTranscriptTypes = new Set<string>([
    "user.message.created", "assistant.started", "assistant.delta",
    "assistant.completed", "reasoning.started", "reasoning.delta", "reasoning.completed",
    "tool.started", "tool.output", "tool.completed", "tool.failed", "tool.cancelled",
    "turn.started", "turn.settled", "turn.failed", "turn.aborted", "turn.indeterminate",
    "turn.waiting_for_input", "turn.retrying", "turn.compacting", "turn.accepted", "turn.queued",
    "extension.dialog", "extension.notify", "extension.status", "extension.widget",
    "retry.state", "compaction.state", "error.event",
  ]);
  const appendTranscriptEvent = (
    sessionId: string,
    type: string,
    payload: Record<string, unknown>,
    sourceEventId?: string,
  ): void => {
    if (!canonicalTranscriptTypes.has(type)) {
      store.appendEvent(`session:${sessionId}`, type, payload);
      return;
    }
    canonicalSessionStore.append({
      sessionId,
      type: type as Parameters<CanonicalSessionStore["append"]>[0]["type"],
      ...(sourceEventId ? { sourceEventId } : {}),
      payload,
    });
  };
  store.ensureStream(hostStream, "host");

  const ompEnvironment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (typeof value === "string") ompEnvironment[key] = value;
  Object.assign(ompEnvironment, options.environment ?? {});
  const ompFactory: OmpSessionFactory = createOmpSessionFactory({
    executable: options.ompExecutable,
    cwd: options.workspace,
    env: ompEnvironment,
    requestTimeoutMs: 30_000,
    startTimeoutMs: 15_000,
    closeGracePeriodMs: 5_000,
    drainTimeoutMs: 5_000,
    logger,
  });

  const reconcileStartup = (): void => {
    const uncertainAtStartup = store.markUncertainIndeterminate();
    for (const session of store.sessionStates()) {
      const sessionId = typeof session.sessionId === "string" ? session.sessionId : null;
      if (!sessionId) continue;
      if (uncertainAtStartup.some((command) => command.scopeKey === `session:${sessionId}`)) {
        store.updateSessionState(sessionId, {
          ...session,
          runtimeState: "indeterminate",
          attentionState: "needs_attention",
        });
        continue;
      }
      const runtimeState = typeof session.runtimeState === "string" ? session.runtimeState : "stopped";
      if (!["running", "waiting_for_input", "compacting", "retry_wait"].includes(runtimeState)) continue;
      store.updateSessionState(sessionId, {
        ...(store.sessionState(sessionId) ?? session),
        runtimeState: "indeterminate",
        attentionState: "needs_attention",
      });
      appendTranscriptEvent(sessionId, "turn.indeterminate", {
        sessionId,
        reason: "bridge_restart",
      }, `reconcile:${sessionId}:bridge_restart`);
    }
  };

  const sessionRoot = join(ompSessionDir, workspaceId);
  mkdirSync(sessionRoot, { recursive: true, mode: 0o700 });
  const rpc = ompFactory.create({ bridgeSessionId: workspaceId, sessionDir: sessionRoot });
  const rpcStarted = false;
  // Mobile sessions are started lazily by their own per-session OMP provider.
  const searchRoots = options.searchRoots && options.searchRoots.length > 0
    ? options.searchRoots
    : defaultWorkspaceSearchRoots(options.workspace);
  const config: OneSessionWorkspaceConfig = {
    workspaceId,
    rootPath: options.workspace,
    displayName,
    fingerprint,
    policyMode: "full",
    availableSince: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    ...(searchRoots.length > 0 ? { searchRoots } : {}),
  };
  const attachments = new AttachmentStore({ root: join(stateDir, "attachments") });
  attachments.sweep();
  const attachmentSweepTimer = setInterval(() => {
    try { attachments.sweep(); } catch { /* push/OMP service must outlive cleanup failure */ }
  }, 15 * 60_000);
  attachmentSweepTimer.unref();
  const exports = new ExportRegistry({ rootDir: join(stateDir, "exports") });
  // Resolve the host-side notification service exactly once so sweep, close,
  // and the capability event all see the same instance. The constructed path
  // is used when the operator passes `--fcm-service-account`; injection is
  // preserved for tests and downstream callers.
  let notificationService: NotificationService | null = options.notificationService ?? null;
  let capabilityProviders: readonly NotificationPlatform[] | null = null;
  if (!notificationService && options.fcm) {
    notificationService = new BridgeNotificationService({
      store,
      apns: new UnavailableApnsTransport(),
      fcm: new FcmAdapter(options.fcm),
      supportedPlatforms: ["fcm"],
    });
    capabilityProviders = ["fcm"];
  } else if (notificationService) {
    // Backward-compat: an injected service is treated as fully configured
    // for both platforms. New code should prefer `fcm` configuration.
    capabilityProviders = ["apns", "fcm"];
  }
  const sessionRpcs = new Map<string, OmpSession>();
  const createSessionRpc = (sessionId: string): OmpSession => {
    const existing = sessionRpcs.get(sessionId);
    if (existing) return existing;
    const state = store.sessionState(sessionId) ?? {};
    const cwd = typeof state.workspaceRootPath === "string" ? state.workspaceRootPath : options.workspace;
    const storedReference = store.backendSession(sessionId);
    const sessionDir = join(ompSessionDir, sessionId);
    mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
    const configured = createOmpSessionFactory({
      executable: options.ompExecutable,
      cwd,
      env: ompEnvironment,
      requestTimeoutMs: 30_000,
      startTimeoutMs: 15_000,
      closeGracePeriodMs: 5_000,
      drainTimeoutMs: 5_000,
      logger,
      onReference: (reference) => {
        store.ensureBackendSession({
          bridgeSessionId: sessionId,
          backendKind: reference.backend,
          backendSessionId: reference.sessionId,
          backendSessionFile: reference.sessionFile,
        });
      },
    }).create({
      bridgeSessionId: sessionId,
      sessionDir,
      ...(storedReference ? {
        reference: {
          backend: "omp",
          sessionId: storedReference.backendSessionId,
          sessionFile: storedReference.backendSessionFile,
        },
      } : {}),
    });
    sessionRpcs.set(sessionId, configured);
    return configured;
  };
  const hostModels: readonly Record<string, unknown>[] = [];
  // The dedicated store is created before the adapter so canonical OMP
  // notifications can enter the v2 log before mobile subscriptions begin.
  // Rewrite slice: route raw OMP notifications to a bounded diagnostics
  // sink instead of the user-visible session stream. The diagnostics DB
  // lives beside the canonical journal so a corruption or sweep in one
  // never blocks the other. Diagnostics are NEVER consulted by transcript
  // rendering code; the sink is support-only. A failure to open the
  // diagnostics DB MUST NOT prevent the daemon from starting; the
  // adapter simply falls back to no diagnostics, and the bridge enters
  // runtime with full canonical journal functionality.
  let diagnosticsSink: PiDiagnosticsSink | null = null;
  try {
    const path = join(stateDir, "omp-diagnostics.sqlite");
    diagnosticsSink = new PiDiagnosticsSink(new Database(path));
  } catch (error) {
    // Diagnostics is a support-only surface; the canonical journal
    // above is the user-visible authority. A permissions or filesystem
    // failure here is logged via the redacting logger and the daemon
    // continues with no diagnostics sink.
    try {
      const logger = options.logger ?? createRedactingLogger();
      logger.log({ class: "warning", event: "diagnostics_sink_disabled", fields: { error: error instanceof Error ? error.message : String(error) } });
    } catch { /* logger is itself best-effort */ }
  }
  const adapterOptions: Record<string, unknown> = {
    store,
    createRpc: createSessionRpc,
    processSpec: () => ({ executable: options.ompExecutable, args: ["--mode", "rpc"], cwd: options.workspace }),
    workspace: config,
    attachmentStore: attachments,
    exportRegistry: exports,
    hostModels,
    canonicalSessionStore,
  };
  if (diagnosticsSink !== null) adapterOptions["diagnosticsSink"] = diagnosticsSink;
  if (notificationService) adapterOptions["notificationService"] = notificationService;
  const adapter = new OneSessionPiAdapter(adapterOptions as never);
  if(notificationService && capabilityProviders) store.appendEvent(`host:${store.identity().hostId}`,"notification.capability",{available:true,providers:[...capabilityProviders],bestEffort:true});
  const notificationSweepTimer=setInterval(()=>{ try{notificationService?.sweep();}catch{/* OMP service outlives push cleanup */} },60_000);
  notificationSweepTimer.unref();
  const dialogSweepTimer=setInterval(()=>{ try{adapter.sweepExtensionDialogs();}catch{/* service outlives cleanup failure */} },30_000);
  dialogSweepTimer.unref();
  const bridgeVersion = options.bridgeVersion?.trim() || BRIDGE_VERSION;
  // Phase 4 — dedicated canonical session-event log + transport. The
  // runtime advertises `session_events.v2` only when the transport is
  // constructed; otherwise the capability stays hidden and the
  // legacy transcript path remains the only authoritative surface.
  const canonicalEventTransport = new CanonicalEventTransport({ store: canonicalSessionStore });
  const runtime = new DurableBridgeRuntime({
    store,
    adapter,
    bridgeVersion,
    piVersion: "omp",
    hostDisplayName: displayName,
    canonicalSessionStore,
    canonicalEventTransport,
    ...(notificationService ? { notifications: notificationService } : {}),
  });
  const server = createBridgeServer({
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    runtime,
    httpHandler: createBinaryHttpHandler({
      attachments,
      exports: adapter,
      credentials: { verify: (installationId, plaintext) => runtime.verifyInstallationCredential(installationId, plaintext) },
      rateQuota: createRateQuotaTracker({
        store,
        attachments,
        limits: {
          uploadsPerMinute: 10,
          retainedBytesPerInstallation: 250 * 1024 * 1024,
          aggregateBytes: 1024 * 1024 * 1024,
        },
      }),
    }),
  });
  // The listener is bound before bulk reconciliation. Runtime readiness stays
  // false until command recovery and the deferred history pass finish.
  reconcileStartup();
  await runtime.start();

  // Legacy event compaction is deliberately best-effort maintenance. It runs
  // only after listener binding and startup reconciliation, and failures are
  // reported through the redacting logger without affecting live clients. A
  // progressing store is drained in short, bounded transactions; idle or
  // blocked stores back off so maintenance cannot compete with live traffic.
  const maintenanceLogger = options.logger ?? createRedactingLogger();
  let legacyCompactionTimer: ReturnType<typeof setTimeout> | null = null;
  let maintenanceClosing = false;
  const scheduleLegacyCompaction = (delayMs: number): void => {
    if (maintenanceClosing) return;
    if (legacyCompactionTimer) clearTimeout(legacyCompactionTimer);
    legacyCompactionTimer = setTimeout(runLegacyCompaction, delayMs);
    legacyCompactionTimer.unref?.();
  };
  const runLegacyCompaction = (): void => {
    legacyCompactionTimer = null;
    if (maintenanceClosing) return;
    let progressing = false;
    try {
      const result = store.compactLegacyEvents();
      progressing = result.deletedRows > 0;
      if (progressing || result.blockedStreams.length > 0) {
        maintenanceLogger.log({
          class: "diagnostic",
          event: "legacy-event-compaction",
          fields: { deletedRows: result.deletedRows, deletedBytes: result.deletedBytes, blockedStreams: result.blockedStreams.length },
        });
      }
    } catch (error) {
      const code = error instanceof StoreError ? error.code : "io";
      try { maintenanceLogger.log({ class: "error", event: "legacy-event-compaction-failed", fields: { code } }); } catch { /* maintenance must not affect clients */ }
    } finally {
      scheduleLegacyCompaction(progressing ? LEGACY_COMPACTION_PROGRESS_DELAY_MS : LEGACY_COMPACTION_IDLE_DELAY_MS);
    }
  };
  // Run one bounded batch synchronously after readiness, then let the timer
  // continue only when that batch made progress.
  runLegacyCompaction();

  return {
    server, runtime, adapter, rpc, store, workspace: config, canonicalSessionStore,
    get rpcStarted() { return rpcStarted; },
    async close() {
      clearInterval(attachmentSweepTimer);
      clearInterval(dialogSweepTimer);
      clearInterval(notificationSweepTimer);
      maintenanceClosing = true;
      if (legacyCompactionTimer) clearTimeout(legacyCompactionTimer);
      try { notificationService?.sweep(); } catch { /* best effort */ }
      try { attachments.sweep(); } catch { /* best effort */ }
      try { adapter.sweepExtensionDialogs(); } catch { /* best effort */ }
      try { await rpc.drain(); } catch { /* best-effort drain event */ }
      for (const client of sessionRpcs.values()) {
        try { await client.drain(); } catch { /* best-effort */ }
      }
      try { await adapter.drain(); } catch { /* best-effort host drain event */ }
      adapter.close();
      if (diagnosticsSink) {
        try { diagnosticsSink.close(); } catch { /* best-effort */ }
      }
      adapter.closeDiagnosticsSink();
      try { canonicalEventTransport.close(); } catch { /* best-effort */ }
      try { server.stop(true); } catch { /* ignore */ }
      for (const client of sessionRpcs.values()) {
        try { await client.close(); } catch { /* ignore */ }
      }
      try { await rpc.close(); } catch { /* ignore */ }
      attachments.close();
      store.close();
    },
  };
}

// ---------------- helpers ----------------

function hashFingerprint(rootPath: string): string {
  return new Bun.CryptoHasher("sha256").update(`workspace:${rootPath}`).digest("hex").slice(0, 32);
}

// ---------------- CLI ----------------

interface CliArgs {
  workspace: string | null;
  ompExecutable: string | null;
  port: number | null;
  config: string | null;
  stateDir: string | null;
  ompSessionDir: string | null;
  displayName: string | null;
  policyMode: HostPolicyMode | null;
  allowedRoots: string[];
  searchRoots: string[];
  fcmServiceAccount: string | null;
  help: boolean;
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const out: CliArgs = { workspace: null, ompExecutable: null, port: null, config: null, stateDir: null, ompSessionDir: null, displayName: null, policyMode: null, allowedRoots: [], searchRoots: [], fcmServiceAccount: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--workspace": out.workspace = argv[++i] ?? null; break;
      case "--omp-executable": out.ompExecutable = argv[++i] ?? null; break;
      case "--config": out.config = argv[++i] ?? null; break;
      case "--port": out.port = Number.parseInt(argv[++i] ?? "8788", 10); break;
      case "--state-dir": out.stateDir = argv[++i] ?? null; break;
      case "--omp-session-dir": out.ompSessionDir = argv[++i] ?? null; break;
      case "--display-name": out.displayName = argv[++i] ?? null; break;
      case "--fcm-service-account": {
        const next = argv[++i] ?? null;
        if (!next) throw new Error("--fcm-service-account requires a path");
        out.fcmServiceAccount = next;
        break;
      }
      case "--policy-mode": {
        const next = argv[++i] ?? null;
        if (next !== "full" && next !== "read_only") throw new Error("--policy-mode must be `full` or `read_only`");
        out.policyMode = next;
        break;
      }
      case "--allowed-root": {
        const next = argv[++i] ?? null;
        if (!next) throw new Error("--allowed-root requires a path");
        out.allowedRoots.push(next);
        break;
      }
      case "--search-root": {
        const next = argv[++i] ?? null;
        if (!next) throw new Error("--search-root requires a path");
        if (!isAbsolute(next)) throw new Error(`--search-root path must be absolute: ${next}`);
        out.searchRoots.push(next);
        break;
      }
      case "--help": case "-h": out.help = true; break;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (out.port !== null && (!Number.isFinite(out.port) || out.port < 0 || out.port > 65535)) throw new Error("--port must be a valid TCP port");
  for (const path of out.allowedRoots) if (!isAbsolute(path)) throw new Error(`--allowed-root paths must be absolute: ${path}`);
  if (out.fcmServiceAccount !== null && !isAbsolute(out.fcmServiceAccount)) throw new Error("--fcm-service-account path must be absolute");
  return out;
}

const USAGE = `usage: daemon --workspace <abs path> [--config <abs path> | --omp-executable <abs path>] [--port N] [--state-dir <abs path>] [--omp-session-dir <abs path>] [--display-name <str>] [--search-root <abs path>] [--fcm-service-account <abs path>]`;

/** Selects the explicit CLI path first, then the owner-only install config path. */
export function resolveFcmServiceAccountPath(
  explicitPath: string | null,
  installed: { readonly fcmServiceAccount?: string } | null,
): string | null {
  return explicitPath ?? installed?.fcmServiceAccount ?? null;
}

export async function main(argv: readonly string[]): Promise<number> {
  let args: CliArgs;
  try { args = parseCliArgs(argv); }
  catch (error) { process.stderr.write(`${USAGE}\n${(error as Error).message}\n`); return 2; }
  let installed: ReturnType<typeof parseInstallConfig> | null = null;
  try {
    installed = args.config ? parseInstallConfig(readFileSync(args.config, "utf8")) : null;
  } catch (error) {
    process.stderr.write(`invalid install config: ${(error as Error).message}\n`);
    return 2;
  }
  const ompExecutable = args.ompExecutable ?? installed?.ompExecutable ?? null;
  if (args.help || !args.workspace || !ompExecutable) {
    process.stdout.write(`${USAGE}\n`);
    return args.help ? 0 : 2;
  }
  let fcmConfig: FcmConfig | null = null;
  const fcmServiceAccount = resolveFcmServiceAccountPath(args.fcmServiceAccount, installed);
  if (fcmServiceAccount) {
    try {
      const loaded = loadFcmServiceAccount(fcmServiceAccount);
      fcmConfig = { projectId: loaded.projectId, serviceAccountEmail: loaded.serviceAccountEmail, privateKey: loaded.privateKey };
    } catch (error) {
      process.stderr.write(`${(error as Error).message}\n`);
      return 2;
    }
  }
  const handle = await runDaemon({
    workspace: args.workspace,
    ompExecutable,
    port: args.port ?? installed?.port ?? 8788,
    ...(args.stateDir ? { stateDir: args.stateDir } : installed ? { stateDir: installed.stateRoot } : {}),
    ...(args.ompSessionDir ? { ompSessionDir: args.ompSessionDir } : {}),
    ...(args.displayName ? { displayName: args.displayName } : {}),
    ...(installed?.bridgeVersion ? { bridgeVersion: installed.bridgeVersion } : {}),
    ...(args.policyMode ? { policyMode: args.policyMode } : {}),
    ...(args.allowedRoots.length > 0 ? { allowedRoots: args.allowedRoots } : {}),
    ...(args.searchRoots.length > 0 ? { searchRoots: args.searchRoots } : {}),
    ...(fcmConfig ? { fcm: fcmConfig } : {}),
    environment: process.env as Record<string, string>,
  });
  process.stdout.write(`${JSON.stringify({
    protocolVersion: PROTOCOL_VERSION,
    bridgeVersion: handle.runtime.bridgeVersion,
    port: handle.server.port,
    serveTarget: `http://127.0.0.1:${handle.server.port}`,
    workspace: handle.workspace,
  })}\n`);
  const shutdown = async (): Promise<void> => {
    await handle.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  // Park forever; the process group is torn down on signal.
  await new Promise<void>(() => undefined);
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((error) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
  });
}
