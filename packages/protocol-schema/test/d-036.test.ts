import { expect, test } from "bun:test";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import {
  CapabilityStatusSchema,
  CommandSchema,
  ErrorInfoSchema,
  EVENT_STREAM_OWNERSHIP,
  EventSchema,
  LIMITS,
  PLAN_CAPABILITY,
  PlanSnapshotSchema,
  PlanTargetSchema,
  PlanUnavailableSchema,
  RECIPE_CAPABILITY,
  RecipeActivitySchema,
  RecipeUnavailableSchema,
} from "../src/index.ts";

const uuid = "11111111-1111-1111-1111-111111111111";
const envelope = {
  protocol: { major: 1, minor: 0 }, messageId: uuid, eventId: uuid,
  streamId: `session:${uuid}`, cursor: "1", sentAt: "2026-07-15T00:00:00.000Z",
};

// Identity / timing envelope shared by every recipe activity. The schema
// requires every one of these fields, so tests construct them once and reuse
// them to avoid test-only optionality drift.
const sharedActivity = {
  sessionId: uuid,
  turnId: "turn-1",
  activityId: "act-1",
  ordinal: 0,
  timing: { startedAt: "2026-07-15T00:00:00.000Z" },
};

test("D-036 LIMITS expose the bounded F0 identifier and payload surfaces", () => {
  expect(LIMITS.maxPlanSteps).toBe(64);
  expect(LIMITS.maxRecipeActivityIdLength).toBe(128);
  expect(LIMITS.maxTurnIdLength).toBe(128);
  expect(LIMITS.maxPlanIdLength).toBe(128);
  expect(LIMITS.maxStepIdLength).toBe(128);
  expect(LIMITS.maxRecipeTitleLength).toBe(128);
  expect(LIMITS.maxToolNameLength).toBe(128);
  expect(LIMITS.maxRecipeArgumentsLength).toBe(240);
  expect(LIMITS.maxRecipeOutputLength).toBe(240);
  expect(LIMITS.maxPlanBlockerLength).toBe(240);
  expect(LIMITS.maxReasonLength).toBe(512);
  expect(LIMITS.maxRemediationLength).toBe(512);
  expect(LIMITS.maxCapabilitySourceLength).toBe(128);
  expect(LIMITS.maxErrorMessageLength).toBe(512);
});

test("D-036 RecipeActivity thinking arm permits only title, optional providerSummary, optional truncation", () => {
  const activity = TypeCompiler.Compile(RecipeActivitySchema);
  // Valid thinking activity with optional bounded providerSummary.
  expect(activity.Check({
    kind: "thinking",
    ...sharedActivity,
    status: "running",
    title: "Working on it",
    providerSummary: { kind: "provider_summary", provider: "anthropic", summary: "concise summary" },
  })).toBe(true);
  // Valid thinking activity without providerSummary (omission is unavailable
  // empty state, NOT permission to derive one).
  expect(activity.Check({
    kind: "thinking",
    ...sharedActivity,
    status: "pending",
    title: "Working on it",
  })).toBe(true);
  // Valid thinking activity with optional truncation telemetry.
  expect(activity.Check({
    kind: "thinking",
    ...sharedActivity,
    status: "completed",
    title: "Working on it",
    providerSummary: { kind: "provider_summary", provider: "anthropic", summary: "concise summary" },
    truncation: { retainedBytes: 100, totalBytes: 1024, isTruncated: true },
  })).toBe(true);
  // The tool arm MUST reject providerSummary — thinking-only field.
  expect(activity.Check({
    kind: "tool",
    ...sharedActivity,
    status: "completed",
    title: "Reading file",
    toolName: "read",
    arguments: "{}",
    output: "ok",
    providerSummary: { kind: "provider_summary", provider: "private", summary: "leak" },
  })).toBe(false);
  // Private sibling is rejected — both arms are closed.
  expect(activity.Check({
    kind: "thinking",
    ...sharedActivity,
    status: "running",
    title: "Working on it",
    private: "leak",
  })).toBe(false);
});

test("D-036 RecipeActivity tool arm supports bounded title/toolName, arguments/output, optional errorInfo/truncation", () => {
  const activity = TypeCompiler.Compile(RecipeActivitySchema);
  // Valid tool activity with every required and permitted field.
  expect(activity.Check({
    kind: "tool",
    ...sharedActivity,
    status: "running",
    title: "Reading file",
    toolName: "read",
    arguments: "{\"path\":\"/tmp/x\"}",
    output: "first 240 chars",
    errorInfo: { code: "internal_error", message: "boom", retryable: false },
    truncation: { retainedBytes: 100, totalBytes: 1024, isTruncated: true },
  })).toBe(true);
  // Tool arm must reject providerSummary (thinking-only field).
  expect(activity.Check({
    kind: "tool",
    ...sharedActivity,
    status: "completed",
    title: "Reading file",
    toolName: "read",
    arguments: "{}",
    output: "ok",
    providerSummary: { kind: "provider_summary", provider: "x", summary: "leak" },
  })).toBe(false);
});

test("D-036 RecipeActivity rejects every missing identity / timing field", () => {
  const activity = TypeCompiler.Compile(RecipeActivitySchema);
  const valid = {
    kind: "thinking" as const,
    ...sharedActivity,
    status: "running" as const,
    title: "Working on it",
  };
  for (const missing of ["sessionId", "turnId", "activityId", "ordinal", "timing", "status", "title"] as const) {
    const next = { ...valid } as Record<string, unknown>;
    delete next[missing];
    expect(activity.Check(next)).toBe(false);
  }
  // Negative ordinal is invalid (non-negative integer).
  expect(activity.Check({ ...valid, ordinal: -1 })).toBe(false);
});

test("D-036 RecipeActivity rejects oversized identifiers, titles, arguments, output, toolName", () => {
  const activity = TypeCompiler.Compile(RecipeActivitySchema);
  // Oversized turnId / activityId / title.
  expect(activity.Check({
    kind: "thinking",
    ...sharedActivity,
    turnId: "t".repeat(LIMITS.maxTurnIdLength + 1),
    status: "running",
    title: "Working on it",
  })).toBe(false);
  expect(activity.Check({
    kind: "thinking",
    ...sharedActivity,
    activityId: "a".repeat(LIMITS.maxRecipeActivityIdLength + 1),
    status: "running",
    title: "Working on it",
  })).toBe(false);
  expect(activity.Check({
    kind: "thinking",
    ...sharedActivity,
    status: "running",
    title: "T".repeat(LIMITS.maxRecipeTitleLength + 1),
  })).toBe(false);
  // Tool arm oversized title/toolName/arguments/output.
  const validTool = {
    kind: "tool" as const,
    ...sharedActivity,
    status: "completed" as const,
    title: "ok",
    toolName: "read",
    arguments: "{}",
    output: "ok",
  };
  expect(activity.Check({ ...validTool, title: "t".repeat(LIMITS.maxRecipeTitleLength + 1) })).toBe(false);
  expect(activity.Check({ ...validTool, toolName: "n".repeat(LIMITS.maxToolNameLength + 1) })).toBe(false);
  expect(activity.Check({ ...validTool, arguments: "a".repeat(LIMITS.maxRecipeArgumentsLength + 1) })).toBe(false);
  expect(activity.Check({ ...validTool, output: "o".repeat(LIMITS.maxRecipeOutputLength + 1) })).toBe(false);
  // At the inclusive upper bound the values must still pass.
  expect(activity.Check({
    ...validTool,
    title: "t".repeat(LIMITS.maxRecipeTitleLength),
    toolName: "n".repeat(LIMITS.maxToolNameLength),
    arguments: "a".repeat(LIMITS.maxRecipeArgumentsLength),
    output: "o".repeat(LIMITS.maxRecipeOutputLength),
  })).toBe(true);
});

test("D-036 RecipeActivity preserves the five distinct status values", () => {
  const activity = TypeCompiler.Compile(RecipeActivitySchema);
  for (const status of ["pending", "running", "completed", "failed", "cancelled"] as const) {
    expect(activity.Check({
      kind: "thinking",
      ...sharedActivity,
      status,
      title: "Working on it",
    })).toBe(true);
  }
  // Plan-step-only statuses must NOT be valid recipe activity statuses.
  expect(activity.Check({
    kind: "thinking",
    ...sharedActivity,
    status: "blocked" as unknown as "running",
    title: "Working on it",
  })).toBe(false);
  expect(activity.Check({
    kind: "thinking",
    ...sharedActivity,
    status: "skipped" as unknown as "running",
    title: "Working on it",
  })).toBe(false);
});

test("D-036 PlanTarget is closed with required planId, stepId, revision (each bounded opaque)", () => {
  const target = TypeCompiler.Compile(PlanTargetSchema);
  // Valid target — every field required and bounded.
  expect(target.Check({ planId: "p1", stepId: "s1", revision: "r2" })).toBe(true);
  // Missing revision — schema requires it so an idempotency retry cannot retarget.
  expect(target.Check({ planId: "p1", stepId: "s1" })).toBe(false);
  // Empty / oversized opaque identifiers are rejected.
  expect(target.Check({ planId: "", stepId: "s1", revision: "r1" })).toBe(false);
  expect(target.Check({ planId: "p".repeat(LIMITS.maxPlanIdLength + 1), stepId: "s1", revision: "r1" })).toBe(false);
  expect(target.Check({ planId: "p1", stepId: "", revision: "r1" })).toBe(false);
  expect(target.Check({ planId: "p1", stepId: "s".repeat(LIMITS.maxStepIdLength + 1), revision: "r1" })).toBe(false);
  // Pure-decimal revision is rejected: revision is a RevisionToken, not a cursor.
  expect(target.Check({ planId: "p1", stepId: "s1", revision: "12345" })).toBe(false);
  // Closed shape — no private sibling.
  expect(target.Check({ planId: "p1", stepId: "s1", revision: "r1", private: "leak" })).toBe(false);
});

test("D-036 PlanStep is bounded; blocker and timing are optional", () => {
  const plan = TypeCompiler.Compile(PlanSnapshotSchema);
  // Minimal pending step (no blocker / timing) is valid.
  expect(plan.Check({
    planId: "p1", revision: "r1",
    sessionId: uuid, turnId: "turn-1", source: "session-bridge", stale: false,
    capability: { state: "available" },
    steps: [{ stepId: "s1", title: "Step 1", status: "pending" }],
  })).toBe(true);
  // Blocked step with bounded blocker and timing is valid.
  expect(plan.Check({
    planId: "p1", revision: "r1",
    sessionId: uuid, turnId: "turn-1", source: "session-bridge", stale: false,
    capability: { state: "available" },
    steps: [{
      stepId: "s2",
      title: "Step 2",
      status: "blocked",
      blocker: "waiting on upstream",
      timing: { startedAt: "2026-07-15T00:00:00.000Z", updatedAt: "2026-07-15T00:01:00.000Z" },
    }],
  })).toBe(true);
  // Oversized stepId/title/blocker are rejected.
  expect(plan.Check({
    planId: "p1", revision: "r1",
    sessionId: uuid, turnId: "turn-1", source: "session-bridge", stale: false,
    capability: { state: "available" },
    steps: [{ stepId: "s".repeat(LIMITS.maxStepIdLength + 1), title: "Step 1", status: "pending" }],
  })).toBe(false);
  expect(plan.Check({
    planId: "p1", revision: "r1",
    sessionId: uuid, turnId: "turn-1", source: "session-bridge", stale: false,
    capability: { state: "available" },
    steps: [{ stepId: "s1", title: "T".repeat(LIMITS.maxRecipeTitleLength + 1), status: "pending" }],
  })).toBe(false);
  expect(plan.Check({
    planId: "p1", revision: "r1",
    sessionId: uuid, turnId: "turn-1", source: "session-bridge", stale: false,
    capability: { state: "available" },
    steps: [{
      stepId: "s1",
      title: "Step 1",
      status: "blocked",
      blocker: "b".repeat(LIMITS.maxPlanBlockerLength + 1),
    }],
  })).toBe(false);
  // Recipe-only statuses must NOT be valid plan-step statuses.
  expect(plan.Check({
    planId: "p1", revision: "r1",
    sessionId: uuid, turnId: "turn-1", source: "session-bridge", stale: false,
    capability: { state: "available" },
    steps: [{ stepId: "s1", title: "Step 1", status: "cancelled" as unknown as "pending" }],
  })).toBe(false);
  expect(plan.Check({
    planId: "p1", revision: "r1",
    sessionId: uuid, turnId: "turn-1", source: "session-bridge", stale: false,
    capability: { state: "available" },
    steps: [{ stepId: "s1", title: "Step 1", status: "failed" as unknown as "pending" }],
  })).toBe(false);
});

test("D-036 PlanSnapshot retains 64 / rejects 65 steps and the five plan-step statuses", () => {
  const plan = TypeCompiler.Compile(PlanSnapshotSchema);
  const step = (i: number) => ({ stepId: `s${i}`, title: `Step ${i}`, status: "pending" as const });
  const identity = { sessionId: uuid, turnId: "turn-1", source: "session-bridge", stale: false, capability: { state: "available" as const } };
  expect(LIMITS.maxPlanSteps).toBe(64);
  expect(plan.Check({ planId: "p1", revision: "r1", ...identity, steps: Array.from({ length: 64 }, (_, i) => step(i)) })).toBe(true);
  expect(plan.Check({ planId: "p1", revision: "r1", ...identity, steps: Array.from({ length: 65 }, (_, i) => step(i)) })).toBe(false);
  // The plan-step state set is the five distinct values: pending / running /
  // completed / blocked / skipped. Recipe states are not valid here.
  for (const status of ["pending", "running", "completed", "blocked", "skipped"] as const) {
    expect(plan.Check({
      planId: "p1", revision: "r1", ...identity,
      steps: [{ stepId: "s1", title: "Step 1", status }],
    })).toBe(true);
  }
});

test("D-036 RecipeUnavailable / PlanUnavailable require capability + closed CapabilityStatus", () => {
  const recipe = TypeCompiler.Compile(RecipeUnavailableSchema);
  const plan = TypeCompiler.Compile(PlanUnavailableSchema);
  // Valid unavailable envelopes carry the literal capability identifier plus
  // a closed CapabilityStatus.
  expect(recipe.Check({
    capability: RECIPE_CAPABILITY,
    status: { state: "unavailable", reason: "off", remediation: "enable" },
  })).toBe(true);
  expect(plan.Check({
    capability: PLAN_CAPABILITY,
    status: { state: "stale", reason: "old", remediation: "refresh" },
  })).toBe(true);
  // Wrong capability literal is rejected on each surface.
  expect(recipe.Check({
    capability: PLAN_CAPABILITY,
    status: { state: "unavailable", reason: "off", remediation: "enable" },
  })).toBe(false);
  expect(plan.Check({
    capability: RECIPE_CAPABILITY,
    status: { state: "stale", reason: "old", remediation: "refresh" },
  })).toBe(false);
  // Missing capability is rejected.
  expect(recipe.Check({ status: { state: "unavailable", reason: "off", remediation: "enable" } })).toBe(false);
  expect(plan.Check({ status: { state: "stale", reason: "old", remediation: "refresh" } })).toBe(false);
  // Closed shape — `private` is not a valid sibling.
  expect(recipe.Check({
    capability: RECIPE_CAPABILITY,
    status: { state: "unavailable", reason: "off", remediation: "enable" },
    private: "leak",
  })).toBe(false);
  expect(plan.Check({
    capability: PLAN_CAPABILITY,
    status: { state: "stale", reason: "old", remediation: "refresh" },
    private: "leak",
  })).toBe(false);
  // Closed CapabilityStatus variant — `private` nested inside status is
  // rejected because every variant is `additionalProperties: false`.
  expect(recipe.Check({
    capability: RECIPE_CAPABILITY,
    status: { state: "unavailable", reason: "off", remediation: "enable", private: "leak" },
  })).toBe(false);
});

test("D-036 event payloads are registered with session ownership", () => {
  const events = TypeCompiler.Compile(EventSchema);
  expect(events.Check({ ...envelope, type: "recipe.activity", payload: {
    kind: "tool",
    ...sharedActivity,
    status: "running",
    title: "reading",
    toolName: "read",
    arguments: "{}",
    output: "ok",
  } })).toBe(true);
  expect(events.Check({ ...envelope, type: "recipe.unavailable", payload: {
    capability: RECIPE_CAPABILITY,
    status: { state: "unavailable", reason: "off", remediation: "enable" },
  } })).toBe(true);
  expect(events.Check({ ...envelope, type: "plan.snapshot", payload: {
    planId: "p1", revision: "r1", sessionId: uuid, turnId: "turn-1",
    source: "session-bridge", stale: false, capability: { state: "available" },
    steps: [],
  } })).toBe(true);
  expect(events.Check({ ...envelope, type: "plan.unavailable", payload: {
    capability: PLAN_CAPABILITY,
    status: { state: "stale", reason: "old", remediation: "refresh" },
  } })).toBe(true);
  for (const type of ["recipe.activity", "recipe.unavailable", "plan.snapshot", "plan.unavailable"] as const) expect(EVENT_STREAM_OWNERSHIP[type]).toBe("session");
});

test("D-036 prompt.submit preserves legacy payload and uses planTarget (not target) with required revision", () => {
  const commands = TypeCompiler.Compile(CommandSchema);
  const base = { protocol: { major: 1, minor: 0 }, messageId: uuid, requestId: uuid, connectionId: uuid, commandId: uuid, leaseId: uuid, sentAt: "2026-07-15T00:00:00.000Z", type: "prompt.submit", payload: { sessionId: uuid, deliveryMode: "immediate", message: "go", attachmentIds: [] } };
  // Legacy payload without planTarget remains valid (omission preserves every
  // existing prompt.submit contract, including the legacy un-targeted `steer`).
  expect(commands.Check(base)).toBe(true);
  // planTarget is the CORRECT field name; required revision closes the shape.
  expect(commands.Check({ ...base, payload: { ...base.payload, planTarget: { planId: "p1", stepId: "s1", revision: "r2" } } })).toBe(true);
  // planTarget without required revision is invalid.
  expect(commands.Check({ ...base, payload: { ...base.payload, planTarget: { planId: "p1", stepId: "s1" } } })).toBe(false);
  // The old `target` field name is not documented by the schema. Legacy
  // additionalProperties behavior intentionally means an old payload carrying
  // it remains accepted, but it is not a typed/declared plan target.
  const commandSchemaText = JSON.stringify(CommandSchema);
  expect(commandSchemaText).toContain("planTarget");
  expect(commandSchemaText).not.toContain('"target"');
  expect(commands.Check({ ...base, payload: { ...base.payload, target: { planId: "p1", stepId: "s1", revision: "r2" } } })).toBe(true);
  // Closed planTarget shape — private sibling is rejected.
  expect(commands.Check({ ...base, payload: { ...base.payload, planTarget: { planId: "p1", stepId: "s1", revision: "r1", private: "leak" } } })).toBe(false);
});

test("D-036 RecipeActivity timing and errorInfo nested objects are closed (no private/internal/debug siblings)", () => {
  const activity = TypeCompiler.Compile(RecipeActivitySchema);
  // Baseline thinking activity with the standard closed timing envelope is valid.
  expect(activity.Check({
    kind: "thinking",
    ...sharedActivity,
    status: "running",
    title: "Working on it",
    timing: { startedAt: "2026-07-15T00:00:00.000Z", updatedAt: "2026-07-15T00:01:00.000Z" },
  })).toBe(true);
  // A `private` sibling nested inside the timing envelope is rejected —
  // the activity would otherwise smuggle a private bookkeeping field
  // through the closed-shape change in TimingSchema.
  expect(activity.Check({
    kind: "thinking",
    ...sharedActivity,
    status: "running",
    title: "Working on it",
    timing: { startedAt: "2026-07-15T00:00:00.000Z", private: "leak" },
  })).toBe(false);
  // An `internal` sibling nested inside the timing envelope is rejected.
  expect(activity.Check({
    kind: "thinking",
    ...sharedActivity,
    status: "running",
    title: "Working on it",
    timing: { startedAt: "2026-07-15T00:00:00.000Z", internal: { debug: "x" } },
  })).toBe(false);
  // A `debug` sibling nested inside the timing envelope is rejected.
  expect(activity.Check({
    kind: "thinking",
    ...sharedActivity,
    status: "running",
    title: "Working on it",
    timing: { startedAt: "2026-07-15T00:00:00.000Z", debug: true },
  })).toBe(false);
  // Baseline tool activity with a closed errorInfo envelope is valid.
  expect(activity.Check({
    kind: "tool",
    ...sharedActivity,
    status: "failed",
    title: "Reading file",
    toolName: "read",
    arguments: "{}",
    output: "ok",
    errorInfo: { code: "internal_error", message: "boom", retryable: false },
  })).toBe(true);
  // A `private` sibling nested inside the errorInfo envelope is rejected.
  expect(activity.Check({
    kind: "tool",
    ...sharedActivity,
    status: "failed",
    title: "Reading file",
    toolName: "read",
    arguments: "{}",
    output: "ok",
    errorInfo: { code: "internal_error", message: "boom", retryable: false, private: "leak" },
  })).toBe(false);
  // An `internal` sibling nested inside the errorInfo envelope is rejected.
  expect(activity.Check({
    kind: "tool",
    ...sharedActivity,
    status: "failed",
    title: "Reading file",
    toolName: "read",
    arguments: "{}",
    output: "ok",
    errorInfo: { code: "internal_error", message: "boom", retryable: false, internal: { stack: "x" } },
  })).toBe(false);
  // A `debug` sibling nested inside the errorInfo envelope is rejected.
  expect(activity.Check({
    kind: "tool",
    ...sharedActivity,
    status: "failed",
    title: "Reading file",
    toolName: "read",
    arguments: "{}",
    output: "ok",
    errorInfo: { code: "internal_error", message: "boom", retryable: false, debug: { trace: "x" } },
  })).toBe(false);
});

test("D-036 CapabilityStatus caps reason/remediation at 512 and source at 128 in every variant", () => {
  const check = TypeCompiler.Compile(CapabilityStatusSchema);
  // Inclusive upper bound on reason/remediation (512) and source (128) is
  // valid for every state. The available variant only has source optional,
  // so we still pin the upper bound via the closed envelope.
  for (const state of ["available", "degraded", "unavailable", "stale"] as const) {
    const base: Record<string, unknown> = { state };
    if (state !== "available") {
      base.reason = "r".repeat(LIMITS.maxReasonLength);
      base.remediation = "f".repeat(LIMITS.maxRemediationLength);
    }
    base.source = "s".repeat(LIMITS.maxCapabilitySourceLength);
    expect(check.Check(base)).toBe(true);
  }
  // Oversized reason (513) is invalid for every non-available state.
  for (const state of ["degraded", "unavailable", "stale"] as const) {
    expect(check.Check({
      state,
      reason: "r".repeat(LIMITS.maxReasonLength + 1),
      remediation: "fix it",
    })).toBe(false);
    // Oversized remediation (513) is invalid for every non-available state.
    expect(check.Check({
      state,
      reason: "broken",
      remediation: "f".repeat(LIMITS.maxRemediationLength + 1),
    })).toBe(false);
  }
  // Oversized source (129) is invalid on every variant — available carries
  // source as optional, so the cap is still enforced when present.
  for (const state of ["available", "degraded", "unavailable", "stale"] as const) {
    const base: Record<string, unknown> = { state };
    if (state !== "available") {
      base.reason = "broken";
      base.remediation = "fix it";
    }
    base.source = "s".repeat(LIMITS.maxCapabilitySourceLength + 1);
    expect(check.Check(base)).toBe(false);
  }
});

test("D-036 ErrorInfoSchema caps message at 512 UTF-16 code units", () => {
  const error = TypeCompiler.Compile(ErrorInfoSchema);
  // Exactly 512 code units is the inclusive upper bound and is valid.
  expect(error.Check({
    code: "internal_error",
    message: "m".repeat(LIMITS.maxErrorMessageLength),
    retryable: false,
  })).toBe(true);
  // 513 code units exceeds the cap and is invalid.
  expect(error.Check({
    code: "internal_error",
    message: "m".repeat(LIMITS.maxErrorMessageLength + 1),
    retryable: false,
  })).toBe(false);
  // Empty string still violates the existing minLength 1 invariant.
  expect(error.Check({ code: "internal_error", message: "", retryable: false })).toBe(false);
});

test("D-036 PlanSnapshot requires sessionId, turnId, source, stale, capability alongside planId/revision/steps", () => {
  const plan = TypeCompiler.Compile(PlanSnapshotSchema);
  // Baseline valid snapshot carries every required field.
  const valid = {
    planId: "p1", revision: "r1",
    sessionId: uuid, turnId: "turn-1", source: "session-bridge", stale: false,
    capability: { state: "available" as const },
    steps: [{ stepId: "s1", title: "Step 1", status: "pending" as const }],
  };
  expect(plan.Check(valid)).toBe(true);
  // Every additional required field, dropped one at a time, is invalid.
  for (const missing of ["sessionId", "turnId", "source", "stale", "capability"] as const) {
    const next = { ...valid } as Record<string, unknown>;
    delete next[missing];
    expect(plan.Check(next)).toBe(false);
  }
  // sessionId is a UUID — non-UUID strings are rejected.
  expect(plan.Check({ ...valid, sessionId: "not-a-uuid" })).toBe(false);
  // turnId is bounded by the canonical 128-code-unit identifier cap.
  expect(plan.Check({ ...valid, turnId: "t".repeat(LIMITS.maxTurnIdLength + 1) })).toBe(false);
  expect(plan.Check({ ...valid, turnId: "" })).toBe(false);
  expect(plan.Check({ ...valid, turnId: "t".repeat(LIMITS.maxTurnIdLength) })).toBe(true);
  // source is bounded by the 128-code-unit capability-source cap and must be nonempty.
  expect(plan.Check({ ...valid, source: "" })).toBe(false);
  expect(plan.Check({ ...valid, source: "s".repeat(LIMITS.maxCapabilitySourceLength + 1) })).toBe(false);
  expect(plan.Check({ ...valid, source: "s".repeat(LIMITS.maxCapabilitySourceLength) })).toBe(true);
  // stale is a boolean — non-boolean values are rejected.
  expect(plan.Check({ ...valid, stale: "yes" as unknown as boolean })).toBe(false);
  expect(plan.Check({ ...valid, stale: 0 as unknown as boolean })).toBe(false);
  expect(plan.Check({ ...valid, stale: null as unknown as boolean })).toBe(false);
  expect(plan.Check({ ...valid, stale: true })).toBe(true);
  // capability must be a closed CapabilityStatus — missing `state` literal is rejected.
  expect(plan.Check({ ...valid, capability: {} })).toBe(false);
  expect(plan.Check({ ...valid, capability: { reason: "broken", remediation: "fix it" } })).toBe(false);
  // capability carries the same closed-shape guarantees as the unavailable
  // surface — private siblings nested inside the status are rejected.
  expect(plan.Check({ ...valid, capability: { state: "unavailable", reason: "x", remediation: "y", private: "leak" } })).toBe(false);
  // Closed top-level shape — unknown siblings are rejected.
  expect(plan.Check({ ...valid, private: "leak" })).toBe(false);
  expect(plan.Check({ ...valid, debug: { trace: "x" } })).toBe(false);
});
