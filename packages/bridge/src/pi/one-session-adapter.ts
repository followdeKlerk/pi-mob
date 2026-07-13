/**
 * One-session Pi adapter for the M5 diagnostic bridge.
 *
 * This adapter implements {@link AdapterPort} for a deployment that
 * runs a single configured workspace and a single Pi RPC subprocess.
 * It is intentionally narrow: only the M5 surface
 * (`workspace.list`, `session.create`, `prompt.submit`, `turn.abort`)
 * is wired to the Pi subprocess, and Pi notifications are normalised
 * into session events that are appended to the corresponding session
 * stream of the {@link BridgeStore}.
 *
 * Two design notes matter for the rest of the bridge:
 *
 *   1. The adapter depends only on the structural shape of the Pi RPC
 *      transport (`PiRpcClient`). Production uses {@link RpcProcess};
 *      tests substitute an in-memory fake that records requests and
 *      emits scripted notifications. No real Pi binary is needed for
 *      adapter-level proofs.
 *
 *   2. Notifications carry the source `sessionId` either on the raw
 *      record (Pi attaches it for `agent_start`, `session_*`, etc.) or
 *      are stamped from the most recent prompt/abort target session
 *      via {@link OneSessionPiAdapter.lastActiveSessionId}. The
 *      single-workspace model means at most one session is "active"
 *      between a `session.create` and the next one.
 */

import type { StoredCommand } from "../core/store";
import type { BridgeStore } from "../core/store";
import { IndeterminateDispatchError } from "../core/domain";
import { normalizePiEvent, ToolOutputLimiter } from "./normalize";
import type { NormalizedPiEvent, RawPiEvent } from "./types";

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

export interface OneSessionAdapterOptions {
  readonly store: BridgeStore;
  readonly rpc: PiRpcClient;
  readonly workspace: OneSessionWorkspaceConfig;
  /** Override `Date.now` for deterministic tests. */
  readonly now?: () => number;
  /** UUID generator; defaults to `crypto.randomUUID`. */
  readonly newSessionId?: () => string;
}

// ---------------- Adapter ----------------

const SUMMARY_EVENT_TYPES = new Set<NormalizedPiEvent["type"]>([
  "session.state", "session.metadata", "controller.state",
  "turn.started", "turn.waiting_for_input", "turn.settled",
  "turn.aborted", "turn.failed", "turn.indeterminate",
  "queue.snapshot", "command.state", "error.event",
]);

export class OneSessionPiAdapter {
  readonly store: BridgeStore;
  readonly rpc: PiRpcClient;
  readonly workspace: OneSessionWorkspaceConfig;
  private readonly now: () => number;
  private readonly newSessionId: () => string;
  private readonly hostStream: string;
  private readonly sessionById = new Map<string, string>();
  private readonly toolOutputLimiter = new ToolOutputLimiter();
  private activeSessionId: string | null = null;
  private detach: () => void;

  constructor(options: OneSessionAdapterOptions) {
    this.store = options.store;
    this.rpc = options.rpc;
    this.workspace = options.workspace;
    this.now = options.now ?? Date.now;
    this.newSessionId = options.newSessionId ?? (() => crypto.randomUUID().toLowerCase());
    const identity = this.store.identity();
    this.hostStream = `host:${identity.hostId}`;
    const existing = this.store.sessionStates()[0];
    const existingId = typeof existing?.sessionId === "string" ? existing.sessionId : null;
    if (existingId) {
      this.sessionById.set(existingId, this.workspace.rootPath);
      this.activeSessionId = existingId;
    }
    this.detach = this.rpc.on("notification", (raw) => this.handleNotification(raw));
  }

  /** Detach from RPC notifications. Idempotent. */
  close(): void {
    this.detach();
    this.detach = () => undefined;
  }

  /** Returns the single configured workspace for `workspace.list`. */
  listWorkspaces(): WorkspaceListing {
    const sessionCount = [...this.sessionById.keys()].length;
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
          sessionCount,
        },
      ],
    };
  }

  /** Dispatch a single command. Implements the AdapterPort contract. */
  async dispatch(command: StoredCommand): Promise<void> {
    switch (command.type) {
      case "session.create":
        return this.handleSessionCreate(command);
      case "prompt.submit":
        return this.handlePromptSubmit(command);
      case "turn.abort":
        return this.handleTurnAbort(command);
      case "session.activate":
        return this.handleManualRetry(command);
      default:
        // Session-scoped metadata commands (rename, policy.set, ...) are
        // local-only at this checkpoint; no Pi RPC call is required.
        return;
    }
  }

  admission(): { accepting: boolean; reason?: string } {
    return this.rpc.isDraining?.()
      ? { accepting: false, reason: "host_draining" }
      : { accepting: true };
  }

  /** Internal hook for tests/diagnostics. */
  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  // ---------------- Internals ----------------

  private handleSessionCreate(command: StoredCommand): void {
    const payload = (command.payload ?? {}) as {
      workspaceId?: string;
      policyMode?: WorkspacePolicyMode;
      name?: string;
    };
    const workspaceId = typeof payload.workspaceId === "string" && payload.workspaceId.length > 0
      ? payload.workspaceId
      : this.workspace.workspaceId;
    const policyMode = payload.policyMode ?? this.workspace.policyMode;
    const existing = this.store.sessionStates()[0];
    if (existing && typeof existing.sessionId === "string") {
      // M5 is deliberately one-session. A repeated create command re-opens
      // the sole durable diagnostic session instead of creating another Pi
      // identity that could not be represented by this one-process adapter.
      this.activeSessionId = existing.sessionId;
      this.store.appendEvent(this.hostStream, "session.summary", existing);
      return;
    }
    const sessionId = this.newSessionId();
    const createdAt = new Date(this.now()).toISOString();
    const summary = {
      sessionId,
      workspaceId,
      displayName: this.workspace.displayName,
      name: typeof payload.name === "string" ? payload.name : null,
      policyMode,
      runtimeState: "idle",
      attentionState: "ready",
      queueCount: 0,
      modelSummary: null,
      createdAt,
      lastActivityAt: createdAt,
    };
    this.store.ensureSession(sessionId, summary);
    this.store.ensureStream(`session:${sessionId}`, "session", sessionId);
    this.sessionById.set(sessionId, this.workspace.rootPath);
    this.activeSessionId = sessionId;
    // Host-stream summary so mobile clients learn the new session.
    this.store.appendEvent(this.hostStream, "session.summary", {
      sessionId,
      workspaceId,
      runtimeState: "idle",
      attentionState: "ready",
      queueCount: 0,
      modelSummary: null,
      policyMode,
      name: summary.name,
      createdAt,
    });
    this.store.appendEvent(`session:${sessionId}`, "session.metadata", {
      sessionId,
      workspaceId,
      name: summary.name,
      policyMode,
      runtimeState: "idle",
      attentionState: "ready",
      createdAt,
    });
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
    this.activeSessionId = payload.sessionId;
    this.rpc.markDispatchStart?.();
    const method: "prompt" | "steer" | "follow_up" =
      payload.deliveryMode === "steer" ? "steer" :
      payload.deliveryMode === "follow_up" ? "follow_up" : "prompt";
    try {
      await this.rpc.request({
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

  private async handleManualRetry(command: StoredCommand): Promise<void> {
    const sessionId = String(command.payload.sessionId ?? "");
    if (!this.store.sessionExists(sessionId)) throw new Error("session.activate session not found");
    if (!this.rpc.manualRetry) throw new Error("manual retry is unavailable");
    await this.rpc.manualRetry();
    const prior = this.store.sessionState(sessionId) ?? {};
    this.store.updateSessionState(sessionId, {
      ...prior,
      runtimeState: "idle",
      attentionState: "ready",
    });
    this.store.appendEvent(`session:${sessionId}`, "session.state", {
      sessionId,
      runtimeState: "idle",
      attentionState: "ready",
      manualRetry: true,
    });
  }

  private async handleTurnAbort(command: StoredCommand): Promise<void> {
    const payload = (command.payload ?? {}) as { sessionId?: string };
    if (typeof payload.sessionId !== "string") throw new Error("turn.abort requires sessionId");
    if (!this.store.sessionExists(payload.sessionId)) throw new Error("turn.abort session not found");
    this.activeSessionId = payload.sessionId;
    await this.rpc.request({ id: command.commandId, method: "abort" });
  }

  private handleNotification(raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    const record = raw as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : null;
    if (!type) return;
    const inferredSessionId = this.resolveNotificationSessionId(record);
    if (!inferredSessionId) return;
    const normalized = normalizePiEvent(record as RawPiEvent, {
      sessionId: inferredSessionId,
      toolOutputLimiter: this.toolOutputLimiter,
    });
    if (normalized.length === 0) return;
    const streamId = `session:${inferredSessionId}`;
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
    if (this.activeSessionId && this.store.sessionExists(this.activeSessionId)) return this.activeSessionId;
    const onlySession = [...this.sessionById.keys()][0];
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
