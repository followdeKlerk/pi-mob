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

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import type { StoredCommand } from "../core/store";
import type { BridgeStore } from "../core/store";
import { IndeterminateDispatchError } from "../core/domain";
import type { AttachmentStore } from "../core/attachments";
import { normalizePiEvent, ToolOutputLimiter } from "./normalize";
import { normalizeCommandCatalogue } from "./command-catalogue";
import { ExportRegistry, ExportRegistryInvalidInputError, type ExportMetadata } from "./export-registry";
import type { NormalizedPiEvent, RawPiEvent } from "./types";
import type { HostPolicyMode } from "../core/workspace-policy";
import { classifyEvent, safePublishStatus, type NotificationService } from "../notifications";
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
  start?(): Promise<void>;
  close?(): Promise<void>;
  lifecycleState?(): string;
  markDispatchStart?(): void;
  manualRetry?(): Promise<void>;
  sendExtensionUiResponse?(response: { id:string; value?:string; confirmed?:boolean; cancelled?:true }): Promise<void>;
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
  /**
   * M13-06 / M13-07 — host-side export registry. The adapter calls
   * into it when handling `session.export`. When omitted the adapter
   * builds a default {@link ExportRegistry} rooted in a private
   * `${workspace.rootPath}/.pi-mob/exports` directory; production
   * deployments should pass a registry whose `rootDir` lives on a
   * private partition with bounded TTL/sweep.
   */
  readonly exportRegistry?: ExportRegistry;
  /** M13 host-private attachment bytes, resolved only at Pi dispatch. */
  readonly attachmentStore?: AttachmentStore;
  /** M15 best-effort status side-channel. */
  readonly notificationService?: NotificationService;
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
  private readonly startedRpcs = new Set<PiRpcClient>();
  private readonly notificationBindings = new Map<
    PiRpcClient,
    { detach: () => void; refs: number }
  >();
  private readonly toolOutputLimiter = new ToolOutputLimiter();
  private readonly policyBridge: OneSessionPolicyBridge | null;
  private readonly supervisor: ProcessSupervisor;
  private readonly reuseExistingOnCreate: boolean;
  private lastUsedSessionId: string | null = null;
  private readonly activeTurns = new Map<string, { turnId: string; deliveryMode: string; message: string }>();
  private readonly globalDetach = new Set<() => void>();
  /** M12 — soft-deletion retention window (7 days) for `session.delete`. */
  private readonly softDeleteRetentionMs: number;
  private readonly exportRegistry: ExportRegistry | null;
  private readonly attachmentStore: AttachmentStore | null;
  private readonly notificationService: NotificationService | null;

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
    this.softDeleteRetentionMs = 7 * 24 * 60 * 60 * 1000;
    this.attachmentStore = options.attachmentStore ?? null;
    this.notificationService = options.notificationService ?? null;
    // Production injects a registry rooted in the bridge state directory.
    // Keeping this optional avoids filesystem side effects for adapters that
    // do not advertise export support (including read-only test fixtures).
    this.exportRegistry = options.exportRegistry ?? null;
    const identity = this.store.identity();
    this.hostStream = `host:${identity.hostId}`;
    if (options.supervisor) {
      this.supervisor = options.supervisor;
    } else {
      this.supervisor = this.buildDefaultSupervisor(options.capacity ?? 3, options.now);
    }
    this.store.recoverDispatchingFollowUps();
    this.store.expireDialogs(this.now());
    // The legacy production transport is a single shared RPC emitter. Bind it
    // exactly once: attaching one handler per durable session multiplies every
    // token delta and terminal event by the session count.
    if (this.rpc && !this.createRpc) {
      const detach = this.rpc.on("notification", (raw) => this.handleNotification(raw));
      this.notificationBindings.set(this.rpc, { detach, refs: 0 });
      this.globalDetach.add(detach);
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
    this.notificationBindings.clear();
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
      case "queue.remove":
        this.store.removeFollowUp(String(command.payload.sessionId ?? ""), String(command.payload.queueItemId ?? "")); return;
      case "queue.clear":
        this.store.clearFollowUps(String(command.payload.sessionId ?? "")); return;
      case "extension.respond":
        return this.handleExtensionResponse(command);
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
      // ---------------- M12 lifecycle ----------------
      case "session.rename":
        return this.handleSessionRename(command);
      case "session.fork":
        return this.handleSessionFork(command);
      case "session.clone":
        return this.handleSessionClone(command);
      case "session.delete":
        return this.handleSessionDelete(command);
      case "session.restore":
        return this.handleSessionRestore(command);
      case "session.purge":
        return this.handleSessionPurge(command);
      case "session.export":
        return this.handleSessionExport(command);
      case "notification.device.register": {
        if(!this.notificationService) return;
        const platform=command.payload.platform;
        if(platform!=="apns"&&platform!=="fcm") throw new Error("invalid notification platform");
        this.notificationService.registerDevice({deviceId:String(command.payload.deviceId??""),installationId:String(command.payload.installationId??""),platform,pushToken:String(command.payload.token??""),appVersion:String(command.payload.appVersion??"unknown")});
        this.store.appendEvent(this.hostStream,"notification.capability",{available:true,registered:true,platform});
        return;
      }
      case "notification.device.unregister":
        this.notificationService?.unregisterDevice(String(command.payload.deviceId??""));
        this.store.appendEvent(this.hostStream,"notification.capability",{available:Boolean(this.notificationService),registered:false});
        return;
      default:
        // Session-scoped metadata commands (rename, policy.set, ...) are
        // local-only at this checkpoint; no Pi RPC call is required.
        return;
    }
  }

  validateCommand(type: string, payload: Record<string, unknown>): void {
    if (type === "extension.respond") {
      const dialog = this.store.pendingDialog(String(payload.sessionId ?? ""), this.now());
      if (!dialog || dialog.dialogId !== payload.dialogId) throw new Error("invalid_state");
      return;
    }
    if (type === "queue.remove") {
      const found=this.store.listFollowUps(String(payload.sessionId ?? "")).some((item)=>item.queueItemId===payload.queueItemId);
      if(!found) throw new Error("queue_item_not_found");
      return;
    }
    if (type !== "prompt.submit") return;
    if (payload.deliveryMode === "follow_up" && this.store.listFollowUps(String(payload.sessionId ?? "")).length >= 10) throw new Error("queue_full");
    const ids = Array.isArray(payload.attachmentIds) ? payload.attachmentIds : [];
    if (ids.length > 4) throw new Error("attachment_unavailable");
    let bytes = 0;
    for (const value of ids) {
      if (typeof value !== "string" || !this.attachmentStore) throw new Error("attachment_unavailable");
      const resolved = this.attachmentStore.resolve(value);
      if (!resolved.available || !resolved.bytes || !resolved.contentType || !["image/jpeg", "image/png"].includes(resolved.contentType)) throw new Error("attachment_unavailable");
      bytes += resolved.bytes;
    }
    if (bytes > 25 * 1024 * 1024) throw new Error("attachment_unavailable");
  }

  commandAccepted(type: string, payload: Record<string, unknown>, commandId: string): void {
    if (type === "prompt.submit" && payload.deliveryMode === "follow_up") {
      const sessionId = String(payload.sessionId ?? "");
      this.store.enqueueFollowUp({ sessionId, queueItemId:commandId, message:String(payload.message ?? ""), attachmentIds:Array.isArray(payload.attachmentIds) ? payload.attachmentIds.filter((id): id is string => typeof id === "string") : [] });
    }
    if (type !== "prompt.submit" || !this.attachmentStore) return;
    const ids = Array.isArray(payload.attachmentIds) ? payload.attachmentIds : [];
    for (const id of ids) {
      if (typeof id !== "string") continue;
      try { this.attachmentStore.retain(id, this.now() + 7 * 24 * 60 * 60_000); } catch { /* validation already succeeded; never break Pi acceptance */ }
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

  private async ensureRpcStarted(rpc: PiRpcClient): Promise<void> {
    if (!this.createRpc || !rpc.start || this.startedRpcs.has(rpc)) return;
    if (rpc.lifecycleState && rpc.lifecycleState() !== "stopped") {
      this.startedRpcs.add(rpc);
      return;
    }
    this.startedRpcs.add(rpc);
    try {
      await rpc.start();
    } catch (error) {
      this.startedRpcs.delete(rpc);
      throw error;
    }
  }

  private bindSession(sessionId: string): SessionEntry {
    const slot = this.slots.get(sessionId) ?? (() => {
      const rpc = this.createRpc ? this.createRpc(sessionId) : this.rpc!;
      const fresh: SessionSlot = { rpc, bound: null };
      this.slots.set(sessionId, fresh);
      return fresh;
    })();
    if (slot.bound) return slot.bound;
    let binding = this.notificationBindings.get(slot.rpc);
    if (!binding) {
      const handler: PiRpcNotificationHandler = (raw) => this.handleNotification(raw);
      const detach = slot.rpc.on("notification", handler);
      binding = { detach, refs: 0 };
      this.notificationBindings.set(slot.rpc, binding);
      this.globalDetach.add(detach);
    }
    binding.refs += 1;
    let attached = true;
    const entry: SessionEntry = {
      rpc: slot.rpc,
      detach: () => {
        if (!attached) return;
        attached = false;
        const current = this.notificationBindings.get(slot.rpc);
        if (!current) return;
        current.refs -= 1;
        if (current.refs <= 0) {
          current.detach();
          this.globalDetach.delete(current.detach);
          this.notificationBindings.delete(slot.rpc);
        }
      },
      state: "idle",
    };
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

  /** Emits a schema-complete host summary even for partial lifecycle patches. */
  private appendSessionSummary(sessionId: string, patch: Record<string, unknown>): void {
    const prior = this.store.sessionState(sessionId) ?? {};
    const runtimeState = typeof patch.runtimeState === "string"
      ? patch.runtimeState
      : typeof prior.runtimeState === "string" ? prior.runtimeState : "idle";
    const candidateQueueCount = Number.isInteger(patch.queueCount) ? patch.queueCount : prior.queueCount;
    const queueCount = Number.isInteger(candidateQueueCount) && Number(candidateQueueCount) >= 0
      ? Number(candidateQueueCount)
      : 0;
    this.store.appendEvent(this.hostStream, "session.summary", {
      ...patch,
      sessionId,
      workspaceId: typeof patch.workspaceId === "string"
        ? patch.workspaceId
        : typeof prior.workspaceId === "string"
        ? prior.workspaceId
        : this.workspace.workspaceId,
      name: typeof patch.name === "string" ? patch.name : prior.name,
      displayName: typeof patch.displayName === "string" ? patch.displayName : prior.displayName,
      workspaceRelativePath: typeof patch.workspaceRelativePath === "string"
        ? patch.workspaceRelativePath
        : prior.workspaceRelativePath,
      runtimeState,
      queueCount,
    });
  }

  private publishSummaryChange(sessionId: string, payload: Record<string, unknown>): void {
    const prior = this.store.sessionState(sessionId) ?? {};
    const runtimeState = (payload.runtimeState as string | undefined) ?? prior.runtimeState;
    const attentionState = (payload.attentionState as string | undefined) ?? prior.attentionState ?? "ready";
    const next = { ...prior, runtimeState, attentionState, lastActivityAt: new Date(this.now()).toISOString() };
    this.store.updateSessionState(sessionId, next);
    this.appendSessionSummary(sessionId, {
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
      workspaceRelativePath?: string;
    };
    const workspaceId = typeof payload.workspaceId === "string" && payload.workspaceId.length > 0
      ? payload.workspaceId
      : this.workspace.workspaceId;
    const baseMode: WorkspacePolicyMode = payload.policyMode
      ?? (this.policyBridge ? this.policyBridge.hostMode() : this.workspace.policyMode);
    let sessionRoot = this.workspace.rootPath;
    let workspaceRelativePath = ".";
    let workspaceDisplayName = this.workspace.displayName;
    if (typeof payload.workspaceRelativePath === "string") {
      const workspaceRoot = realpathSync(this.workspace.rootPath);
      sessionRoot = realpathSync(resolve(workspaceRoot, payload.workspaceRelativePath));
      const containedRelativePath = relative(workspaceRoot, sessionRoot);
      if (containedRelativePath.startsWith("..") || isAbsolute(containedRelativePath)) {
        throw new Error("workspace_not_allowed");
      }
      workspaceRelativePath = containedRelativePath.length === 0
        ? "."
        : containedRelativePath.split("\\").join("/");
      workspaceDisplayName = workspaceRelativePath === "."
        ? this.workspace.displayName
        : basename(sessionRoot);
    }

    // M11 — backwards-compat shim only. By default a repeated
    // session.create admits a new session, matching the multi-session
    // contract. Tests that need the M5 reuse behaviour can opt back in.
    if (this.reuseExistingOnCreate) {
      const existing = this.store.sessionStates()[0];
      if (existing && typeof existing.sessionId === "string") {
        this.lastUsedSessionId = existing.sessionId;
        this.appendSessionSummary(existing.sessionId, existing);
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
      workspaceRelativePath,
      workspaceDisplayName,
      workspaceRootPath: sessionRoot,
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
      await this.supervisor.start(sessionId, spec ?? { executable: "pi", args: [], cwd: sessionRoot });
    } catch (error) {
      this.store.discardSession(sessionId);
      if (error instanceof ProcessSupervisorError && error.code === "host_capacity") {
        this.supervisor.register(sessionId, "stopped");
        const snapshot = this.supervisor.snapshot();
        throw new HostCapacityError(this.supervisor.activeCount(), snapshot.capacity);
      }
      throw error;
    }

    const rpc = this.resolveRpc(sessionId);
    await this.ensureRpcStarted(rpc);
    this.bindSession(sessionId);
    this.lastUsedSessionId = sessionId;

    const summary = {
      sessionId,
      workspaceId,
      displayName: workspaceDisplayName,
      workspaceRelativePath,
      workspaceRootPath: sessionRoot,
      name: typeof payload.name === "string" && payload.name.trim().length > 0
        ? payload.name.trim()
        : workspaceDisplayName,
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
    this.appendSessionSummary(sessionId, {
      workspaceId,
      runtimeState: "idle",
      attentionState: "ready",
      queueCount: 0,
      modelSummary: null,
      policyMode: baseMode,
      name: summary.name,
      displayName: workspaceDisplayName,
      workspaceRelativePath,
      createdAt,
      change: "added",
    });
    this.store.appendEvent(`session:${sessionId}`, "session.metadata", {
      sessionId,
      workspaceId,
      name: summary.name,
      displayName: workspaceDisplayName,
      workspaceRelativePath,
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
    this.appendSessionSummary(sessionId, {
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
    await this.ensureRpcStarted(rpc);
    if (rpc.manualRetry &&
        (!rpc.lifecycleState || rpc.lifecycleState() !== "idle")) {
      await rpc.manualRetry();
    }
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
    this.appendSessionSummary(sessionId, {
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
    const [modelsRaw, stateRaw, statsRaw, commandsRaw, treeRaw, forkMessagesRaw] = await Promise.all([
      safeRequest("get_available_models"), safeRequest("get_state"),
      safeRequest("get_session_stats"), safeRequest("get_commands"),
      safeRequest("get_tree"), safeRequest("get_fork_messages"),
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
    const boundTree = (value: unknown, depth = 0): unknown => {
      if (depth >= 12) return "[depth limited]";
      if (typeof value === "string") return value.slice(0, 2_000);
      if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
      if (Array.isArray(value)) return value.slice(0, 500).map((item) => boundTree(item, depth + 1));
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 50).map(([key, item]) => [key, boundTree(item, depth + 1)]));
      return null;
    };
    const sessionTree = boundTree(unwrap(treeRaw));
    const forkValue = unwrap(forkMessagesRaw);
    const eligibleForkMessages = Array.isArray(forkValue)
      ? forkValue.filter((item) => item && typeof item === "object").slice(0, 500).map((item) => boundTree(item))
      : [];
    const prior = this.store.sessionState(sessionId) ?? {};
    const patch = {
      availableModels,
      commandCatalogue,
      modelId: typeof stateObject.model === "string" ? stateObject.model : null,
      thinkingLevel: typeof stateObject.thinkingLevel === "string" ? stateObject.thinkingLevel : null,
      steeringMode: stateObject.steeringMode ?? null,
      followUpMode: stateObject.followUpMode ?? null,
      autoCompactionEnabled: stateObject.autoCompactionEnabled ?? null,
      sessionTree,
      eligibleForkMessages,
    };
    this.store.updateSessionState(sessionId, { ...prior, ...patch });
    this.store.appendEvent(`session:${sessionId}`, "session.tree", { sessionId, tree: sessionTree, eligibleForkMessages });
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
    if (command.payload.deliveryMode === "follow_up") return;
    const payload = (command.payload ?? {}) as {
      sessionId?: string;
      message?: string;
      deliveryMode?: "immediate" | "steer" | "follow_up";
      attachmentIds?: string[];
    };
    if (typeof payload.sessionId !== "string") throw new Error("prompt.submit requires sessionId");
    if (typeof payload.message !== "string" || payload.message.length === 0) throw new Error("prompt.submit requires message");
    if (!this.store.sessionExists(payload.sessionId)) throw new Error("prompt.submit session not found");
    this.lastUsedSessionId = payload.sessionId;
    const rpc = this.sessions.get(payload.sessionId)?.rpc ?? this.rpc;
    if (!rpc) throw new Error("prompt.submit no RPC available");
    await this.ensureRpcStarted(rpc);
    const policySnapshot = this.policyBridge?.snapshotModeFor(payload.sessionId);
    if (this.policyBridge && !policySnapshot) throw new Error("prompt.submit requires a durable policy snapshot");
    this.policyBridge?.publish?.(policySnapshot ?? undefined);
    rpc.markDispatchStart?.();
    const method: "prompt" | "steer" | "follow_up" =
      payload.deliveryMode === "steer" ? "steer" :
      payload.deliveryMode === "follow_up" ? "follow_up" : "prompt";
    const attachmentIds = Array.isArray(payload.attachmentIds) ? payload.attachmentIds : [];
    if (attachmentIds.length > 4) throw new Error("prompt.submit supports at most four attachments");
    this.activeTurns.set(payload.sessionId, {
      turnId: command.commandId,
      deliveryMode: payload.deliveryMode ?? "immediate",
      message: payload.message,
    });
    const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
    let attachmentBytes = 0;
    for (const attachmentId of attachmentIds) {
      if (!this.attachmentStore) throw new Error("attachment_unavailable");
      const resolved = this.attachmentStore.resolve(attachmentId);
      if (!resolved.available || !resolved.contentType || !resolved.bytes) throw new Error("attachment_unavailable");
      attachmentBytes += resolved.bytes;
      if (attachmentBytes > 25 * 1024 * 1024) throw new Error("prompt attachments exceed 25 MiB");
      const chunks: Uint8Array[] = [];
      for await (const chunk of this.attachmentStore.openReadStream(attachmentId)) chunks.push(chunk);
      const joined = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
      images.push({ type: "image", data: joined.toString("base64"), mimeType: resolved.contentType });
      this.attachmentStore.retain(attachmentId, this.now() + 24 * 60 * 60_000);
    }
    try {
      await rpc.request({
        id: command.commandId,
        method,
        params: { message: payload.message, ...(images.length ? { images } : {}) },
      });
    } catch (error) {
      this.activeTurns.delete(payload.sessionId);
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

  // ---------------- M12 lifecycle handlers ----------------

  /**
   * Map an opaque bridge-side entry reference (`entryId`) into a
   * Pi `get_fork_messages`/`fork` entry id. The mapping is identity
   * because the upstream notification stream already emits the
   * canonical entry id, and `get_fork_messages` exposes the eligible
   * range. Tests verify that unknown references produce a
   * `session_not_found` style error.
   */
  private mapForkEntryId(sessionId: string, entryId: string): { eligible: boolean; reason?: string } {
    if (typeof entryId !== "string" || entryId.length === 0) return { eligible: false, reason: "invalid_entry" };
    const prior = this.store.sessionState(sessionId) ?? {};
    const deleted = prior.deletedAt;
    if (deleted) return { eligible: false, reason: "session_deleted" };
    return { eligible: true };
  }

  /** Writes lineage metadata onto a session and publishes it as `session.metadata`. */
  private writeLineage(sessionId: string, lineage: { parentSessionId: string | null; lineageType: "root" | "branch" | "clone"; createdFrom: string | null; createdAt: string }): void {
    this.store.changeSessionSummary(sessionId, {
      parentSessionId: lineage.parentSessionId,
      lineageType: lineage.lineageType,
      lineageCreatedFrom: lineage.createdFrom,
      lineageCreatedAt: lineage.createdAt,
    });
    this.store.appendEvent(`session:${sessionId}`, "session.metadata", {
      sessionId,
      parentSessionId: lineage.parentSessionId,
      lineageType: lineage.lineageType,
      createdFrom: lineage.createdFrom,
      createdAt: lineage.createdAt,
    });
  }

  /** session.rename — requires an idle (or stopped) session and writes the new name. */
  private async handleSessionRename(command: StoredCommand): Promise<void> {
    const payload = (command.payload ?? {}) as { sessionId?: string; name?: string };
    if (typeof payload.sessionId !== "string") throw new Error("session.rename requires sessionId");
    if (typeof payload.name !== "string" || payload.name.length === 0) throw new Error("session.rename requires name");
    const prior = this.store.sessionState(payload.sessionId);
    if (!prior) throw new Error("session.rename session not found");
    if (prior.deletedAt) throw new Error("session_deleted");
    if (prior.runtimeState && prior.runtimeState !== "idle" && prior.runtimeState !== "stopped") {
      throw new Error("session.rename requires an idle session");
    }
    const rpc = this.sessions.get(payload.sessionId)?.rpc ?? this.rpc;
    if (!rpc) throw new Error("session.rename no RPC available");
    try {
      await rpc.request({ id: command.commandId, method: "set_session_name", params: { name: payload.name } });
    } catch (error) {
      // Extension cancel / RPC failure — surface as capability-safe `invalid_state`
      // so mobile sees the rename failed but the durable summary is unchanged.
      throw new Error(`session.rename failed: ${(error as Error).message ?? "rpc_error"}`);
    }
    const previousName = typeof prior.name === "string" ? prior.name : null;
    this.store.updateSessionState(payload.sessionId, { ...prior, name: payload.name, previousName });
    this.store.appendEvent(`session:${payload.sessionId}`, "session.metadata", {
      sessionId: payload.sessionId,
      name: payload.name,
      previousName,
      renamedAt: new Date(this.now()).toISOString(),
    });
    this.appendSessionSummary(payload.sessionId, {
      name: payload.name,
      previousName,
      change: "renamed",
    });
  }

  /**
   * session.fork — branches a session at the eligible entry id. The
   * new session is the child; the original is unchanged. Extension
   * cancellation is signalled by `fork` throwing — the original
   * session is not mutated and no child row is added.
   */
  private async handleSessionFork(command: StoredCommand): Promise<void> {
    const payload = (command.payload ?? {}) as { sessionId?: string; entryId?: string };
    if (typeof payload.sessionId !== "string") throw new Error("session.fork requires sessionId");
    if (typeof payload.entryId !== "string" || payload.entryId.length === 0) throw new Error("session.fork requires entryId");
    const prior = this.store.sessionState(payload.sessionId);
    if (!prior) throw new Error("session.fork session not found");
    if (prior.deletedAt) throw new Error("session_deleted");
    if (prior.runtimeState && prior.runtimeState !== "idle" && prior.runtimeState !== "stopped") {
      throw new Error("session.fork requires an idle session");
    }
    const mapping = this.mapForkEntryId(payload.sessionId, payload.entryId);
    if (!mapping.eligible) throw new Error(`session.fork ineligible: ${mapping.reason ?? "unknown"}`);
    const rpc = this.sessions.get(payload.sessionId)?.rpc ?? this.rpc;
    if (!rpc) throw new Error("session.fork no RPC available");
    let eligibleResponse: unknown;
    try {
      eligibleResponse = await rpc.request({ id: `${command.commandId}:eligible`, method: "get_fork_messages" });
    } catch (error) {
      this.store.appendEvent(`session:${payload.sessionId}`, "session.metadata", {
        sessionId: payload.sessionId,
        forkCancelled: true,
        entryId: payload.entryId,
        reason: (error as Error).message ?? "rpc_error",
      });
      throw error;
    }
    const eligibleItems = Array.isArray(eligibleResponse)
      ? eligibleResponse
      : eligibleResponse && typeof eligibleResponse === "object" && Array.isArray((eligibleResponse as Record<string, unknown>).messages)
        ? (eligibleResponse as Record<string, unknown>).messages as unknown[]
        : null;
    if (eligibleItems && !eligibleItems.some((item) => item && typeof item === "object"
      && ((item as Record<string, unknown>).entryId === payload.entryId || (item as Record<string, unknown>).id === payload.entryId))) {
      throw new Error("session.fork entry is not eligible");
    }
    let response: unknown;
    try {
      response = await rpc.request({ id: command.commandId, method: "fork", params: { entryId: payload.entryId } });
    } catch (error) {
      // Extension cancel or RPC failure — leave original unchanged.
      this.store.appendEvent(`session:${payload.sessionId}`, "session.metadata", {
        sessionId: payload.sessionId,
        forkCancelled: true,
        entryId: payload.entryId,
        reason: (error as Error).message ?? "rpc_error",
      });
      throw error;
    }
    if (response && typeof response === "object" && (response as Record<string, unknown>).cancelled === true) {
      this.store.appendEvent(`session:${payload.sessionId}`, "session.metadata", {
        sessionId: payload.sessionId,
        forkCancelled: true,
        entryId: payload.entryId,
      });
      return;
    }
    const childSessionId = this.newSessionId();
    const createdAt = new Date(this.now()).toISOString();
    const lineage = {
      parentSessionId: payload.sessionId,
      lineageType: "branch" as const,
      createdFrom: payload.entryId,
      createdAt,
    };
    this.store.addSessionSummary(childSessionId, {
      sessionId: childSessionId,
      workspaceId: this.workspace.workspaceId,
      displayName: this.workspace.displayName,
      name: `Fork of ${typeof prior.name === "string" ? prior.name : payload.sessionId.slice(0, 8)}`,
      policyMode: (prior.policyMode as WorkspacePolicyMode) ?? this.workspace.policyMode,
      runtimeState: "idle",
      attentionState: "ready",
      queueCount: 0,
      createdAt,
      lastActivityAt: createdAt,
      forkResult: response ?? null,
    });
    this.writeLineage(childSessionId, lineage);
    this.lastUsedSessionId = childSessionId;
  }

  /**
   * session.clone — duplicates the current active branch. Like fork,
   * the original session is never mutated. The child has no
   * `createdFrom` (entry id) but does carry `parentSessionId` and a
   * `lineageType: "clone"` marker so mobile can render the tree.
   */
  private async handleSessionClone(command: StoredCommand): Promise<void> {
    const payload = (command.payload ?? {}) as { sessionId?: string };
    if (typeof payload.sessionId !== "string") throw new Error("session.clone requires sessionId");
    const prior = this.store.sessionState(payload.sessionId);
    if (!prior) throw new Error("session.clone session not found");
    if (prior.deletedAt) throw new Error("session_deleted");
    if (prior.runtimeState && prior.runtimeState !== "idle" && prior.runtimeState !== "stopped") {
      throw new Error("session.clone requires an idle session");
    }
    const rpc = this.sessions.get(payload.sessionId)?.rpc ?? this.rpc;
    if (!rpc) throw new Error("session.clone no RPC available");
    let response: unknown;
    try {
      response = await rpc.request({ id: command.commandId, method: "clone" });
    } catch (error) {
      this.store.appendEvent(`session:${payload.sessionId}`, "session.metadata", {
        sessionId: payload.sessionId,
        cloneCancelled: true,
        reason: (error as Error).message ?? "rpc_error",
      });
      throw error;
    }
    if (response && typeof response === "object" && (response as Record<string, unknown>).cancelled === true) {
      this.store.appendEvent(`session:${payload.sessionId}`, "session.metadata", {
        sessionId: payload.sessionId,
        cloneCancelled: true,
      });
      return;
    }
    const childSessionId = this.newSessionId();
    const createdAt = new Date(this.now()).toISOString();
    const lineage = {
      parentSessionId: payload.sessionId,
      lineageType: "clone" as const,
      createdFrom: null,
      createdAt,
    };
    this.store.addSessionSummary(childSessionId, {
      sessionId: childSessionId,
      workspaceId: this.workspace.workspaceId,
      displayName: this.workspace.displayName,
      name: `Clone of ${typeof prior.name === "string" ? prior.name : payload.sessionId.slice(0, 8)}`,
      policyMode: (prior.policyMode as WorkspacePolicyMode) ?? this.workspace.policyMode,
      runtimeState: "idle",
      attentionState: "ready",
      queueCount: 0,
      createdAt,
      lastActivityAt: createdAt,
      cloneResult: response ?? null,
    });
    this.writeLineage(childSessionId, lineage);
    this.lastUsedSessionId = childSessionId;
  }

  /**
   * session.delete — soft-delete with a 7-day purge window.
   *
   * Pi has no delete-session RPC command (BACKLOG M0-20), so this
   * adapter only marks the session as soft-deleted in the durable
   * store: state gains `deletedAt`, `purgeAfter`, `deletionState =
   * "soft_deleted"`, and the host stream receives a `session.removed`
   * event with the purge window. Running processes are stopped; the
   * Pi on-disk session file is left untouched so restore is possible.
   */
  private async handleSessionDelete(command: StoredCommand): Promise<void> {
    const payload = (command.payload ?? {}) as { sessionId?: string; abortActive?: boolean; cancelQueued?: boolean };
    if (typeof payload.sessionId !== "string") throw new Error("session.delete requires sessionId");
    const prior = this.store.sessionState(payload.sessionId);
    if (!prior) throw new Error("session.delete session not found");
    if (prior.deletedAt) {
      // Idempotent: already soft-deleted.
      return;
    }
    const supervisorState = this.supervisor.state(payload.sessionId);
    const activeTurn = prior.runtimeState === "running" || prior.runtimeState === "waiting_for_input" || supervisorState === "running" || supervisorState === "waiting_for_input";
    if (activeTurn && payload.abortActive !== true) throw new Error("session.delete requires explicit active-turn abort");
    if (Number(prior.queueCount ?? 0) > 0 && payload.cancelQueued !== true) throw new Error("session.delete requires explicit queued-prompt cancellation");
    // Abort explicitly before process stop; no active action is silently discarded.
    if (activeTurn) {
      const rpc = this.sessions.get(payload.sessionId)?.rpc ?? this.rpc;
      if (!rpc) throw new Error("session.delete no RPC available to abort active turn");
      await rpc.request({ id: `${command.commandId}:abort`, method: "abort" });
    }
    // Stop running process so the Pi session file is no longer being mutated.
    try {
      if (supervisorState === "running" || supervisorState === "idle") {
        await this.supervisor.stop(payload.sessionId, "soft_delete");
      }
      this.unbindSession(payload.sessionId);
    } catch (error) {
      this.store.markSessionDeleteFailed(payload.sessionId, (error as Error).message || "process stop failed");
      throw new Error("session.delete_failed: repair required");
    }
    const deleted = this.store.softDeleteSession(payload.sessionId, this.softDeleteRetentionMs, this.now());
    const deletedAt = String(deleted.deletedAt);
    const purgeAfter = String(deleted.purgeAfter);
    this.store.appendEvent(`session:${payload.sessionId}`, "session.state", {
      sessionId: payload.sessionId,
      runtimeState: "stopped",
      attentionState: "none",
      deletedAt,
      purgeAfter,
      deletionState: "soft_deleted",
    });
    // Host-stream `session.removed` so mobile can show the deleted
    // badge with the purge window. Removal is soft — the row remains
    // durably addressable so restore can revive it.
    this.store.appendEvent(this.hostStream, "session.removed", {
      sessionId: payload.sessionId,
      workspaceId: this.workspace.workspaceId,
      removedAt: deletedAt,
      purgeAfter,
      deletionState: "soft_deleted",
      partial: false,
      reason: "operator",
    });
    // Also keep the durable summary coherent with the removal so list
    // consumers see `runtimeState: stopped` until restore.
    this.appendSessionSummary(payload.sessionId, {
      runtimeState: "stopped",
      attentionState: "none",
      deletedAt,
      purgeAfter,
      deletionState: "soft_deleted",
      change: "removed",
    });
  }

  /**
   * session.restore — revives a soft-deleted session whose purge
   * window has not elapsed. Restoring after the window is rejected
   * (use `session.purge` for irreversible removal). The restored
   * session is re-bound to its RPC client and a fresh `session.activate`
   * cycle is performed so mobile lands on the idle summary.
   */
  private async handleSessionRestore(command: StoredCommand): Promise<void> {
    const payload = (command.payload ?? {}) as { sessionId?: string };
    if (typeof payload.sessionId !== "string") throw new Error("session.restore requires sessionId");
    const prior = this.store.sessionState(payload.sessionId);
    if (!prior) throw new Error("session.restore session not found");
    if (!prior.deletedAt) {
      // Not deleted — restore is a no-op; surface as `invalid_state`.
      throw new Error("session.restore: session is not deleted");
    }
    const purgeAfterMs = Date.parse(String(prior.purgeAfter));
    if (Number.isFinite(purgeAfterMs) && purgeAfterMs <= this.now()) {
      throw new Error("session.restore: purge window has elapsed");
    }
    const restored = this.store.restoreSoftDeletedSession(payload.sessionId, this.now());
    const restoredAt = String(restored.restoredAt);
    this.store.appendEvent(`session:${payload.sessionId}`, "session.metadata", {
      sessionId: payload.sessionId,
      restoredAt,
      previousDeletedAt: prior.deletedAt,
      previousPurgeAfter: prior.purgeAfter,
    });
    this.appendSessionSummary(payload.sessionId, {
      runtimeState: "stopped",
      attentionState: "none",
      restoredAt,
      change: "restored",
    });
    // Delegate process re-establishment to session.activate semantics.
    await this.handleSessionActivate(command);
  }

  /**
   * session.purge — irreversible. Pi has no delete RPC (M0-20), so
   * purge removes the durable row and emits `session.removed` with
   * `permanent: true`. The session ID is never reused because the
   * store issues fresh UUIDs for every `session.create`.
   */
  private async handleSessionPurge(command: StoredCommand): Promise<void> {
    const payload = (command.payload ?? {}) as { sessionId?: string };
    if (typeof payload.sessionId !== "string") throw new Error("session.purge requires sessionId");
    if (!this.store.sessionExists(payload.sessionId)) throw new Error("session.purge session not found");
    try {
      this.unbindSession(payload.sessionId);
      const supervisorState = this.supervisor.state(payload.sessionId);
      if (supervisorState === "running" || supervisorState === "idle") {
        await this.supervisor.stop(payload.sessionId, "purge");
      }
    } catch (error) {
      this.store.markSessionDeleteFailed(payload.sessionId, (error as Error).message || "purge stop failed");
      throw new Error("session.delete_failed: repair required");
    }
    this.store.purgeSessionTombstone(payload.sessionId);
  }

  private async handleSessionExport(command: StoredCommand): Promise<void> {
    const sessionId = String(command.payload.sessionId ?? "");
    const state = this.store.sessionState(sessionId);
    if (!state) throw new Error("session.export session not found");
    if (state.deletedAt || state.lifecycleState === "purged") throw new Error("session_deleted");
    const rpc = this.sessions.get(sessionId)?.rpc ?? this.rpc;
    if (!rpc) throw new Error("session.export no RPC available");
    const exportRegistry = this.exportRegistry;
    if (!exportRegistry) throw new Error("session.export unsupported");
    for (const expired of exportRegistry.sweepExpired()) {
      this.store.appendEvent(`session:${expired.sessionId}`, "session.export", expired as unknown as Record<string, unknown>);
    }
    const reserved = exportRegistry.register({ sessionId, format: "html" });
    mkdirSync(exportRegistry.rootPath(), { recursive: true, mode: 0o700 });
    try {
      const response = await rpc.request({
        id: command.commandId,
        method: "export_html",
        params: { outputPath: reserved.storagePath },
      });
      const responseObject = response && typeof response === "object" ? response as Record<string, unknown> : {};
      let bytes = typeof responseObject.bytes === "number" ? responseObject.bytes : 0;
      let digest = typeof responseObject.sha256 === "string" ? responseObject.sha256 : "";
      if (!/^[0-9a-f]{64}$/.test(digest)) {
        const content = readFileSync(reserved.storagePath);
        bytes = content.byteLength;
        digest = createHash("sha256").update(content).digest("hex");
      }
      const metadata = exportRegistry.markCompleted(reserved.metadata.exportId, { bytes, sha256: digest });
      if (!metadata) throw new ExportRegistryInvalidInputError("export reservation disappeared");
      this.store.appendEvent(`session:${sessionId}`, "session.export", metadata as unknown as Record<string, unknown>);
      this.store.changeSessionSummary(sessionId, { latestExport: metadata });
    } catch (error) {
      const failed = exportRegistry.markFailed(reserved.metadata.exportId, (error as Error).message || "export failed");
      if (failed) this.store.appendEvent(`session:${sessionId}`, "session.export", failed as unknown as Record<string, unknown>);
      throw error;
    }
  }

  sweepExtensionDialogs(): number {
    const expired=this.store.expireDialogs(this.now());
    for(const dialog of expired){
      this.store.appendEvent(`session:${dialog.sessionId}`,"extension.dialog",{sessionId:dialog.sessionId,dialogId:dialog.dialogId,method:dialog.method,state:"expired",expiresAt:new Date(dialog.expiresAt).toISOString()});
      const prior=this.store.sessionState(dialog.sessionId) ?? {};
      this.store.updateSessionState(dialog.sessionId,{...prior,pendingDialog:null});
    }
    return expired.length;
  }

  listExports(sessionId: string): ExportMetadata[] { return this.exportRegistry?.list(sessionId) ?? []; }
  getExport(exportId: string): ExportMetadata | null { return this.exportRegistry?.get(exportId) ?? null; }
  deleteExport(exportId: string): ExportMetadata | null { return this.exportRegistry?.delete(exportId) ?? null; }
  exportFile(exportId: string): ReturnType<typeof Bun.file> | null { return this.exportRegistry?.file(exportId) ?? null; }

  private async handleExtensionResponse(command: StoredCommand): Promise<void> {
    const sessionId = String(command.payload.sessionId ?? "");
    const dialog = this.store.claimDialogResponse(sessionId, String(command.payload.dialogId ?? ""), this.now());
    const rpc = this.sessions.get(sessionId)?.rpc ?? this.rpc;
    if (!rpc?.sendExtensionUiResponse) throw new Error("extension response transport unavailable");
    const input = command.payload.response && typeof command.payload.response === "object" ? command.payload.response as Record<string,unknown> : {};
    const response: { id:string; value?:string; confirmed?:boolean; cancelled?:true } = { id:dialog.upstreamId };
    if (input.cancelled === true) response.cancelled = true;
    else if (dialog.method === "confirm") response.confirmed = input.confirmed === true;
    else if (typeof input.value === "string") response.value = input.value;
    else throw new Error("invalid extension response");
    await rpc.sendExtensionUiResponse(response);
    this.store.appendEvent(`session:${sessionId}`, "extension.dialog", { sessionId, dialogId:dialog.dialogId, method:dialog.method, state:"responded", expiresAt:new Date(dialog.expiresAt).toISOString() });
  }

  private async dispatchNextFollowUp(sessionId:string): Promise<void> {
    const item = this.store.claimNextFollowUp(sessionId); if (!item) return;
    try {
      await this.handlePromptSubmit({ commandId:item.queueItemId, type:"prompt.submit", scopeKey:`session:${sessionId}`, streamId:`session:${sessionId}`, semanticHash:"", state:"running", dispatchCount:1, payload:{ sessionId, message:item.message, attachmentIds:[...item.attachmentIds], deliveryMode:"immediate" } });
      this.store.finishFollowUp(item.queueItemId);
    } catch (error) { this.store.finishFollowUp(item.queueItemId, true); throw error; }
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
    if (type === "extension_ui_request" && ["select","confirm","input","editor"].includes(String(record.method ?? ""))) {
      const timeout = typeof record.timeout === "number" && Number.isFinite(record.timeout) ? Math.max(0, Math.min(300_000, record.timeout)) : 300_000;
      const method = String(record.method) as "select"|"confirm"|"input"|"editor";
      const bound=(value:unknown,max:number)=>typeof value === "string" ? value.slice(0,max) : "";
      const request:Record<string,unknown>={title:bound(record.title,512),message:bound(record.message,4096),placeholder:bound(record.placeholder,512),prefill:bound(record.prefill,64*1024),options:Array.isArray(record.options)?record.options.slice(0,100).map((value)=>bound(value,512)):[]};
      const dialog = this.store.createDialog({ sessionId:inferredSessionId, upstreamId:String(record.id ?? "").slice(0,256), method, request, expiresAt:this.now()+timeout });
      this.store.appendEvent(streamId, "extension.dialog", { sessionId:inferredSessionId, dialogId:dialog.dialogId, method, ...request, createdAt:new Date(dialog.createdAt).toISOString(), expiresAt:new Date(dialog.expiresAt).toISOString(), state:"pending" });
      this.store.updateSessionState(inferredSessionId, { ...(this.store.sessionState(inferredSessionId) ?? {}), pendingDialog:{ dialogId:dialog.dialogId, method, ...request, expiresAt:new Date(dialog.expiresAt).toISOString() } });
      return;
    }
    const normalized = normalizePiEvent(record as RawPiEvent, {
      sessionId: inferredSessionId,
      toolOutputLimiter: this.toolOutputLimiter,
    });
    if (normalized.length === 0) return;
    const activeTurn = this.activeTurns.get(inferredSessionId);
    for (const event of normalized) {
      if(["turn.failed","turn.aborted","turn.indeterminate"].includes(event.type)) this.store.orphanPendingDialogs(inferredSessionId);
      const enrichedPayload: Record<string, unknown> = {
        ...event.payload,
        ...(activeTurn ? { turnId: activeTurn.turnId } : {}),
        ...(activeTurn && event.type === "turn.started"
          ? { commandId: activeTurn.turnId, deliveryMode: activeTurn.deliveryMode, message: activeTurn.message }
          : {}),
      };
      const storedEvent=this.store.appendEvent(streamId, event.type, enrichedPayload);
      const notificationKind=classifyEvent({type:event.type,sessionId:inferredSessionId,sourceEventId:storedEvent.eventId,sourceAt:storedEvent.createdAt,...(typeof enrichedPayload.errorCode==="string"?{errorCode:enrichedPayload.errorCode}:{}),...(typeof enrichedPayload.attentionState==="string"?{attentionState:enrichedPayload.attentionState}:{}),...(typeof enrichedPayload.runtimeState==="string"?{runtimeState:enrichedPayload.runtimeState}:{})});
      if(notificationKind) safePublishStatus(this.notificationService,{sessionId:inferredSessionId,kind:notificationKind,sourceEventId:storedEvent.eventId,sourceAt:storedEvent.createdAt});
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
        ...enrichedPayload,
        ...(typeof runtimeState === "string" ? { runtimeState } : {}),
        lastActivityAt: new Date(this.now()).toISOString(),
      });
    }
    if (type === "agent_settled") {
      this.activeTurns.delete(inferredSessionId);
      void this.dispatchNextFollowUp(inferredSessionId).catch(() => undefined);
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
