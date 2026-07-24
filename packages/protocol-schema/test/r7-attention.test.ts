import { describe, expect, test } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { AttentionItemSchema, CommandSchema, EventSchema } from "../src";

const item = {
  attentionId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  turnId: "turn-1",
  category: "needs_input",
  occurrence: "2026-07-23T10:00:00.000Z",
  summary: "Choose a deployment target",
  actionable: true,
  revision: "rev-1",
  resolved: false,
  superseded: false,
};

describe("R7 attention contract", () => {
  test("accepts every category and stays closed", () => {
    for (const category of ["needs_input", "completed", "failed", "interrupted", "background"]) {
      expect(Value.Check(AttentionItemSchema, { ...item, category })).toBe(true);
    }
    expect(Value.Check(AttentionItemSchema, { ...item, private: true })).toBe(false);
  });

  test("journals session items and resolves by durable revision", () => {
    expect(Value.Check(EventSchema, {
      protocol: { major: 1, minor: 0 },
      messageId: "66666666-6666-4666-8666-666666666666",
      sentAt: item.occurrence,
      type: "attention.item",
      eventId: "33333333-3333-4333-8333-333333333333",
      streamId: `session:${item.sessionId}`,
      cursor: "1",
      payload: item,
    })).toBe(true);
    expect(Value.Check(CommandSchema, {
      protocol: { major: 1, minor: 0 },
      messageId: "77777777-7777-4777-8777-777777777777",
      sentAt: item.occurrence,
      connectionId: "88888888-8888-4888-8888-888888888888",
      requestId: "99999999-9999-4999-8999-999999999999",
      type: "attention.resolve",
      commandId: "44444444-4444-4444-8444-444444444444",
      leaseId: "55555555-5555-4555-8555-555555555555",
      payload: { sessionId: item.sessionId, attentionId: item.attentionId, expectedRevision: "rev-1" },
    })).toBe(true);
  });
});
