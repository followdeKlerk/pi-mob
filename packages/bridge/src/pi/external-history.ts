import { readFileSync, statSync } from "node:fs";
import {
  parseSessionEntries,
  type SessionEntry,
  type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import { BridgeStore, type StoredEvent } from "../core/store";
import { RecipeActivityProjector, type RecipeActivity } from "./recipe-activity";

const MAX_TEXT_BYTES = 48 * 1024;

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

  /** Backfill the latest snapshots when upgrading a journal from before R1. */
  backfill(): number {
    let count = 0;
    this.store.transaction(() => { count = this.appendChanged(); });
    return count;
  }

  private hydrate(): void {
    for (const event of this.store.listEvents(`session:${this.sessionId}`)) {
      if (event.type === "recipe.activity") {
        const key = recipeKey(event.payload);
        if (key) this.published.set(key, canonical(event.payload));
        continue;
      }
      this.apply(event);
    }
  }

  private resetAndHydrate(): void {
    this.projector = new RecipeActivityProjector({ sessionId: this.sessionId });
    this.published.clear();
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
    let count = 0;
    for (const activity of this.projector.snapshot()) {
      // The F0 wire contract requires both bounded argument and output text on
      // the tool arm. A start-only projection truthfully has no output yet, so
      // keep it in the projector and publish its first snapshot only after
      // output/result arrives rather than inventing placeholder content.
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
 */
export function importExternalSessionHistory(
  store: BridgeStore,
  sessionId: string,
  sourcePath: string,
): number {
  const prior = store.sessionState(sessionId);
  if (!prior || prior.externalSession !== true) return 0;
  const stats = statSync(sourcePath);
  const sourceRevision = `${stats.size}:${stats.mtimeMs}`;
  if (prior.externalHistorySourceRevision === sourceRevision) return 0;

  const parsed = parseSessionEntries(readFileSync(sourcePath, "utf8"));
  const entries = parsed.filter((entry): entry is SessionEntry => entry.type !== "session");
  const branch = activeBranch(entries);
  const previousLeaf = typeof prior.externalHistoryLeafId === "string"
    ? prior.externalHistoryLeafId
    : null;
  const previousIndex = previousLeaf
    ? branch.findIndex((entry) => entry.id === previousLeaf)
    : -1;
  // If the TUI merely appended to the same branch, import only the new tail.
  // If it switched branches, retain the already-journaled transcript and add
  // the new active branch rather than duplicating every old event.
  const pending = previousIndex >= 0 ? branch.slice(previousIndex + 1) :
    previousLeaf ? [] : branch;
  const projection = new DurableRecipeActivityProjection(store, sessionId);
  let currentTurnId: string | null = null;
  let count = 0;
  const append = (type: string, payload: Record<string, unknown>) => {
    projection.append(type, {
      sessionId,
      historical: true,
      ...(currentTurnId ? { turnId: currentTurnId } : {}),
      ...payload,
    });
    count += 1;
  };
  const settleTurn = () => {
    if (!currentTurnId) return;
    append("turn.settled", { turnId: currentTurnId });
    currentTurnId = null;
  };

  // One outer transaction makes the source marker and every imported source /
  // recipe event atomic. A crash retries the whole tail rather than publishing
  // a partially imported history.
  store.transaction(() => {
    for (const entry of pending) {
      if (entry.type !== "message") continue;
      const message = (entry as SessionMessageEntry).message as unknown as Record<string, unknown>;
      const role = message.role;
      const at = timestamp(message.timestamp ?? entry.timestamp);
      if (role === "user") {
        settleTurn();
        currentTurnId = entry.id;
        append("turn.started", {
          turnId: entry.id,
          commandId: entry.id,
          deliveryMode: "immediate",
          message: boundedText(textContent(message.content)),
          ...(at ? { timestamp: at } : {}),
        });
        continue;
      }
      if (role === "assistant") {
        if (!currentTurnId) {
          currentTurnId = `historical-${entry.id}`;
          append("turn.started", {
            turnId: currentTurnId,
            commandId: currentTurnId,
            deliveryMode: "immediate",
            ...(at ? { timestamp: at } : {}),
          });
        }
        const content = Array.isArray(message.content) ? message.content : [];
        for (let index = 0; index < content.length; index += 1) {
          const raw = content[index];
          if (!raw || typeof raw !== "object") continue;
          const part = raw as Record<string, unknown>;
          const contentBlockId = `${entry.id}:${index}`;
          if (part.type === "text" && typeof part.text === "string") {
            append("assistant.started", { contentBlockId, assistantStepId: entry.id, ...(at ? { timestamp: at } : {}) });
            if (part.text) append("assistant.delta", {
              contentBlockId,
              assistantStepId: entry.id,
              text: boundedText(part.text),
              ...(at ? { timestamp: at } : {}),
            });
            append("assistant.completed", { contentBlockId, assistantStepId: entry.id, ...(at ? { timestamp: at } : {}) });
          } else if (part.type === "thinking") {
            // Pi's `thinking` block is private chain-of-thought, not a provider
            // display summary. Retain lifecycle only; never persist its text.
            append("reasoning.started", { contentBlockId, assistantStepId: entry.id, ...(at ? { timestamp: at } : {}) });
            append("reasoning.completed", { contentBlockId, assistantStepId: entry.id, ...(at ? { timestamp: at } : {}) });
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
          ...metadata,
          ...(message.isError === true ? {
            errorInfo: {
              code: "tool_failed",
              message: (output || "Tool failed").slice(0, 512),
              retryable: false,
            },
          } : {}),
        });
      }
    }
    settleTurn();
    const leaf = branch.at(-1)?.id ?? null;
    store.updateSessionState(sessionId, {
      ...prior,
      externalHistorySourceRevision: sourceRevision,
      externalHistoryLeafId: leaf,
      externalHistoryImportedAt: new Date().toISOString(),
    });
  });
  return count;
}
