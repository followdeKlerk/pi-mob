import { expect, test } from "bun:test";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import {
  CommandSchema,
  EVENT_STREAM_OWNERSHIP,
  EventSchema,
  LIMITS,
  PlanSnapshotSchema,
  RecipeActivitySchema,
} from "../src/index.ts";

const uuid = "11111111-1111-1111-1111-111111111111";
const envelope = {
  protocol: { major: 1, minor: 0 }, messageId: uuid, eventId: uuid,
  streamId: `session:${uuid}`, cursor: "1", sentAt: "2026-07-15T00:00:00.000Z",
};

test("D-036 activity and plan shapes are closed and bounded", () => {
  const activity = TypeCompiler.Compile(RecipeActivitySchema);
  expect(activity.Check({ kind: "thinking", status: "running", message: "working", providerSummary: { kind: "provider_summary", provider: "x", summary: "safe" } })).toBe(true);
  expect(activity.Check({ kind: "tool", status: "completed", message: "done", toolName: "read", providerSummary: { kind: "provider_summary", provider: "private", summary: "leak" } })).toBe(false);
  expect(activity.Check({ kind: "thinking", status: "running", message: "working", private: "leak" })).toBe(false);

  const plan = TypeCompiler.Compile(PlanSnapshotSchema);
  const step = (i: number) => ({ stepId: `s${i}`, title: `Step ${i}`, status: "pending" });
  expect(LIMITS.maxPlanSteps).toBe(64);
  expect(plan.Check({ planId: "p1", revision: "r1", steps: Array.from({ length: 64 }, (_, i) => step(i)) })).toBe(true);
  expect(plan.Check({ planId: "p1", revision: "r1", steps: Array.from({ length: 65 }, (_, i) => step(i)) })).toBe(false);
});

test("D-036 event payloads are registered with session ownership", () => {
  const events = TypeCompiler.Compile(EventSchema);
  expect(events.Check({ ...envelope, type: "recipe.activity", payload: { kind: "tool", status: "running", message: "reading", toolName: "read" } })).toBe(true);
  expect(events.Check({ ...envelope, type: "recipe.unavailable", payload: { status: { state: "unavailable", reason: "off", remediation: "enable" } } })).toBe(true);
  expect(events.Check({ ...envelope, type: "plan.snapshot", payload: { planId: "p1", revision: "r1", steps: [] } })).toBe(true);
  expect(events.Check({ ...envelope, type: "plan.unavailable", payload: { status: { state: "stale", reason: "old", remediation: "refresh" } } })).toBe(true);
  for (const type of ["recipe.activity", "recipe.unavailable", "plan.snapshot", "plan.unavailable"] as const) expect(EVENT_STREAM_OWNERSHIP[type]).toBe("session");
});

test("prompt.submit preserves legacy payload and accepts only closed target shape", () => {
  const commands = TypeCompiler.Compile(CommandSchema);
  const base = { protocol: { major: 1, minor: 0 }, messageId: uuid, requestId: uuid, connectionId: uuid, commandId: uuid, leaseId: uuid, sentAt: "2026-07-15T00:00:00.000Z", type: "prompt.submit", payload: { sessionId: uuid, deliveryMode: "immediate", message: "go", attachmentIds: [] } };
  expect(commands.Check(base)).toBe(true);
  expect(commands.Check({ ...base, payload: { ...base.payload, target: { planId: "p1", stepId: "s1" } } })).toBe(true);
  expect(commands.Check({ ...base, payload: { ...base.payload, target: { planId: "p1", stepId: "s1", revision: "r2" } } })).toBe(true);
  expect(commands.Check({ ...base, payload: { ...base.payload, target: { planId: "p1" } } })).toBe(false);
  expect(commands.Check({ ...base, payload: { ...base.payload, target: { planId: "p1", stepId: "s1", private: "leak" } } })).toBe(false);
});
