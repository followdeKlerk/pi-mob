import { readFileSync, statSync } from "node:fs";
import type {
  ExtensionUiMethod,
  NormalizedPiCommand,
  NormalizedPiResponse,
  PiRpcCommand,
  RawPiRpcResponse,
} from "./types";

const ALLOWED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  prompt: ["message", "images", "streamingBehavior"], steer: ["message", "images"], follow_up: ["message", "images"], abort: [],
  new_session: ["parentSession"], get_state: [], get_messages: [], get_session_stats: [], get_commands: [],
  set_model: ["provider", "modelId"], cycle_model: [], get_available_models: [], set_thinking_level: ["level"], cycle_thinking_level: [],
  set_steering_mode: ["mode"], set_follow_up_mode: ["mode"], compact: ["customInstructions"], set_auto_compaction: ["enabled"], set_auto_retry: ["enabled"], abort_retry: [],
  bash: ["command", "excludeFromContext"], abort_bash: [], export_html: ["outputPath"], switch_session: ["sessionPath"], fork: ["entryId"], clone: [],
  get_fork_messages: [], get_entries: ["since"], get_tree: [], get_last_assistant_text: [], set_session_name: ["name"],
};

function payload(command: NormalizedPiCommand): Readonly<Record<string, unknown>> {
  return command.payload ?? {};
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${field} must be a non-empty string`);
  return value;
}

/** Convert bridge-private normalized intent to the exact Pi 0.80.6 RPC command shape. */
export function toPiRpcCommand(command: NormalizedPiCommand, id?: string): PiRpcCommand {
  const allowed = ALLOWED_FIELDS[command.type];
  if (!allowed) throw new TypeError(`unsupported Pi command: ${command.type}`);
  const source = payload(command);
  const result: Record<string, unknown> = { ...(id ? { id } : {}), type: command.type };
  for (const field of allowed) if (source[field] !== undefined) result[field] = source[field];

  if (["prompt", "steer", "follow_up"].includes(command.type)) requireString(result.message, "message");
  if (command.type === "set_model") {
    requireString(result.provider, "provider");
    requireString(result.modelId, "modelId");
  }
  if (["set_thinking_level", "set_steering_mode", "set_follow_up_mode", "fork", "set_session_name"].includes(command.type)) {
    const field = command.type === "set_thinking_level" ? "level" : command.type.endsWith("_mode") ? "mode" : command.type === "fork" ? "entryId" : "name";
    requireString(result[field], field);
  }
  if (["set_auto_compaction", "set_auto_retry"].includes(command.type) && typeof result.enabled !== "boolean") {
    throw new TypeError("enabled must be boolean");
  }
  if (command.type === "bash") requireString(result.command, "command");
  if (command.type === "switch_session") {
    const path = requireString(result.sessionPath, "sessionPath");
    let valid = false;
    try {
      if (statSync(path).isFile()) {
        const firstLine = readFileSync(path, "utf8").split("\n", 1)[0] ?? "";
        const header = JSON.parse(firstLine) as { type?: unknown; version?: unknown };
        valid = header.type === "session" && Number.isInteger(header.version) && (header.version as number) >= 1 && (header.version as number) <= 3;
      }
    } catch { valid = false; }
    if (!valid) throw new TypeError("sessionPath must reference a compatible Pi session file");
  }
  return result as PiRpcCommand;
}

export function normalizePiResponse(response: RawPiRpcResponse): NormalizedPiResponse {
  if (response.success) return { command: response.command, success: true, ...(response.data === undefined ? {} : { data: sanitize(response.data) }) };
  const text = typeof response.error === "string" ? response.error.toLowerCase() : "";
  return {
    command: response.command,
    success: false,
    errorCode: text.includes("nothing to export") || text.includes("invalid") ? "invalid_state" : "pi_unavailable",
  };
}

export function extensionUiResponse(id: string, method: ExtensionUiMethod, value: unknown, cancelled = false): Readonly<Record<string, unknown>> {
  requireString(id, "id");
  if (cancelled) return { type: "extension_ui_response", id, cancelled: true };
  if (method === "confirm") return { type: "extension_ui_response", id, confirmed: value === true };
  return { type: "extension_ui_response", id, value: sanitize(value) };
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 8) return "<truncated>";
  if (typeof value === "string") {
    if (value.startsWith("/") || /^([A-Za-z]:\\|~\/)/.test(value)) return "<host-private>";
    return value.length > 262_144 ? `${value.slice(0, 262_144)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 1000).map((item) => sanitize(item, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/path|sourceInfo|sessionFile|fullOutputPath/i.test(key)) continue;
      output[key] = sanitize(item, depth + 1);
    }
    return output;
  }
  return value;
}
