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
 *   --workspace <abs path>   workspace root (also becomes Pi's cwd)
 *   --executable <abs path>  Pi RPC binary
 *   --port <int>             loopback port to bind (default 8788)
 *   --state-dir <abs path>   durable SQLite directory (default /tmp/pi-mob-state)
 *   --session-dir <abs path> Pi session directory (default $TMPDIR/pi-mob-sessions)
 *   --display-name <str>     human-readable workspace name (defaults to basename)
 *   --help                   print usage
 */

import { existsSync, mkdirSync } from "node:fs";
import { isAbsolute, basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { SupervisedRpcClient } from "./pi/supervised-rpc-client";
import { OneSessionPiAdapter, type OneSessionWorkspaceConfig } from "./pi/one-session-adapter";
import { BridgeStore } from "./core/store";
import { DurableBridgeRuntime } from "./core/runtime";
import { createBridgeServer, type BridgeServer } from "./core/server";
import { createRedactingLogger, type RedactingLogger } from "./logger";

const PROTOCOL_VERSION = "1.0";
const BRIDGE_VERSION = "0.0.0-m6";

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
}

export interface DaemonHandle {
  readonly server: BridgeServer;
  readonly runtime: DurableBridgeRuntime;
  readonly adapter: OneSessionPiAdapter;
  readonly rpc: SupervisedRpcClient;
  readonly store: BridgeStore;
  readonly workspace: OneSessionWorkspaceConfig;
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
  const workspaceId = hashWorkspaceId(options.workspace);
  const fingerprint = computeFingerprint(options.workspace);
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

  const rpc = new SupervisedRpcClient({
    processId: workspaceId,
    initialState: restoredRuntime === "crash_loop" ? "crash_loop" : "stopped",
    rpc: {
      executable: options.executable,
      args: ["--mode", "rpc", "--session-dir", sessionDir, ...(options.rpcArgs ?? [])],
      cwd: options.workspace,
      environment: options.environment ?? {},
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
  if (restoredRuntime !== "crash_loop") await rpc.start();
  const config: OneSessionWorkspaceConfig = {
    workspaceId,
    rootPath: options.workspace,
    displayName,
    fingerprint,
    policyMode: "full",
    availableSince: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  const adapter = new OneSessionPiAdapter({ store, rpc, workspace: config });
  const runtime = new DurableBridgeRuntime({
    store,
    adapter,
    bridgeVersion: BRIDGE_VERSION,
    piVersion: "0.80.6",
    hostDisplayName: displayName,
  });
  await runtime.start();

  const server = createBridgeServer({ hostname: "127.0.0.1", port: options.port ?? 0, runtime });

  return {
    server, runtime, adapter, rpc, store, workspace: config,
    async close() {
      try { await rpc.drain(); } catch { /* best-effort drain event */ }
      adapter.close();
      try { server.stop(true); } catch { /* ignore */ }
      try { await rpc.close(); } catch { /* ignore */ }
      store.close();
    },
  };
}

// ---------------- helpers ----------------

function hashWorkspaceId(rootPath: string): string {
  // Stable, deterministic UUID-shape identifier for a workspace root.
  // Avoids requiring a real UUID generator and stays stable across
  // daemon restarts for the same path.
  const bytes = new TextEncoder().encode(rootPath);
  const hex = new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function computeFingerprint(rootPath: string): string {
  return new Bun.CryptoHasher("sha256").update(`workspace:${rootPath}`).digest("hex").slice(0, 32);
}

// ---------------- CLI ----------------

interface CliArgs {
  workspace: string | null;
  executable: string | null;
  port: number;
  stateDir: string | null;
  sessionDir: string | null;
  displayName: string | null;
  help: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const out: CliArgs = { workspace: null, executable: null, port: 8788, stateDir: null, sessionDir: null, displayName: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--workspace": out.workspace = argv[++i] ?? null; break;
      case "--executable": out.executable = argv[++i] ?? null; break;
      case "--port": out.port = Number.parseInt(argv[++i] ?? "8788", 10); break;
      case "--state-dir": out.stateDir = argv[++i] ?? null; break;
      case "--session-dir": out.sessionDir = argv[++i] ?? null; break;
      case "--display-name": out.displayName = argv[++i] ?? null; break;
      case "--help": case "-h": out.help = true; break;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(out.port) || out.port < 0 || out.port > 65535) throw new Error("--port must be a valid TCP port");
  return out;
}

const USAGE = `usage: daemon --workspace <abs path> --executable <abs path> [--port N] [--state-dir <abs path>] [--session-dir <abs path>] [--display-name <str>]`;

export async function main(argv: readonly string[]): Promise<number> {
  let args: CliArgs;
  try { args = parseArgs(argv); }
  catch (error) { process.stderr.write(`${USAGE}\n${(error as Error).message}\n`); return 2; }
  if (args.help || !args.workspace || !args.executable) {
    process.stdout.write(`${USAGE}\n`);
    return args.help ? 0 : 2;
  }
  const handle = await runDaemon({
    workspace: args.workspace,
    executable: args.executable,
    port: args.port,
    ...(args.stateDir ? { stateDir: args.stateDir } : {}),
    ...(args.sessionDir ? { sessionDir: args.sessionDir } : {}),
    ...(args.displayName ? { displayName: args.displayName } : {}),
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
