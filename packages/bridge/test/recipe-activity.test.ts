import { describe, expect, test } from "bun:test";
import { projectRecipeActivities } from "../src/pi/recipe-activity";

const sessionId = "11111111-1111-1111-1111-111111111111";
const event = (type: string, payload: Record<string, unknown>, occurredAt: string) => ({
  type,
  payload: { sessionId, ...payload },
  occurredAt,
} as const);

describe("recipe activity projector", () => {
  test("projects sparse reasoning and tool lifecycles with stable ordinals", () => {
    const events = [
      event("turn.started", { turnId: "turn-1" }, "2026-01-01T00:00:00.000Z"),
      event("reasoning.started", { turnId: "turn-1", contentBlockId: "reason-1" }, "2026-01-01T00:00:01.000Z"),
      event("reasoning.delta", { turnId: "turn-1", contentBlockId: "reason-1", text: "private reasoning" }, "2026-01-01T00:00:02.000Z"),
      event("reasoning.completed", { turnId: "turn-1", contentBlockId: "reason-1" }, "2026-01-01T00:00:03.000Z"),
      event("tool.started", { turnId: "turn-1", toolCallId: "tool-1", toolName: "read", arguments: { path: "README.md" } }, "2026-01-01T00:00:04.000Z"),
      event("tool.output", { turnId: "turn-1", toolCallId: "tool-1", output: "ok", retainedBytes: 2, totalBytes: 2, isTruncated: false }, "2026-01-01T00:00:05.000Z"),
      event("tool.completed", { turnId: "turn-1", toolCallId: "tool-1", result: { output: "ok" } }, "2026-01-01T00:00:06.000Z"),
    ];
    const result = projectRecipeActivities(events);
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.ordinal)).toEqual([0, 1]);
    expect(result[0]).toMatchObject({ kind: "thinking", status: "completed", title: "Thinking" });
    expect(result[0]).not.toHaveProperty("providerSummary");
    expect(result[1]).toMatchObject({ kind: "tool", status: "completed", toolName: "read", output: '{"output":"ok"}' });
    expect(result[1]!.timing.durationMs).toBe(2000);
  });

  test("dedupes replay, preserves first kind, and bounds tool fields", () => {
    const started = event("tool.started", { turnId: "t", toolCallId: "a", toolName: "bash", arguments: "x".repeat(400) }, "2026-01-01T00:00:00.000Z");
    const replay = projectRecipeActivities([started, started, event("reasoning.started", { turnId: "t", contentBlockId: "a" }, "2026-01-01T00:00:01.000Z")]);
    expect(replay).toHaveLength(1);
    expect(replay[0]!.kind).toBe("tool");
    expect(replay[0]!.arguments).toHaveLength(240);
    expect(replay[0]!.truncation?.isTruncated).toBe(true);
    expect(Object.isFrozen(replay[0])).toBe(true);
  });

  test("failed tools carry safe error and truncation metadata", () => {
    const result = projectRecipeActivities([
      event("tool.started", { turnId: "t", toolCallId: "a", toolName: "bash", arguments: {} }, "2026-01-01T00:00:00.000Z"),
      event("tool.failed", { turnId: "t", toolCallId: "a", isError: true, output: "failure", retainedBytes: 3, totalBytes: 7, isTruncated: true }, "2026-01-01T00:00:01.000Z"),
    ]);
    expect(result[0]).toMatchObject({ status: "failed", errorInfo: { code: "internal_error", retryable: false }, truncation: { retainedBytes: 3, totalBytes: 7, isTruncated: true } });
  });
});
