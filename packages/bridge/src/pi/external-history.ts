import { readFileSync, statSync } from "node:fs";
import {
  parseSessionEntries,
  type SessionEntry,
  type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import { BridgeStore, MAX_EVENT_PAGE_SIZE, type StoredEvent } from "../core/store";
import { RecipeActivityProjector, type RecipeActivity } from "./recipe-activity";
import { CanonicalSessionStore, type CanonicalSessionEventRecord } from "../session-events/canonical-session-store";
import type { CanonicalEventType } from "../session-events/canonical-event";

const MAX_TEXT_BYTES = 48 * 1024;
const HISTORY_SCAN_PAGE_SIZE = Math.min(32, MAX_EVENT_PAGE_SIZE);

/** Iterate a stable stream prefix without materialising the whole journal. */
function forEachStoredEvent(store: BridgeStore, streamId: string, visit: (event: StoredEvent) => void): void {
  let afterCursor = "0";
  let throughCursor: string | undefined;
  while (true) {
    const page = store.pageEvents(streamId, HISTORY_SCAN_PAGE_SIZE, afterCursor, throughCursor);
    throughCursor ??= page.snapshotRevision;
    for (const event of page.items) visit(event);
    if (!page.nextAfterCursor) return;
    afterCursor = page.nextAfterCursor;
  }
}

/** Adapt a committed canonical record for the legacy recipe projector only. */
export function canonicalProjectionEvent(event: CanonicalSessionEventRecord): StoredEvent {
  return {
    eventId: event.eventId,
    streamId: `session:${event.sessionId}`,
    cursor: String(event.sequence),
    type: event.eventType,
    payload: event.payload,
    createdAt: event.createdAt,
  };
}

/** Walk the authoritative session journal selected by the caller. The
 * production reconciliation path reads CanonicalSessionStore; the optional
 * legacy path continues to inspect BridgeStore.events. */
function forEachDurableSessionEvent(
  store: BridgeStore,
  sessionId: string,
  canonical: CanonicalSessionStore | undefined,
  visit: (event: StoredEvent) => void,
): void {
  if (canonical) {
    let after = 0;
    while (true) {
      const page = canonical.readAfter(sessionId, after, 4096);
      for (const event of page) visit(canonicalProjectionEvent(event));
      if (page.length < 4096) return;
      after = page.at(-1)!.sequence;
    }
  }
  forEachStoredEvent(store, `session:${sessionId}`, visit);
}

function boundedText(value: string): string {
  const bytes = Buffer.from(value);
  if (bytes.length <= MAX_TEXT_BYTES) return value;
  return `${bytes.subarray(0, MAX_TEXT_BYTES).toString("utf8")}\n\n[Historical content truncated by pi-mob]`;
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (!part || typeof part !== "object") return "";
    const value = part as Record<string, unknown>;
    return value.type === "text" && typeof value.text === "string" ? value.text : "";
  }).filter(Boolean).join("\n");
}

function activeBranch(entries: SessionEntry[]): SessionEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const branch: SessionEntry[] = [];
  let entry: SessionEntry | undefined = entries.at(-1);
  const seen = new Set<string>();
  while (entry && !seen.has(entry.id)) {
    seen.add(entry.id);
    branch.push(entry);
    entry = entry.parentId ? byId.get(entry.parentId) : undefined;
  }
  return branch.reverse();
}

function timestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return value;
  return undefined;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function recipeKey(payload: Readonly<Record<string, unknown>>): string | null {
  const sessionId = payload.sessionId;
  const turnId = payload.turnId;
  const activityId = payload.activityId ?? payload.toolCallId ?? payload.contentBlockId;
  return typeof sessionId === "string" && typeof turnId === "string" && typeof activityId === "string"
    ? `${sessionId}\u0000${turnId}\u0000${activityId}`
    : null;
}

function projectionFields(type: string, payload: Readonly<Record<string, unknown>>): Record<string, unknown> {
  if (type === "tool.started") return { toolName: payload.toolName, arguments: payload.arguments };
  if (type === "tool.output") return {
    output: payload.output,
    retainedBytes: payload.retainedBytes,
    totalBytes: payload.totalBytes,
    isTruncated: payload.isTruncated,
    digest: payload.digest,
  };
  if (type === "tool.completed" || type === "tool.failed" || type === "tool.cancelled") return {
    toolName: payload.toolName,
    result: payload.result,
    output: payload.output,
    errorInfo: payload.errorInfo,
    retainedBytes: payload.retainedBytes,
    totalBytes: payload.totalBytes,
    isTruncated: payload.isTruncated,
    digest: payload.digest,
  };
  // Raw reasoning text is intentionally absent. The current Pi contract has
  // no provider-displayable summary, so only lifecycle identity is projected.
  return {};
}

function occurrence(event: StoredEvent): string | number {
  const payloadTime = timestamp(event.payload.timestamp)
    ?? timestamp(event.payload.startedAt)
    ?? timestamp(event.payload.finishedAt);
  return payloadTime ?? event.createdAt;
}

/**
 * Durable adapter around {@link RecipeActivityProjector}.
 *
 * Source lifecycle events and their derived `recipe.activity` snapshot are
 * appended in one BridgeStore transaction. Store listeners therefore cannot
 * publish either event until both writes commit. Rehydrating from the journal
 * restores turn/tool scope and semantic source fingerprints, so a replayed or
 * history-overlapping lifecycle update cannot create another recipe update.
 */
export class DurableRecipeActivityProjection {
  private projector: RecipeActivityProjector;
  private readonly published = new Map<string, string>();
  private readonly backfillPending = new Set<string>();
  private readonly seen = new Set<string>();
  private readonly terminal = new Set<string>();
  private readonly toolTurns = new Map<string, string>();
  private activeTurnId: string | null = null;

  constructor(
    private readonly store: BridgeStore,
    private readonly sessionId: string,
  ) {
    this.projector = new RecipeActivityProjector({ sessionId });
    this.hydrate();
  }

  /** Append an authoritative normalized event and any changed recipe snapshot. */
  append(type: string, payload: Record<string, unknown>): StoredEvent {
    let stored: StoredEvent | undefined;
    try {
      this.store.transaction(() => {
        stored = this.store.appendEvent(`session:${this.sessionId}`, type, payload);
        this.apply(stored!);
        this.appendChanged();
      });
    } catch (error) {
      // The projector is in-memory. Rebuild it after a rolled-back write so a
      // subsequent retry is based only on durable authority.
      this.resetAndHydrate();
      throw error;
    }
    return stored!;
  }

  /**
   * Apply a previously committed source event and publish derived
   * `recipe.activity` projections. Use this entry point when the
   * caller has already persisted the source event through another
   * authoritative path (for example, the
   * {@link CanonicalEventStore}). The projection never re-writes the
   * source event; it only updates the in-memory projector and writes
   * the resulting derived events.
   *
   * Errors during publish rebuild the in-memory projector from the
   * durable journal so a subsequent retry cannot drift from the
   * authoritative history.
   */
  applyAndPublish(storedEvent: StoredEvent): void {
    try {
      this.store.transaction(() => {
        this.apply(storedEvent);
        this.appendChanged();
      });
    } catch (error) {
      this.resetAndHydrate();
      throw error;
    }
  }

  /** Backfill the latest snapshots when upgrading a journal from before R1. */
  backfill(): number {
    const pending = [...this.backfillPending];
    let count = 0;
    this.store.transaction(() => { count = this.appendActivities(pending); });
    for (const identity of pending) this.backfillPending.delete(identity);
    return count;
  }

  private hydrate(): void {
    forEachStoredEvent(this.store, `session:${this.sessionId}`, (event) => {
      if (event.type === "recipe.activity") {
        const key = recipeKey(event.payload);
        if (key) this.published.set(key, canonical(event.payload));
        return;
      }
      this.apply(event);
    });
    // Hydration rebuilds the in-memory projector from authoritative history.
    // Preserve the hydrated identities for an explicit backfill(), then drain
    // them so the first live append after startup only publishes that event's
    // changed activity instead of rescanning the whole journal.
    for (const identity of this.projector.takeDirty()) {
      this.backfillPending.add(identity);
    }
  }

  private resetAndHydrate(): void {
    this.projector = new RecipeActivityProjector({ sessionId: this.sessionId });
    this.published.clear();
    this.backfillPending.clear();
    this.seen.clear();
    this.terminal.clear();
    this.toolTurns.clear();
    this.activeTurnId = null;
    this.hydrate();
  }

  private apply(event: StoredEvent): void {
    const payload = event.payload;
    if (event.type === "turn.started") {
      if (typeof payload.turnId === "string" && payload.turnId.length > 0) {
        this.activeTurnId = payload.turnId;
        this.projector.apply({ type: event.type, payload, occurredAt: occurrence(event) });
      }
      return;
    }
    if (["turn.settled", "turn.aborted", "turn.failed", "turn.indeterminate"].includes(event.type)) {
      this.activeTurnId = null;
      return;
    }
    if (event.type === "reasoning.delta") return;
    if (!event.type.startsWith("tool.") && !event.type.startsWith("reasoning.")) return;

    const activityId = typeof payload.toolCallId === "string"
      ? payload.toolCallId
      : typeof payload.contentBlockId === "string" ? payload.contentBlockId : null;
    if (!activityId) return;
    const explicitTurn = typeof payload.turnId === "string" && payload.turnId.length > 0
      ? payload.turnId
      : null;
    const boundToolTurn = event.type.startsWith("tool.") ? this.toolTurns.get(activityId) ?? null : null;
    const turnId = explicitTurn ?? boundToolTurn ?? this.activeTurnId;
    if (!turnId) return;
    if (event.type.startsWith("tool.")) {
      if (boundToolTurn && explicitTurn && boundToolTurn !== explicitTurn) return;
      if (!boundToolTurn) this.toolTurns.set(activityId, turnId);
    }

    const projectedPayload = { ...payload, sessionId: this.sessionId, turnId };
    const identity = recipeKey(projectedPayload);
    if (!identity) return;
    const isTerminal = ["tool.completed", "tool.failed", "tool.cancelled", "reasoning.completed"].includes(event.type);
    if (this.terminal.has(identity)) return;
    const fingerprint = `${event.type}\u0000${identity}\u0000${canonical(projectionFields(event.type, projectedPayload))}`;
    if (this.seen.has(fingerprint)) return;
    this.seen.add(fingerprint);
    if (isTerminal) this.terminal.add(identity);
    this.projector.apply({ type: event.type, payload: projectedPayload, occurredAt: occurrence(event) });
  }

  private appendChanged(): number {
    return this.appendActivities(this.projector.takeDirty());
  }

  private appendActivities(identities: readonly string[]): number {
    let count = 0;
    // Publish only activities explicitly selected by the caller. Live appends
    // drain the projector's dirty set; backfill() supplies the identities
    // captured during hydration.
    //
    // Pre-fix this iterated {@link projector.snapshot} over every event,
    // canonicalising every accumulated activity. With O(n) activities and
    // O(m) events that was O(n*m) work, so a 5k-tool / 15k-event external
    // session took ~555s and never finished inside the LaunchAgent
    // watchdog. Tracking only the dirty identities (bounded by the number
    // of distinct activities in the journal) makes this O(n) overall.
    for (const identity of identities) {
      const activity = this.projector.activity(identity);
      if (!activity) continue;
      // The F0 wire contract requires both bounded argument and output text on
      // the tool arm. A start-only projection truthfully has no output yet, so
      // keep it in the projector and publish its first snapshot only after
      // output/result arrives rather than inventing placeholder content.
      // The activity stays in the projector's source map; the next apply()
      // that fills in the missing field (e.g. tool.output) re-dirties it
      // and we publish then.
      if (activity.kind === "tool" &&
          (!activity.arguments || !activity.output)) continue;
      const payload = recipePayload(activity);
      const key = recipeKey(payload)!;
      const serialized = canonical(payload);
      if (this.published.get(key) === serialized) continue;
      this.store.appendEvent(`session:${this.sessionId}`, "recipe.activity", payload);
      this.published.set(key, serialized);
      count += 1;
    }
    return count;
  }
}

function recipePayload(activity: RecipeActivity): Record<string, unknown> {
  return {
    ...activity,
    timing: { ...activity.timing },
    ...(activity.truncation ? { truncation: { ...activity.truncation } } : {}),
    ...(activity.errorInfo ? { errorInfo: { ...activity.errorInfo } } : {}),
  };
}

/**
 * Project the active branch of an imported Pi JSONL session into the bridge's
 * durable transcript stream. The source remains read-only. A size/mtime marker
 * makes startup replay idempotent for unchanged files.
 *
 * Restricted to sessions with `externalSession: true` — the legacy
 * TUI-import path used at daemon startup. Live RPC sessions owned by the
 * bridge use {@link importSessionHistoryTail} instead, which does not
 * require that flag and works for any session whose `piSessionPath` points
 * at the authoritative JSONL.
 */
export function importExternalSessionHistory(
  store: BridgeStore,
  sessionId: string,
  sourcePath: string,
  canonical?: { readonly sessionStore: CanonicalSessionStore },
): number {
  const prior = store.sessionState(sessionId);
  if (!prior || prior.externalSession !== true) return 0;
  return importSessionHistoryInternal(store, sessionId, sourcePath, prior, canonical);
}

/** Build a snapshot of the durable tool ids already journaled for `sessionId`.
 *  Used by {@link inferOverlapAnchor} to choose the latest safe overlap
 *  between the authoritative JSONL active branch and the durable journal. */
function durableToolFingerprints(store: BridgeStore, sessionId: string, canonical?: CanonicalSessionStore): {
  readonly started: Set<string>;
  readonly terminal: Set<string>;
  readonly durableEventCount: number;
} {
  const started = new Set<string>();
  const terminal = new Set<string>();
  let durableEventCount = 0;
  forEachDurableSessionEvent(store, sessionId, canonical, (event) => {
    durableEventCount += 1;
    const id = event.payload.toolCallId;
    if (typeof id !== "string") return;
    if (event.type === "tool.started") started.add(id);
    else if (event.type === "tool.completed" || event.type === "tool.failed" || event.type === "tool.cancelled") terminal.add(id);
  });
  return { started, terminal, durableEventCount };
}

/** Walk the JSONL active branch and return the index of the latest safe
 *  overlap entry against the durable journal. The branch is scanned in
 *  order; each candidate advances the anchor. A toolResult whose toolCallId
 *  is already durable terminal is a *stronger* anchor than an assistant
 *  toolCall whose toolCallId is already durable started, so a `terminal`
 *  candidate only wins when it sits at or after the current `started`
 *  anchor.
 *
 *  Returns -1 when the journal has no overlap with the branch, which the
 *  caller treats as "do not import" for live bridge-owned sessions (we
 *  must never blindly replay a full JSONL over a non-empty durable stream
 *  we cannot align). Returns -1 also for empty journals, which the caller
 *  resolves against the legacy `externalSession` flag (full-branch import
 *  preserved for genuinely new TUI imports). */
function inferOverlapAnchor(
  branch: readonly SessionEntry[],
  durable: { readonly started: Set<string>; readonly terminal: Set<string> },
): number {
  if (durable.started.size === 0 && durable.terminal.size === 0) return -1;
  let startedAnchor = -1;
  let terminalAnchor = -1;
  for (let i = 0; i < branch.length; i += 1) {
    const entry = branch[i]!;
    if (entry.type !== "message") continue;
    const message = (entry as SessionMessageEntry).message as unknown as Record<string, unknown>;
    if (message.role === "assistant") {
      const content = Array.isArray(message.content) ? message.content : [];
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const p = part as Record<string, unknown>;
        if (p.type === "toolCall" && typeof p.id === "string" && durable.started.has(p.id)) {
          startedAnchor = i;
          break;
        }
      }
      continue;
    }
    if (message.role === "toolResult" && typeof message.toolCallId === "string" &&
        durable.terminal.has(message.toolCallId)) {
      // Only advance the terminal anchor past the started anchor if it sits
      // at or after the started anchor. A toolResult earlier in the branch
      // than the tool.started we already durable-recorded cannot be the
      // safe overlap: that would mean the journal and the JSONL are out of
      // phase and we must refuse to import.
      if (i >= startedAnchor || startedAnchor === -1) terminalAnchor = i;
    }
  }
  // The terminal anchor is strictly stronger when it sits at or after the
  // latest started anchor: it proves both the start and the result already
  // exist, so importing entries strictly after it cannot duplicate earlier
  // tool/turn events. If the durable terminal id appears earlier than the
  // latest durable-started id we cannot rely on it as the alignment
  // boundary, because the journal and the JSONL may be out of phase — fall
  // back to the latest started anchor instead.
  if (terminalAnchor >= startedAnchor && terminalAnchor >= 0) return terminalAnchor;
  return startedAnchor;
}

/**
 * Re-import the JSONL tail for any session whose authoritative on-disk file
 * is `sourcePath`. Works for both legacy `externalSession: true` sessions
 * (TUI imports) and live RPC sessions (bridge-owned RPC subprocess).
 *
 * Idempotent: a second call against an unchanged file is a no-op. When the
 * file grows between calls (Pi appended new toolResults while the bridge
 * RPC was disconnected, for example) only the new tail is projected.
 *
 * Returns the number of events appended to the session stream. The caller
 * is expected to invoke this on:
 *
 *   - bridge daemon startup (so the durable journal converges with the
 *     authoritative on-disk Pi file before the listener binds);
 *   - bridge RPC subprocess reconnect/restart (so a missed
 *     `tool_execution_end` notification that Pi did write to the JSONL
 *     still produces a `tool.completed`/`tool.failed` event);
 *   - any periodic reconciliation tick the operator configures.
 *
 * The function refuses to project anything for a session that has never
 * been recorded; the caller is expected to call
 * {@link BridgeStore.ensureSession} first.
 */
export function importSessionHistoryTail(
  store: BridgeStore,
  sessionId: string,
  sourcePath: string,
  canonical?: { readonly sessionStore: CanonicalSessionStore },
): number {
  const prior = store.sessionState(sessionId);
  if (!prior) return 0;
  return importSessionHistoryInternal(store, sessionId, sourcePath, prior, canonical);
}

/**
 * The precise lifecycle outcome produced by a single reconciliation call,
 * scoped to the reconciled active turn. The reconciler returns this so
 * the caller can derive the canonical session row state without scanning
 * the entire history for unrelated older terminal events.
 */
export type ReconciledTurnOutcome =
  | { readonly kind: "live"; readonly imported: number }
  | { readonly kind: "idle"; readonly turnId: string; readonly imported: number; readonly terminalType: "turn.settled" | "turn.aborted" | "turn.failed" }
  | { readonly kind: "indeterminate"; readonly turnId: string; readonly imported: number; readonly reason: string };

/**
 * Reconcile a lifecycle boundary, rather than merely exposing the importer.
 * `liveProcess` is deliberately explicit: an open JSONL turn is only made
 * indeterminate after the owner has observed that no Pi process owns it.
 *
 * The returned `turnOutcome` describes the lifecycle of the *reconciled
 * active turn* only:
 *   - `live`           — a healthy Pi process owns the session; nothing
 *                        was terminalised by this call.
 *   - `idle`           — the reconciled active turn ended in a visible
 *                        assistant text and was durable-settled (settled/
 *                        aborted/failed). Caller maps to `runtimeState =
 *                        "idle"`, `attentionState = "ready"`.
 *   - `indeterminate`  — the reconciled active turn was left open by the
 *                        JSONL and the caller passed `liveProcess: false`.
 *                        Caller maps to `runtimeState = "indeterminate"`,
 *                        `attentionState = "needs_attention"`.
 *
 * Older terminal events from a previous run are deliberately ignored so
 * the caller cannot be fooled into settling a session based on stale
 * transcript.
 */
export function reconcileSessionHistoryTail(
  store: BridgeStore,
  sessionId: string,
  sourcePath: string,
  options: { readonly liveProcess: boolean },
  canonical?: { readonly sessionStore: CanonicalSessionStore },
): { readonly imported: number; readonly authoritativeTerminal: boolean; readonly turnOutcome: ReconciledTurnOutcome } {
  const imported = importSessionHistoryTail(store, sessionId, sourcePath, canonical);
  const terminalTools = new Set<string>();
  const startedTools = new Map<string, Record<string, unknown>>();
  const terminalTurns = new Set<string>();
  const startedTurns = new Set<string>();
  let authoritativeTerminal = false;
  let latestTerminal: { readonly terminalType: "turn.settled" | "turn.aborted" | "turn.failed" | "turn.indeterminate"; readonly turnId: string; readonly cursor: string } | null = null;
  forEachDurableSessionEvent(store, sessionId, canonical?.sessionStore, (event) => {
    if (event.type === "tool.started" && typeof event.payload.toolCallId === "string") {
      startedTools.set(event.payload.toolCallId, event.payload);
    } else if (["tool.completed", "tool.failed", "tool.cancelled"].includes(event.type) && typeof event.payload.toolCallId === "string") {
      terminalTools.add(event.payload.toolCallId);
    }
    if (event.type === "turn.started" && typeof event.payload.turnId === "string") {
      startedTurns.add(event.payload.turnId);
    } else if (["turn.settled", "turn.aborted", "turn.failed", "turn.indeterminate"].includes(event.type) && typeof event.payload.turnId === "string") {
      terminalTurns.add(event.payload.turnId);
      latestTerminal = { terminalType: event.type as "turn.settled" | "turn.aborted" | "turn.failed" | "turn.indeterminate", turnId: event.payload.turnId, cursor: event.cursor };
    }
    if (["tool.completed", "tool.failed", "turn.settled", "turn.failed"].includes(event.type) && event.payload.historical === true) {
      authoritativeTerminal = true;
    }
  });
  const openTools = [...startedTools.entries()].filter(([id]) => !terminalTools.has(id));
  const openTurns = new Set([...startedTurns].filter((id) => !terminalTurns.has(id)));
  // Resolve the reconciled active turn: the *latest* durable turn.started
  // turnId whose pair did NOT come from a previous run's older terminal.
  // For sessions with no live owner we must rely on the turn the importer
  // either left open (openTurns.first) or that was already settled earlier
  // (any durable terminal whose turnId matches a known turn.started).
  authoritativeTerminal = imported > 0 && authoritativeTerminal;
  if (options.liveProcess) {
    // Live owner: import lands but no boundary is synthesised. The session
    // runtimeState must NOT be flipped to idle from a prior stale "running"
    // purely because the importer ran — that decision belongs to the live
    // RPC subprocess.
    return { imported, authoritativeTerminal, turnOutcome: { kind: "live", imported } };
  }
  if (openTools.length === 0 && openTurns.size === 0) {
    // Nothing open. Was there a turn this reconciliation produced that we
    // should map? Only the latest durable terminal turn matters; older
    // events from previous runs are intentionally ignored so a session
    // whose persisted runtimeState is already correct is not re-asserted.
    const latestTerminalTurn = latestTerminal;
    if (!latestTerminalTurn) {
      return { imported, authoritativeTerminal, turnOutcome: { kind: "live", imported } };
    }
    return { imported, authoritativeTerminal, turnOutcome: idleOutcome(latestTerminalTurn, imported) };
  }
  // No-live owner, with at least one open tool or open turn. Synthesise the
  // orphan boundary and report indeterminate. Canonical reconciliation must
  // never construct the legacy recipe projection.
  const projection = canonical ? null : new DurableRecipeActivityProjection(store, sessionId);
  const appendSynthesized = (type: string, payload: Record<string, unknown>, sourceEventId: string): void => {
    if (canonical) {
      canonical.sessionStore.append({
        sessionId,
        type: type as CanonicalEventType,
        payload,
        sourceEventId,
      });
      // Canonical reconciliation writes only the canonical event. Do not
      // mirror it into the legacy session stream or publish recipe.activity.
      return;
    }
    projection!.append(type, payload);
  };
  const appendBoundary = (): void => {
    for (const [toolCallId, started] of openTools) {
      const turnId = typeof started.turnId === "string" ? started.turnId : undefined;
      appendSynthesized("tool.failed", {
        sessionId, ...(turnId ? { turnId } : {}), toolCallId,
        toolName: typeof started.toolName === "string" ? started.toolName : "tool",
        output: "No live Pi owner remained before a terminal tool result was observed.",
        result: "indeterminate",
        isError: true,
        errorInfo: { code: "indeterminate", message: "No live Pi owner remained before the tool result was observed.", retryable: false },
        historical: true,
      }, `reconcile:${sessionId}:tool:${toolCallId}:no_live_rpc`);
    }
    for (const turnId of openTurns) {
      appendSynthesized("turn.indeterminate", {
        sessionId, turnId, reason: "no_live_rpc", historical: true,
      }, `reconcile:${sessionId}:turn:${turnId}:no_live_rpc`);
    }
  };
  if (canonical) appendBoundary();
  else store.transaction(appendBoundary);
  // The synthesized boundary is now the authoritative terminal lifecycle;
  // callers must not add a second generic exit/indeterminate event.
  const reconciledTurnId = [...openTurns][0] ?? [...terminalTurns][0] ?? null;
  return {
    imported,
    authoritativeTerminal: true,
    turnOutcome: { kind: "indeterminate", turnId: reconciledTurnId ?? "", imported, reason: "no_live_rpc" },
  };
}

/** Map the latest terminal turn to the canonical ReconciledTurnOutcome.
 *  `turn.indeterminate` is reported as indeterminate; settled/aborted/
 *  failed are reported as idle for the caller to map to runtimeState. */
function idleOutcome(latest: { readonly terminalType: "turn.settled" | "turn.aborted" | "turn.failed" | "turn.indeterminate"; readonly turnId: string; readonly cursor: string }, imported: number, reason = "no_live_rpc"): ReconciledTurnOutcome {
  if (latest.terminalType === "turn.indeterminate") {
    return { kind: "indeterminate", turnId: latest.turnId, imported, reason };
  }
  return { kind: "idle", turnId: latest.turnId, imported, terminalType: latest.terminalType };
}

function importSessionHistoryInternal(
  store: BridgeStore,
  sessionId: string,
  sourcePath: string,
  prior: Record<string, unknown>,
  canonical?: { readonly sessionStore: CanonicalSessionStore },
): number {
  let stats;
  try {
    stats = statSync(sourcePath);
  } catch {
    // Source file missing: a live RPC subprocess has not produced its
    // session file yet, or it was cleaned up. Nothing to project.
    return 0;
  }
  const sourceRevision = `${stats.size}:${stats.mtimeMs}`;
  // A previous daemon may have marked the JSONL imported before the
  // dedicated canonical log existed. When canonical storage is empty, run
  // one backfill even if the legacy source revision is unchanged.
  const canonicalBackfill = canonical !== undefined && canonical.sessionStore.count(sessionId) === 0;
  if (prior.externalHistorySourceRevision === sourceRevision && !canonicalBackfill) return 0;

  const parsed = parseSessionEntries(readFileSync(sourcePath, "utf8"));
  const entries = parsed.filter((entry): entry is SessionEntry => entry.type !== "session");
  const branch = activeBranch(entries);
  const previousLeaf = typeof prior.externalHistoryLeafId === "string"
    ? prior.externalHistoryLeafId
    : null;
  const previousIndex = previousLeaf
    ? branch.findIndex((entry) => entry.id === previousLeaf)
    : -1;
  // Three sources of "where to start the import":
  //   1. explicit `externalHistoryLeafId` marker (legacy/external sessions
  //      that recorded their leaf on every import);
  //   2. an inferred overlap anchor against the durable journal (a
  //      tool.started or tool.completed toolCallId present in both);
  //   3. fall through to the full branch for the empty legacy import.
  //
  // For a bridge-owned live session whose journal already has events but no
  // explicit leaf marker (typical for sessions restored from before this
  // reconciliation fix), case 2 prevents replaying the entire JSONL over
  // durable events that already match. With an empty durable journal case 2
  // is skipped, preserving the legacy TUI-import behaviour for genuinely
  // new sessions.
  const durable = previousLeaf ? null : durableToolFingerprints(store, sessionId, canonical?.sessionStore);
  const inferredAnchor = durable
    ? inferOverlapAnchor(branch, durable)
    : -1;
  let pending: SessionEntry[];
  if (canonicalBackfill) {
    pending = branch;
  } else if (previousIndex >= 0) {
    pending = branch.slice(previousIndex + 1);
  } else if (previousLeaf) {
    pending = [];
  } else if (inferredAnchor >= 0) {
    // Anchor inclusive: the matched toolCall/result entry itself is
    // already durable, so we resume strictly *after* it. Importing the
    // anchor entry would duplicate the already-journaled assistant and
    // tool events.
    pending = branch.slice(inferredAnchor + 1);
  } else if (prior.externalSession === true || durable?.durableEventCount === 0) {
    // Legacy TUI import path: with no leaf marker, no inferred anchor,
    // AND an empty durable journal, fall through to the original
    // full-branch behaviour so a genuinely new external session still
    // imports its entire active branch.
    pending = branch;
  } else {
    // Bridge-owned live session with a non-empty durable journal and no
    // safe overlap: refuse to replay the full JSONL over an unrelated
    // transcript. The caller can fall back to
    // {@link reconcileSessionHistoryTail} which will synthesize an
    // explicit indeterminate boundary for any orphan tool/turn rather
    // than silently duplicating an unrelated history.
    pending = [];
  }
  // Older callers without CanonicalSessionStore intentionally retain the
  // isolated recipe projection fallback. The normal daemon passes the
  // canonical store and therefore leaves this null.
  const projection = canonical ? null : new DurableRecipeActivityProjection(store, sessionId);
  const existingToolTurns = new Map<string, string>();
  const durableOpenTurns = new Set<string>();
  let latestDurableOpenTurnId: string | null = null;
  forEachDurableSessionEvent(store, sessionId, canonical?.sessionStore, (event) => {
    if (event.type === "tool.started" && typeof event.payload.toolCallId === "string" && typeof event.payload.turnId === "string") {
      existingToolTurns.set(event.payload.toolCallId, event.payload.turnId);
    }
    if (event.type === "turn.started" && typeof event.payload.turnId === "string") {
      latestDurableOpenTurnId = event.payload.turnId;
      durableOpenTurns.add(event.payload.turnId);
    }
    if ((event.type === "turn.settled" || event.type === "turn.aborted" || event.type === "turn.failed" || event.type === "turn.indeterminate") &&
        typeof event.payload.turnId === "string") {
      durableOpenTurns.delete(event.payload.turnId);
      latestDurableOpenTurnId = event.payload.turnId;
    }
  });
  // When the import resumes from an inferred anchor (no `externalHistoryLeafId`),
  // the most recent durable open turn is the one to which the resumed slice
  // belongs. Seed `currentTurnId` so a trailing assistant message does not
  // synthesise a fresh `historical-…` turnId over an already-durable turn.
  let currentTurnId: string | null = inferredAnchor >= 0 ? latestDurableOpenTurnId : null;
  let lastRole: unknown = null;
  let lastAssistantHadText = false;
  let count = 0;
  let activeEntryId = "unknown";
  let activeEntryEventOrdinal = 0;
  const assistantContent = new Map<string, string>();
  const append = (type: string, payload: Record<string, unknown>) => {
    // A single assistant JSONL entry can produce several events of the same
    // normalized type (for example, two text blocks). The ordinal is scoped
    // to the stable source entry and replayed in the same parse order, so it
    // remains byte-stable across retries/restarts without using payload text
    // or a generated event ID as identity.
    activeEntryEventOrdinal += 1;
    const existingTurn = typeof payload.toolCallId === "string"
      ? existingToolTurns.get(payload.toolCallId)
      : undefined;
    const turnId = existingTurn ?? currentTurnId;
    const projectedPayload: Record<string, unknown> = {
      sessionId,
      historical: true,
      ...(turnId ? { turnId } : {}),
      ...payload,
    };
    if (canonical) {
      const sourceEventId = `history:${sourcePath}:${activeEntryId}:${type}:${activeEntryEventOrdinal}`;
      let canonicalType = type as CanonicalEventType;
      let canonicalPayload = projectedPayload;
      const turn = typeof projectedPayload.turnId === "string" ? projectedPayload.turnId : currentTurnId ?? `historical:${sessionId}`;
      const block = String(projectedPayload.contentBlockId ?? projectedPayload.assistantStepId ?? "assistant");
      const messageId = `${sessionId}:${turn}:${block}`;
      if (type === "assistant.started") {
        canonicalPayload = { turnId: turn, messageId };
      } else if (type === "assistant.delta") {
        const key = `${turn}:${block}`;
        const text = typeof projectedPayload.text === "string" ? projectedPayload.text : "";
        const content = `${assistantContent.get(key) ?? ""}${text}`;
        assistantContent.set(key, content);
        canonicalType = "assistant.content.replaced";
        canonicalPayload = { turnId: turn, messageId, content: [{ kind: "text", text: content }] };
      } else if (type === "assistant.completed") {
        canonicalType = "assistant.message.completed";
        canonicalPayload = { turnId: turn, messageId };
      } else if (type === "tool.output") {
        canonicalType = "tool.progress.replaced";
        canonicalPayload = { turnId: turn, toolCallId: projectedPayload.toolCallId, progress: projectedPayload.output };
      } else if (type.startsWith("tool.")) {
        canonicalPayload = { ...projectedPayload, turnId: turn };
      }
      canonical.sessionStore.append({
        sessionId,
        type: canonicalType,
        payload: canonicalPayload,
        sourceEventId,
      });
      // Canonical history import is authoritative. In particular, do not
      // backfill source transcript rows or derived recipe.activity rows in
      // the legacy session stream.
    } else {
      projection!.append(type, projectedPayload);
    }
    if (type === "tool.started" && typeof payload.toolCallId === "string" && turnId) {
      existingToolTurns.set(payload.toolCallId, turnId);
    }
    count += 1;
  };
  const settleTurn = () => {
    if (!currentTurnId) return;
    append("turn.settled", { turnId: currentTurnId });
    currentTurnId = null;
  };
  const checkpoint = (): void => {
    if (count === 0) return;
    // Canonical events commit individually. Checkpoint only after a complete
    // source entry, so a failure halfway through an entry retries its stable
    // source IDs without skipping the entry's remaining projections.
    store.updateSessionState(sessionId, {
      ...prior,
      externalHistorySourceRevision: sourceRevision,
      externalHistoryLeafId: activeEntryId,
      externalHistoryImportedAt: new Date().toISOString(),
    });
  };

  // Legacy projection imports keep their single transaction so the source
  // marker and recipe rows remain atomic. Canonical events must not be
  // appended inside that outer transaction: CanonicalSessionStore publishes
  // after its own commit, while an enclosing BridgeStore rollback could
  // otherwise publish an event that no longer exists. Canonical source IDs
  // make these bounded per-event commits restart-idempotent.
  const importPending = (): void => {
    for (const entry of pending) {
      activeEntryId = entry.id;
      activeEntryEventOrdinal = 0;
      if (entry.type !== "message") continue;
      const message = (entry as SessionMessageEntry).message as unknown as Record<string, unknown>;
      const role = message.role;
      lastRole = role;
      lastAssistantHadText = role === "assistant" && Array.isArray(message.content) && message.content.some((part) =>
        Boolean(part && typeof part === "object" && (part as Record<string, unknown>).type === "text"));
      const at = timestamp(message.timestamp ?? entry.timestamp);
      if (role === "user") {
        settleTurn();
        currentTurnId = entry.id;
        const userText = boundedText(textContent(message.content));
        if (canonical) {
          append("user.message.created", {
            messageId: entry.id,
            turnId: entry.id,
            text: userText,
            ...(at ? { timestamp: at } : {}),
          });
        }
        append("turn.started", {
          turnId: entry.id,
          commandId: entry.id,
          deliveryMode: "immediate",
          message: userText,
          ...(at ? { timestamp: at } : {}),
        });
        checkpoint();
        continue;
      }
      if (role === "assistant") {
        if (!currentTurnId) {
          // The anchor-resumed slice carries the durable open turn forward.
          // Only synthesise a fresh `historical-…` turn when we are
          // importing from the very start of the branch (no anchor), which
          // preserves the legacy full-import behaviour for empty journals.
          currentTurnId = `historical-${entry.id}`;
          append("turn.started", {
            turnId: currentTurnId,
            commandId: currentTurnId,
            deliveryMode: "immediate",
            ...(at ? { timestamp: at } : {}),
          });
        }
        // If `currentTurnId` points at an already-durable turn (anchor
        // resume), do NOT emit a new turn.started and do NOT reset the id;
        // the resumed slice belongs to the same turn until a `user` role or
        // a `settleTurn` boundary moves it on.
        const content = Array.isArray(message.content) ? message.content : [];
        const textParts = content.filter((part): part is Record<string, unknown> =>
          Boolean(part && typeof part === "object" && (part as Record<string, unknown>).type === "text" && typeof (part as Record<string, unknown>).text === "string"));
        // One Pi assistant message maps to one canonical assistant identity.
        // Thinking-only and tool-only entries remain non-rendered lifecycle
        // data; they must not create an empty assistant card.
        const contentBlockId = entry.id;
        if (textParts.length > 0) {
          append("assistant.started", { contentBlockId, assistantStepId: entry.id, ...(at ? { timestamp: at } : {}) });
          for (const part of textParts) {
            const partText = boundedText(part.text as string);
            if (partText) append("assistant.delta", {
              contentBlockId,
              assistantStepId: entry.id,
              text: partText,
              ...(at ? { timestamp: at } : {}),
            });
          }
          append("assistant.completed", { contentBlockId, assistantStepId: entry.id, ...(at ? { timestamp: at } : {}) });
        }
        for (const [index, raw] of content.entries()) {
          if (!raw || typeof raw !== "object") continue;
          const part = raw as Record<string, unknown>;
          if (part.type === "thinking") {
            // Pi's `thinking` block is private chain-of-thought, not a provider
            // display summary. Retain lifecycle only; never persist its text.
            const thinkingId = `${entry.id}:thinking:${index}`;
            append("reasoning.started", { contentBlockId: thinkingId, assistantStepId: entry.id, ...(at ? { timestamp: at } : {}) });
            append("reasoning.completed", { contentBlockId: thinkingId, assistantStepId: entry.id, ...(at ? { timestamp: at } : {}) });
          } else if (part.type === "toolCall" && typeof part.id === "string" &&
                     typeof part.name === "string") {
            append("tool.started", {
              toolCallId: part.id,
              toolName: part.name,
              assistantStepId: entry.id,
              arguments: part.arguments && typeof part.arguments === "object"
                ? part.arguments
                : {},
              ...(at ? { timestamp: at } : {}),
            });
          }
        }
        checkpoint();
        continue;
      }
      if (role === "toolResult" && typeof message.toolCallId === "string") {
        const rawOutput = textContent(message.content);
        const output = boundedText(rawOutput);
        const totalBytes = Buffer.byteLength(rawOutput);
        const retainedBytes = Buffer.byteLength(output);
        const metadata = {
          retainedBytes,
          totalBytes,
          isTruncated: retainedBytes < totalBytes,
          ...(at ? { timestamp: at } : {}),
        };
        if (output) append("tool.output", {
          toolCallId: message.toolCallId,
          toolName: typeof message.toolName === "string" ? message.toolName : "tool",
          output,
          ...metadata,
        });
        append(message.isError === true ? "tool.failed" : "tool.completed", {
          toolCallId: message.toolCallId,
          toolName: typeof message.toolName === "string" ? message.toolName : "tool",
          result: output || {},
          isError: message.isError === true,
          ...metadata,
          ...(message.isError === true ? {
            errorInfo: {
              code: "tool_failed",
              message: (output || "Tool failed").slice(0, 512),
              retryable: false,
            },
          } : {}),
        });
        checkpoint();
      }
    }
    // A trailing toolResult only terminalizes the tool, NOT the parent
    // assistant turn: Pi normally continues with more reasoning or further
    // toolCalls after a toolResult. Closing the turn here would mask a
    // half-formed answer as a settled one. The authoritative branch ends
    // in a settled turn only when it ends in a visible assistant text
    // block; if the JSONL ends in `toolResult` without a following
    // assistant text, the turn stays open and the caller
    // (reconcileSessionHistoryTail) decides how to boundary it based on
    // live ownership.
    if (lastRole === "assistant" && lastAssistantHadText) settleTurn();
    const leaf = branch.at(-1)?.id ?? null;
    // Only record the source-revision marker when at least one event was
    // imported. A no-overlap refusal must not lock the file away from a
    // later reconciliation that produces a safe anchor.
    if (count > 0) {
      store.updateSessionState(sessionId, {
        ...prior,
        externalHistorySourceRevision: sourceRevision,
        externalHistoryLeafId: leaf,
        externalHistoryImportedAt: new Date().toISOString(),
      });
    }
  };
  if (canonical) importPending();
  else store.transaction(importPending);
  return count;
}
