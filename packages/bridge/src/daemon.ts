/**
 * M6 bridge daemon: supervises Pi RPC and serves the currently configured
 * one-session diagnostic workspace over the durable loopback WebSocket
 * transport. Install, private Serve exposure, pairing, and service lifecycle
 * land in M7.
 *
 * CLI:
 *
 *   bun packages/bridge/src/daemon.ts \
 *     --workspace /absolute/repo \
 *     --executable /absolute/pi \
 *     --port 8788 \
 *     --state-dir /absolute/state
 *
 *   --workspace <abs path>            workspace root (also becomes Pi's cwd)
 *   --executable <abs path>           Pi RPC binary
 *   --port <int>                      loopback port to bind (default 8788)
 *   --state-dir <abs path>            durable SQLite directory (default /tmp/pi-mob-state)
 *   --session-dir <abs path>          Pi session directory (default $TMPDIR/pi-mob-sessions)
 *   --display-name <str>              human-readable workspace name (defaults to basename)
 *   --fcm-service-account <abs path>  absolute path to a Google service-account JSON file;
 *                                     enables FCM push and starts a BridgeNotificationService
 *   --help                            print usage
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { SupervisedRpcClient } from "./pi/supervised-rpc-client";
import { OneSessionPiAdapter, type OneSessionPolicyBridge, type OneSessionWorkspaceConfig } from "./pi/one-session-adapter";
import { BridgeStore } from "./core/store";
import { DurableBridgeRuntime, type RuntimePolicyHandler } from "./core/runtime";
import { createBridgeServer, type BridgeServer } from "./core/server";
import { AttachmentStore } from "./core/attachments";
import { createBinaryHttpHandler } from "./core/binary-http";
import { ExportRegistry } from "./pi/export-registry";
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
  DurableTrustPolicyStore,
  HostPolicyService,
  addAllowedRoot,
  buildTrustManifest,
  canonicalize,
  createWorkspaceRootsConfig,
  defaultBoundedSearch,
  deriveRootId,
  type HostPolicyMode,
  type WorkspaceRoot,
  type WorkspaceRootsConfig,
  type WorkspaceRootId,
  type CanonicalPath,
} from "./core/workspace-policy";

const PROTOCOL_VERSION = "1.0";
const BRIDGE_VERSION = "0.0.0-m8";

export interface DaemonOptions {
  readonly workspace: string;
  readonly executable: string;
  readonly port?: number;
  readonly stateDir?: string;
  readonly sessionDir?: string;
  readonly displayName?: string;
  readonly rpcArgs?: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly pathDirs?: readonly string[];
  readonly logger?: RedactingLogger;
  /** M8 — host policy mode seed; ignored on re-launch when persisted state already exists. */
  readonly policyMode?: HostPolicyMode;
  /** M8 — extra allowed workspace roots beyond `workspace`. */
  readonly allowedRoots?: readonly string[];
  /** Loadable host-policy Pi extension. Defaults to the monorepo extension in development. */
  readonly extensionPath?: string;
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

interface DaemonPolicyBootstrap {
  readonly rootsConfig: WorkspaceRootsConfig;
  readonly primaryRoot: WorkspaceRoot;
  readonly trustStore: DurableTrustPolicyStore;
  readonly hostPolicy: HostPolicyService;
  readonly handler: RuntimePolicyHandler;
  readonly hostPolicyMode: HostPolicyMode;
  /** True when the primary workspace currently passes the start gate
   *  (trust state == `trusted`). When false, the bridge is up but Pi
   *  is not running and the owner must approve + activate. */
  readonly trustGateAllowed: boolean;
}

export interface DaemonHandle {
  readonly server: BridgeServer;
  readonly runtime: DurableBridgeRuntime;
  readonly adapter: OneSessionPiAdapter;
  readonly rpc: SupervisedRpcClient;
  readonly store: BridgeStore;
  readonly workspace: OneSessionWorkspaceConfig;
  /** True when the Pi RPC supervisor has been started. False for an
   *  untrusted workspace until {@link activate} succeeds. */
  readonly rpcStarted: boolean;
  /** Re-evaluates the trust gate and, if the workspace is trusted,
   *  starts the Pi RPC supervisor exactly once. Idempotent and
   *  no-throw when the gate is still closed; throws when the runtime
   *  cannot accept activation (e.g. supervisor already drained). */
  activate(): Promise<void>;
  close(): Promise<void>;
}

function assertAbsolute(label: string, value: string): void {
  if (!isAbsolute(value)) throw new Error(`${label} must be an absolute path (got ${JSON.stringify(value)})`);
}

export async function runDaemon(options: DaemonOptions): Promise<DaemonHandle> {
  assertAbsolute("workspace", options.workspace);
  assertAbsolute("executable", options.executable);
  if (!existsSync(options.workspace)) throw new Error(`workspace does not exist: ${options.workspace}`);
  if (!existsSync(options.executable)) throw new Error(`executable does not exist: ${options.executable}`);

  const stateDir = resolve(options.stateDir ?? join(tmpdir(), "pi-mob-state"));
  const sessionDir = resolve(options.sessionDir ?? join(tmpdir(), "pi-mob-sessions"));
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  mkdirSync(sessionDir, { recursive: true, mode: 0o700 });

  const store = new BridgeStore(join(stateDir, "bridge.sqlite"));
  const logger = options.logger ?? createRedactingLogger();
  void logger;
  const displayName = options.displayName ?? basename(options.workspace);
  // Use the canonical-path UUID-shaped root id so the bridge speaks the
  // same identifier the runtime / trust store will see after realpath.
  // Falling back to the lexical path keeps the daemon bootable for
  // workspaces that have not yet been materialised on disk.
  let canonicalWorkspacePath: CanonicalPath;
  try { canonicalWorkspacePath = canonicalize(options.workspace); }
  catch { canonicalWorkspacePath = options.workspace; }
  const workspaceId: WorkspaceRootId = deriveRootId(canonicalWorkspacePath);
  const fingerprint = hashFingerprint(canonicalWorkspacePath);
  const hostStream = `host:${store.identity().hostId}`;
  store.ensureStream(hostStream, "host");
  const uncertainAtStartup = store.markUncertainIndeterminate();
  const restoredSession = store.sessionStates()[0] as Record<string, unknown> | undefined;
  if (restoredSession && typeof restoredSession.sessionId === "string" &&
      uncertainAtStartup.some((command) => command.scopeKey === `session:${restoredSession.sessionId}`)) {
    store.updateSessionState(restoredSession.sessionId, {
      ...restoredSession,
      runtimeState: "indeterminate",
      attentionState: "needs_attention",
    });
  }
  const refreshedSession = store.sessionStates()[0] as Record<string, unknown> | undefined;
  const restoredRuntime = typeof refreshedSession?.runtimeState === "string"
    ? refreshedSession.runtimeState
    : "stopped";
  if (refreshedSession && typeof refreshedSession.sessionId === "string" &&
      ["running", "waiting_for_input", "compacting", "retry_wait"].includes(restoredRuntime)) {
    store.updateSessionState(refreshedSession.sessionId, {
      ...refreshedSession,
      runtimeState: "indeterminate",
      attentionState: "needs_attention",
    });
    store.appendEvent(`session:${refreshedSession.sessionId}`, "turn.indeterminate", {
      sessionId: refreshedSession.sessionId,
      reason: "bridge_restart",
    });
  }

  // Bootstrap trust BEFORE creating the RPC supervisor. The trust gate
  // decides whether the supervisor is started at all on this launch; an
  // untrusted workspace still boots the bridge so the owner can approve
  // + activate without a separate restart.
  const bootstrap = bootstrapPolicy({ store, primaryWorkspacePath: canonicalWorkspacePath, primaryWorkspaceLabel: displayName, requestedPolicyMode: options.policyMode ?? "full", extraRoots: options.allowedRoots ?? [] });
  const policyFile = join(stateDir, "host-policy.json");
  const publishPolicy: NonNullable<OneSessionPolicyBridge["publish"]> = (snapshot) => {
    const effective = bootstrap.hostPolicy.effective();
    const trust = bootstrap.handler.resolveTrust(bootstrap.primaryRoot.canonicalPath);
    writeFileSync(policyFile, `${JSON.stringify({
      mode: snapshot?.policyMode ?? effective.mode,
      version: snapshot?.policyVersion ?? effective.rules.policyVersion,
      fingerprint: snapshot?.fingerprint ?? trust.fingerprint,
      snapshottedAt: snapshot?.snapshottedAt ?? new Date().toISOString(),
    })}\n`, { mode: 0o600 });
  };
  publishPolicy();
  const developmentExtension = resolve(import.meta.dir, "../../pi-extension/src/extension.ts");
  const extensionPath = options.extensionPath ?? (existsSync(developmentExtension) ? developmentExtension : undefined);
  if (!extensionPath) throw new Error("host policy extension path is required");
  assertAbsolute("extensionPath", extensionPath);
  if (!existsSync(extensionPath)) throw new Error(`host policy extension does not exist: ${extensionPath}`);

  const rpc = new SupervisedRpcClient({
    processId: workspaceId,
    beforeSpawn: () => {
      const trust = bootstrap.handler.resolveTrust(bootstrap.primaryRoot.canonicalPath);
      if (trust.status !== "trusted") throw new Error("workspace_trust_required");
    },
    initialState: restoredRuntime === "crash_loop" ? "crash_loop" : "stopped",
    rpc: {
      executable: options.executable,
      args: ["--mode", "rpc", "--session-dir", sessionDir, "--extension", extensionPath, ...(options.rpcArgs ?? [])],
      cwd: options.workspace,
      environment: { ...(options.environment ?? {}), PI_MOB_HOST_POLICY_FILE: policyFile },
      pathDirs: options.pathDirs ?? ["/usr/local/bin", "/usr/bin", "/bin"],
      defaultRequestTimeoutMs: 30_000,
      closeGracePeriodMs: 5_000,
    },
    emit(event) {
      if (event.type.startsWith("host.")) {
        store.appendEvent(hostStream, event.type, event.payload);
        return;
      }
      const session = store.sessionStates()[0] as Record<string, unknown> | undefined;
      if (!session || typeof session.sessionId !== "string") return;
      const sessionId = session.sessionId;
      const payload: Record<string, unknown> = { ...event.payload, sessionId };
      store.appendEvent(`session:${sessionId}`, event.type, payload);
      if (event.type === "turn.indeterminate") {
        store.updateSessionState(sessionId, { ...session, runtimeState: "indeterminate", attentionState: "needs_attention" });
      } else if (event.type === "session.state" && typeof payload.runtimeState === "string") {
        store.updateSessionState(sessionId, {
          ...session,
          runtimeState:
            session["runtimeState"] === "indeterminate" &&
                payload["runtimeState"] !== "crash_loop"
            ? "indeterminate"
            : payload["runtimeState"],
          attentionState: session["attentionState"] === "needs_attention"
            ? "needs_attention"
            : payload["attentionState"] ?? session["attentionState"],
        });
      }
    },
  });
  let rpcStarted = false;
  if (bootstrap.trustGateAllowed && restoredRuntime !== "crash_loop") {
    await rpc.start();
    rpcStarted = true;
  }
  const policyBridge: OneSessionPolicyBridge = {
    hostMode: () => bootstrap.hostPolicy.effective().mode,
    publish: publishPolicy,
    snapshotModeFor: (sessionId) => {
      const state = store.sessionState(sessionId) ?? {};
      if (typeof state.policyMode !== "string" || typeof state.policyVersion !== "string" || typeof state.trustFingerprint !== "string" || typeof state.lastPolicySnapshotAt !== "string") return null;
      return { policyMode: state.policyMode as HostPolicyMode, policyVersion: state.policyVersion, fingerprint: state.trustFingerprint, snapshottedAt: state.lastPolicySnapshotAt };
    },
  };
  const config: OneSessionWorkspaceConfig = {
    workspaceId,
    rootPath: options.workspace,
    displayName,
    fingerprint,
    policyMode: bootstrap.hostPolicyMode,
    availableSince: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  const attachments = new AttachmentStore({ root: join(stateDir, "attachments") });
  attachments.sweep();
  const attachmentSweepTimer = setInterval(() => {
    try { attachments.sweep(); } catch { /* push/Pi service must outlive cleanup failure */ }
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
  const sessionRpcs = new Map<string, SupervisedRpcClient>();
  const createSessionRpc = (sessionId: string): SupervisedRpcClient => {
    const existing = sessionRpcs.get(sessionId);
    if (existing) return existing;
    const state = store.sessionState(sessionId) ?? {};
    const cwd = typeof state.workspaceRootPath === "string"
      ? state.workspaceRootPath
      : options.workspace;
    if (cwd === options.workspace) return rpc;
    const client = new SupervisedRpcClient({
      processId: sessionId,
      beforeSpawn: () => {
        const trust = bootstrap.handler.resolveTrust(
          bootstrap.primaryRoot.canonicalPath,
        );
        if (trust.status !== "trusted") {
          throw new Error("workspace_trust_required");
        }
      },
      initialState: "stopped",
      rpc: {
        executable: options.executable,
        args: ["--mode", "rpc", "--session-dir", sessionDir, "--extension", extensionPath, ...(options.rpcArgs ?? [])],
        cwd,
        environment: { ...(options.environment ?? {}), PI_MOB_HOST_POLICY_FILE: policyFile },
        pathDirs: options.pathDirs ?? ["/usr/local/bin", "/usr/bin", "/bin"],
        defaultRequestTimeoutMs: 30_000,
        closeGracePeriodMs: 5_000,
      },
      emit(event) {
        if (event.type.startsWith("host.")) {
          store.appendEvent(hostStream, event.type, event.payload);
          return;
        }
        const current = store.sessionState(sessionId) ?? {};
        const payload: Record<string, unknown> = { ...event.payload, sessionId };
        store.appendEvent(`session:${sessionId}`, event.type, payload);
        if (event.type === "session.state" && typeof payload.runtimeState === "string") {
          store.updateSessionState(sessionId, {
            ...current,
            runtimeState: payload.runtimeState,
          });
        }
      },
    });
    sessionRpcs.set(sessionId, client);
    return client;
  };
  const adapter = new OneSessionPiAdapter({ store, createRpc: createSessionRpc, workspace: config, policyBridge, attachmentStore: attachments, exportRegistry: exports, ...(notificationService ? {notificationService} : {}) });
  if(notificationService && capabilityProviders) store.appendEvent(`host:${store.identity().hostId}`,"notification.capability",{available:true,providers:[...capabilityProviders],bestEffort:true});
  const notificationSweepTimer=setInterval(()=>{ try{notificationService?.sweep();}catch{/* Pi service outlives push cleanup */} },60_000);
  notificationSweepTimer.unref();
  const dialogSweepTimer=setInterval(()=>{ try{adapter.sweepExtensionDialogs();}catch{/* service outlives cleanup failure */} },30_000);
  dialogSweepTimer.unref();
  const runtime = new DurableBridgeRuntime({
    store,
    adapter,
    bridgeVersion: BRIDGE_VERSION,
    piVersion: "0.80.6",
    hostDisplayName: displayName,
    policy: bootstrap.handler,
    defaultSessionPolicyMode: bootstrap.hostPolicyMode,
  });
  await runtime.start();

  const server = createBridgeServer({
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    runtime,
    httpHandler: createBinaryHttpHandler({ attachments, exports: adapter }),
  });

  return {
    server, runtime, adapter, rpc, store, workspace: config,
    get rpcStarted() { return rpcStarted; },
    async activate() {
      const trust = bootstrap.handler.resolveTrust(bootstrap.primaryRoot.canonicalPath);
      if (trust.status !== "trusted" || restoredRuntime === "crash_loop") return;
      if (!rpcStarted) {
        await rpc.manualRetry();
        rpcStarted = true;
      }
    },
    async close() {
      clearInterval(attachmentSweepTimer);
      clearInterval(dialogSweepTimer);
      clearInterval(notificationSweepTimer);
      try { notificationService?.sweep(); } catch { /* best effort */ }
      try { attachments.sweep(); } catch { /* best effort */ }
      try { adapter.sweepExtensionDialogs(); } catch { /* best effort */ }
      try { await rpc.drain(); } catch { /* best-effort drain event */ }
      for (const client of sessionRpcs.values()) {
        try { await client.drain(); } catch { /* best-effort */ }
      }
      adapter.close();
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

/**
 * Builds the M8 policy bootstrap before Pi starts. New workspaces remain
 * approval-required; only the host policy mode is seeded from configuration.
 */
function bootstrapPolicy(input: {
  store: BridgeStore;
  primaryWorkspacePath: string;
  primaryWorkspaceLabel: string;
  requestedPolicyMode: HostPolicyMode;
  extraRoots: readonly string[];
}): DaemonPolicyBootstrap {
  const trustStore = new DurableTrustPolicyStore(input.store);
  const hostPolicy = new HostPolicyService(input.store);
  let rootsConfig = createWorkspaceRootsConfig();
  let primaryRoot: WorkspaceRoot;
  try {
    const canonical = canonicalize(input.primaryWorkspacePath);
    rootsConfig = addAllowedRoot(rootsConfig, canonical, input.primaryWorkspaceLabel);
    primaryRoot = rootsConfig.roots[0]!;
  } catch {
    primaryRoot = { id: deriveRootId(input.primaryWorkspacePath), canonicalPath: input.primaryWorkspacePath, label: input.primaryWorkspaceLabel };
    rootsConfig = createWorkspaceRootsConfig([primaryRoot]);
  }
  for (const extra of input.extraRoots) {
    try {
      const extraCanonical = canonicalize(extra);
      rootsConfig = addAllowedRoot(rootsConfig, extraCanonical, basename(extraCanonical));
    } catch { /* refuse silently: extra roots are optional */ }
  }

  // Seed the host policy from the requested mode on first launch only.
  const hostSeed = hostPolicy.seedIfAbsent({ mode: input.requestedPolicyMode, actor: "daemon-config" });

  const handler: RuntimePolicyHandler = {
    trustStore,
    hostPolicy,
    search: (sub) => defaultBoundedSearch({ ...sub, rootCanonical: primaryRoot.canonicalPath }),
    resolveTrust: (rootCanonical, workspaceId = primaryRoot.id) => trustStore.resolveTrustState({ workspaceId, rootCanonical }),
    rootSeed: () => primaryRoot,
    approve: ({ workspaceId = primaryRoot.id, rootCanonical = primaryRoot.canonicalPath, label = primaryRoot.label, fingerprint, approvedBy, now }) => {
      const manifest = buildTrustManifest(rootCanonical);
      const record = trustStore.approve({
        workspaceId,
        rootPath: rootCanonical,
        label,
        fingerprint,
        policyVersion: manifest.policyVersion,
        approvedBy,
        ...(now !== undefined ? { now } : {}),
      });
      return { workspaceId: record.workspaceId, fingerprint: record.fingerprint, approvedAt: record.approvedAt, policyVersion: record.policyVersion };
    },
  };
  const trustGateAllowed = handler.resolveTrust(primaryRoot.canonicalPath).status === "trusted";
  return { rootsConfig, primaryRoot, trustStore, hostPolicy, handler, hostPolicyMode: hostSeed.policy.mode, trustGateAllowed };
}

function hashFingerprint(rootPath: string): string {
  return new Bun.CryptoHasher("sha256").update(`workspace:${rootPath}`).digest("hex").slice(0, 32);
}

// ---------------- CLI ----------------

interface CliArgs {
  workspace: string | null;
  executable: string | null;
  port: number | null;
  config: string | null;
  stateDir: string | null;
  sessionDir: string | null;
  displayName: string | null;
  policyMode: HostPolicyMode | null;
  allowedRoots: string[];
  extensionPath: string | null;
  fcmServiceAccount: string | null;
  help: boolean;
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const out: CliArgs = { workspace: null, executable: null, port: null, config: null, stateDir: null, sessionDir: null, displayName: null, policyMode: null, allowedRoots: [], extensionPath: null, fcmServiceAccount: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--workspace": out.workspace = argv[++i] ?? null; break;
      case "--executable": out.executable = argv[++i] ?? null; break;
      case "--config": out.config = argv[++i] ?? null; break;
      case "--extension": out.extensionPath = argv[++i] ?? null; break;
      case "--port": out.port = Number.parseInt(argv[++i] ?? "8788", 10); break;
      case "--state-dir": out.stateDir = argv[++i] ?? null; break;
      case "--session-dir": out.sessionDir = argv[++i] ?? null; break;
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
      case "--help": case "-h": out.help = true; break;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (out.port !== null && (!Number.isFinite(out.port) || out.port < 0 || out.port > 65535)) throw new Error("--port must be a valid TCP port");
  for (const path of out.allowedRoots) if (!isAbsolute(path)) throw new Error(`--allowed-root paths must be absolute: ${path}`);
  if (out.fcmServiceAccount !== null && !isAbsolute(out.fcmServiceAccount)) throw new Error("--fcm-service-account path must be absolute");
  return out;
}

const USAGE = `usage: daemon --workspace <abs path> [--config <abs path> | --executable <abs path>] [--extension <abs path>] [--port N] [--state-dir <abs path>] [--session-dir <abs path>] [--display-name <str>] [--policy-mode full|read_only] [--allowed-root <abs path>]... [--fcm-service-account <abs path>]`;

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
  const executable = args.executable ?? installed?.piExecutable ?? null;
  if (args.help || !args.workspace || !executable) {
    process.stdout.write(`${USAGE}\n`);
    return args.help ? 0 : 2;
  }
  let fcmConfig: FcmConfig | null = null;
  if (args.fcmServiceAccount) {
    try {
      const loaded = loadFcmServiceAccount(args.fcmServiceAccount);
      fcmConfig = { projectId: loaded.projectId, serviceAccountEmail: loaded.serviceAccountEmail, privateKey: loaded.privateKey };
    } catch (error) {
      process.stderr.write(`${(error as Error).message}\n`);
      return 2;
    }
  }
  const handle = await runDaemon({
    workspace: args.workspace,
    executable,
    port: args.port ?? installed?.port ?? 8788,
    ...(args.stateDir ? { stateDir: args.stateDir } : installed ? { stateDir: installed.stateRoot } : {}),
    ...(args.sessionDir ? { sessionDir: args.sessionDir } : {}),
    ...(args.displayName ? { displayName: args.displayName } : {}),
    ...(args.policyMode ? { policyMode: args.policyMode } : {}),
    ...(args.allowedRoots.length > 0 ? { allowedRoots: args.allowedRoots } : {}),
    ...(args.extensionPath ? { extensionPath: args.extensionPath } : {}),
    ...(fcmConfig ? { fcm: fcmConfig } : {}),
    ...(process.env.PI_MOB_PAIRING_FILE ? { environment: { PI_MOB_PAIRING_FILE: process.env.PI_MOB_PAIRING_FILE } } : {}),
  });
  process.stdout.write(`${JSON.stringify({
    protocolVersion: PROTOCOL_VERSION,
    bridgeVersion: BRIDGE_VERSION,
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
