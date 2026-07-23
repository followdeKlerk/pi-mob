import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BridgeStore } from "../src/core/store";
import { AttentionProjection, type AttentionCategory } from "../src/core/attention-projection";

const sessionId = "22222222-2222-4222-8222-222222222222";
const CATEGORIES: readonly AttentionCategory[] = [
  "needs_input",
  "completed",
  "failed",
  "interrupted",
  "background",
];

describe("R7 attention projection", () => {
  test("publishes all five categories and resolves without changing local read state", () => {
    const store = new BridgeStore(join(mkdtempSync(join(tmpdir(), "attention-")), "bridge.sqlite"));
    const projection = new AttentionProjection(store);
    const items = CATEGORIES.map((category, index) =>
      projection.publish({
        sessionId,
        turnId: `turn-${index}`,
        category,
        occurrence: `2026-07-23T10:00:0${index}.000Z`,
        summary: category,
        actionable: category === "needs_input",
      }),
    );
    expect(items).toHaveLength(5);
    expect(items.every((item, index) => item.category === CATEGORIES[index])).toBe(true);
    expect(items[0]!.actionable).toBe(true);
    expect(items[1]!.actionable).toBe(false);

    const resolved = projection.resolve({
      sessionId,
      attentionId: items[0]!.attentionId,
      expectedRevision: items[0]!.revision,
    });
    expect(resolved.resolved).toBe(true);
    expect(resolved.revision).not.toBe(items[0]!.revision);
    expect(() =>
      projection.resolve({
        sessionId,
        attentionId: items[0]!.attentionId,
        expectedRevision: items[0]!.revision,
      }),
    ).toThrow("stale");
    store.close();
  });

  test("resolve rejects unknown attention ids and cross-session reuse", () => {
    const store = new BridgeStore(join(mkdtempSync(join(tmpdir(), "attention-")), "bridge.sqlite"));
    const projection = new AttentionProjection(store);
    const otherSessionId = "33333333-3333-4333-8333-333333333333";
    const item = projection.publish({
      sessionId,
      turnId: "turn-1",
      category: "needs_input",
      occurrence: "2026-07-23T10:00:00.000Z",
      summary: "needs input",
      actionable: true,
    });
    expect(() =>
      projection.resolve({ sessionId: otherSessionId, attentionId: item.attentionId, expectedRevision: item.revision }),
    ).toThrow("not found");
    expect(() =>
      projection.resolve({ sessionId, attentionId: "missing", expectedRevision: item.revision }),
    ).toThrow("not found");
    store.close();
  });

  test("summary is clipped to the canonical 240-code-unit bound", () => {
    const store = new BridgeStore(join(mkdtempSync(join(tmpdir(), "attention-")), "bridge.sqlite"));
    const projection = new AttentionProjection(store);
    const longSummary = "x".repeat(1000);
    const item = projection.publish({
      sessionId,
      turnId: "turn-clip",
      category: "background",
      occurrence: "2026-07-23T10:00:00.000Z",
      summary: longSummary,
      actionable: false,
    });
    expect(item.summary.length).toBe(240);
    store.close();
  });
});
