import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extensionUiResponse, normalizePiEvent, normalizePiResponse, toPiRpcCommand, type NormalizedPiCommand, type PiCommandName } from "../src";

const noPayload: PiCommandName[] = ["abort", "new_session", "get_state", "get_messages", "get_session_stats", "get_commands", "cycle_model", "get_available_models", "cycle_thinking_level", "abort_retry", "abort_bash", "clone", "get_fork_messages", "get_tree", "get_last_assistant_text"];

describe("exact Pi 0.82.0 command adapter", () => {
  test("maps every command family and prevalidates session files", () => {
    for (const type of noPayload) expect(toPiRpcCommand({ type }, "id")).toMatchObject({ id: "id", type });
    const cases: NormalizedPiCommand[] = [
      { type: "prompt", payload: { message: "hello" } }, { type: "steer", payload: { message: "change" } }, { type: "follow_up", payload: { message: "later" } },
      { type: "set_model", payload: { provider: "fixture", modelId: "model" } }, { type: "set_thinking_level", payload: { level: "high" } },
      { type: "set_steering_mode", payload: { mode: "all" } }, { type: "set_follow_up_mode", payload: { mode: "one-at-a-time" } },
      { type: "compact", payload: { customInstructions: "safe" } }, { type: "set_auto_compaction", payload: { enabled: true } }, { type: "set_auto_retry", payload: { enabled: false } },
      { type: "bash", payload: { command: "pwd" } }, { type: "export_html" }, { type: "fork", payload: { entryId: "entry" } },
      { type: "get_entries", payload: { since: 2 } }, { type: "set_session_name", payload: { name: "name" } },
    ];
    for (const command of cases) expect(toPiRpcCommand(command).type).toBe(command.type);
    expect(() => toPiRpcCommand({ type: "switch_session", payload: { sessionPath: "/missing/pi-session" } })).toThrow("compatible Pi session file");
    const dir = mkdtempSync(join(tmpdir(), "pi-adapter-"));
    const file = join(dir, "session.jsonl"); writeFileSync(file, `${JSON.stringify({ type: "session", version: 3, id: "fixture", timestamp: "2026-07-13T00:00:00.000Z", cwd: dir })}\n`);
    expect(toPiRpcCommand({ type: "switch_session", payload: { sessionPath: file } })).toMatchObject({ type: "switch_session", sessionPath: file });
  });

  test("normalizes failures without leaking raw paths", () => {
    expect(normalizePiResponse({ type: "response", command: "export_html", success: false, error: "Nothing to export yet /private/file" })).toEqual({ command: "export_html", success: false, errorCode: "invalid_state" });
    expect(extensionUiResponse("dialog", "confirm", true)).toEqual({ type: "extension_ui_response", id: "dialog", confirmed: true });
    expect(extensionUiResponse("dialog", "input", null, true)).toEqual({ type: "extension_ui_response", id: "dialog", cancelled: true });
  });
});

describe("Pi event normalization", () => {
  const context = { sessionId: "session" };
  test("settles Pi and terminal OMP boundaries without changing Pi pre-settlement behavior", () => {
    expect(normalizePiEvent({ type: "agent_end", willRetry: false }, context).map((item) => item.type)).not.toContain("turn.settled");
    expect(normalizePiEvent({ type: "agent_end", isTerminal: true, messages: [] }, context).map((item) => item.type)).toEqual(["turn.settled"]);
    // Rewrite slice: raw Pi events are routed through the diagnostics sink,
    // NOT the user-visible session stream. The curated output is the only
    // shape the transcript authority sees.
    expect(normalizePiEvent({ type: "agent_settled" }, context).map((item) => item.type)).toEqual(["turn.settled"]);
  });

  test("does not create empty assistant replies around a streamed text block", () => {
    expect(normalizePiEvent({ type: "message_start", message: { role: "assistant", content: [] } }, context)).toEqual([]);
    expect(normalizePiEvent({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } }, context)).toEqual([
      { type: "assistant.started", payload: { sessionId: "session", contentBlockId: "0" } },
    ]);
    expect(normalizePiEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hi" }] } }, context)).toEqual([
      { type: "assistant.completed", payload: { sessionId: "session", contentBlockId: "0", content: { role: "assistant", content: [{ type: "text", text: "Hi" }] } } },
    ]);
  });

  test("surfaces provider failures without leaking provider diagnostics", () => {
    const raw = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "API key not valid: secret details",
      },
    };
    expect(normalizePiEvent(raw, context)).toEqual([{
      type: "turn.failed",
      payload: {
        sessionId: "session",
        errorCode: "provider_error",
        errorMessage: "The model provider rejected the request. Check the configured provider credentials and retry.",
      },
    }]);
  });

  test("covers lifecycle, content, tools, queue, retry, compaction, and extension UI", () => {
    const raws = [
      { type: "agent_start" }, { type: "turn_start", turnIndex: 1 }, { type: "turn_end", message: {} },
      { type: "message_start", message: { role: "assistant", id: "a" } },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hi" } }, { type: "message_end", message: {} },
      { type: "message_update", assistantMessageEvent: { type: "error", reason: "error" } },
      { type: "tool_execution_start", toolCallId: "one", toolName: "read", args: { path: "/private/repo" } },
      { type: "tool_execution_start", toolCallId: "two", toolName: "bash", args: {} },
      { type: "tool_execution_update", toolCallId: "one", partialResult: "out" },
      { type: "tool_execution_end", toolCallId: "one", toolName: "read", result: "done", isError: false },
      { type: "tool_execution_end", toolCallId: "two", toolName: "bash", result: "bad", isError: true },
      { type: "queue_update", steering: [], followUp: [] }, { type: "compaction_start", reason: "manual" }, { type: "compaction_end", aborted: false },
      { type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 10 }, { type: "auto_retry_end", success: true, attempt: 1 },
      { type: "session_info_changed", name: "safe" }, { type: "thinking_level_changed", level: "high" }, { type: "entry_appended", entry: { id: "e", path: "/private" } },
      { type: "extension_ui_request", id: "d", method: "confirm", title: "Sure?" }, { type: "extension_ui_request", id: "n", method: "notify", message: "done" },
      { type: "extension_error", extensionPath: "/private/ext", event: { detail: "failed at /home/private/repo/file.ts" }, error: "secret" },
    ];
    const output = raws.flatMap((raw) => normalizePiEvent(raw, context));
    expect(new Set(output.map((item) => item.type)).size).toBeGreaterThan(12);
    expect(output.filter((item) => item.type === "tool.started").map((item) => item.payload.toolCallId)).toEqual(["one", "two"]);
    // Rewrite slice: curated output NEVER carries raw `pi.rpc.event`
    // envelopes; raw events flow into the diagnostics sink. The curated
    // shape still redacts private paths.
    expect(JSON.stringify(output)).not.toContain("/private");
    expect(JSON.stringify(output)).not.toContain("/home/private");
    expect(output.filter((item) => item.type === "pi.rpc.event")).toHaveLength(0);
    expect(output.some((item) => item.type === "turn.failed" && item.payload.errorCode === "provider_interrupted")).toBe(true);
  });
});
