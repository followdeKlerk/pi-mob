import type { BackendNotification } from "../backend/contract";

const FORWARDED_TYPES = new Set([
  "agent_start", "agent_end", "turn_start", "turn_end", "message_start", "message_update", "message_end",
  "tool_execution_start", "tool_execution_update", "tool_execution_end", "compaction_start", "compaction_end",
  "auto_retry_start", "auto_retry_end", "extension_ui_request", "model_changed", "session_info_changed",
  "thinking_level_changed", "steering_mode_changed", "follow_up_mode_changed", "session_stats",
]);
const MAX_TEXT = 64 * 1024;
const PRIVATE_KEY = /path|sessionFile|sourceInfo|fullOutputPath|stack/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return "<truncated>";
  if (typeof value === "string") return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value.replace(/(?:\/Users\/|\/private\/|\/home\/)[^\s"']+/g, "<private-path>");
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitize(item, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (PRIVATE_KEY.test(key)) continue;
      output[key] = sanitize(item, depth + 1);
    }
    return output;
  }
  return value;
}

export function normalizeOmpNotification(raw: unknown, sessionId: string): BackendNotification | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const type = typeof source.type === "string" ? source.type : "";
  if (!FORWARDED_TYPES.has(type)) return null;
  const output = sanitize(source) as Record<string, unknown>;
  output.sessionId = sessionId;
  if (type === "agent_end") output.isTerminal = true;
  if (type === "message_update" && output.assistantMessageEvent === undefined) {
    const delta = typeof output.delta === "string" ? output.delta : typeof output.text === "string" ? output.text : "";
    output.assistantMessageEvent = { type: "text_delta", delta };
  }
  return output as BackendNotification;
}

export function extractOmpSessionId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  for (const candidate of [source.sessionId, source.session_id, source.id]) {
    if (typeof candidate === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(candidate)) return candidate;
  }
  for (const key of ["session", "data", "state"]) {
    const nested = extractOmpSessionId(source[key]);
    if (nested) return nested;
  }
  return null;
}
