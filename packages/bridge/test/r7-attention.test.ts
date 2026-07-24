import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BridgeStore } from "../src/core/store";
import { AttentionProjection } from "../src/core/attention-projection";

const sessionId = "22222222-2222-4222-8222-222222222222";

describe("R7 attention projection", () => {
  test("publishes all five categories and resolves without changing local read state", () => {
    const store = new BridgeStore(join(mkdtempSync(join(tmpdir(), "attention-")), "bridge.sqlite"));
    const projection = new AttentionProjection(store);
    const items = ["needs_input", "completed", "failed", "interrupted", "background"].map((category, index) =>
      projection.publish({
        sessionId,
        turnId: `turn-${index}`,
        category: category as "needs_input" | "completed" | "failed" | "interrupted" | "background",
        occurrence: `2026-07-23T10:00:0${index}.000Z`,
        summary: category,
        actionable: category === "needs_input",
      }),
    );
    expect(items).toHaveLength(5);
    const resolved = projection.resolve(sessionId, items[0]!.attentionId, items[0]!.revision);
    expect(resolved.resolved).toBe(true);
    expect(() => projection.resolve(sessionId, items[0]!.attentionId, items[0]!.revision)).toThrow("stale");
    store.close();
  });
});
