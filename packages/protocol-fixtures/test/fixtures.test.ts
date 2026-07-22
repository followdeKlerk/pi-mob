import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COMMAND_TYPES, ERROR_CODES, EVENT_TYPES, LIMITS, RESPONSE_TYPES,
  canonicalSemanticCommand, semanticCommandSha256, validateFixture,
} from "@pi-mob/protocol-schema";
import { ProtocolScenarioMachine, fixtureManifest, listFixtures, type ProtocolScenario } from "../src/index.ts";

const corpus = new URL("../corpus/", import.meta.url).pathname;

test("fixture corpus is exhaustive, sorted, round-trippable, and valid by label", () => {
  expect(fixtureManifest.length).toBeGreaterThan(100);
  expect(listFixtures()).toEqual([...listFixtures()].sort());
  const covered = { command: new Set<string>(), event: new Set<string>(), response: new Set<string>(), error: new Set<string>() };
  for (const entry of fixtureManifest) {
    const fixture = JSON.parse(readFileSync(join(corpus, entry.file), "utf8")) as { readonly valid: boolean; readonly kind: string; readonly message: Record<string, unknown> };
    expect(fixture.valid).toBe(entry.valid);
    expect(fixture.kind).toBe(entry.kind);
    expect(validateFixture(fixture)).toBe(true);
    expect(validateFixture(JSON.parse(JSON.stringify(fixture)))).toBe(true);
    if (fixture.valid && fixture.kind in covered) {
      const value = fixture.kind === "error"
        ? (fixture.message.payload as Record<string, unknown>).code
        : fixture.message.type;
      if (typeof value === "string") covered[fixture.kind as keyof typeof covered].add(value);
    }
    if (fixture.valid) assertCursorStrings(fixture.message, entry.file);
  }
  expect([...covered.command].sort()).toEqual([...COMMAND_TYPES].sort());
  expect([...covered.event].filter((type) => EVENT_TYPES.includes(type as never)).sort()).toEqual([...EVENT_TYPES].sort());
  expect([...covered.response].sort()).toEqual([...RESPONSE_TYPES].sort());
  expect([...covered.error].sort()).toEqual([...ERROR_CODES].sort());
});

function assertCursorStrings(value: unknown, source: string, key = ""): void {
  if (Array.isArray(value)) {
    for (const item of value) assertCursorStrings(item, source, key);
    return;
  }
  if (value === null || typeof value !== "object") {
    if (/cursor$/i.test(key)) expect(typeof value, source).toBe("string");
    return;
  }
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    assertCursorStrings(child, source, childKey);
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type FixtureRecord = {
  readonly name: string;
  readonly kind: string;
  readonly valid: boolean;
  readonly message: Record<string, unknown>;
  readonly expectation?: string;
  readonly semanticExpectation?: Record<string, unknown>;
};

const expectedInvalidFiles = [
  "invalid-workspace-path-traversal.json",
  "invalid-workspace-path-exact-dot.json",
  "invalid-workspace-tree-depth-17.json",
  "invalid-workspace-path-oversize.json",
  "invalid-workspace-tree-page-size-oversize.json",
  "invalid-workspace-file-size-oversize.json",
  "invalid-workspace-file-read-oversize.json",
  "invalid-context-token-decimal-exponent.json",
  "invalid-context-token-17-digit.json",
  "invalid-context-missing-expected-revision.json",
  "invalid-context-missing-target.json",
  "invalid-workspace-file-metadata-private-field.json",
  "invalid-context-target-private-field.json",
  "invalid-prompt-file-ref-private-field.json",
  "invalid-prompt-file-ref-missing-revision.json",
] as const;

type ExpectedInvalidFile = typeof expectedInvalidFiles[number];

function repairExpectedInvalid(file: ExpectedInvalidFile, message: Record<string, unknown>): Record<string, unknown> {
  const repaired = clone(message);
  const payload = repaired.payload as Record<string, unknown>;
  switch (file) {
    case "invalid-workspace-path-traversal.json":
    case "invalid-workspace-path-exact-dot.json":
    case "invalid-workspace-path-oversize.json":
      payload.path = "src";
      break;
    case "invalid-workspace-tree-depth-17.json":
      ((payload.items as Array<Record<string, unknown>>)[0]!).depth = LIMITS.maxTreeDepth;
      break;
    case "invalid-workspace-tree-page-size-oversize.json":
      payload.pageSize = LIMITS.maxTreePageItems;
      break;
    case "invalid-workspace-file-size-oversize.json":
      ((payload.file as Record<string, unknown>)).size = LIMITS.maxFileSize;
      break;
    case "invalid-workspace-file-read-oversize.json":
      ((payload.result as Record<string, unknown>)).content = "x";
      break;
    case "invalid-context-token-decimal-exponent.json":
    case "invalid-context-token-17-digit.json":
      ((payload.tokenUsage as Record<string, unknown>)).inputTokens = "9999999999999999";
      break;
    case "invalid-context-missing-expected-revision.json":
      payload.expectedRevision = "context-r1";
      break;
    case "invalid-context-missing-target.json":
      payload.target = { kind: "file", path: "src/index.ts", revision: "file-r1" };
      break;
    case "invalid-workspace-file-metadata-private-field.json":
      delete (payload.file as Record<string, unknown>).private;
      break;
    case "invalid-context-target-private-field.json":
      delete (payload.target as Record<string, unknown>).private;
      break;
    case "invalid-prompt-file-ref-private-field.json":
      delete ((payload.fileRefs as Array<Record<string, unknown>>)[0]!).private;
      break;
    case "invalid-prompt-file-ref-missing-revision.json":
      ((payload.fileRefs as Array<Record<string, unknown>>)[0]!).revision = "file-r1";
      break;
  }
  return repaired;
}

type SemanticError = "file_stale" | "invalid_message";
function validatePromptSemantics(message: Record<string, unknown>, currentFileRevision: string): SemanticError | undefined {
  const payload = message.payload as Record<string, unknown>;
  const fileRefs = payload.fileRefs as Array<Record<string, unknown>>;
  const attachmentIds = payload.attachmentIds as Array<unknown>;
  if (fileRefs.some((fileRef) => fileRef.revision !== currentFileRevision)) return "file_stale";
  if (fileRefs.length + attachmentIds.length > 4) return "invalid_message";
  return undefined;
}

test("D-037 invalid corpus isolates schema and semantic invariants", () => {
  for (const file of expectedInvalidFiles) {
    const entry = fixtureManifest.find((fixture) => fixture.file === file);
    expect(entry).toMatchObject({ file, valid: false, expectation: "expected-invalid" });
    const fixture = JSON.parse(readFileSync(join(corpus, file), "utf8")) as FixtureRecord;
    expect(fixture.expectation).toBe("expected-invalid");
    expect(validateFixture(fixture), file).toBe(true);

    const repairedMessage = repairExpectedInvalid(file, fixture.message);
    expect(JSON.stringify(repairedMessage)).not.toBe(JSON.stringify(fixture.message));
    expect(validateFixture({ ...clone(fixture), valid: true, message: repairedMessage }), file).toBe(true);
  }

  const semanticFiles = [
    "semantic-invalid-prompt-file-ref-stale-revision.json",
    "semantic-invalid-prompt-joint-context-cap.json",
  ] as const;
  for (const file of semanticFiles) {
    const fixture = JSON.parse(readFileSync(join(corpus, file), "utf8")) as FixtureRecord;
    expect(fixture.valid).toBe(true);
    expect(fixture.expectation).toBe("semantic-invalid");
    expect(validateFixture(fixture)).toBe(true);
    const isStaleRevision = file === "semantic-invalid-prompt-file-ref-stale-revision.json";
    const expectedError: SemanticError = isStaleRevision ? "file_stale" : "invalid_message";
    expect(fixture.semanticExpectation?.outcome).toBe("rejected");
    expect(fixture.semanticExpectation?.errorCode).toBe(expectedError);
    if (isStaleRevision) {
      expect(fixture.semanticExpectation?.currentRevision).toBe("file-r2");
    } else {
      expect(fixture.semanticExpectation?.maxCombinedItems).toBe(4);
    }
    const currentRevision = isStaleRevision ? "file-r2" : "file-r1";
    expect(validatePromptSemantics(fixture.message, currentRevision)).toBe(expectedError);

    const repairedMessage = clone(fixture.message);
    const payload = repairedMessage.payload as Record<string, unknown>;
    if (file === "semantic-invalid-prompt-file-ref-stale-revision.json") {
      ((payload.fileRefs as Array<Record<string, unknown>>)[0]!).revision = "file-r2";
    } else {
      payload.attachmentIds = (payload.attachmentIds as Array<unknown>).slice(0, 3);
    }
    expect(validatePromptSemantics(repairedMessage, currentRevision)).toBeUndefined();
    expect(validateFixture({ ...clone(fixture), message: repairedMessage })).toBe(true);
  }
});

test("tool output boundary metadata remains exact and bounded", () => {
  const eventBoundary = JSON.parse(readFileSync(join(corpus, "tool-output-event-boundary.json"), "utf8"));
  const retainedBoundary = JSON.parse(readFileSync(join(corpus, "tool-output-retained-boundary.json"), "utf8"));
  expect(eventBoundary.message.payload).toMatchObject({ retainedBytes: 262144, totalBytes: 262144, isTruncated: false });
  expect(retainedBoundary.message.payload).toMatchObject({ retainedBytes: 5242880, totalBytes: 6291456, isTruncated: true });
  expect(retainedBoundary.message.payload.digest).toHaveLength(64);
  expect(validateFixture(eventBoundary)).toBe(true);
  expect(validateFixture(retainedBoundary)).toBe(true);
});

test("ordered scenario matrix applies every transition and reaches its declared outcome", () => {
  const scenarios = JSON.parse(readFileSync(join(corpus, "scenarios.json"), "utf8")) as ProtocolScenario[];
  expect(scenarios.map((scenario) => scenario.name)).toEqual([
    "pairing-valid-invalid", "hello-mismatch-generation", "replay-gap-conflicting-duplicate", "multipart-snapshot-post-baseline", "controller-reclaim-takeover-expiry-stale", "command-conflict-restart-indeterminate", "prompt-immediate-steer-follow-up-queue", "attachment-retry-conflict-expiry-malformed-oversized", "export-dialog-pagination", "oversized-slow-consumer-pi-db", "unknown-optional-required-capability",
  ]);
  for (const scenario of scenarios) {
    expect(scenario.steps.length).toBeGreaterThan(1);
    expect(scenario.outcome).not.toBeEmpty();
    const machine = new ProtocolScenarioMachine();
    for (const step of scenario.steps) {
      const entry = fixtureManifest.find((fixture) => fixture.file === step.fixture);
      expect(entry).toBeDefined();
      const fixture = JSON.parse(readFileSync(join(corpus, step.fixture), "utf8"));
      expect(validateFixture(fixture)).toBe(true);
      expect(machine.apply(step.action, fixture)).toBe(step.expect);
    }
    expect(machine.phase).toBe(scenario.outcome);
  }
});

test("shared semantic hash matrix excludes transport metadata and normalizes Unicode", () => {
  const cases = JSON.parse(readFileSync(join(corpus, "semantic-hashes.json"), "utf8")) as Array<{
    readonly messages?: ReadonlyArray<{ readonly type: string; readonly payload: Record<string, unknown> }>;
    readonly semanticCommands?: ReadonlyArray<{ readonly type: string; readonly payload: Record<string, unknown> }>;
    readonly canonical: string;
    readonly sha256: string;
  }>;
  for (const hashCase of cases) {
    const commands = hashCase.messages ?? hashCase.semanticCommands ?? [];
    expect(commands.length).toBeGreaterThan(1);
    for (const command of commands) {
      expect(canonicalSemanticCommand(command)).toBe(hashCase.canonical);
      expect(semanticCommandSha256(command)).toBe(hashCase.sha256);
    }
  }
});

test("scenario transitions reject out-of-order behavior", () => {
  const machine = new ProtocolScenarioMachine();
  expect(() => machine.apply("snapshot.end")).toThrow("requires part_two");
});
