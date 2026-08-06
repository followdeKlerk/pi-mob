/**
 * M6 bridge daemon: supervises Pi RPC and serves the currently configured
 * one-session diagnostic workspace over the durable loopback WebSocket
 * transport. Install, private Serve exposure, pairing, and service lifecycle
 * land in M7.
 *
 * The bridge intentionally owns no policy / trust / read-only machinery.
 * Pi's normal execution model is the default. The legacy read-only path
 * has been removed from the default code path; persisted databases that
 * still record `policyMode: "read_only"` are coerced to `"full"`.
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

import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, basename, join, relative, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { SupervisedRpcClient } from "./pi/supervised-rpc-client";
import { resolvePiLaunchConfig, type PiLaunchConfig } from "./pi/launch-config";
import { importExternalSessionHistory, reconcileSessionHistoryTail } from "./pi/external-history";
import { OneSessionPiAdapter, type OneSessionWorkspaceConfig } from "./pi/one-session-adapter";
import { BridgeStore } from "./core/store";
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

export interface DaemonOptions {
  readonly workspace: string;
  readonly executable: string;
  readonly port?: number;
  readonly stateDir?: string;
  readonly sessionDir?: string;
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
  /**
   * Optional Pi extension path. The bridge no longer injects a default
   * policy extension; pass this when the operator wants Pi loaded with
   * a custom extension. Omit to run Pi with no `--extension` flag.
   */
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

export interface DaemonHandle {
  readonly server: BridgeServer;
  readonly runtime: DurableBridgeRuntime;
  readonly adapter: OneSessionPiAdapter;
  readonly rpc: SupervisedRpcClient;
  readonly store: BridgeStore;
  readonly workspace: OneSessionWorkspaceConfig;
  /** Dedicated canonical transcript authority used by session_events.v2. */
  readonly canonicalSessionStore: CanonicalSessionStore;
  /** True when the Pi RPC supervisor has been started. */
  readonly rpcStarted: boolean;
  close(): Promise<void>;
}

function assertAbsolute(label: string, value: string): void {
  if (!isAbsolute(value)) throw new Error(`${label} must be an absolute path (got ${JSON.stringify(value)})`);
}

interface DiscoveredPiSession {
  readonly sessionId: string;
  readonly path: string;
  readonly cwd: string;
  readonly name: string;
  readonly createdAt: string;
  readonly modifiedAt: string;
}

function previewUserText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const value = message as Record<string, unknown>;
  if (value.role !== "user") return "";
  const content = value.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => {
    if (!item || typeof item !== "object") return "";
    const part = item as Record<string, unknown>;
    return part.type === "text" && typeof part.text === "string" ? part.text : "";
  }).filter(Boolean).join(" ");
}

function compactSessionName(value: string, fallback: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (!singleLine) return fallback;
  return singleLine.length > 72 ? `${singleLine.slice(0, 69)}…` : singleLine;
}

function discoverHostModels(launchConfig: PiLaunchConfig): Array<Record<string, unknown>> {
  try {
    const result = Bun.spawnSync({
      cmd: [launchConfig.executable, "--list-models"],
      cwd: launchConfig.cwd,
      env: launchConfig.env,
      stdout: "pipe",
      stderr: "ignore",
    });
    if (result.exitCode !== 0) return [];
    const lines = result.stdout.toString().split("\n").slice(1);
    const models: Array<Record<string, unknown>> = [];
    for (const line of lines) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 6) continue;
      const [provider, id, contextWindow, maxOutput, thinking, images] = columns;
      if (!provider || !id) continue;
      models.push({
        id,
        modelId: id,
        name: id,
        label: id,
        provider,
        contextWindow,
        maxOutput,
        thinking: thinking === "yes",
        images: images === "yes",
        available: true,
      });
    }
    return models.slice(0, 500);
  } catch {
    return [];
  }
}

function discoverPiSessions(workspaceRoot: string, environment: Readonly<Record<string, string>>): DiscoveredPiSession[] {
  const home = environment.HOME;
  if (!home) return [];
  const root = join(home, ".pi", "agent", "sessions");
  if (!existsSync(root)) return [];
  const files: string[] = [];
  for (const directory of readdirSync(root, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const parent = join(root, directory.name);
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(join(parent, entry.name));
      }
    }
  }
  const discovered: DiscoveredPiSession[] = [];
  for (const path of files.slice(0, 500)) {
    try {
      const stats = statSync(path);
      const bytes = Math.min(stats.size, 1024 * 1024);
      const buffer = Buffer.alloc(bytes);
      const fd = openSync(path, "r");
      try { readSync(fd, buffer, 0, bytes, 0); } finally { closeSync(fd); }
      const lines = buffer.toString("utf8").split("\n");
      const header = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
      if (header.type !== "session" || typeof header.id !== "string" ||
          typeof header.cwd !== "string") continue;
      const sessionId = header.id;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) continue;
      const cwd = resolve(header.cwd);
      const relativePath = relative(workspaceRoot, cwd);
      if (relativePath.startsWith("..") || isAbsolute(relativePath)) continue;
      let explicitName = "";
      let firstMessage = "";
      for (const line of lines.slice(1)) {
        if (!line.trim()) continue;
        let entry: Record<string, unknown>;
        try { entry = JSON.parse(line) as Record<string, unknown>; }
        catch { continue; }
        if (entry.type === "session_info" && typeof entry.name === "string") {
          explicitName = entry.name;
        }
        if (!firstMessage && entry.type === "message") {
          firstMessage = previewUserText(entry.message);
        }
      }
      discovered.push({
        sessionId,
        path,
        cwd,
        name: compactSessionName(explicitName || firstMessage, basename(cwd) || "Untitled chat"),
        createdAt: typeof header.timestamp === "string" ? header.timestamp : stats.birthtime.toISOString(),
        modifiedAt: stats.mtime.toISOString(),
      });
    } catch {
      // A partially-written or malformed TUI session must not block the host.
    }
  }
  return discovered.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
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
  assertAbsolute("workspace", options.workspace);
  assertAbsolute("executable", options.executable);
  if (!existsSync(options.workspace)) throw new Error(`workspace does not exist: ${options.workspace}`);
  if (!existsSync(options.executable)) throw new Error(`executable does not exist: ${options.executable}`);

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
  if (options.extensionPath) {
    assertAbsolute("extensionPath", options.extensionPath);
    if (!existsSync(options.extensionPath)) throw new Error(`extension does not exist: ${options.extensionPath}`);
  }

  const stateDir = resolve(options.stateDir ?? join(tmpdir(), "pi-mob-state"));
  const sessionDir = resolve(options.sessionDir ?? join(tmpdir(), "pi-mob-sessions"));
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  mkdirSync(sessionDir, { recursive: true, mode: 0o700 });

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

  // One owner-captured launch contract is shared by model discovery and every
  // primary or per-session Pi RPC. Per-session arguments/cwds are explicit
  // overlays, while executable and environment never diverge.
  const piLaunchConfig = resolvePiLaunchConfig({
    executable: options.executable,
    cwd: options.workspace,
    env: { ...(options.environment ?? {}) },
  });

  // Pi's normal TUI and pi-mob historically used separate session
  // directories. Import the canonical TUI index into the bridge directory so
  // mobile can discover and resume existing conversations. The JSONL remains
  // Pi-owned; only bounded metadata and the absolute resume path are stored.
  for (const session of discoverPiSessions(canonicalWorkspacePath, piLaunchConfig.env)) {
    if (store.sessionExists(session.sessionId)) continue;
    let sessionWorkspaceId: WorkspaceRootId;
    try { sessionWorkspaceId = deriveRootId(canonicalize(session.cwd)); }
    catch { continue; }
    const relativePath = relative(canonicalWorkspacePath, session.cwd) || ".";
    const state: Record<string, unknown> = {
      sessionId: session.sessionId,
      name: session.name,
      runtimeState: "stopped",
      attentionState: "none",
      controllerState: "none",
      queueCount: 0,
      policyMode: "full" as HostPolicyMode,
      workspaceId: sessionWorkspaceId,
      workspaceRootPath: session.cwd,
      workspaceRelativePath: relativePath,
      workspaceDisplayName: basename(session.cwd) || displayName,
      piSessionPath: session.path,
      externalSession: true,
      createdAt: session.createdAt,
      lastActivityAt: session.modifiedAt,
      deletionState: "active",
      lifecycleState: "active",
    };
    store.ensureSession(session.sessionId, state);
    store.ensureStream(`session:${session.sessionId}`, "session", session.sessionId);
  }
  const extensionArgs: string[] = options.extensionPath ? ["--extension", options.extensionPath] : [];
  const reconcile = (sessionId: string, liveProcess: boolean) => {
    const state = store.sessionState(sessionId);
    if (!state || typeof state.piSessionPath !== "string") {
      return { authoritativeTerminal: false, turnOutcome: { kind: "live", imported: 0 } as const };
    }
    return reconcileSessionHistoryTail(store, sessionId, state.piSessionPath, { liveProcess }, {
      sessionStore: canonicalSessionStore,
    });
  };

  /** Map a `ReconciledTurnOutcome` to the canonical adapter runtimeState/
   *  attentionState pair for a historical, terminalised turn. This mirrors
   *  the live-adapter mapping in `one-session-adapter.ts` so a session
   *  reconciled at startup converges with the state it would have reached
   *  through the live RPC. */
  const canonicalHistoricalState = (outcome: ReturnType<typeof reconcile>["turnOutcome"]): { runtimeState: string; attentionState: string } | null => {
    if (outcome.kind === "idle") {
      // settled / aborted / failed all converge to idle/ready per the
      // canonical adapter mapping; provider_interrupted is a Pi-specific
      // variant that only the live path can produce.
      return { runtimeState: "idle", attentionState: "ready" };
    }
    if (outcome.kind === "indeterminate") {
      return { runtimeState: "indeterminate", attentionState: "needs_attention" };
    }
    // live owner: do not mutate the persisted runtime state. A healthy
    // owner may continue; the live adapter will publish its own boundary.
    return null;
  };

  // Reconcile bridge-owned sessions before crash recovery. Pi's JSONL is the
  // authority for a live session: a terminal tool result/final answer must
  // win over the bridge's stale persisted `running` state. External sessions
  // retain their import-only startup behaviour.
  //
  // The reconciler returns the precise lifecycle outcome for the
  // reconciled active turn. Mapping that outcome (not the whole history)
  // to runtimeState/attentionState is what keeps a session whose JSONL
  // genuinely settled out of a stale "Running" presentation, while still
  // leaving a healthy live owner's persisted state untouched.
  const reconciledAtStartup = new Set<string>();
  // Defer bulk JSONL reconciliation until the loopback server exists.
  // Health remains not-ready until this function and runtime recovery finish.
  const reconcileStartup = (): void => {
  for (const state of store.sessionStates()) {
    if (typeof state.sessionId !== "string" || typeof state.piSessionPath !== "string") continue;
    try {
      if (state.externalSession === true) {
        importExternalSessionHistory(store, state.sessionId, state.piSessionPath, {
          sessionStore: canonicalSessionStore,
        });
        continue;
      }
      if (!existsSync(state.piSessionPath)) continue;
      const result = reconcile(state.sessionId, false);
      reconciledAtStartup.add(state.sessionId);
      const canonical = canonicalHistoricalState(result.turnOutcome);
      if (canonical) {
        const current = store.sessionState(state.sessionId) ?? state;
        const nextState = {
          ...current,
          runtimeState: canonical.runtimeState,
          attentionState: canonical.attentionState,
          lastActivityAt: new Date().toISOString(),
        };
        // Persist the row update.
        store.updateSessionState(state.sessionId, nextState);
        // Emit a host-stream `session.summary` so connected/replaying
        // mobile clients learn the new terminal state. `changeSessionSummary`
        // appends `changedKeys` describing exactly which fields moved.
        store.changeSessionSummary(state.sessionId, {
          runtimeState: canonical.runtimeState,
          attentionState: canonical.attentionState,
        });
      }
    } catch {
      // Corrupt or concurrently-written TUI history must not prevent the host
      // from starting; the next daemon launch retries because no marker moved.
    }
  }

  const uncertainAtStartup = store.markUncertainIndeterminate();
  // Recovery is per durable session. Never let insertion order select the
  // session whose commands or open turn become indeterminate.
  for (const session of store.sessionStates()) {
    const sessionId = typeof session.sessionId === "string" ? session.sessionId : null;
    if (!sessionId) continue;
    if (uncertainAtStartup.some((command) => command.scopeKey === `session:${sessionId}`)) {
      store.updateSessionState(sessionId, {
        ...session,
        runtimeState: "indeterminate",
        attentionState: "needs_attention",
      });
    }
    if (reconciledAtStartup.has(sessionId)) continue;
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
  // The legacy primary client may be assigned to one session by the factory
  // below. Its exit callback must use that explicit binding, never an
  // arbitrary sessionStates()[0] lookup.
  let primaryRpcOwner: string | null = null;
  let hostDrainingEmitted = false;
  const appendHostDraining = (payload: Record<string, unknown>): void => {
    if (hostDrainingEmitted) return;
    hostDrainingEmitted = true;
    store.appendEvent(hostStream, "host.draining", payload);
  };
  const rpc = new SupervisedRpcClient({
    beforeUnexpectedExit: () => primaryRpcOwner
      ? reconcile(primaryRpcOwner, false)
      : { authoritativeTerminal: false },
    processId: workspaceId,
    initialState: store.sessionStates().some((session) => session.runtimeState === "crash_loop") ? "crash_loop" : "stopped",
    rpc: {
      launchConfig: piLaunchConfig,
      args: ["--mode", "rpc", "--session-dir", sessionDir, ...extensionArgs, ...(options.rpcArgs ?? [])],
      defaultRequestTimeoutMs: 30_000,
      closeGracePeriodMs: 5_000,
    },
    emit(event) {
      if (event.type === "host.draining") {
        appendHostDraining(event.payload);
        return;
      }
      if (event.type.startsWith("host.")) {
        store.appendEvent(hostStream, event.type, event.payload);
        return;
      }
      const sessionId = primaryRpcOwner;
      if (!sessionId) return;
      const session = store.sessionState(sessionId) as Record<string, unknown> | undefined;
      if (!session) return;
      const payload: Record<string, unknown> = { ...event.payload, sessionId };
      appendTranscriptEvent(sessionId, event.type, payload);
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
  // Do not launch an unbound compatibility Pi process. Mobile sessions are
  // started lazily by their own per-session supervised client below.
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
    const externalSessionPath = typeof state.piSessionPath === "string"
      ? state.piSessionPath
      : null;
    // Mobile sessions always get an independent supervised client. The old
    // primary binding had no stable Pi identity and could replace a valid
    // session file with a fresh restart path.
    const client = new SupervisedRpcClient({
      beforeUnexpectedExit: () => reconcile(sessionId, false),
      processId: sessionId,
      initialState: "stopped",
      rpc: {
        launchConfig: piLaunchConfig,
        args: [
          "--mode", "rpc",
          ...(externalSessionPath
            ? ["--session", externalSessionPath, "--session-dir", sessionDir]
            : ["--session-id", sessionId, "--session-dir", sessionDir]),
          ...extensionArgs,
          ...(options.rpcArgs ?? []),
        ],
        cwd,
        defaultRequestTimeoutMs: 30_000,
        closeGracePeriodMs: 5_000,
      },
      ...(externalSessionPath ? {
        beforeSpawn: () => {
          if (!existsSync(externalSessionPath)) throw new Error("pi session history is unavailable");
        },
      } : {}),
      emit(event) {
        if (event.type === "host.draining") {
          appendHostDraining(event.payload);
          return;
        }
        if (event.type.startsWith("host.")) {
          store.appendEvent(hostStream, event.type, event.payload);
          return;
        }
        const current = store.sessionState(sessionId) ?? {};
        const payload: Record<string, unknown> = { ...event.payload, sessionId };
        appendTranscriptEvent(sessionId, event.type, payload);
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
  const hostModels = discoverHostModels(piLaunchConfig);
  // The dedicated store is created before the adapter so canonical Pi
  // notifications can enter the v2 log before mobile subscriptions begin.
  // Rewrite slice: route raw Pi notifications to a bounded diagnostics
  // sink instead of the user-visible session stream. The diagnostics DB
  // lives beside the canonical journal so a corruption or sweep in one
  // never blocks the other. Diagnostics are NEVER consulted by transcript
  // rendering code; the sink is support-only. A failure to open the
  // diagnostics DB MUST NOT prevent the daemon from starting; the
  // adapter simply falls back to no diagnostics, and the bridge enters
  // runtime with full canonical journal functionality.
  let diagnosticsSink: PiDiagnosticsSink | null = null;
  try {
    const path = join(stateDir, "pi-diagnostics.sqlite");
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
    workspace: config,
    attachmentStore: attachments,
    exportRegistry: exports,
    hostModels,
    reconcileHistory: (sessionId: string, liveProcess: boolean) => reconcile(sessionId, liveProcess),
    // Live adapter admission uses the dedicated canonical log directly.
    // `recipe.activity` remains a derived compatibility projection only.
    canonicalSessionStore,
  };
  if (diagnosticsSink !== null) adapterOptions["diagnosticsSink"] = diagnosticsSink;
  if (notificationService) adapterOptions["notificationService"] = notificationService;
  const adapter = new OneSessionPiAdapter(adapterOptions as never);
  if(notificationService && capabilityProviders) store.appendEvent(`host:${store.identity().hostId}`,"notification.capability",{available:true,providers:[...capabilityProviders],bestEffort:true});
  const notificationSweepTimer=setInterval(()=>{ try{notificationService?.sweep();}catch{/* Pi service outlives push cleanup */} },60_000);
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
    piVersion: "0.82.0",
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

  return {
    server, runtime, adapter, rpc, store, workspace: config, canonicalSessionStore,
    get rpcStarted() { return rpcStarted; },
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
  executable: string | null;
  port: number | null;
  config: string | null;
  stateDir: string | null;
  sessionDir: string | null;
  displayName: string | null;
  policyMode: HostPolicyMode | null;
  allowedRoots: string[];
  searchRoots: string[];
  extensionPath: string | null;
  fcmServiceAccount: string | null;
  help: boolean;
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const out: CliArgs = { workspace: null, executable: null, port: null, config: null, stateDir: null, sessionDir: null, displayName: null, policyMode: null, allowedRoots: [], searchRoots: [], extensionPath: null, fcmServiceAccount: null, help: false };
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
        // Deprecated: kept as a no-op for back-compat with persisted
        // install configs that still pass the flag. The bridge no longer
        // owns a host policy; any value is coerced to "full".
        const next = argv[++i] ?? null;
        if (next !== "full" && next !== "read_only") throw new Error("--policy-mode must be `full` or `read_only`");
        out.policyMode = next;
        break;
      }
      case "--allowed-root": {
        // Deprecated: kept for back-compat. The bridge no longer
        // maintains a multi-root allowlist; the value is ignored.
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

const USAGE = `usage: daemon --workspace <abs path> [--config <abs path> | --executable <abs path>] [--extension <abs path>] [--port N] [--state-dir <abs path>] [--session-dir <abs path>] [--display-name <str>] [--search-root <abs path>] [--fcm-service-account <abs path>]`;

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
    ...(installed?.bridgeVersion ? { bridgeVersion: installed.bridgeVersion } : {}),
    ...(args.policyMode ? { policyMode: args.policyMode } : {}),
    ...(args.allowedRoots.length > 0 ? { allowedRoots: args.allowedRoots } : {}),
    ...(args.searchRoots.length > 0 ? { searchRoots: args.searchRoots } : {}),
    ...(args.extensionPath ? { extensionPath: args.extensionPath } : {}),
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
