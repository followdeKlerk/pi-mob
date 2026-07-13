import { BUILT_IN_PI_TOOLS, type NormalizedPiEvent, type RawPiEvent } from "./types";

export interface PiNormalizationContext {
  readonly sessionId: string;
}

const TEXT_LIMIT = 262_144;
function text(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.length > TEXT_LIMIT ? `${value.slice(0, TEXT_LIMIT)}…` : value;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function safe(value: unknown, depth = 0): unknown {
  if (depth > 6) return "<truncated>";
  if (typeof value === "string") {
    if (value.startsWith("/") || /^([A-Za-z]:\\|~\/)/.test(value)) return "<host-private>";
    return text(value);
  }
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => safe(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/path|sourceInfo|sessionFile|fullOutputPath|stack/i.test(key)) continue;
      out[key] = safe(item, depth + 1);
    }
    return out;
  }
  return value;
}
function event(type: NormalizedPiEvent["type"], sessionId: string, payload: Record<string, unknown> = {}): NormalizedPiEvent {
  return { type, payload: { sessionId, ...payload } };
}

/** Normalize exact Pi 0.80.6 events without exposing upstream shapes or host paths. */
export function normalizePiEvent(raw: RawPiEvent, context: PiNormalizationContext): readonly NormalizedPiEvent[] {
  const sessionId = context.sessionId;
  switch (raw.type) {
    case "agent_start": return [event("session.state", sessionId, { runtimeState: "running" })];
    case "agent_end": return [event("session.state", sessionId, { runtimeState: raw.willRetry === true ? "retrying" : "finishing" })];
    case "agent_settled": return [event("turn.settled", sessionId, {})];
    case "turn_start": return [event("turn.started", sessionId, { turnIndex: raw.turnIndex, timestamp: raw.timestamp })];
    case "turn_end": return [event("assistant.completed", sessionId, { summary: safe(raw.message), toolResultCount: Array.isArray(raw.toolResults) ? raw.toolResults.length : 0 })];
    case "message_start": {
      const message = object(raw.message);
      return [event(message.role === "assistant" ? "assistant.started" : "reasoning.started", sessionId, { contentBlockId: message.id ?? raw.messageId ?? "message" })];
    }
    case "message_update": return normalizeMessageUpdate(raw, sessionId);
    case "message_end": return [event("assistant.completed", sessionId, { content: safe(raw.message) })];
    case "tool_execution_start": return [event("tool.started", sessionId, {
      toolCallId: String(raw.toolCallId ?? "unknown"), toolName: String(raw.toolName ?? "unknown"),
      builtIn: BUILT_IN_PI_TOOLS.includes(raw.toolName as never), arguments: safe(raw.args), status: "running",
    })];
    case "tool_execution_update": return [event("tool.output", sessionId, {
      toolCallId: String(raw.toolCallId ?? "unknown"), output: safe(raw.partialResult), retainedBytes: byteLength(raw.partialResult), totalBytes: byteLength(raw.partialResult), isTruncated: false,
    })];
    case "tool_execution_end": return [event(raw.isError === true ? "tool.failed" : "tool.completed", sessionId, {
      toolCallId: String(raw.toolCallId ?? "unknown"), toolName: String(raw.toolName ?? "unknown"), result: safe(raw.result), isError: raw.isError === true,
    })];
    case "queue_update": return [event("queue.snapshot", sessionId, { steering: safe(raw.steering), followUp: safe(raw.followUp) })];
    case "compaction_start": return [event("compaction.state", sessionId, { state: "running", reason: raw.reason })];
    case "compaction_end": return [event("compaction.state", sessionId, { state: raw.aborted === true ? "aborted" : raw.errorMessage ? "failed" : "completed", willRetry: raw.willRetry === true })];
    case "auto_retry_start": return [event("retry.state", sessionId, { state: "waiting", attempt: raw.attempt, maxAttempts: raw.maxAttempts, delayMs: raw.delayMs })];
    case "auto_retry_end": return [event("retry.state", sessionId, { state: raw.success === true ? "completed" : "failed", attempt: raw.attempt })];
    case "entry_appended": return [event("session.state", sessionId, { entry: safe(raw.entry) })];
    case "session_info_changed": return [event("session.metadata", sessionId, { name: text(raw.name) })];
    case "thinking_level_changed": return [event("model.state", sessionId, { thinkingLevel: raw.level })];
    case "extension_error": return [event("error.event", sessionId, { code: "internal_error", retryable: false, extensionEvent: raw.event })];
    case "extension_ui_request": return normalizeExtensionUi(raw, sessionId);
    default: return [];
  }
}

function normalizeMessageUpdate(raw: RawPiEvent, sessionId: string): readonly NormalizedPiEvent[] {
  const delta = object(raw.assistantMessageEvent);
  const kind = String(delta.type ?? "");
  const contentBlockId = String(delta.contentIndex ?? delta.id ?? "content");
  if (kind === "text_start") return [event("assistant.started", sessionId, { contentBlockId })];
  if (kind === "text_delta") return [event("assistant.delta", sessionId, { contentBlockId, text: text(delta.delta ?? delta.text) })];
  if (kind === "text_end") return [event("assistant.completed", sessionId, { contentBlockId })];
  if (kind === "thinking_start") return [event("reasoning.started", sessionId, { contentBlockId })];
  if (kind === "thinking_delta") return [event("reasoning.delta", sessionId, { contentBlockId, text: text(delta.delta ?? delta.text) })];
  if (kind === "thinking_end") return [event("reasoning.completed", sessionId, { contentBlockId })];
  if (kind === "error") return [event(delta.reason === "aborted" ? "turn.aborted" : "turn.failed", sessionId, { reason: delta.reason })];
  return [];
}

function normalizeExtensionUi(raw: RawPiEvent, sessionId: string): readonly NormalizedPiEvent[] {
  const method = String(raw.method ?? "");
  const id = String(raw.id ?? "");
  if (["select", "confirm", "input", "editor"].includes(method)) return [event("extension.dialog", sessionId, { dialogId: id, method, title: text(raw.title), options: safe(raw.options), placeholder: text(raw.placeholder), prefill: text(raw.prefill), timeout: raw.timeout })];
  if (method === "notify") return [event("extension.notify", sessionId, { message: text(raw.message), notifyType: raw.notifyType })];
  if (method === "setStatus") return [event("extension.status", sessionId, { statusKey: text(raw.statusKey), statusText: text(raw.statusText) })];
  if (method === "setWidget") return [event("extension.widget", sessionId, { widgetKey: text(raw.widgetKey), widgetLines: safe(raw.widgetLines), placement: raw.widgetPlacement })];
  if (method === "setTitle") return [event("extension.title", sessionId, { title: text(raw.title) })];
  if (method === "set_editor_text") return [event("extension.editor_prefill", sessionId, { text: text(raw.text) })];
  return [];
}

function byteLength(value: unknown): number {
  try { return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).byteLength; }
  catch { return 0; }
}
