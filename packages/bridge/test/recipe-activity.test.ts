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

  test("rejects oversized ids before identity and preserves the first kind on collisions", () => {
    const oversized = "x".repeat(129);
    const result = projectRecipeActivities([
      event("tool.started", { turnId: "t", toolCallId: oversized, toolName: "bash" }, "2026-01-01T00:00:00.000Z"),
      event("tool.started", { turnId: "t", toolCallId: "a", toolName: "bash" }, "2026-01-01T00:00:01.000Z"),
      event("reasoning.started", { turnId: "t", contentBlockId: "a" }, "2026-01-01T00:00:02.000Z"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "tool", activityId: "a" });
  });

  test("does not fabricate tool fields for malformed or absent values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = projectRecipeActivities([
      event("tool.started", { turnId: "t", toolCallId: "a" }, "2026-01-01T00:00:00.000Z"),
      event("tool.started", { turnId: "t", toolCallId: "b", toolName: "bash", arguments: circular }, "2026-01-01T00:00:01.000Z"),
      event("tool.completed", { turnId: "t", toolCallId: "b" }, "2026-01-01T00:00:02.000Z"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ activityId: "b", toolName: "bash" });
    expect(result[0]).not.toHaveProperty("arguments");
    expect(result[0]).not.toHaveProperty("output");
    expect(result[0]).not.toHaveProperty("truncation");
  });

  test("only includes truncation when source metadata exists", () => {
    const result = projectRecipeActivities([
      event("tool.started", { turnId: "t", toolCallId: "a", toolName: "bash", arguments: "x".repeat(400) }, "2026-01-01T00:00:00.000Z"),
      event("tool.completed", { turnId: "t", toolCallId: "a", result: "y".repeat(400) }, "2026-01-01T00:00:01.000Z"),
    ]);
    expect(result[0]!.arguments).toHaveLength(240);
    expect(result[0]!.output).toHaveLength(240);
    expect(result[0]).not.toHaveProperty("truncation");
  });

  test("tracks failed and cancelled terminal states", () => {
    const failed = projectRecipeActivities([
      event("tool.started", { turnId: "t", toolCallId: "a", toolName: "bash" }, "2026-01-01T00:00:00.000Z"),
      event("tool.failed", { turnId: "t", toolCallId: "a", output: "failure", errorInfo: { code: "internal_error", message: "failure", retryable: false }, retainedBytes: 3, totalBytes: 7, isTruncated: true }, "2026-01-01T00:00:01.000Z"),
    ]);
    expect(failed[0]).toMatchObject({ status: "failed", errorInfo: { code: "internal_error", retryable: false }, truncation: { retainedBytes: 3, totalBytes: 7, isTruncated: true } });

    const cancelled = projectRecipeActivities([
      event("tool.started", { turnId: "t", toolCallId: "b", toolName: "bash" }, "2026-01-01T00:00:00.000Z"),
      event("tool.cancelled", { turnId: "t", toolCallId: "b" }, "2026-01-01T00:00:01.000Z"),
    ]);
    expect(cancelled[0]).toMatchObject({ status: "cancelled" });
  });
});
