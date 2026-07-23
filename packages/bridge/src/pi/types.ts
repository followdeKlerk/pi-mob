import type { EventType } from "@pi-mob/protocol-schema";

export type PiCommandName =
  | "prompt" | "steer" | "follow_up" | "abort" | "new_session"
  | "get_state" | "get_messages" | "get_session_stats" | "get_commands"
  | "set_model" | "cycle_model" | "get_available_models"
  | "set_thinking_level" | "cycle_thinking_level"
  | "set_steering_mode" | "set_follow_up_mode"
  | "compact" | "set_auto_compaction" | "set_auto_retry" | "abort_retry"
  | "bash" | "abort_bash" | "export_html" | "switch_session" | "fork" | "clone"
  | "get_fork_messages" | "get_entries" | "get_tree" | "get_last_assistant_text"
  | "set_session_name";

export interface NormalizedPiCommand {
  readonly type: PiCommandName;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface PiRpcCommand {
  readonly id?: string;
  readonly type: PiCommandName;
  readonly [key: string]: unknown;
}

export interface NormalizedPiEvent {
  readonly type: EventType;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface NormalizedPiResponse {
  readonly command: PiCommandName;
  readonly success: boolean;
  readonly data?: unknown;
  readonly errorCode?: "invalid_state" | "pi_unavailable" | "internal_error";
}

export interface RawPiRpcResponse {
  readonly type: "response";
  readonly id?: string;
  readonly command: PiCommandName;
  readonly success: boolean;
  readonly data?: unknown;
  readonly error?: unknown;
}

export interface RawPiEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

export const BUILT_IN_PI_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;
export type BuiltInPiTool = (typeof BUILT_IN_PI_TOOLS)[number];

export type ExtensionUiMethod =
  | "select" | "confirm" | "input" | "editor"
  | "notify" | "setStatus" | "setWidget" | "setTitle" | "set_editor_text";
