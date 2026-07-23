export type ProcessState =
  | "stopped" | "starting" | "idle" | "running" | "waiting_for_input"
  | "retry_wait" | "compacting" | "stopping" | "crashed"
  | "crash_loop" | "incompatible";

export type ProcessAttention = "none" | "user" | "dialog" | "queued";

export interface ProcessSpawnSpec {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface ManagedProcess {
  readonly pid: number | undefined;
  start(spec: ProcessSpawnSpec): Promise<void>;
  terminate(): void;
  waitForExit(timeoutMs: number): Promise<boolean>;
  forceKillGroup(): Promise<void>;
  diagnostics(): readonly string[];
}

export interface ProcessLifecycleEvent {
  readonly type: "session.state" | "host.capacity" | "host.draining" | "host.degraded" | "turn.indeterminate";
  readonly sessionId?: string;
  readonly payload: Record<string, unknown>;
}

export interface ProcessRecord {
  readonly sessionId: string;
  readonly state: ProcessState;
  readonly attention: ProcessAttention;
  readonly pid?: number;
  readonly spec?: ProcessSpawnSpec;
  readonly lastActivityAt: number;
  readonly restartTimestamps: readonly number[];
  readonly retryAt?: number;
  readonly forcedCleanup: boolean;
  readonly diagnostics: readonly string[];
}

export interface ProcessSupervisorSnapshot {
  readonly draining: boolean;
  readonly capacity: number;
  readonly sessions: readonly ProcessRecord[];
}

export interface ProcessSupervisorOptions {
  readonly capacity?: number;
  readonly now?: () => number;
  readonly createProcess: (sessionId: string) => ManagedProcess;
  readonly emit?: (event: ProcessLifecycleEvent) => void;
  readonly idleTimeoutMs?: number;
  readonly restartWindowMs?: number;
  readonly restartLimit?: number;
  readonly retryDelayMs?: number;
  readonly gracefulStopMs?: number;
  readonly diagnosticLimit?: number;
}

export class ProcessSupervisorError extends Error {
  override readonly name = "ProcessSupervisorError";
  constructor(readonly code: "not_found" | "invalid_state" | "host_capacity" | "host_draining" | "crash_loop", message: string) { super(message); }
}

interface Entry {
  sessionId: string;
  state: ProcessState;
  attention: ProcessAttention;
  process: ManagedProcess | null;
  spec: ProcessSpawnSpec | null;
  lastActivityAt: number;
  restartTimestamps: number[];
  retryAt?: number;
  forcedCleanup: boolean;
  diagnostics: string[];
}

const ACTIVE = new Set<ProcessState>(["starting", "idle", "running", "waiting_for_input", "retry_wait", "compacting", "stopping"]);
const EVICTABLE = new Set<ProcessState>(["idle"]);
const ALLOWED: Readonly<Record<ProcessState, readonly ProcessState[]>> = {
  stopped: ["starting", "incompatible"],
  starting: ["idle", "crashed", "incompatible", "stopping"],
  idle: ["running", "waiting_for_input", "compacting", "stopping", "crashed"],
  running: ["idle", "waiting_for_input", "compacting", "stopping", "crashed"],
  waiting_for_input: ["idle", "running", "stopping", "crashed"],
  retry_wait: ["starting", "stopping", "crashed", "crash_loop"],
  compacting: ["idle", "running", "stopping", "crashed"],
  stopping: ["stopped", "crashed"],
  crashed: ["retry_wait", "starting", "crash_loop", "stopped"],
  crash_loop: ["starting", "stopped"],
  incompatible: ["stopped"],
};

export class ProcessSupervisor {
  private readonly entries = new Map<string, Entry>();
  private readonly capacity: number;
  private readonly now: () => number;
  private readonly createProcess: (sessionId: string) => ManagedProcess;
  private readonly emitFn: ((event: ProcessLifecycleEvent) => void) | undefined;
  private readonly idleTimeoutMs: number;
  private readonly restartWindowMs: number;
  private readonly restartLimit: number;
  private readonly retryDelayMs: number;
  private readonly gracefulStopMs: number;
  private readonly diagnosticLimit: number;
  private draining = false;

  constructor(options: ProcessSupervisorOptions) {
    const capacity = options.capacity ?? 3;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 8) throw new RangeError("capacity must be 1..8");
    this.capacity = capacity;
    this.now = options.now ?? Date.now;
    this.createProcess = options.createProcess;
    this.emitFn = options.emit;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60_000;
    this.restartWindowMs = options.restartWindowMs ?? 5 * 60_000;
    this.restartLimit = options.restartLimit ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1_000;
    this.gracefulStopMs = options.gracefulStopMs ?? 5_000;
    this.diagnosticLimit = options.diagnosticLimit ?? 32;
  }

  register(sessionId: string, state: ProcessState = "stopped"): void {
    if (this.entries.has(sessionId)) return;
    this.entries.set(sessionId, { sessionId, state, attention: "none", process: null, spec: null, lastActivityAt: this.now(), restartTimestamps: [], forcedCleanup: false, diagnostics: [] });
  }

  state(sessionId: string): ProcessState { return this.require(sessionId).state; }
  get isDraining(): boolean { return this.draining; }
  activeCount(): number {
    return [...this.entries.values()].filter(
      (entry) => entry.process !== null && ACTIVE.has(entry.state),
    ).length;
  }
  configure(sessionId: string, spec: ProcessSpawnSpec): void {
    const entry = this.require(sessionId);
    entry.spec = { ...spec, args: [...spec.args] };
  }

  async start(sessionId: string, spec: ProcessSpawnSpec): Promise<void> {
    const entry = this.require(sessionId);
    if (this.draining) throw new ProcessSupervisorError("host_draining", "host is draining");
    if (entry.state === "crash_loop") throw new ProcessSupervisorError("crash_loop", "manual retry required");
    if (!["stopped", "crashed", "retry_wait"].includes(entry.state)) throw new ProcessSupervisorError("invalid_state", `cannot start from ${entry.state}`);
    const occupiedByOthers = [...this.entries.values()].filter(
      (item) =>
        item.sessionId !== sessionId &&
        item.process !== null &&
        ACTIVE.has(item.state),
    ).length;
    if (occupiedByOthers >= this.capacity) {
      const victim = this.eligibleIdle().filter((item) => item.sessionId !== sessionId).sort((a, b) => a.lastActivityAt - b.lastActivityAt)[0];
      if (!victim) {
        this.emit({ type: "host.capacity", payload: { active: this.activeCount(), capacity: this.capacity, blocked: true } });
        throw new ProcessSupervisorError("host_capacity", "no eligible idle process");
      }
      await this.stop(victim.sessionId, "capacity");
    }
    entry.spec = { ...spec, args: [...spec.args] };
    entry.process = this.createProcess(sessionId);
    this.move(entry, "starting");
    try {
      await entry.process.start(entry.spec);
      entry.lastActivityAt = this.now();
      this.move(entry, "idle");
    } catch (error) {
      this.captureDiagnostics(entry, error);
      entry.process = null;
      this.move(entry, "crashed");
      throw error;
    }
  }

  transition(sessionId: string, state: ProcessState, attention?: ProcessAttention): void {
    const entry = this.require(sessionId);
    if (attention !== undefined) entry.attention = attention;
    this.move(entry, state);
    entry.lastActivityAt = this.now();
    if (this.draining && state === "idle" && entry.attention === "none") void this.stop(sessionId, "drain_settled");
  }

  setAttention(sessionId: string, attention: ProcessAttention): void {
    const entry = this.require(sessionId); entry.attention = attention; entry.lastActivityAt = this.now();
  }

  async unexpectedExit(sessionId: string, detail: { exitCode?: number | null; signal?: string | null; runningAction?: boolean } = {}): Promise<void> {
    const entry = this.require(sessionId);
    if (!ACTIVE.has(entry.state)) throw new ProcessSupervisorError("invalid_state", `unexpected exit from ${entry.state}`);
    const wasRunning = detail.runningAction === true || ["running", "waiting_for_input", "compacting"].includes(entry.state);
    this.captureDiagnostics(entry, entry.process?.diagnostics() ?? []);
    entry.process = null;
    if (wasRunning) this.emit({ type: "turn.indeterminate", sessionId, payload: { sessionId, reason: "pi_exit", exitCode: detail.exitCode ?? null, signal: detail.signal ?? null } });
    const cutoff = this.now() - this.restartWindowMs;
    entry.restartTimestamps = entry.restartTimestamps.filter((time) => time >= cutoff);
    entry.restartTimestamps.push(this.now());
    this.move(entry, "crashed");
    if (entry.restartTimestamps.length >= this.restartLimit) {
      this.move(entry, "crash_loop");
      this.emit({ type: "host.degraded", payload: { reason: "crash_loop", sessionId, restartCount: entry.restartTimestamps.length, windowMs: this.restartWindowMs } });
      return;
    }
    if (this.draining) { this.move(entry, "stopped"); return; }
    entry.retryAt = this.now() + this.retryDelayMs;
    this.move(entry, "retry_wait");
  }

  async manualRetry(sessionId: string): Promise<void> {
    const entry = this.require(sessionId);
    if (!["crash_loop", "crashed", "retry_wait"].includes(entry.state) || !entry.spec) throw new ProcessSupervisorError("invalid_state", "manual retry unavailable");
    entry.restartTimestamps = [];
    if (entry.state === "crash_loop") this.move(entry, "stopped");
    await this.start(sessionId, entry.spec);
  }

  async tick(): Promise<void> {
    for (const entry of this.entries.values()) {
      if (entry.state === "idle" && entry.attention === "none" && this.now() - entry.lastActivityAt >= this.idleTimeoutMs) await this.stop(entry.sessionId, "idle_timeout");
      if (entry.state === "retry_wait" && entry.retryAt !== undefined && this.now() >= entry.retryAt && entry.spec) {
        delete entry.retryAt;
        await this.start(entry.sessionId, entry.spec).catch(() => undefined);
      }
    }
  }

  async stop(sessionId: string, reason = "operator"): Promise<void> {
    const entry = this.require(sessionId);
    if (entry.state === "stopped") return;
    const process = entry.process;
    if (!process) { entry.state = "stopped"; return; }
    this.move(entry, "stopping");
    process.terminate();
    let exited = false;
    try { exited = await process.waitForExit(this.gracefulStopMs); } catch (error) { this.captureDiagnostics(entry, error); }
    if (!exited) {
      try {
        await process.forceKillGroup();
        entry.forcedCleanup = true;
      } catch (error) { this.captureDiagnostics(entry, error); }
    }
    this.captureDiagnostics(entry, process.diagnostics());
    entry.process = null;
    this.move(entry, "stopped");
    this.emit({ type: "session.state", sessionId, payload: { sessionId, runtimeState: "stopped", stopReason: reason, forcedCleanup: entry.forcedCleanup } });
  }

  async drain(): Promise<{ stopped: string[]; retained: string[] }> {
    this.draining = true;
    this.emit({ type: "host.draining", payload: { draining: true } });
    const stopped: string[] = []; const retained: string[] = [];
    for (const entry of this.entries.values()) {
      if (entry.state === "idle" && entry.attention === "none") { await this.stop(entry.sessionId, "host_drain"); stopped.push(entry.sessionId); }
      else if (ACTIVE.has(entry.state)) retained.push(entry.sessionId);
    }
    return { stopped, retained };
  }

  snapshot(): ProcessSupervisorSnapshot {
    return { draining: this.draining, capacity: this.capacity, sessions: [...this.entries.values()].map((entry) => this.publicRecord(entry)) };
  }

  restoreAfterReboot(snapshot: ProcessSupervisorSnapshot): void {
    this.entries.clear(); this.draining = false;
    for (const record of snapshot.sessions) {
      const preserved: ProcessState = record.state === "crash_loop" || record.state === "incompatible" ? record.state : "stopped";
      this.entries.set(record.sessionId, { sessionId: record.sessionId, state: preserved, attention: record.attention, process: null, spec: record.spec ? { ...record.spec, args: [...record.spec.args] } : null, lastActivityAt: this.now(), restartTimestamps: [...record.restartTimestamps], forcedCleanup: record.forcedCleanup, diagnostics: [...record.diagnostics].slice(-this.diagnosticLimit) });
    }
  }

  private publicRecord(entry: Entry): ProcessRecord {
    return { sessionId: entry.sessionId, state: entry.state, attention: entry.attention, ...(entry.process?.pid === undefined ? {} : { pid: entry.process.pid }), ...(entry.spec ? { spec: { ...entry.spec, args: [...entry.spec.args] } } : {}), lastActivityAt: entry.lastActivityAt, restartTimestamps: [...entry.restartTimestamps], ...(entry.retryAt === undefined ? {} : { retryAt: entry.retryAt }), forcedCleanup: entry.forcedCleanup, diagnostics: [...entry.diagnostics] };
  }
  private eligibleIdle(): Entry[] { return [...this.entries.values()].filter((entry) => EVICTABLE.has(entry.state) && entry.attention === "none"); }
  private require(id: string): Entry { const entry = this.entries.get(id); if (!entry) throw new ProcessSupervisorError("not_found", `unknown session ${id}`); return entry; }
  private move(entry: Entry, state: ProcessState): void {
    if (entry.state === state) return;
    if (!ALLOWED[entry.state].includes(state)) throw new ProcessSupervisorError("invalid_state", `invalid ${entry.state}->${state}`);
    entry.state = state;
    this.emit({ type: "session.state", sessionId: entry.sessionId, payload: { sessionId: entry.sessionId, runtimeState: state, attentionState: entry.attention } });
  }
  private emit(event: ProcessLifecycleEvent): void { this.emitFn?.(event); }
  private captureDiagnostics(entry: Entry, value: unknown): void {
    const values = Array.isArray(value) ? value : [value instanceof Error ? value.message : String(value)];
    for (const item of values) entry.diagnostics.push(redact(String(item)));
    if (entry.diagnostics.length > this.diagnosticLimit) entry.diagnostics.splice(0, entry.diagnostics.length - this.diagnosticLimit);
  }
}

function redact(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9-]+|ghp_[A-Za-z0-9]+|Bearer\s+\S+/g, "redacted")
    .replace(/\/(?:Users|home)\/[^\s]+/g, "redacted")
    .slice(0, 2048);
}
