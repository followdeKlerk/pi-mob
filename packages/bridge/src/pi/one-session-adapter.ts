/**
 * Multi-session Pi adapter for the M11 bridge.
 *
 * Wires a single bridge store to one or more independent Pi RPC
 * subprocesses. Each session is a durable entity that the mobile app
 * can run, stop, list, and restore without interfering with any other
 * session. Capacity is enforced through the existing
 * {@link ProcessSupervisor} so the host's three-process default and
 * eligible-idle LRU eviction semantics carry over for free.
 *
 * Backwards compatibility:
 *
 *  - The class is still exported as `OneSessionPiAdapter` from the
 *    package's `pi/one-session-adapter` entry. Existing tests that
 *    construct the adapter with a single shared `rpc` keep working
 *    because the per-session RPC lookup falls back to that instance.
 *  - The M5 one-session create-reuse path is gone. Every
 *    `session.create` now produces a fresh session ID and an
 *    independent mapping; the host stream receives a `session.summary`
 *    add event each time.
 *
 * Notification routing: every notification carries a `sessionId`. The
 * adapter trusts that field, falls back to the most recently used
 * session when it is absent, and never applies a notification to a
 * session it did not originate from.
 */

import type { StoredCommand } from "../core/store";
import type { BridgeStore } from "../core/store";
import { IndeterminateDispatchError } from "../core/domain";
import { normalizePiEvent, ToolOutputLimiter } from "./normalize";
import { normalizeCommandCatalogue } from "./command-catalogue";
import type { NormalizedPiEvent, RawPiEvent } from "./types";
import type { HostPolicyMode } from "../core/workspace-policy";
import {
  ProcessSupervisor,
  type ManagedProcess,
  type ProcessSpawnSpec,
  type ProcessSupervisorOptions,
  ProcessSupervisorError,
} from "../core/process-supervisor";

/**
 * Bridge for the M8 runtime-owned policy module. The adapter never
 * mutates policy itself — it just sets the per-session default and
 * reports back the host policy snapshot that the runtime may have
 * written alongside the session. Tests pass `null` to opt out.
 */
export interface OneSessionPolicyBridge {
  /** Returns the host-wide policy mode the adapter should default new sessions to. */
  hostMode(): HostPolicyMode;
  /** Returns the mode the most recent prompt-start snapshot wrote into a session. */
  snapshotModeFor(sessionId: string): { policyMode: HostPolicyMode; policyVersion: string; fingerprint: string; snapshottedAt: string } | null;
  /** Publishes policy for the next turn to the bridge-owned extension file. */
  publish?(snapshot?: { policyMode: HostPolicyMode; policyVersion: string; fingerprint: string; snapshottedAt: string }): void;
}

// ---------------- RPC client contract ----------------

export interface PiRpcRequestOptions {
  readonly id?: string;
  readonly method: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface PiRpcNotification {
  readonly type: string;
  readonly sessionId?: string;
  readonly [key: string]: unknown;
}

export type PiRpcNotificationHandler = (raw: unknown) => void;

/**
 * Structural interface the adapter needs from a Pi RPC transport.
 * {@link import("./rpc-process").RpcProcess} satisfies this directly.
 */
export interface PiRpcClient {
  request(opts: PiRpcRequestOptions): Promise<unknown>;
  on(kind: "notification", handler: PiRpcNotificationHandler): () => void;
  markDispatchStart?(): void;
  manualRetry?(): Promise<void>;
  isDraining?(): boolean;
}

// ---------------- Workspace listing shape ----------------

export type WorkspaceTrustState = "trusted" | "untrusted" | "approval_required";
export type WorkspacePolicyMode = "full" | "read_only";

export interface WorkspaceListingItem {
  readonly [key: string]: unknown;
  readonly workspaceId: string;
  readonly displayName: string;
  readonly fingerprint: string;
  readonly trustState: WorkspaceTrustState;
  readonly policyMode: WorkspacePolicyMode;
  readonly availableSince: string;
  readonly lastSeenAt: string;
  readonly sessionCount: number;
}

export interface WorkspaceListing {
  readonly items: readonly WorkspaceListingItem[];
}

// ---------------- Adapter options ----------------

export interface OneSessionWorkspaceConfig {
  readonly workspaceId: string;
  readonly rootPath: string;
  readonly displayName: string;
  readonly fingerprint: string;
  readonly policyMode: WorkspacePolicyMode;
  readonly availableSince?: string;
  readonly lastSeenAt?: string;
}

/** Thrown when the host has reached its concurrent process capacity. */
export class HostCapacityError extends Error {
  override readonly name = "HostCapacityError";
  constructor(readonly active: number, readonly capacity: number) {
    super(`host_capacity: ${active}/${capacity} active sessions and no eligible idle process to evict`);
  }
}

export interface OneSessionAdapterOptions {
  readonly store: BridgeStore;
  /**
   * Legacy shared RPC client. Used as a single-process fallback and
   * automatically selected by the per-session resolver when no
   * `createRpc` factory is supplied. Production wiring should pass
   * `createRpc` so each session gets its own transport.
   */
  readonly rpc?: PiRpcClient;
  /** M11: per-session RPC factory. The adapter calls this when a new
   * session is admitted so it owns an independent subprocess / client. */
  readonly createRpc?: (sessionId: string) => PiRpcClient;
  readonly workspace: OneSessionWorkspaceConfig;
  /** Override `Date.now` for deterministic tests. */
  readonly now?: () => number;
  /** UUID generator; defaults to `crypto.randomUUID`. */
  readonly newSessionId?: () => string;
  /**
   * M8 — optional bridge into the host policy module so the adapter can
   * honour the host-wide mode when seeding a new session. When `null` the
   * adapter falls back to the configured `workspace.policyMode` for
   * backwards-compat.
   */
  readonly policyBridge?: OneSessionPolicyBridge | null;
  /**
   * M11 — optional process supervisor. When supplied, the adapter uses
   * it to enforce capacity, run idle eviction, and drive lazy restore.
   * The default factory configures a supervisor with the documented
   * three-process ceiling and eligible-idle LRU eviction.
   */
  readonly supervisor?: ProcessSupervisor;
  /**
   * M11 — spawn spec factory used when the adapter owns its own
   * supervisor. Returns the per-session executable/args/cwd triple.
   * Tests that own the supervisor can pass `undefined` and call
   * `supervisor.configure` directly.
   */
  readonly processSpec?: (sessionId: string) => ProcessSpawnSpec;
  /**
   * M11 — when `supervisor` is omitted the adapter creates a private
   * one with this capacity. Defaults to 3. The capacity is bounded
   * between 1 and 8 to mirror `ProcessSupervisor` validation.
   */
  readonly capacity?: number;
  /**
   * M11 — when `true`, session.create for a session that the store
   * already knows about re-issues a `session.summary` (change) event
   * instead of admitting a duplicate. The default `false` is the
   * M11-correct behaviour: every create admits a new session.
   */
  readonly reuseExistingOnCreate?: boolean;
}

// ---------------- Adapter ----------------

const SUMMARY_EVENT_TYPES = new Set<NormalizedPiEvent["type"]>([
  "session.state", "session.metadata", "controller.state",
  "turn.started", "turn.waiting_for_input", "turn.settled",
  "turn.aborted", "turn.failed", "turn.indeterminate",
  "queue.snapshot", "command.state", "error.event",
]);

interface SessionEntry {
  /** The original RPC client produced by the factory, retained across stop/restore. */
  readonly rpc: PiRpcClient;
  detach: () => void;
  state: "starting" | "idle" | "running" | "stopped" | "removed";
}

/** Permanent per-session record: keeps the original RPC client even when
 * the live entry has been unbound by `session.stop`. */
interface SessionSlot {
  readonly rpc: PiRpcClient;
  bound: SessionEntry | null;
}

class SessionProcessStub implements ManagedProcess {
  pid: number | undefined;
  start(): Promise<void> { return Promise.resolve(); }
  terminate(): void { /* no-op: the RPC client is responsible for its own process */ }
  waitForExit(): Promise<boolean> { return Promise.resolve(true); }
  async forceKillGroup(): Promise<void> { /* no-op */ }
  diagnostics(): readonly string[] { return []; }
}

export class OneSessionPiAdapter {
  readonly store: BridgeStore;
  readonly workspace: OneSessionWorkspaceConfig;
  /** Legacy single-RPC reference. Kept for back-compat. */
  readonly rpc: PiRpcClient | undefined;
  private readonly now: () => number;
  private readonly newSessionId: () => string;
  private readonly hostStream: string;
  private readonly createRpc: ((sessionId: string) => PiRpcClient) | null;
  private readonly processSpec: ((sessionId: string) => ProcessSpawnSpec) | null;
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly slots = new Map<string, SessionSlot>();
  private readonly toolOutputLimiter = new ToolOutputLimiter();
  private readonly policyBridge: OneSessionPolicyBridge | null;
  private readonly supervisor: ProcessSupervisor;
  private readonly reuseExistingOnCreate: boolean;
  private lastUsedSessionId: string | null = null;
  private readonly globalDetach = new Set<() => void>();

  constructor(options: OneSessionAdapterOptions) {
    this.store = options.store;
    this.workspace = options.workspace;
    this.rpc = options.rpc;
    this.now = options.now ?? Date.now;
    this.newSessionId = options.newSessionId ?? (() => crypto.randomUUID().toLowerCase());
    this.policyBridge = options.policyBridge ?? null;
    this.createRpc = options.createRpc ?? null;
    this.processSpec = options.processSpec ?? null;
    this.reuseExistingOnCreate = options.reuseExistingOnCreate ?? false;
    const identity = this.store.identity();
    this.hostStream = `host:${identity.hostId}`;
    if (options.supervisor) {
      this.supervisor = options.supervisor;
    } else {
      this.supervisor = this.buildDefaultSupervisor(options.capacity ?? 3, options.now);
    }
    this.bootstrapExistingSessions();
  }

  private buildDefaultSupervisor(capacity: number, now: ((() => number) | undefined)): ProcessSupervisor {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 8) {
      throw new RangeError("capacity must be 1..8");
    }
    const options: ProcessSupervisorOptions = {
      capacity,
      ...(now ? { now } : {}),
      createProcess: (sessionId) => {
        const spec = this.processSpec?.(sessionId);
        if (spec) this.supervisor.configure(sessionId, spec);
        return new SessionProcessStub();
      },
      emit: (event) => this.applySupervisorEvent(event),
    };
    return new ProcessSupervisor(options);
  }

  private bootstrapExistingSessions(): void {
    for (const record of this.store.sessionStates()) {
      const id = typeof record.sessionId === "string" ? record.sessionId : null;
      if (!id) continue;
      this.supervisor.register(id, "stopped");
      this.resolveRpc(id);
      this.bindSession(id);
    }
  }

  /** Detach all RPC listeners. Idempotent. */
  close(): void {
    for (const fn of this.globalDetach) fn();
    this.globalDetach.clear();
    for (const entry of this.sessions.values()) entry.detach();
    this.sessions.clear();
  }

  /** Returns the configured workspace plus the count of durable sessions. */
  listWorkspaces(): WorkspaceListing {
    return {
      items: [
        {
          workspaceId: this.workspace.workspaceId,
          displayName: this.workspace.displayName,
          fingerprint: this.workspace.fingerprint,
          trustState: "trusted",
          policyMode: this.workspace.policyMode,
          availableSince: this.workspace.availableSince ?? new Date(0).toISOString(),
          lastSeenAt: this.workspace.lastSeenAt ?? new Date(this.now()).toISOString(),
          sessionCount: this.store.sessionStates().length,
        },
      ],
    };
  }

  /** Dispatch a single command. Implements the AdapterPort contract. */
  async dispatch(command: StoredCommand): Promise<void> {
    switch (command.type) {
      case "session.create":
        return this.handleSessionCreate(command);
      case "session.stop":
        return this.handleSessionStop(command);
      case "prompt.submit":
        return this.handlePromptSubmit(command);
      case "turn.abort":
        return this.handleTurnAbort(command);
      case "session.activate":
        return this.handleSessionActivate(command);
      case "session.policy.set":
        this.policyBridge?.publish?.();
        return;
      case "model.set":
        return this.handleSessionControl(command, "set_model", "model.state", {
          modelId: command.payload.modelId,
        }, true);
      case "thinking.set":
        return this.handleSessionControl(command, "set_thinking_level", "model.state", {
          level: command.payload.level,
        }, true);
      case "compaction.start":
        return this.handleSessionControl(command, "compact", "compaction.state", {
          state: "running",
        });
      case "compaction.auto.set":
        return this.handleSessionControl(command, "set_auto_compaction", "compaction.state", {
          autoEnabled: command.payload.enabled,
        });
      case "retry.auto.set":
        return this.handleSessionControl(command, "set_auto_retry", "retry.state", {
          autoEnabled: command.payload.enabled,
        });
      case "retry.abort":
        return this.handleSessionControl(command, "abort_retry", "retry.state", {
          state: "aborted",
        });
      case "steering_mode.set":
        return this.handleSessionControl(command, "set_steering_mode", "model.state", {
          steeringEnabled: command.payload.enabled,
        });
      case "follow_up_mode.set":
        return this.handleSessionControl(command, "set_follow_up_mode", "model.state", {
          followUpEnabled: command.payload.enabled,
        });
      default:
        // Session-scoped metadata commands (rename, policy.set, ...) are
        // local-only at this checkpoint; no Pi RPC call is required.
        return;
    }
  }

  admission(): { accepting: boolean; reason?: string } {
    const capacity = this.supervisor.snapshot().capacity;
    if (this.supervisor.isDraining) return { accepting: false, reason: "host_draining" };
    if (this.supervisor.activeCount() >= capacity) return { accepting: false, reason: "host_capacity" };
    if (this.rpc?.isDraining?.()) return { accepting: false, reason: "host_draining" };
    return { accepting: true };
  }

  /** Returns the most recently admitted or used session ID, if any. */
  getActiveSessionId(): string | null {
    return this.lastUsedSessionId;
  }

  /** Returns the supervisor snapshot for tests and diagnostics. */
  getSupervisorSnapshot() { return this.supervisor.snapshot(); }

  // ---------------- Internals ----------------

  private resolveRpc(sessionId: string): PiRpcClient {
    const slot = this.slots.get(sessionId);
    if (slot) return slot.rpc;
    if (this.createRpc) {
      const rpc = this.createRpc(sessionId);
      this.slots.set(sessionId, { rpc, bound: null });
      return rpc;
    }
    if (!this.rpc) throw new Error("no Pi RPC transport configured");
    return this.rpc;
  }

  private bindSession(sessionId: string): SessionEntry {
    const slot = this.slots.get(sessionId) ?? (() => {
      const rpc = this.createRpc ? this.createRpc(sessionId) : this.rpc!;
      const fresh: SessionSlot = { rpc, bound: null };
      this.slots.set(sessionId, fresh);
      return fresh;
    })();
    if (slot.bound) return slot.bound;
    const handler: PiRpcNotificationHandler = (raw) => this.handleNotification(raw);
    const detach = slot.rpc.on("notification", handler);
    this.globalDetach.add(detach);
    const entry: SessionEntry = { rpc: slot.rpc, detach, state: "idle" };
    slot.bound = entry;
    this.sessions.set(sessionId, entry);
    return entry;
  }

  private unbindSession(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.detach();
    this.sessions.delete(sessionId);
    const slot = this.slots.get(sessionId);
    if (slot) slot.bound = null;
  }

  private applySupervisorEvent(event: import("../core/process-supervisor").ProcessLifecycleEvent): void {
    if (event.type === "host.capacity") {
      const payload = event.payload as { active?: number; capacity?: number; blocked?: boolean };
      if (payload.blocked) {
        this.store.appendEvent(this.hostStream, "host.capacity", payload);
      }
      return;
    }
    if (event.type === "host.draining") {
      this.store.appendEvent(this.hostStream, "host.draining", event.payload);
      return;
    }
    if (event.type === "host.degraded") {
      this.store.appendEvent(this.hostStream, "host.degraded", event.payload);
      return;
    }
    if (event.sessionId) {
      this.store.appendEvent(`session:${event.sessionId}`, "session.state", event.payload);
      this.publishSummaryChange(event.sessionId, event.payload);
    }
  }

  private publishSummaryChange(sessionId: string, payload: Record<string, unknown>): void {
    const prior = this.store.sessionState(sessionId) ?? {};
    const runtimeState = (payload.runtimeState as string | undefined) ?? prior.runtimeState;
    const attentionState = (payload.attentionState as string | undefined) ?? prior.attentionState ?? "ready";
    const next = { ...prior, runtimeState, attentionState, lastActivityAt: new Date(this.now()).toISOString() };
    this.store.updateSessionState(sessionId, next);
    this.store.appendEvent(this.hostStream, "session.summary", {
      sessionId,
      workspaceId: this.workspace.workspaceId,
      runtimeState,
      attentionState,
      lastActivityAt: next.lastActivityAt,
      change: payload,
    });
  }

  private async handleSessionCreate(command: StoredCommand): Promise<void> {
    const payload = (command.payload ?? {}) as {
      workspaceId?: string;
      policyMode?: WorkspacePolicyMode;
      name?: string;
    };
    const workspaceId = typeof payload.workspaceId === "string" && payload.workspaceId.length > 0
      ? payload.workspaceId
      : this.workspace.workspaceId;
    const baseMode: WorkspacePolicyMode = payload.policyMode
      ?? (this.policyBridge ? this.policyBridge.hostMode() : this.workspace.policyMode);

    // M11 — backwards-compat shim only. By default a repeated
    // session.create admits a new session, matching the multi-session
    // contract. Tests that need the M5 reuse behaviour can opt back in.
    if (this.reuseExistingOnCreate) {
      const existing = this.store.sessionStates()[0];
      if (existing && typeof existing.sessionId === "string") {
        this.lastUsedSessionId = existing.sessionId;
        this.store.appendEvent(this.hostStream, "session.summary", existing);
        await this.refreshSessionCapabilities(existing.sessionId as string);
        return;
      }
    }

    const sessionId = this.newSessionId();
    const createdAt = new Date(this.now()).toISOString();
    // Supervisor lifecycle events are durable, so establish the canonical
    // session stream before starting the process.
    this.store.ensureSession(sessionId, {
      sessionId,
      workspaceId,
      runtimeState: "starting",
      attentionState: "ready",
      createdAt,
    });
    this.store.ensureStream(`session:${sessionId}`, "session", sessionId);

    // M11 — admit the new session through the supervisor. Capacity
    // errors surface as explicit HostCapacityError so the runtime can
    // report a bounded host summary to mobile clients.
    this.supervisor.register(sessionId, "stopped");
    const spec = this.processSpec?.(sessionId);
    try {
      if (spec) this.supervisor.configure(sessionId, spec);
      await this.supervisor.start(sessionId, spec ?? { executable: "pi", args: [], cwd: this.workspace.rootPath });
    } catch (error) {
      this.store.discardSession(sessionId);
      if (error instanceof ProcessSupervisorError && error.code === "host_capacity") {
        this.supervisor.register(sessionId, "stopped");
        const snapshot = this.supervisor.snapshot();
        throw new HostCapacityError(this.supervisor.activeCount(), snapshot.capacity);
      }
      throw error;
    }

    this.resolveRpc(sessionId);
    this.bindSession(sessionId);
    this.lastUsedSessionId = sessionId;

    const summary = {
      sessionId,
      workspaceId,
      displayName: this.workspace.displayName,
      name: typeof payload.name === "string" ? payload.name : null,
      policyMode: baseMode,
      runtimeState: "idle",
      attentionState: "ready",
      queueCount: 0,
      modelSummary: null,
      createdAt,
      lastActivityAt: createdAt,
    };
    this.store.updateSessionState(sessionId, summary);
    // Host-stream summary so mobile clients learn the new session.
    this.store.appendEvent(this.hostStream, "session.summary", {
      sessionId,
      workspaceId,
      runtimeState: "idle",
      attentionState: "ready",
      queueCount: 0,
      modelSummary: null,
      policyMode: baseMode,
      name: summary.name,
      createdAt,
      change: "added",
    });
    this.store.appendEvent(`session:${sessionId}`, "session.metadata", {
      sessionId,
      workspaceId,
      name: summary.name,
      policyMode: baseMode,
      runtimeState: "idle",
      attentionState: "ready",
      createdAt,
    });
    await this.refreshSessionCapabilities(sessionId);
  }

  private async handleSessionStop(command: StoredCommand): Promise<void> {
    const payload = (command.payload ?? {}) as { sessionId?: string };
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : null;
    if (!sessionId) throw new Error("session.stop requires sessionId");
    if (!this.store.sessionExists(sessionId)) throw new Error("session.stop session not found");
    const prior = this.store.sessionState(sessionId) ?? {};
    if (prior.runtimeState && prior.runtimeState !== "idle" && prior.runtimeState !== "stopped") {
      throw new Error("session.stop requires an idle session");
    }
    await this.supervisor.stop(sessionId, "operator");
    this.unbindSession(sessionId);
    this.store.appendEvent(`session:${sessionId}`, "session.state", {
      sessionId,
      runtimeState: "stopped",
      attentionState: "none",
      stopReason: "operator",
    });
    this.store.updateSessionState(sessionId, {
      ...prior,
      runtimeState: "stopped",
      attentionState: "none",
      lastActivityAt: new Date(this.now()).toISOString(),
    });
    this.store.appendEvent(this.hostStream, "session.summary", {
      sessionId,
      workspaceId: this.workspace.workspaceId,
      runtimeState: "stopped",
      attentionState: "none",
      change: "stopped",
    });
  }

  private async handleSessionActivate(command: StoredCommand): Promise<void> {
    const payload = (command.payload ?? {}) as { sessionId?: string };
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
    if (!sessionId) throw new Error("session.activate requires sessionId");
    if (!this.store.sessionExists(sessionId)) throw new Error("session.activate session not found");
    const prior = this.store.sessionState(sessionId) ?? {};
    // Lazy restore: bring the supervised process back online, re-bind
    // the per-session RPC client, and re-issue the manual retry.
    let restored = false;
    try {
      const state = this.supervisor.state(sessionId);
      if (state === "stopped") {
        const spec = this.processSpec?.(sessionId);
        if (!spec) throw new ProcessSupervisorError("invalid_state", "no spawn spec for restore");
        await this.supervisor.start(sessionId, spec);
      } else {
        await this.supervisor.manualRetry(sessionId);
      }
      restored = true;
    } catch (error) {
      if (!(error instanceof ProcessSupervisorError)) throw error;
    }
    if (restored || !this.sessions.has(sessionId)) {
      this.bindSession(sessionId);
    }
    const rpc = this.sessions.get(sessionId)!.rpc;
    if (rpc.manualRetry) await rpc.manualRetry();
    this.lastUsedSessionId = sessionId;
    const next = {
      ...prior,
      runtimeState: "idle" as const,
      attentionState: "ready" as const,
      lastActivityAt: new Date(this.now()).toISOString(),
    };
    this.store.updateSessionState(sessionId, next);
    this.store.appendEvent(`session:${sessionId}`, "session.state", {
      sessionId,
      runtimeState: "idle",
      attentionState: "ready",
      manualRetry: true,
      restored,
    });
    this.store.appendEvent(this.hostStream, "session.summary", {
      sessionId,
      workspaceId: this.workspace.workspaceId,
      runtimeState: "idle",
      attentionState: "ready",
      change: "restored",
    });
    await this.refreshSessionCapabilities(sessionId);
  }

  private async refreshSessionCapabilities(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    const rpc = entry?.rpc ?? this.rpc;
    if (!rpc) return;
    const safeRequest = async (method: string): Promise<unknown> => {
      try { return await rpc.request({ method, timeoutMs: 5_000 }); }
      catch { return null; }
    };
    const [modelsRaw, stateRaw, statsRaw, commandsRaw] = await Promise.all([
      safeRequest("get_available_models"), safeRequest("get_state"),
      safeRequest("get_session_stats"), safeRequest("get_commands"),
    ]);
    const unwrap = (value: unknown): unknown => value && typeof value === "object" && "data" in value
      ? (value as Record<string, unknown>).data : value;
    const modelsValue = unwrap(modelsRaw);
    const availableModels = Array.isArray(modelsValue)
      ? modelsValue.filter((item) => item && typeof item === "object").slice(0, 500)
      : [];
    const state = unwrap(stateRaw);
    const stats = unwrap(statsRaw);
    const stateObject = state && typeof state === "object" ? state as Record<string, unknown> : {};
    const statsObject = stats && typeof stats === "object" ? stats as Record<string, unknown> : {};
    const commandCatalogue = normalizeCommandCatalogue(unwrap(commandsRaw));
    const prior = this.store.sessionState(sessionId) ?? {};
    const patch = {
      availableModels,
      commandCatalogue,
      modelId: typeof stateObject.model === "string" ? stateObject.model : null,
      thinkingLevel: typeof stateObject.thinkingLevel === "string" ? stateObject.thinkingLevel : null,
      steeringMode: stateObject.steeringMode ?? null,
      followUpMode: stateObject.followUpMode ?? null,
      autoCompactionEnabled: stateObject.autoCompactionEnabled ?? null,
    };
    this.store.updateSessionState(sessionId, { ...prior, ...patch });
    this.store.appendEvent(`session:${sessionId}`, "model.state", { sessionId, ...patch });
    this.store.appendEvent(`session:${sessionId}`, "context.state", { sessionId, ...statsObject });
  }

  private async handleSessionControl(
    command: StoredCommand,
    method: string,
    eventType: "model.state" | "retry.state" | "compaction.state",
    statePatch: Record<string, unknown>,
    idleOnly = false,
  ): Promise<void> {
    const sessionId = String(command.payload.sessionId ?? "");
    const prior = this.store.sessionState(sessionId);
    if (!prior) throw new Error(`${command.type} session not found`);
    if (idleOnly && prior.runtimeState !== "idle" && prior.runtimeState !== "stopped") {
      throw new Error(`${command.type} requires an idle session`);
    }
    const params = command.type === "steering_mode.set" || command.type === "follow_up_mode.set"
      ? { mode: command.payload.enabled === true ? "all" : "one-at-a-time" }
      : Object.fromEntries(Object.entries(command.payload).filter(([key]) => key !== "sessionId"));
    const rpc = this.sessions.get(sessionId)?.rpc ?? this.rpc;
    if (!rpc) throw new Error(`${command.type} no RPC available`);
    await rpc.request({ id: command.commandId, method, params });
    const patch = {
      sessionId,
      ...statePatch,
      ...(command.type === "model.set" ? { modelId: command.payload.modelId } : {}),
      ...(command.type === "thinking.set" ? { thinkingLevel: command.payload.level } : {}),
    };
    this.store.updateSessionState(sessionId, { ...prior, ...patch });
    this.store.appendEvent(`session:${sessionId}`, eventType, patch);
  }

  /** Returns the last durable model catalogue. A Pi `model_list` notification
   * refreshes this through `model.state`; an empty list is explicit rather
   * than inventing provider configuration on mobile. */
  listModels(sessionId?: string): { readonly items: ReadonlyArray<Record<string, unknown>> } {
    const id = sessionId ?? this.lastUsedSessionId;
    if (!id) return { items: [] };
    const state = this.store.sessionState(id) ?? {};
    const models = Array.isArray(state.availableModels) ? state.availableModels : [];
    return { items: models.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").map((item) => ({ ...item })) };
  }

  private async handlePromptSubmit(command: StoredCommand): Promise<void> {
    const payload = (command.payload ?? {}) as {
      sessionId?: string;
      message?: string;
      deliveryMode?: "immediate" | "steer" | "follow_up";
    };
    if (typeof payload.sessionId !== "string") throw new Error("prompt.submit requires sessionId");
    if (typeof payload.message !== "string" || payload.message.length === 0) throw new Error("prompt.submit requires message");
    if (!this.store.sessionExists(payload.sessionId)) throw new Error("prompt.submit session not found");
    this.lastUsedSessionId = payload.sessionId;
    const rpc = this.sessions.get(payload.sessionId)?.rpc ?? this.rpc;
    if (!rpc) throw new Error("prompt.submit no RPC available");
    const policySnapshot = this.policyBridge?.snapshotModeFor(payload.sessionId);
    if (this.policyBridge && !policySnapshot) throw new Error("prompt.submit requires a durable policy snapshot");
    this.policyBridge?.publish?.(policySnapshot ?? undefined);
    rpc.markDispatchStart?.();
    const method: "prompt" | "steer" | "follow_up" =
      payload.deliveryMode === "steer" ? "steer" :
      payload.deliveryMode === "follow_up" ? "follow_up" : "prompt";
    try {
      await rpc.request({
        id: command.commandId,
        method,
        params: { message: payload.message },
      });
    } catch (error) {
      const streamId = `session:${payload.sessionId}`;
      this.store.appendEvent(streamId, "turn.indeterminate", {
        sessionId: payload.sessionId,
        reason: "rpc_outcome_unknown",
      });
      const prior = this.store.sessionState(payload.sessionId) ?? {};
      this.store.updateSessionState(payload.sessionId, {
        ...prior,
        runtimeState: "indeterminate",
        attentionState: "needs_attention",
      });
      throw new IndeterminateDispatchError(
        "Pi command outcome is unknown",
        { cause: error },
      );
    }
  }

  private async handleTurnAbort(command: StoredCommand): Promise<void> {
    const payload = (command.payload ?? {}) as { sessionId?: string };
    if (typeof payload.sessionId !== "string") throw new Error("turn.abort requires sessionId");
    if (!this.store.sessionExists(payload.sessionId)) throw new Error("turn.abort session not found");
    this.lastUsedSessionId = payload.sessionId;
    const rpc = this.sessions.get(payload.sessionId)?.rpc ?? this.rpc;
    if (!rpc) throw new Error("turn.abort no RPC available");
    await rpc.request({ id: command.commandId, method: "abort" });
  }

  private handleNotification(raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    const record = raw as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : null;
    if (!type) return;
    const inferredSessionId = this.resolveNotificationSessionId(record);
    if (!inferredSessionId) return;
    const streamId = `session:${inferredSessionId}`;
    if (!this.store.streamPosition(streamId)) return;
    const normalized = normalizePiEvent(record as RawPiEvent, {
      sessionId: inferredSessionId,
      toolOutputLimiter: this.toolOutputLimiter,
    });
    if (normalized.length === 0) return;
    for (const event of normalized) {
      this.store.appendEvent(streamId, event.type, { ...event.payload });
      const prior = this.store.sessionState(inferredSessionId) ?? {};
      const runtimeState = event.type === "turn.started"
        ? "running"
        : event.type === "turn.failed" && event.payload.errorCode === "provider_interrupted"
        ? "provider_interrupted"
        : ["turn.settled", "turn.aborted", "turn.failed"].includes(event.type)
        ? "idle"
        : event.payload.runtimeState;
      this.store.updateSessionState(inferredSessionId, {
        ...prior,
        ...event.payload,
        ...(typeof runtimeState === "string" ? { runtimeState } : {}),
        lastActivityAt: new Date(this.now()).toISOString(),
      });
    }
  }

  private resolveNotificationSessionId(record: Record<string, unknown>): string | null {
    const direct = record.sessionId;
    if (typeof direct === "string") {
      return this.store.sessionExists(direct) ? direct : null;
    }
    if (this.lastUsedSessionId && this.store.sessionExists(this.lastUsedSessionId)) return this.lastUsedSessionId;
    const onlySession = [...this.sessions.keys()][0];
    return onlySession ?? null;
  }
}

/** Test helper: a deterministic session id generator. */
export function deterministicIdGenerator(_prefix: string): () => string {
  let counter = 0;
  return () => `00000000-0000-4000-8000-${(++counter).toString().padStart(12, "0")}`;
}

/** Re-exported so the daemon/tests can avoid depending on normalize internals. */
export { SUMMARY_EVENT_TYPES };
