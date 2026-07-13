// pi-mob:security-test-fixture — deliberate private-path redaction probes.
import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  TOOL_OUTPUT_CALL_MAX_BYTES,
  TOOL_OUTPUT_EVENT_MAX_BYTES,
  ToolOutputLimiter,
  normalizePiEvent,
} from "../src";

const utf8Bytes = (value: string): number => Buffer.byteLength(value, "utf8");
const digest = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

describe("M6-07 bounded tool output", () => {
  test("uses exact UTF-8 wire limits without splitting a code point", () => {
    const valueBudget = TOOL_OUTPUT_EVENT_MAX_BYTES - 1024;
    const exactBytes = valueBudget - 2; // JSON string quotes consume two bytes.
    const exact = "é".repeat(exactBytes / 2);
    const exactResult = new ToolOutputLimiter().limit("exact", exact);
    expect(exactResult.value).toBe(exact);
    expect(exactResult).toMatchObject({
      retainedBytes: exactBytes,
      totalBytes: exactBytes,
      isTruncated: false,
    });
    expect(exactResult.digest).toBeUndefined();

    // The byte cap lands in the middle of the four-byte emoji. The retained
    // prefix must stop before it rather than emitting U+FFFD or exceeding cap.
    const oversized = `${"a".repeat(valueBudget - 3)}😀tail`;
    const result = new ToolOutputLimiter().limit("utf8", oversized);
    expect(result.value).toBe("a".repeat(valueBudget - 3));
    expect(utf8Bytes(result.value as string)).toBe(valueBudget - 3);
    expect(result).toMatchObject({
      retainedBytes: valueBudget - 3,
      totalBytes: valueBudget + 5,
      isTruncated: true,
      digest: digest(oversized),
    });
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("bounds final JSON for escape-heavy hostile output", () => {
    const limiter = new ToolOutputLimiter();
    const hostile = ('\\\"\n\t').repeat(100_000);
    const event = normalizePiEvent({
      type: "tool_execution_update",
      toolCallId: "escaped",
      partialResult: hostile,
    }, { sessionId: "session", toolOutputLimiter: limiter })[0]!;
    expect(utf8Bytes(JSON.stringify(event.payload))).toBeLessThanOrEqual(
      TOOL_OUTPUT_EVENT_MAX_BYTES,
    );
    expect(event.payload.isTruncated).toBe(true);
    expect(event.payload.retainedBytes).toBeLessThan(event.payload.totalBytes as number);
    expect(String(event.payload.digest)).toBe(digest(hostile));
  });

  test("enforces the cumulative 5 MiB inline cap independently per tool call", () => {
    const limiter = new ToolOutputLimiter();
    const chunk = "x".repeat(TOOL_OUTPUT_EVENT_MAX_BYTES);
    const hasher = createHash("sha256");
    let latest = limiter.limit("one", "");

    for (let index = 0; index < 21; index += 1) {
      latest = limiter.limit("one", chunk);
      hasher.update(chunk);
      expect(utf8Bytes(latest.value as string)).toBeLessThanOrEqual(TOOL_OUTPUT_EVENT_MAX_BYTES);
    }
    expect(latest.retainedBytes).toBe(TOOL_OUTPUT_CALL_MAX_BYTES);
    expect(latest.totalBytes).toBe(21 * TOOL_OUTPUT_EVENT_MAX_BYTES);
    expect(latest.isTruncated).toBe(true);

    const afterCap = limiter.limit("one", "tail");
    hasher.update("tail");
    expect(afterCap.value).toBe("");
    expect(afterCap).toMatchObject({
      retainedBytes: TOOL_OUTPUT_CALL_MAX_BYTES,
      totalBytes: 21 * TOOL_OUTPUT_EVENT_MAX_BYTES + 4,
      isTruncated: true,
      digest: hasher.digest("hex"),
    });

    const independent = limiter.limit("two", "available");
    expect(independent).toMatchObject({
      value: "available",
      retainedBytes: 9,
      totalBytes: 9,
      isTruncated: false,
    });
  });

  test("recursively redacts private paths before retaining nested values", () => {
    const limiter = new ToolOutputLimiter();
    const limited = limiter.limit("nested", {
      content: [{ type: "text", text: "read /private/repo/secret.ts then /opt/company/token" }],
      details: {
        fullOutputPath: "/private/tmp/raw.log",
        nested: { message: "failed at /Users/alice/project/file.ts", stack: "/private/stack" },
      },
    });
    const output = limited.value as Record<string, unknown>;
    const json = JSON.stringify(output);

    expect(json).not.toContain("/private");
    expect(json).not.toContain("/opt/company");
    expect(json).not.toContain("/Users/alice");
    expect(json).not.toContain("fullOutputPath");
    expect(json).not.toContain("stack");
    expect(json).toContain("<host-private>");
    expect(limited).toMatchObject({
      retainedBytes: utf8Bytes(json),
      totalBytes: utf8Bytes(json),
      isTruncated: false,
    });
  });

  test("bounds huge update and final result values and continues the turn", () => {
    const limiter = new ToolOutputLimiter();
    const context = { sessionId: "session", toolOutputLimiter: limiter };
    const huge = `${"😀".repeat(3 * 1024 * 1024)} /private/never-inline`;

    expect(() => normalizePiEvent({
      type: "tool_execution_start",
      toolCallId: "huge",
      toolName: "bash",
      args: {},
    }, context)).not.toThrow();
    const update = normalizePiEvent({
      type: "tool_execution_update",
      toolCallId: "huge",
      partialResult: huge,
    }, context)[0]!;
    const completed = normalizePiEvent({
      type: "tool_execution_end",
      toolCallId: "huge",
      toolName: "bash",
      result: { content: [{ type: "text", text: huge }] },
      isError: false,
    }, context)[0]!;
    const settled = normalizePiEvent({ type: "agent_settled" }, context)[0]!;

    expect(update.type).toBe("tool.output");
    expect(completed.type).toBe("tool.completed");
    expect(settled.type).toBe("turn.settled");
    expect(utf8Bytes(JSON.stringify(update.payload))).toBeLessThanOrEqual(TOOL_OUTPUT_EVENT_MAX_BYTES);
    expect(utf8Bytes(completed.payload.result as string)).toBeLessThanOrEqual(TOOL_OUTPUT_EVENT_MAX_BYTES);
    expect(update.payload.isTruncated).toBe(true);
    expect(completed.payload.isTruncated).toBe(true);
    expect(String(update.payload.digest)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(completed.payload.digest)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify([update, completed])).not.toContain("/private/never-inline");
  });
});
