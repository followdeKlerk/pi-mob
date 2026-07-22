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
  expect(check.Check({ state: "degraded", reason: "stale revision" })).toBe(true);
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
  expect(provider.Check({ kind: "provider_summary", provider: "anthropic", model: "claude" })).toBe(true);
  expect(provider.Check({ kind: "provider_summary", provider: "anthropic" })).toBe(true);
  expect(provider.Check({ kind: "summary", provider: "anthropic" })).toBe(false);
  expect(provider.Check({ provider: "anthropic" })).toBe(false);
});
