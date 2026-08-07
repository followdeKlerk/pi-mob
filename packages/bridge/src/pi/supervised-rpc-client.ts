import { ProcessSupervisor, type ManagedProcess, type ProcessLifecycleEvent, type ProcessSpawnSpec } from "../core/process-supervisor";
import { RpcProcess, type RpcProcessConfiguration, type RpcRequestOptions } from "./rpc-process";
import type { PiRpcNotificationHandler, PiRpcRequestOptions } from "./one-session-adapter";

export interface SupervisedRpcClientOptions {
  readonly rpc: RpcProcessConfiguration;
  readonly processId: string;
  readonly now?: () => number;
  readonly restartDelayMs?: number;
  readonly maintenanceIntervalMs?: number;
  readonly initialState?: "stopped" | "crash_loop" | "incompatible";
  readonly capacity?: number;
  readonly emit?: (event: ProcessLifecycleEvent) => void;
  /** Synchronous final admission check invoked immediately before Bun.spawn. */
  readonly beforeSpawn?: () => void;
  /** Reconcile Pi JSONL before converting an exit into indeterminate state. */
  readonly beforeUnexpectedExit?: () => { readonly authoritativeTerminal: boolean };
}

/** Restartable Pi RPC proxy used by the daemon. The adapter keeps one stable
 * client reference while the supervisor can replace crashed subprocesses. */
export class SupervisedRpcClient {
  private current: RpcProcess | null = null;
  private readonly notifications = new Set<PiRpcNotificationHandler>();
  private readonly supervisor: ProcessSupervisor;
  private readonly processId: string;
  private readonly spec: ProcessSpawnSpec;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private closing = false;

  constructor(private readonly options: SupervisedRpcClientOptions) {
    this.processId = options.processId;
    const launch = "launchConfig" in options.rpc ? options.rpc.launchConfig : options.rpc;
    this.spec = { executable: launch.executable, args: "launchConfig" in options.rpc ? [...launch.args, ...(options.rpc.args ?? [])] : launch.args, cwd: "launchConfig" in options.rpc ? options.rpc.cwd ?? launch.cwd : launch.cwd };
    this.supervisor = new ProcessSupervisor({
      capacity: options.capacity ?? 3,
      ...(options.now ? { now: options.now } : {}),
      retryDelayMs: options.restartDelayMs ?? 1_000,
      createProcess: () => new RpcManagedProcess(
        new RpcProcess(options.rpc),
        (rpc) => { this.current = rpc; this.bind(rpc); },
        () => this.unexpectedExit(),
        options.beforeSpawn,
      ),
      ...(options.emit ? { emit: options.emit } : {}),
    });
    this.supervisor.register(this.processId, options.initialState ?? "stopped");
    this.supervisor.configure(this.processId, this.spec);
  }

  async start(): Promise<void> {
    await this.supervisor.start(this.processId, this.spec);
    this.maintenanceTimer = setInterval(() => {
      void this.supervisor.tick();
    }, this.options.maintenanceIntervalMs ?? 60_000);
    this.maintenanceTimer.unref?.();
  }

  async request(options: PiRpcRequestOptions): Promise<unknown> {
    const rpc = this.current;
    if (this.supervisor.isDraining) throw new Error("host_draining");
    if (!rpc || !["idle", "running", "waiting_for_input", "compacting"].includes(this.supervisor.state(this.processId))) throw new Error("Pi process unavailable");
    return rpc.request(options as RpcRequestOptions);
  }

  async sendExtensionUiResponse(response: { id:string; value?:string; confirmed?:boolean; cancelled?:true }): Promise<void> {
    const rpc = this.current;
    if (!rpc) throw new Error("Pi process unavailable");
    await rpc.sendExtensionUiResponse(response);
  }

  on(kind: "notification", handler: PiRpcNotificationHandler): () => void {
    if (kind !== "notification") return () => undefined;
    this.notifications.add(handler);
    return () => this.notifications.delete(handler);
  }

  markDispatchStart(): void {
    if (this.supervisor.state(this.processId) === "idle") {
      this.supervisor.transition(this.processId, "running");
    }
  }
  state(): string { return this.supervisor.state(this.processId); }
  lifecycleState(): string { return this.state(); }
  snapshot() { return this.supervisor.snapshot(); }
  async manualRetry(): Promise<void> {
    const state = this.supervisor.state(this.processId);
    if (state === "idle") return;
    if (state === "stopped") {
      await this.supervisor.start(this.processId, this.spec);
      return;
    }
    await this.supervisor.manualRetry(this.processId);
  }
  isDraining(): boolean { return this.supervisor.isDraining; }
  async drain(): Promise<void> { await this.supervisor.drain(); }
  async close(): Promise<void> {
    this.closing = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    await this.supervisor.stop(this.processId, "daemon_shutdown");
    this.current = null;
  }

  private bind(rpc: RpcProcess): void {
    rpc.on("notification", (value, raw) => {
      this.project(value);
      void raw;
      for (const handler of this.notifications) handler(value);
    });
  }

  private project(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const record = value as { type?: unknown; method?: unknown };
    const type = record.type;
    const state = this.supervisor.state(this.processId);
    try {
      if (type === "agent_start" && state === "idle") this.supervisor.transition(this.processId, "running");
      else if (type === "compaction_start" && ["idle", "running"].includes(state)) this.supervisor.transition(this.processId, "compacting");
      else if (type === "extension_ui_request" && ["select", "confirm", "input", "editor"].includes(String(record.method ?? "")) && ["idle", "running"].includes(state)) this.supervisor.transition(this.processId, "waiting_for_input", "dialog");
      else if (type === "agent_settled" && ["running", "waiting_for_input", "compacting"].includes(state)) {
        this.supervisor.setAttention(this.processId, "none");
        this.supervisor.transition(this.processId, "idle");
      }
    } catch { /* durable adapter events remain authoritative */ }
  }

  private unexpectedExit(): void {
    if (this.closing) return;
    const running = ["running", "waiting_for_input", "compacting"].includes(this.supervisor.state(this.processId));
    let authoritativeTerminal = false;
    try { authoritativeTerminal = this.options.beforeUnexpectedExit?.().authoritativeTerminal ?? false; } catch { /* reconciliation retries on restart */ }
    void this.supervisor.unexpectedExit(this.processId, { runningAction: running && !authoritativeTerminal }).then(() => {
      if (this.supervisor.state(this.processId) !== "retry_wait") return;
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        void this.supervisor.tick();
      }, this.options.restartDelayMs ?? 1_000);
    });
  }
}

class RpcManagedProcess implements ManagedProcess {
  private expected = false;
  constructor(
    private readonly rpc: RpcProcess,
    private readonly becameCurrent: (rpc: RpcProcess) => void,
    private readonly exitedUnexpectedly: () => void,
    private readonly beforeSpawn?: () => void,
  ) {}
  get pid(): number | undefined { return this.rpc.pid; }
  async start(_spec: ProcessSpawnSpec): Promise<void> {
    this.beforeSpawn?.();
    this.becameCurrent(this.rpc);
    this.rpc.on("exit", () => { if (!this.expected) this.exitedUnexpectedly(); });
    await this.rpc.start();
  }
  terminate(): void { this.expected = true; void this.rpc.close(); }
  async waitForExit(timeoutMs: number): Promise<boolean> {
    return Promise.race([
      this.rpc.waitForExit().then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
  }
  async forceKillGroup(): Promise<void> {
    this.expected = true;
    await this.rpc.forceKillGroup();
  }
  diagnostics(): readonly string[] { return this.rpc.getStderrRing().map((line) => line.line); }
}
