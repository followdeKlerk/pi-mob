import { readFileSync, statSync } from "node:fs";
import {
  parseSessionEntries,
  type SessionEntry,
  type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import { BridgeStore } from "../core/store";

const MAX_TEXT_BYTES = 512 * 1024;

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
  if (typeof value === "string") return value;
  return undefined;
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
  const streamId = `session:${sessionId}`;
  let currentTurnId: string | null = null;
  let count = 0;
  const append = (type: string, payload: Record<string, unknown>) => {
    store.appendEvent(streamId, type, {
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

  for (const entry of pending) {
    if (entry.type !== "message") continue;
    const message = (entry as SessionMessageEntry).message as unknown as Record<string, unknown>;
    const role = message.role;
    if (role === "user") {
      settleTurn();
      currentTurnId = entry.id;
      append("turn.started", {
        turnId: entry.id,
        commandId: entry.id,
        deliveryMode: "immediate",
        message: boundedText(textContent(message.content)),
        ...(timestamp(message.timestamp ?? entry.timestamp)
          ? { timestamp: timestamp(message.timestamp ?? entry.timestamp) }
          : {}),
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
        });
      }
      const content = Array.isArray(message.content) ? message.content : [];
      for (let index = 0; index < content.length; index += 1) {
        const raw = content[index];
        if (!raw || typeof raw !== "object") continue;
        const part = raw as Record<string, unknown>;
        const contentBlockId = `${entry.id}:${index}`;
        if (part.type === "text" && typeof part.text === "string") {
          append("assistant.started", { contentBlockId, assistantStepId: entry.id });
          if (part.text) append("assistant.delta", {
            contentBlockId,
            assistantStepId: entry.id,
            text: boundedText(part.text),
          });
          append("assistant.completed", { contentBlockId, assistantStepId: entry.id });
        } else if (part.type === "thinking" && typeof part.thinking === "string") {
          append("reasoning.started", { contentBlockId, assistantStepId: entry.id });
          if (part.thinking) append("reasoning.delta", {
            contentBlockId,
            assistantStepId: entry.id,
            text: boundedText(part.thinking),
          });
          append("reasoning.completed", { contentBlockId, assistantStepId: entry.id });
        } else if (part.type === "toolCall" && typeof part.id === "string" &&
                   typeof part.name === "string") {
          append("tool.started", {
            toolCallId: part.id,
            toolName: part.name,
            assistantStepId: entry.id,
            arguments: part.arguments && typeof part.arguments === "object"
              ? part.arguments
              : {},
          });
        }
      }
      continue;
    }
    if (role === "toolResult" && typeof message.toolCallId === "string") {
      const output = boundedText(textContent(message.content));
      if (output) append("tool.output", {
        toolCallId: message.toolCallId,
        toolName: typeof message.toolName === "string" ? message.toolName : "tool",
        output,
      });
      append(message.isError === true ? "tool.failed" : "tool.completed", {
        toolCallId: message.toolCallId,
        toolName: typeof message.toolName === "string" ? message.toolName : "tool",
        result: output ? { output } : {},
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
  return count;
}
