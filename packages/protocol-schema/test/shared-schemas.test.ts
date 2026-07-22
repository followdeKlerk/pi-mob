import { expect, test } from "bun:test";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import {
  ERROR_CODES,
  BoundsSchema,
  CapabilityStatusSchema,
  ErrorInfoSchema,
  ProviderSummarySchema,
  RevisionTokenSchema,
  TimingSchema,
  TruncationSchema,
} from "../src/index.ts";

test("ERROR_CODES exposes the F0 R1/R2 stability codes", () => {
  expect(ERROR_CODES).toContain("recipe_unavailable");
  expect(ERROR_CODES).toContain("plan_unavailable");
  expect(ERROR_CODES).toContain("stale_plan_target");
});

test("CapabilityStatusSchema accepts every state plus optional context", () => {
  const check = TypeCompiler.Compile(CapabilityStatusSchema);
  expect(check.Check({ state: "available" })).toBe(true);
  expect(check.Check({ state: "available", reason: "green", remediation: "no action" })).toBe(true);
  expect(check.Check({
    state: "degraded",
    reason: "stale revision",
    remediation: "force refresh",
  })).toBe(true);
  expect(check.Check({
    state: "unavailable",
    reason: "recipe not configured",
    remediation: "set pi.recipes.enabled=true",
    source: "host",
    revision: "rev-2026-07-15-r7",
    lastRefreshedAt: "2026-07-15T00:00:00.000Z",
  })).toBe(true);
  expect(check.Check({})).toBe(false);
  expect(check.Check({ state: "ready" })).toBe(false);
  expect(check.Check({ state: "available", revision: "12345" })).toBe(false);
});

test("CapabilityStatusSchema admits the new stale state and requires context for every non-available variant", () => {
  const check = TypeCompiler.Compile(CapabilityStatusSchema);
  // stale — valid shape
  expect(check.Check({
    state: "stale",
    reason: "recipe revision older than 24h",
    remediation: "request a fresh recipe snapshot",
    source: "session-bridge",
    revision: "rev-2026-07-14-r3",
    lastRefreshedAt: "2026-07-14T00:00:00.000Z",
  })).toBe(true);
  // stale — minimal shape with just required reason+remediation is still valid
  expect(check.Check({
    state: "stale",
    reason: "stale",
    remediation: "refresh",
  })).toBe(true);
  // stale — missing reason is invalid
  expect(check.Check({ state: "stale", remediation: "refresh" })).toBe(false);
  expect(check.Check({ state: "stale", reason: "" })).toBe(false);
  // every non-available state MUST carry a nonempty remediation
  for (const state of ["degraded", "unavailable", "stale"] as const) {
    expect(check.Check({ state, reason: "x" })).toBe(false);
    expect(check.Check({ state, remediation: "fix it" })).toBe(false);
    expect(check.Check({ state, reason: "x", remediation: "" })).toBe(false);
    expect(check.Check({ state, reason: "", remediation: "fix it" })).toBe(false);
    expect(check.Check({ state, reason: "x", remediation: "fix it" })).toBe(true);
  }
});

test("RevisionTokenSchema accepts opaque identifiers but never pure-decimal cursors", () => {
  const check = TypeCompiler.Compile(RevisionTokenSchema);
  expect(check.Check("rev-2026-07-15-r7")).toBe(true);
  expect(check.Check("v1.2.3-abc")).toBe(true);
  expect(check.Check("a")).toBe(true);
  expect(check.Check("")).toBe(false);
  expect(check.Check("12345")).toBe(false);
  expect(check.Check("0")).toBe(false);
  expect(check.Check("9007199254740992")).toBe(false);
  expect(check.Check("a".repeat(129))).toBe(false);
});

test("bounded primitive schemas enforce their minimums and ISO patterns", () => {
  const truncation = TypeCompiler.Compile(TruncationSchema);
  expect(truncation.Check({ retainedBytes: 0, totalBytes: 0, isTruncated: false })).toBe(true);
  expect(truncation.Check({
    retainedBytes: 100,
    totalBytes: 1024,
    digest: "0".repeat(64),
    isTruncated: true,
  })).toBe(true);
  expect(truncation.Check({ retainedBytes: -1, totalBytes: 0, isTruncated: false })).toBe(false);
  expect(truncation.Check({ retainedBytes: 0, totalBytes: 0, digest: "not-a-digest", isTruncated: false })).toBe(false);

  const timing = TypeCompiler.Compile(TimingSchema);
  expect(timing.Check({ startedAt: "2026-07-15T00:00:00.000Z" })).toBe(true);
  expect(timing.Check({
    startedAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:01:00.000Z",
    finishedAt: "2026-07-15T00:02:00.000Z",
    durationMs: 120_000,
  })).toBe(true);
  expect(timing.Check({ startedAt: "2026-07-15 00:00:00" })).toBe(false);
  expect(timing.Check({})).toBe(false);
  expect(timing.Check({ startedAt: "2026-07-15T00:00:00.000Z", durationMs: -1 })).toBe(false);

  const bounds = TypeCompiler.Compile(BoundsSchema);
  expect(bounds.Check({})).toBe(true);
  expect(bounds.Check({ maxItems: 0, maxBytes: 0, maxLines: 0, maxDepth: 0, maxDurationMs: 0 })).toBe(true);
  expect(bounds.Check({ maxItems: -1 })).toBe(false);
  expect(bounds.Check({ futureField: 7 })).toBe(true);
});

test("ErrorInfoSchema admits the new stability codes and ProviderSummarySchema is tagged", () => {
  const error = TypeCompiler.Compile(ErrorInfoSchema);
  expect(error.Check({ code: "recipe_unavailable", message: "no recipe available", retryable: false })).toBe(true);
  expect(error.Check({ code: "plan_unavailable", message: "no plan available", retryable: true })).toBe(true);
  expect(error.Check({
    code: "stale_plan_target",
    message: "plan revision is stale",
    retryable: false,
    recommendedDelayMs: 250,
  })).toBe(true);
  expect(error.Check({ code: "recipe_unavailable", retryable: false })).toBe(false);
  expect(error.Check({ code: "missing_code", message: "x", retryable: false })).toBe(false);

  const provider = TypeCompiler.Compile(ProviderSummarySchema);
  expect(provider.Check({ kind: "provider_summary", provider: "anthropic", model: "claude", summary: "concise provider description" })).toBe(true);
  expect(provider.Check({ kind: "provider_summary", provider: "anthropic", summary: "concise provider description" })).toBe(true);
  expect(provider.Check({ kind: "summary", provider: "anthropic", summary: "x" })).toBe(false);
  expect(provider.Check({ provider: "anthropic", summary: "x" })).toBe(false);
});

test("ProviderSummarySchema enforces summary length, truncation, and closed shape", () => {
  const provider = TypeCompiler.Compile(ProviderSummarySchema);
  // summary — exactly 4096 is valid (the inclusive upper bound)
  expect(provider.Check({
    kind: "provider_summary",
    provider: "anthropic",
    summary: "a".repeat(4096),
  })).toBe(true);
  // summary — 4097 code units exceeds the cap and is invalid
  expect(provider.Check({
    kind: "provider_summary",
    provider: "anthropic",
    summary: "a".repeat(4097),
  })).toBe(false);
  // summary — missing entirely is invalid because it is required
  expect(provider.Check({ kind: "provider_summary", provider: "anthropic" })).toBe(false);
  // summary — empty string violates minLength 1
  expect(provider.Check({ kind: "provider_summary", provider: "anthropic", summary: "" })).toBe(false);
  // truncation — valid sibling block describing a clipped summary
  expect(provider.Check({
    kind: "provider_summary",
    provider: "anthropic",
    summary: "a".repeat(4096),
    truncation: {
      retainedBytes: 4096,
      totalBytes: 8192,
      digest: "0".repeat(64),
      isTruncated: true,
    },
  })).toBe(true);
  // unknown thinking field — closed object means any sibling outside the
  // declared property set (kind/provider/model/summary/truncation) is rejected
  expect(provider.Check({
    kind: "provider_summary",
    provider: "anthropic",
    summary: "concise provider description",
    thinking: "high",
  })).toBe(false);
});
