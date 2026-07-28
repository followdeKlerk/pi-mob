import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { COMMAND_METADATA, LIMITS, semanticCommandSha256 } from "@pi-mob/protocol-schema";
import { ControllerLeaseService, DurableCommandService, StreamService, type AdapterPort } from "./domain";
import type { BridgeRuntimePort, ConnectionContext, SubscriptionMessage, SubscriptionResult } from "./server";
import { type BridgeStore, StoreError, type LeaseMutation } from "./store";
import { WorkspaceFileError, type WorkspaceFileService, type FileReference } from "./workspace-files";
import {
  AuthoritativeProcessRegistry,
  type ProcessOutput,
  type ProcessOutputPageRequest,
} from "./process-projection";
import { GitSummaryService } from "../git/summary-service";
import { AttentionProjection } from "./attention-projection";
import type { AgentSupervisionService } from "../agents/supervision-service";
import type { MobileCatalogueService } from "../pi/mobile-catalogue-service";
import { type PlanSourceService, isPlanUnavailable, boundPlanSnapshot } from "../plans/source-service";
import { type ContextSourceService, type ContextMutationTarget, isContextUnavailable, boundContextSnapshot } from "../context/source-service";

export class RuntimeProtocolError extends Error { override readonly name = "RuntimeProtocolError"; constructor(readonly code: string, message: string) { super(message); } }
const SUMMARY_EVENT_TYPES = new Set(["session.state", "session.metadata", "controller.state", "turn.started", "turn.waiting_for_input", "turn.settled", "turn.aborted", "turn.failed", "turn.indeterminate", "queue.snapshot", "command.state", "error.event"]);
const SUMMARY_STATE_KEYS = new Set(["runtimeState", "attentionState", "policyMode", "modelSummary", "queueCount", "lastActivityAt", "controllerSummary"]);
const HISTORY_TOKEN_KIND = "session.history.page";
interface HistoryPageToken {
  readonly version: 1;
  readonly kind: typeof HISTORY_TOKEN_KIND;
  readonly hostId: string;
  readonly sessionId: string;
  readonly pageSize: number;
  readonly beforeCursor: string;
}
const SESSION_LIST_TOKEN_KIND = "session.list";
interface SessionListToken {
  readonly version: 1;
  readonly kind: typeof SESSION_LIST_TOKEN_KIND;
  readonly hostId: string;
  readonly hostGeneration: string;
  readonly sort: string;
  readonly filter: string;
  readonly query: string;
  readonly parentSessionId: string;
  readonly pageSize: number;
  readonly beforeCursor: string;
}

function canonicalDecimal(value: unknown): value is string { return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value); }

/** Preserve structural identifiers while placing one shared UTF-8 budget over
 * large historical text/arguments. Live events remain untouched. */
function boundHistoryPayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (Buffer.byteLength(JSON.stringify(payload)) <= 64 * 1024) return payload;
  const budget = { remaining: 60 * 1024 };
  const visit = (value: unknown): unknown => {
    if (typeof value === "string") {
      const bytes = Buffer.from(value);
      if (bytes.length <= budget.remaining) {
        budget.remaining -= bytes.length;
        return value;
      }
      if (budget.remaining <= 0) return "[truncated]";
      const retained = bytes.subarray(0, budget.remaining).toString("utf8");
      budget.remaining = 0;
      return `${retained}\n[truncated]`;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, visit(child)]),
      );
    }
    return value;
  };
  return visit(payload) as Record<string, unknown>;
}

/** R4 — Normalise the closed `ContextMutationTarget` from the wire
 * payload. The runtime enforces a 3-shape union so a malicious or
 * malformed target cannot smuggle private fields. */
function normaliseContextTarget(value: Record<string, unknown>): ContextMutationTarget {
  const kind = String(value.kind ?? "");
  if (kind === "file") {
    const path = String(value.path ?? "");
    const revision = typeof value.revision === "string" ? value.revision : undefined;
    const rawRanges = Array.isArray(value.ranges) ? value.ranges : undefined;
    const ranges = rawRanges
      ? rawRanges
          .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
          .map((entry) => ({
            startLine: Number(entry.startLine ?? 1),
            endLine: Number(entry.endLine ?? 1),
          }))
      : undefined;
    return revision === undefined
      ? ranges === undefined
        ? { kind: "file", path }
        : { kind: "file", path, ranges }
      : ranges === undefined
        ? { kind: "file", path, revision }
        : { kind: "file", path, ranges, revision };
  }
  if (kind === "source") {
    const sourceId = String(value.sourceId ?? "");
    const revision = typeof value.revision === "string" ? value.revision : undefined;
    return revision === undefined ? { kind: "source", sourceId } : { kind: "source", sourceId, revision };
  }
  return { kind: "all" };
}

/**
 * Runtime options. The bridge intentionally owns no policy / trust / read-only
 * machinery — Pi's normal execution model is the default. Operational knobs
 * stay focused on durable delivery, controller leases, and optional bounded
 * capabilities (file browser, processes, git summary, plans, contexts).
 */
export interface DurableRuntimeOptions {
  readonly store: BridgeStore;
  readonly adapter: AdapterPort;
  readonly bridgeVersion: string;
  readonly piVersion: string;
  readonly hostDisplayName: string;
  /** R3 — optional bounded, read-only workspace-file authority. */
  readonly workspaceFiles?: WorkspaceFileService;
  /** R5 — optional authoritative process projection registry. */
  readonly processes?: AuthoritativeProcessRegistry;
  /** R6 — optional Git summary authority (rev-parse + remote + provider). */
  readonly git?: GitSummaryService;
  /** R6 — resolves a workspace to the cwd used by Git commands. */
  readonly resolveGitCwd?: (workspaceId: string) => string | undefined;
  /** R2 — optional structured-plan authority. When omitted, the bridge
   * never advertises `plans.v1` and surfaces a truthful `plan.unavailable`
   * host-stream event so mobile renders "Plans unavailable" rather than
   * inventing steps from prose. */
  readonly plans?: PlanSourceService;
  /** R4 — optional context-inspector authority. When omitted, the bridge
   * never advertises `contexts.v1` and surfaces a truthful
   * `context.unavailable` host-stream event so the mobile inspector
   * shows explicit unavailable UX rather than fabricated state. */
  readonly contexts?: ContextSourceService;
  readonly attention?: AttentionProjection;
  readonly agents?: AgentSupervisionService;
  readonly catalogue?: MobileCatalogueService;
}

export class DurableBridgeRuntime implements BridgeRuntimePort {
  readonly bridgeVersion: string;
  readonly piVersion: string;
  readonly commands: DurableCommandService;
  readonly streams: StreamService;
  readonly leases: ControllerLeaseService;
  private readonly hostDisplayName: string;
  private readonly historyTokenSecret = randomBytes(32);
  private readonly processes: AuthoritativeProcessRegistry | null;
  private readonly git: GitSummaryService | null;
  private readonly resolveGitCwd: ((workspaceId: string) => string | undefined) | null;
  private readonly inFlightGitSummaries = new Map<string, AbortController>();
  private readonly plans: PlanSourceService | null;
  private readonly inFlightPlanRequests = new Map<string, AbortController>();
  private readonly contexts: ContextSourceService | null;
  private readonly attention: AttentionProjection | null;
  private readonly agents: AgentSupervisionService | null;
  private readonly catalogue: MobileCatalogueService | null;
  private readonly inFlightContextSnapshots = new Map<string, AbortController>();
  private readyState = false;
  constructor(readonly options: DurableRuntimeOptions) {
    this.bridgeVersion = options.bridgeVersion; this.piVersion = options.piVersion; this.hostDisplayName = options.hostDisplayName;
    this.commands = new DurableCommandService(options.store, options.adapter); this.streams = new StreamService(options.store); this.leases = new ControllerLeaseService(options.store);
    const identity = options.store.identity(); options.store.ensureStream(`host:${identity.hostId}`, "host");
    this.processes = options.processes ?? null;
    this.git = options.git ?? null;
    this.resolveGitCwd = options.resolveGitCwd ?? null;
    this.plans = options.plans ?? null;
    this.contexts = options.contexts ?? null;
    this.attention = options.attention ?? null;
    this.agents = options.agents ?? null;
    this.catalogue = options.catalogue ?? null;
  }
  async start(): Promise<{ resumed: number; indeterminate: number }> {
    const recovered = await this.commands.recover(); this.readyState = true; return recovered;
  }
  onEvent(listener: Parameters<BridgeStore["onEvent"]>[0]): () => void { return this.options.store.onEvent(listener); }
  identity(): { hostId: string; hostGeneration: string; hostDisplayName: string } { return { ...this.options.store.identity(), hostDisplayName: this.hostDisplayName }; }
  ready(): { ready: boolean; reason?: string } {
    if (!this.readyState) return { ready: false, reason: "startup recovery incomplete" };
    const health = this.options.store.health(); return health.ready ? { ready: true } : { ready: false, reason: `durable store ${health.reason ?? "unavailable"}` };
  }
  setReadyForTest(ready: boolean): void { this.readyState = ready; }
  optionalCapabilities(): readonly string[] {
    const caps: string[] = [];
    if (this.options.workspaceFiles) caps.push("files.v1");
    if (this.processes) caps.push("processes.v1");
    if (this.git) caps.push("git.v1");
    if (this.plans) caps.push("plans.v1");
    if (this.contexts) caps.push("contexts.v1");
    if (this.attention) caps.push("attention.v1");
    if (this.agents) caps.push("agents.v1");
    if (this.catalogue) caps.push("catalogue.v1");
    return caps;
  }

  subscribe(_connection: ConnectionContext, payload: Record<string, unknown>): SubscriptionResult {
    const requested = Array.isArray(payload.streams) ? payload.streams.map((value) => value as Record<string, unknown>) : [];
    const streams = requested.map((value) => ({ streamId: String(value.streamId ?? ""), detail: value.detail === "summary" ? "summary" as const : "full" as const, afterCursor: typeof value.afterCursor === "string" ? value.afterCursor : undefined }));
    const hostStreamId = `host:${this.identity().hostId}`; this.streams.validateSubscriptions(hostStreamId, streams);
    const accepted: Record<string, unknown>[] = []; const messages: SubscriptionMessage[] = [];
    for (const request of streams) {
      let sync;
      try { sync = this.streams.sync(request.streamId, request.afterCursor); }
      catch (error) {
        const code = error instanceof Error && error.name === "CursorInvalidError" ? "cursor_invalid" : "stream_not_found";
        messages.push({ type: "error", payload: { code, message: "Stream cannot be synchronized.", retryable: false, details: { streamId: request.streamId } } });
        continue;
      }
      accepted.push({ streamId: request.streamId, mode: sync.mode });
      if (sync.mode === "current") {
        if (request.streamId.startsWith("session:")) {
          const state = this.options.store.sessionState(request.streamId.slice("session:".length)) ?? {};
          const visible = request.detail === "summary" ? Object.fromEntries(Object.entries(state).filter(([key]) => SUMMARY_STATE_KEYS.has(key))) : state;
          messages.push({ type: "session.state", payload: { sessionId: request.streamId.slice("session:".length), ...visible } });
        }
        else messages.push({ type: "host.state", payload: { ready: this.ready().ready } });
      }
      if (sync.mode === "snapshot_required") {
        const snapshotId = crypto.randomUUID().toLowerCase();
        messages.push({ type: "stream.snapshot.begin", payload: { snapshotId, streamId: request.streamId, baselineCursor: sync.baseline! } });
        const snapshotParts = request.detail === "summary" && request.streamId.startsWith("session:")
          ? [{ index: 0, json: JSON.stringify(Object.fromEntries(Object.entries(this.options.store.sessionState(request.streamId.slice("session:".length)) ?? {}).filter(([key]) => SUMMARY_STATE_KEYS.has(key)))) }]
          : sync.snapshotParts!;
        snapshotParts.forEach((part, index) => messages.push({ type: "stream.snapshot.part", payload: { snapshotId, part: index, items: [part] } }));
        messages.push({ type: "stream.snapshot.end", payload: { snapshotId, partCount: snapshotParts.length } });
      }
      for (const event of sync.events) if (request.detail === "full" || SUMMARY_EVENT_TYPES.has(event.type)) messages.push({ type: event.type, payload: event.payload, eventId: event.eventId, streamId: event.streamId, cursor: event.cursor });
      messages.push({ type: "stream.sync.complete", payload: { streamId: request.streamId, currentCursor: sync.currentCursor, mode: sync.mode } });
    }
    return { streams: accepted, messages };
  }

  control(connection: ConnectionContext, type: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | void> | Record<string, unknown> | void {
    if (type === "cursor.ack") { this.streams.ack(connection.installationId, payload.cursors as Record<string,string>); return; }
    if (type === "controller.renew") {
      const leaseId = String(payload.leaseId ?? ""); const existing = this.options.store.leaseById(leaseId); if (!existing) throw new RuntimeProtocolError("stale_controller", "lease not found");
      try { const lease = this.leases.renew(existing.scopeKey, leaseId, connection.connectionId); return { leaseId: lease.leaseId, expiresAt: lease.expiresAt }; }
      catch { throw new RuntimeProtocolError("stale_controller", "lease is stale"); }
    }
    if (type === "command.current") { const command = this.options.store.command(String(payload.commandId ?? "")); if (!command) throw new RuntimeProtocolError("command_not_found", "command not found"); return { commandId: command.commandId, state: command.state }; }
    if (type === "session.history.page") return this.sessionHistoryPage(payload);
    if (type === "session.list") return this.sessionList(payload);
    if (type === "model.list") {
      if (typeof this.options.adapter.listModels !== "function") throw new RuntimeProtocolError("unsupported_capability", "adapter does not expose configured models");
      return { items: this.options.adapter.listModels(typeof payload.sessionId === "string" ? payload.sessionId : undefined).items.map((item) => ({ ...item })) };
    }
    if (type === "workspace.list") {
      if (typeof this.options.adapter.listWorkspaces !== "function") throw new RuntimeProtocolError("workspace_unavailable", "adapter does not expose a workspace listing");
      const listing = this.options.adapter.listWorkspaces();
      return { items: listing.items.map((item) => ({ ...item })) };
    }
    if (type === "workspace.search") {
      throw new RuntimeProtocolError("unsupported_capability", "workspace search is not available on this host");
    }
    if (type === "workspace.tree.page" || type === "workspace.file.search" || type === "workspace.file.content.search" || type === "workspace.file.metadata" || type === "workspace.file.read") {
      return this.workspaceFileControl(type, payload);
    }
    if (type === "process.snapshot.request") return this.processSnapshotRequest(payload);
    if (type === "process.output.page") return this.processOutputPage(payload);
    if (type === "git.summary.request") return this.gitSummaryRequest(payload);
    if (type === "git.summary.cancel") return this.gitSummaryCancel(payload);
    if (type === "attention.resolve") return this.attentionResolve(payload);
    if (type === "agent.steer" || type === "agent.cancel" || type === "agent.adopt" || type === "agent.merge") return this.agentAction(type, payload);
    if (type === "catalogue.set_enabled") return this.catalogueSetEnabled(payload);
    if (type === "plan.summary.request") return this.planSummaryRequest(payload);
    if (type === "plan.summary.cancel") return this.planSummaryCancel(payload);
    if (type === "context.snapshot.request") return this.contextSnapshotRequest(payload);
    if (type === "agent.snapshot.request") return this.agentSnapshotRequest();
    if (type === "catalogue.snapshot.request") return this.catalogueSnapshotRequest();
    if (type === "agent.transcript.page") return this.agentTranscriptPage(payload);
    if (type === "context.pin") return this.contextMutation("context.pin", payload);
    if (type === "context.unpin") return this.contextMutation("context.unpin", payload);
    if (type === "context.exclude") return this.contextMutation("context.exclude", payload);
    if (type === "context.refresh") return this.contextMutation("context.refresh", payload);
    return {};
  }

  /** R5 — `process.snapshot.request` returns the frozen closed
   * `process.snapshot.result` shape (`{ items: ProcessSnapshot[] }`) for the
   * requested session. D-039 correlation lives on the mobile side; the bridge
   * only emits the authoritative per-session replacement, capped at
   * `LIMITS.maxProcessSnapshotItems`. */
  private processSnapshotRequest(payload: Record<string, unknown>): Record<string, unknown> {
    if (!this.processes) throw new RuntimeProtocolError("unsupported_capability", "process projection is unavailable on this host");
    const sessionId = String(payload.sessionId ?? "");
    if (!sessionId) throw new RuntimeProtocolError("invalid_message", "sessionId is required");
    const result = this.processes.snapshotResult(sessionId);
    return { items: result.items.map((item) => ({ ...item })) };
  }

  /** R5 — `process.output.page` returns one bounded `ProcessOutput` payload,
   * or `undefined` when no output is available for the requested cursor /
   * pageToken. Cancellation of stale pagination is implicit: a request whose
   * `cursor`/`pageToken` no longer matches the live output returns
   * `undefined` rather than the previous page. */
  private processOutputPage(payload: Record<string, unknown>): Record<string, unknown> | void {
    if (!this.processes) throw new RuntimeProtocolError("unsupported_capability", "process projection is unavailable on this host");
    const request: ProcessOutputPageRequest = {
      sessionId: String(payload.sessionId ?? ""),
      processId: String(payload.processId ?? ""),
      revision: String(payload.revision ?? ""),
      stream: payload.stream === "stderr" ? "stderr" : "stdout",
      ...(typeof payload.cursor === "string" ? { cursor: payload.cursor } : {}),
      ...(typeof payload.pageToken === "string" ? { pageToken: payload.pageToken } : {}),
    };
    const output: ProcessOutput | undefined = this.processes.outputPage(request);
    if (!output) return;
    return { ...output };
  }

  private async catalogueSnapshotRequest(): Promise<Record<string, unknown>> {
    if (!this.catalogue) throw new RuntimeProtocolError("unsupported_capability", "Catalogue unavailable");
    return { ...await this.catalogue.snapshot() };
  }

  private async catalogueSetEnabled(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.catalogue) throw new RuntimeProtocolError("unsupported_capability", "Catalogue unavailable");
    if (payload.confirmed !== true) throw new RuntimeProtocolError("invalid_message", "catalogue toggle requires confirmation");
    try { return await this.catalogue.setEnabled(String(payload.entryId ?? ""), payload.enabled === true, String(payload.expectedRevision ?? "")); }
    catch (error) { throw new RuntimeProtocolError("invalid_state", error instanceof Error ? error.message : "catalogue toggle failed"); }
  }

  private async agentSnapshotRequest(): Promise<Record<string, unknown>> {
    if (!this.agents) throw new RuntimeProtocolError("unsupported_capability", "Agent supervision unavailable");
    return this.agents.snapshot() as Promise<Record<string, unknown>>;
  }

  private async agentTranscriptPage(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.agents) throw new RuntimeProtocolError("unsupported_capability", "Agent supervision unavailable");
    return this.agents.transcript({ agentId: String(payload.agentId ?? ""), pageSize: Number(payload.pageSize), pageToken: typeof payload.pageToken === "string" ? payload.pageToken : null }) as Promise<Record<string, unknown>>;
  }

  private async agentAction(type: "agent.steer" | "agent.cancel" | "agent.adopt" | "agent.merge", payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.agents) throw new RuntimeProtocolError("unsupported_capability", "Agent supervision unavailable");
    try {
      return await this.agents.act({ type, sessionId: String(payload.sessionId ?? ""), agentId: String(payload.agentId ?? ""), expectedRevision: String(payload.expectedRevision ?? ""), ...(typeof payload.instruction === "string" ? { instruction: payload.instruction } : {}) });
    } catch (error) {
      throw new RuntimeProtocolError("invalid_state", error instanceof Error ? error.message : "agent action failed");
    }
  }

  private attentionResolve(payload: Record<string, unknown>): Record<string, unknown> {
    if (!this.attention) throw new RuntimeProtocolError("unsupported_capability", "attention projection is unavailable on this host");
    const sessionId = String(payload.sessionId ?? "");
    const attentionId = String(payload.attentionId ?? "");
    const expectedRevision = String(payload.expectedRevision ?? "");
    if (!sessionId || !attentionId || !expectedRevision) throw new RuntimeProtocolError("invalid_message", "attention.resolve requires sessionId, attentionId, and expectedRevision");
    try {
      return this.attention.resolve({ sessionId, attentionId, expectedRevision }) as unknown as Record<string, unknown>;
    }
    catch (error) { throw new RuntimeProtocolError("invalid_state", error instanceof Error ? error.message : "attention resolution failed"); }
  }

  /** R6 — `git.summary.request` runs the bounded Git summary authority for
   * a workspace and tracks the in-flight request so `git.summary.cancel` can
   * abort it by request ID. The response is the closed `GitSummary` schema
   * (`git.summary.result`). When the service truthfully reports the surface
   * is unavailable for the workspace, the bridge throws
   * `unsupported_capability`; the schema forbids embedding `GitUnavailable`
   * inside `git.summary.result`. The control returns a Promise; the server
   * already awaits it. */
  private async gitSummaryRequest(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.git) throw new RuntimeProtocolError("unsupported_capability", "git summary is unavailable on this host");
    const workspaceId = String(payload.workspaceId ?? "");
    const requestId = String(payload.requestId ?? "");
    if (!workspaceId) throw new RuntimeProtocolError("invalid_message", "workspaceId is required");
    if (!requestId) throw new RuntimeProtocolError("invalid_message", "requestId is required");
    const cwd = this.resolveGitCwd?.(workspaceId);
    if (!cwd) throw new RuntimeProtocolError("unsupported_capability", "workspace cwd is unknown to the git service");
    const controller = new AbortController();
    this.inFlightGitSummaries.set(requestId, controller);
    try {
      const summary = await this.git.summarize(workspaceId, cwd, controller.signal);
      if ("status" in summary && summary.capability === "git-ci.v1") {
        // GitUnavailable: the schema forbids embedding this in
        // git.summary.result. The bridge surfaces truthful unavailability
        // through the host-stream `git.unavailable` event so subscribers see
        // the closed { workspaceId, capability, status } envelope, then
        // rejects the synchronous response with `unsupported_capability` so
        // the mobile coordinator can correlate the unavailable state.
        this.options.store.appendEvent(
          `host:${this.identity().hostId}`,
          "git.unavailable",
          {
            workspaceId: summary.workspaceId,
            capability: summary.capability,
            status: {
              state: summary.status.state,
              reason: summary.status.reason,
              remediation: summary.status.remediation,
            },
          },
        );
        throw new RuntimeProtocolError("unsupported_capability", summary.status.reason);
      }
      return { ...summary };
    } finally {
      const tracked = this.inFlightGitSummaries.get(requestId);
      if (tracked === controller) this.inFlightGitSummaries.delete(requestId);
    }
  }

  /** R6 — `git.summary.cancel` aborts the in-flight request recorded under
   * `targetRequestId`. No result payload is emitted; the schema declares no
   * `.result` shape. The cancel is a no-op when no matching in-flight request
   * exists. */
  private gitSummaryCancel(payload: Record<string, unknown>): Record<string, unknown> {
    const targetRequestId = String(payload.targetRequestId ?? "");
    if (!targetRequestId) throw new RuntimeProtocolError("invalid_message", "targetRequestId is required");
    const controller = this.inFlightGitSummaries.get(targetRequestId);
    if (controller) {
      controller.abort();
      this.inFlightGitSummaries.delete(targetRequestId);
      return { targetRequestId, cancelled: true };
    }
    return { targetRequestId, cancelled: false };
  }

  /** R2 — `plan.summary.request` runs the bounded structured-plan authority
   * for a session/turn and tracks the in-flight request so
   * `plan.summary.cancel` can abort it by request ID. The response is the
   * closed `PlanSnapshot` schema (`plan.snapshot.result`). When the source
   * truthfully reports the surface is unavailable, the bridge emits
   * `plan.unavailable` on the host stream and throws
   * `unsupported_capability`; the schema forbids embedding `PlanUnavailable`
   * inside `plan.snapshot.result`. The control returns a Promise; the
   * server already awaits it. */
  private async planSummaryRequest(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.plans) throw new RuntimeProtocolError("unsupported_capability", "structured plans are unavailable on this host");
    const sessionId = String(payload.sessionId ?? "");
    const turnId = String(payload.turnId ?? "");
    const requestId = String(payload.requestId ?? "");
    if (!sessionId) throw new RuntimeProtocolError("invalid_message", "sessionId is required");
    if (!turnId) throw new RuntimeProtocolError("invalid_message", "turnId is required");
    if (!requestId) throw new RuntimeProtocolError("invalid_message", "requestId is required");
    const controller = new AbortController();
    this.inFlightPlanRequests.set(requestId, controller);
    try {
      const result = await this.plans.snapshot({ sessionId, turnId, signal: controller.signal });
      if (isPlanUnavailable(result)) {
        // PlanUnavailable: surface it on the host stream then reject the
        // synchronous response. Mirror R6 so mobile correlates the throw
        // with the stream event by capability.
        this.options.store.appendEvent(
          `host:${this.identity().hostId}`,
          "plan.unavailable",
          { capability: result.capability, status: result.status },
        );
        throw new RuntimeProtocolError("unsupported_capability", result.status.reason);
      }
      return { ...boundPlanSnapshot(result) };
    } finally {
      const tracked = this.inFlightPlanRequests.get(requestId);
      if (tracked === controller) this.inFlightPlanRequests.delete(requestId);
    }
  }

  /** R2 — `plan.summary.cancel` aborts the in-flight request recorded under
   * `targetRequestId`. The cancel is a no-op when no matching in-flight
   * request exists. Mirrors R6 cancellation shape exactly. */
  private planSummaryCancel(payload: Record<string, unknown>): Record<string, unknown> {
    const targetRequestId = String(payload.targetRequestId ?? "");
    if (!targetRequestId) throw new RuntimeProtocolError("invalid_message", "targetRequestId is required");
    const controller = this.inFlightPlanRequests.get(targetRequestId);
    if (controller) {
      controller.abort();
      this.inFlightPlanRequests.delete(targetRequestId);
      return { targetRequestId, cancelled: true };
    }
    return { targetRequestId, cancelled: false };

  }

  /** R4 — `context.snapshot.request` runs the bounded context-inspector
   * authority for one session and tracks the in-flight request so the
   * bridge can cancel it. The response is the closed `ContextSnapshot`
   * schema (`context.snapshot.result`). When the service truthfully
   * reports the surface is unavailable, the bridge emits
   * `context.unavailable` on the host stream and throws
   * `unsupported_capability`; the schema forbids embedding
   * `ContextUnavailable` inside `context.snapshot.result`. */
  private async contextSnapshotRequest(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.contexts) throw new RuntimeProtocolError("unsupported_capability", "context inspector is unavailable on this host");
    const sessionId = String(payload.sessionId ?? "");
    const requestId = String(payload.requestId ?? "");
    if (!sessionId) throw new RuntimeProtocolError("invalid_message", "sessionId is required");
    if (!requestId) throw new RuntimeProtocolError("invalid_message", "requestId is required");
    const controller = new AbortController();
    this.inFlightContextSnapshots.set(requestId, controller);
    try {
      const result = await this.contexts.snapshot({ sessionId, signal: controller.signal });
      if (isContextUnavailable(result)) {
        // R4 — `context.unavailable` is session-scoped per
        // EVENT_STREAM_OWNERSHIP (docs/PROTOCOL.md §14 / D-037); the host
        // has no host-scoped slot for per-session context truth.
        // `ensureSession` is idempotent and repairs the rows the
        // session-stream foreign key expects.
        this.options.store.ensureSession(result.sessionId, { runtimeState: "idle" });
        this.options.store.ensureStream(
          `session:${result.sessionId}`,
          "session",
          result.sessionId,
        );
        this.options.store.appendEvent(
          `session:${result.sessionId}`,
          "context.unavailable",
          { sessionId: result.sessionId, capability: result.capability, status: result.status },
        );
        throw new RuntimeProtocolError("unsupported_capability", result.status.reason);
      }
      return { ...boundContextSnapshot(result) };
    } finally {
      const tracked = this.inFlightContextSnapshots.get(requestId);
      if (tracked === controller) this.inFlightContextSnapshots.delete(requestId);
    }
  }

  /** R4 — `context.pin` / `context.unpin` / `context.exclude` /
   * `context.refresh` are durable session commands per D-037. The
   * bridge forwards them to the injected service; rejection surfaces
   * as `unsupported_capability` so a stale tap never silently mutates
   * the authoritative snapshot. */
  private async contextMutation(
    type: "context.pin" | "context.unpin" | "context.exclude" | "context.refresh",
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this.contexts) throw new RuntimeProtocolError("unsupported_capability", "context inspector is unavailable on this host");
    const sessionId = String(payload.sessionId ?? "");
    const expectedRevision = String(payload.expectedRevision ?? "");
    const targetValue = payload.target;
    if (!sessionId) throw new RuntimeProtocolError("invalid_message", "sessionId is required");
    if (!expectedRevision) throw new RuntimeProtocolError("invalid_message", "expectedRevision is required");
    if (!targetValue || typeof targetValue !== "object") throw new RuntimeProtocolError("invalid_message", "target is required");
    const target = normaliseContextTarget(targetValue as Record<string, unknown>);
    const result = await this.contexts.mutate({ sessionId, type, target, expectedRevision });
    if (!result.accepted) {
      throw new RuntimeProtocolError("unsupported_capability", result.rejectionReason ?? "context mutation rejected");
    }
    return { sessionId, type, accepted: true, revision: result.revision };
  }

    /** Routes all R3 reads through the only filesystem authority. */
  private workspaceFileControl(type: string, payload: Record<string, unknown>): Record<string, unknown> {
    const files = this.options.workspaceFiles;
    if (!files) throw new RuntimeProtocolError("unsupported_capability", "workspace file browsing is unavailable on this host");
    try {
      const workspaceId = String(payload.workspaceId ?? "");
      if (type === "workspace.tree.page") return { ...files.treePage({
        workspaceId,
        ...(typeof payload.path === "string" ? { path: payload.path } : {}),
        ...(typeof payload.rootRevision === "string" ? { rootRevision: payload.rootRevision } : {}),
        pageSize: Number(payload.pageSize),
        ...(typeof payload.pageToken === "string" || payload.pageToken === null ? { pageToken: payload.pageToken } : {}),
      }) };
      if (type === "workspace.file.search") return { ...files.filenameSearch({
        workspaceId,
        query: String(payload.query ?? ""),
        ...(typeof payload.path === "string" ? { path: payload.path } : {}),
        ...(typeof payload.pageSize === "number" ? { pageSize: payload.pageSize } : {}),
        ...(typeof payload.pageToken === "string" || payload.pageToken === null ? { pageToken: payload.pageToken } : {}),
      }) };
      if (type === "workspace.file.content.search") return { ...files.contentSearch({
        workspaceId,
        query: String(payload.query ?? ""),
        ...(typeof payload.path === "string" ? { path: payload.path } : {}),
        ...(typeof payload.pageSize === "number" ? { pageSize: payload.pageSize } : {}),
        ...(typeof payload.pageToken === "string" || payload.pageToken === null ? { pageToken: payload.pageToken } : {}),
      }) };
      if (type === "workspace.file.metadata") return files.metadata({ workspaceId, path: String(payload.path ?? ""), ...(typeof payload.expectedRevision === "string" ? { expectedRevision: payload.expectedRevision } : {}) });
      return files.read({ workspaceId, path: String(payload.path ?? ""), rangeStart: Number(payload.rangeStart), rangeEnd: Number(payload.rangeEnd), ...(typeof payload.expectedRevision === "string" ? { expectedRevision: payload.expectedRevision } : {}) });
    } catch (error) {
      if (error instanceof WorkspaceFileError) throw new RuntimeProtocolError(error.code, error.message);
      throw error;
    }
  }

  private sessionList(payload: Record<string, unknown>): Record<string, unknown> {
    const pageSize = payload.pageSize;
    if (!Number.isInteger(pageSize) || (pageSize as number) < 1 || (pageSize as number) > 100) {
      throw new RuntimeProtocolError("invalid_message", "pageSize must be an integer from 1 through 100");
    }
    const sort = typeof payload.sort === "string" ? payload.sort : "activity";
    const filterRaw = typeof payload.filter === "string" ? payload.filter : "all";
    const query = typeof payload.query === "string" ? payload.query : "";
    const parentSessionId = typeof payload.parentSessionId === "string" ? payload.parentSessionId : "";
    const identity = this.identity();
    const rawToken = payload.pageToken;
    let beforeCursor: string | null = null;
    if (rawToken !== null && rawToken !== undefined) {
      if (typeof rawToken !== "string") throw new RuntimeProtocolError("invalid_message", "page token must be a string or null");
      const decoded = this.decodeSessionListToken(rawToken);
      if (decoded.sort !== sort) throw new RuntimeProtocolError("invalid_message", "page token is not bound to this query");
      if (decoded.filter !== filterRaw) throw new RuntimeProtocolError("invalid_message", "page token is not bound to this query");
      if (decoded.query !== query) throw new RuntimeProtocolError("invalid_message", "page token is not bound to this query");
      if (decoded.parentSessionId !== parentSessionId) throw new RuntimeProtocolError("invalid_message", "page token is not bound to this tree parent");
      if (decoded.pageSize !== pageSize) throw new RuntimeProtocolError("invalid_message", "page token is not bound to this query");
      beforeCursor = decoded.beforeCursor;
    }
    let page;
    try {
      page = this.options.store.listSessionSummaries({
        filter: filterRaw,
        query: query || null,
        sort,
        pageSize: pageSize as number,
        beforeCursor,
        ...(parentSessionId ? { parentSessionId } : {}),
      });
    } catch (error) {
      if (error instanceof StoreError && error.code === "conflict") throw new RuntimeProtocolError("invalid_message", error.message);
      throw error;
    }
    return {
      items: page.items.map((item) => ({ ...item })),
      snapshotRevision: page.snapshotRevision,
      ...(page.nextBeforeCursor !== undefined
        ? { nextPageToken: this.encodeSessionListToken({
          version: 1,
          kind: SESSION_LIST_TOKEN_KIND,
          hostId: identity.hostId,
          hostGeneration: identity.hostGeneration,
          sort,
          filter: filterRaw,
          query,
          parentSessionId,
          pageSize: pageSize as number,
          beforeCursor: page.nextBeforeCursor,
        }) }
        : {}),
    };
  }

  private sessionHistoryPage(payload: Record<string, unknown>): Record<string, unknown> {
    const sessionId = String(payload.sessionId ?? "");
    const pageSize = payload.pageSize;
    if (!Number.isInteger(pageSize) || (pageSize as number) < 1 || (pageSize as number) > 100) {
      throw new RuntimeProtocolError("invalid_message", "pageSize must be an integer from 1 through 100");
    }
    if (!this.options.store.sessionExists(sessionId)) throw new RuntimeProtocolError("session_not_found", "session not found");
    const rawToken = payload.pageToken;
    let beforeCursor: string | undefined;
    if (rawToken !== null && rawToken !== undefined) {
      if (typeof rawToken !== "string") throw new RuntimeProtocolError("invalid_message", "page token must be a string or null");
      beforeCursor = this.decodeHistoryPageToken(rawToken, sessionId, pageSize as number).beforeCursor;
    }
    let page;
    try { page = this.options.store.pageSessionEvents(sessionId, pageSize as number, beforeCursor); }
    catch (error) {
      if (error instanceof StoreError && error.code === "not_found") throw new RuntimeProtocolError("session_not_found", "session not found");
      throw error;
    }
    // History payloads contain completed assistant/tool text rather than the
    // small live deltas. Bound both each event and the complete response by
    // bytes so a page can never exceed the WebSocket JSON frame limit.
    const candidates = page.items.map((event) => ({
      eventId: event.eventId,
      streamId: event.streamId,
      cursor: event.cursor,
      type: event.type,
      payload: boundHistoryPayload(event.payload),
      createdAt: event.createdAt,
    }));
    const selectedNewestFirst: typeof candidates = [];
    let retainedBytes = 0;
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = candidates[index]!;
      const bytes = Buffer.byteLength(JSON.stringify(candidate));
      if (selectedNewestFirst.length > 0 && retainedBytes + bytes > 700 * 1024) break;
      selectedNewestFirst.push(candidate);
      retainedBytes += bytes;
    }
    const items = selectedNewestFirst.reverse();
    const trimmed = items.length < candidates.length;
    const nextBeforeCursor = (trimmed || page.nextBeforeCursor)
      ? items[0]?.cursor
      : undefined;
    return {
      items,
      snapshotRevision: page.snapshotRevision,
      ...(nextBeforeCursor ? { nextPageToken: this.encodeHistoryPageToken({
        version: 1,
        kind: HISTORY_TOKEN_KIND,
        hostId: this.identity().hostId,
        sessionId,
        pageSize: pageSize as number,
        beforeCursor: nextBeforeCursor,
      }) } : {}),
    };
  }

  private encodeHistoryPageToken(value: HistoryPageToken): string {
    const body = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.historyTokenSecret).update(body, "utf8").digest("base64url");
    return `${body}.${signature}`;
  }

  private encodeSessionListToken(value: SessionListToken): string {
    const body = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.historyTokenSecret).update(body, "utf8").digest("base64url");
    return `${body}.${signature}`;
  }

  private decodeSessionListToken(token: string): SessionListToken {
    try {
      if (token.length === 0 || token.length > 4096) throw new Error("invalid token length");
      const parts = token.split(".");
      if (parts.length !== 2 || !parts[0] || !parts[1] || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error("invalid token shape");
      const expected = createHmac("sha256", this.historyTokenSecret).update(parts[0], "utf8").digest();
      const actual = Buffer.from(parts[1], "base64url");
      if (actual.toString("base64url") !== parts[1] || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("invalid token signature");
      const encodedBody = Buffer.from(parts[0], "base64url");
      if (encodedBody.toString("base64url") !== parts[0]) throw new Error("invalid token encoding");
      const parsed = JSON.parse(encodedBody.toString("utf8")) as Partial<SessionListToken>;
      if (parsed.version !== 1 || parsed.kind !== SESSION_LIST_TOKEN_KIND) throw new Error("token kind mismatch");
      const identity = this.identity();
      if (parsed.hostId !== identity.hostId || parsed.hostGeneration !== identity.hostGeneration) throw new Error("page token is not bound to the current host generation");
      if (typeof parsed.sort !== "string" || typeof parsed.filter !== "string" || typeof parsed.query !== "string" || typeof parsed.parentSessionId !== "string" || typeof parsed.pageSize !== "number" || typeof parsed.beforeCursor !== "string" || !canonicalDecimal(parsed.beforeCursor)) throw new Error("page token shape invalid");
      return parsed as SessionListToken;
    } catch {
      throw new RuntimeProtocolError("invalid_message", "page token is invalid or does not match the session list query");
    }
  }

  private decodeHistoryPageToken(token: string, sessionId: string, pageSize: number): HistoryPageToken {
    try {
      if (token.length === 0 || token.length > 4096) throw new Error("invalid token length");
      const parts = token.split(".");
      if (parts.length !== 2 || !parts[0] || !parts[1] || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error("invalid token shape");
      const expected = createHmac("sha256", this.historyTokenSecret).update(parts[0], "utf8").digest();
      const actual = Buffer.from(parts[1], "base64url");
      if (actual.toString("base64url") !== parts[1] || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("invalid token signature");
      const encodedBody = Buffer.from(parts[0], "base64url");
      if (encodedBody.toString("base64url") !== parts[0]) throw new Error("invalid token encoding");
      const parsed = JSON.parse(encodedBody.toString("utf8")) as Partial<HistoryPageToken>;
      const hostId = this.identity().hostId;
      if (parsed.version !== 1 || parsed.kind !== HISTORY_TOKEN_KIND || parsed.hostId !== hostId || parsed.sessionId !== sessionId || parsed.pageSize !== pageSize || !canonicalDecimal(parsed.beforeCursor)) {
        throw new Error("page token is not bound to this query");
      }
      return parsed as HistoryPageToken;
    } catch {
      throw new RuntimeProtocolError("invalid_message", "page token is invalid or does not match the history query");
    }
  }

  command(connection: ConnectionContext, message: Record<string, unknown>): Record<string, unknown> {
    const type = String(message.type); const payload = message.payload as Record<string, unknown>; const commandId = String(message.commandId ?? "");
    const metadata = COMMAND_METADATA.find((item) => item.type === type); if (!metadata) throw new RuntimeProtocolError("invalid_state", "unsupported command");
    const existing = this.options.store.command(commandId);
    if (existing) {
      const hash = semanticCommandSha256({ type, payload });
      if (hash !== existing.semanticHash) throw new StoreError("conflict", "idempotency conflict");
      const duplicate = this.commands.submit({ commandId, type, payload, scopeKey: existing.scopeKey, streamId: existing.streamId });
      return { state: duplicate.receipt.state, duplicate: true };
    }
    const admission = this.options.adapter.admission?.();
    if (admission && !admission.accepting) {
      throw new RuntimeProtocolError(admission.reason === "host_draining" ? "host_draining" : "host_not_ready", "host is not accepting commands");
    }
    const requestedSession = typeof payload.sessionId === "string" ? payload.sessionId : null;
    const sessionId = metadata.scope === "session" ? requestedSession : metadata.scope === "host-or-session" && payload.scope === "session" ? requestedSession : null;
    if ((metadata.scope === "session" || payload.scope === "session") && !sessionId) throw new RuntimeProtocolError("session_not_found", "session ID is required");
    if (sessionId && !this.options.store.sessionExists(sessionId)) throw new RuntimeProtocolError("session_not_found", "session does not exist");
    if (sessionId && type === "prompt.submit" &&
        this.options.store.sessionState(sessionId)?.runtimeState === "indeterminate") {
      throw new RuntimeProtocolError("invalid_state", "indeterminate session requires explicit activation");
    }

    const identity = this.identity(); const streamId = sessionId ? `session:${sessionId}` : `host:${identity.hostId}`; const scopeKey = streamId;
    if (metadata.requiresLeaseId) {
      try { this.leases.assertController(scopeKey, String(message.leaseId ?? ""), connection.connectionId); }
      catch { throw new RuntimeProtocolError("stale_controller", "controller lease is stale"); }
    }
    const leaseMutation: LeaseMutation | undefined = type === "controller.acquire" || type === "controller.takeover"
      ? { action: type === "controller.takeover" ? "takeover" : "acquire", scopeKey, installationId: connection.installationId, connectionId: connection.connectionId }
      : type === "controller.release"
      ? { action: "release", scopeKey, installationId: connection.installationId, connectionId: connection.connectionId }
      : undefined;
    if (!this.options.store.command(commandId)) {
      try {
        if (type === "prompt.submit") this.validatePromptFileReferences(payload);
        this.options.adapter.validateCommand?.(type, payload); }
      catch (error) {
        if ((error as Error).message === "attachment_unavailable") {
          throw new RuntimeProtocolError("attachment_unavailable", "one or more attachments are unavailable");
        }
        if ((error as Error).message === "queue_full" || (error instanceof StoreError && error.code === "full")) {
          throw new RuntimeProtocolError("queue_full", "follow-up queue is full");
        }
        if ((error as Error).message === "invalid_state") throw new RuntimeProtocolError("invalid_state", "command is no longer valid");
        if ((error as Error).message === "queue_item_not_found") throw new RuntimeProtocolError("queue_item_not_found", "queued follow-up was not found");
        throw error;
      }
    }
    let submission;
    try { submission = this.commands.submit({ commandId, type, payload, scopeKey, streamId, ...(leaseMutation ? { leaseMutation } : {}) }); }
    catch (error) {
      if (error instanceof StoreError && error.code === "conflict" && (type === "controller.acquire" || type === "controller.takeover")) throw new RuntimeProtocolError("controller_conflict", "controller is already held");
      if (error instanceof StoreError && error.code === "conflict" && type === "controller.release") throw new RuntimeProtocolError("stale_controller", "controller release is not authorized");
      throw error;
    }

    if (!submission.receipt.duplicate) this.options.adapter.commandAccepted?.(type, payload, commandId);
    void submission.completion;
    return { state: submission.receipt.state, duplicate: submission.receipt.duplicate };
  }
  /** Enforces D-037's cross-list attachment budget and revalidates every file at send time. */
  private validatePromptFileReferences(payload: Record<string, unknown>): void {
    const attachmentIds = Array.isArray(payload.attachmentIds) ? payload.attachmentIds : [];
    const fileRefs = Array.isArray(payload.fileRefs) ? payload.fileRefs : [];
    if (attachmentIds.length + fileRefs.length > LIMITS.maxAttachmentsPerPrompt) {
      throw new RuntimeProtocolError("invalid_state", "attachments and file references share a four-item limit");
    }
    if (fileRefs.length > 0 && !this.options.workspaceFiles) {
      throw new RuntimeProtocolError("unsupported_capability", "workspace file references are unavailable on this host");
    }
    for (const reference of fileRefs) {
      if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
        throw new RuntimeProtocolError("invalid_message", "file reference is invalid");
      }
      try { this.options.workspaceFiles!.validateReference(reference as FileReference); }
      catch (error) {
        if (error instanceof WorkspaceFileError) throw new RuntimeProtocolError(error.code, error.message);
        throw error;
      }
    }
  }

  disconnected(connection: ConnectionContext): void { this.options.store.disconnectConnection(connection.connectionId); }
  async recover(): Promise<{ resumed: number; indeterminate: number }> { return this.commands.recover(); }
}
