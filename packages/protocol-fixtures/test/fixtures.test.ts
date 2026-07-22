import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COMMAND_TYPES, ERROR_CODES, EVENT_TYPES, RESPONSE_TYPES,
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

test("D-037 invalid corpus isolates schema and semantic invariants", () => {
  const schemaInvalid = [
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
  ];
  for (const file of schemaInvalid) {
    const entry = fixtureManifest.find((fixture) => fixture.file === file);
    expect(entry).toMatchObject({ file, valid: false, expectation: "expected-invalid" });
    const fixture = JSON.parse(readFileSync(join(corpus, file), "utf8"));
    expect(fixture.expectation).toBe("expected-invalid");
    expect(validateFixture(fixture), file).toBe(true);
  }

  const stale = JSON.parse(readFileSync(join(corpus, "semantic-invalid-prompt-file-ref-stale-revision.json"), "utf8"));
  const joint = JSON.parse(readFileSync(join(corpus, "semantic-invalid-prompt-joint-context-cap.json"), "utf8"));
  expect(stale).toMatchObject({ valid: true, expectation: "semantic-invalid", semanticExpectation: { outcome: "rejected", errorCode: "file_stale", currentRevision: "file-r2" } });
  expect(stale.message.payload.fileRefs[0].revision).toBe("file-r1");
  expect(joint).toMatchObject({ valid: true, expectation: "semantic-invalid", semanticExpectation: { outcome: "rejected", errorCode: "invalid_message", maxCombinedItems: 4 } });
  expect(joint.message.payload.attachmentIds).toHaveLength(4);
  expect(joint.message.payload.fileRefs).toHaveLength(1);
  for (const fixture of [stale, joint]) expect(validateFixture(fixture)).toBe(true);
  for (const file of ["semantic-invalid-prompt-file-ref-stale-revision.json", "semantic-invalid-prompt-joint-context-cap.json"]) {
    expect(fixtureManifest.find((fixture) => fixture.file === file)).toMatchObject({ file, valid: true, expectation: "semantic-invalid" });
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
