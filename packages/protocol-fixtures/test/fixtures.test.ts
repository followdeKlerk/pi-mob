import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COMMAND_TYPES, CONTROL_TYPES, ERROR_CODES, EVENT_TYPES, LIMITS, RESPONSE_TYPES,
  canonicalSemanticCommand, semanticCommandSha256, validateFixture,
} from "@pi-mob/protocol-schema";
import { ProtocolScenarioMachine, fixtureManifest, listFixtures, type ProtocolScenario } from "../src/index.ts";

const corpus = new URL("../corpus/", import.meta.url).pathname;

test("fixture corpus is exhaustive, sorted, round-trippable, and valid by label", () => {
  expect(fixtureManifest.length).toBeGreaterThan(100);
  expect(listFixtures()).toEqual([...listFixtures()].sort());
  const covered = { command: new Set<string>(), control: new Set<string>(), event: new Set<string>(), response: new Set<string>(), error: new Set<string>() };
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
  expect([...covered.control].sort()).toEqual([...CONTROL_TYPES].sort());
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
  "invalid-context-target-missing-kind.json",
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
    case "invalid-context-target-missing-kind.json":
      (payload.target as Record<string, unknown>).kind = "file";
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

const r5ExpectedInvalidFiles = [
  "invalid-process-private-field.json",
  "invalid-process-stdout-oversize.json",
  "invalid-process-stderr-oversize.json",
  "invalid-process-ports-33.json",
  "invalid-process-missing-session.json",
  "invalid-process-missing-process.json",
  "invalid-process-missing-revision.json",
  "invalid-process-pid.json",
  "invalid-process-status.json",
  "invalid-process-action.json",
  "invalid-process-stream.json",
  "invalid-process-host-stream.json",
] as const;

type R5ExpectedInvalidFile = typeof r5ExpectedInvalidFiles[number];

function repairR5ExpectedInvalid(file: R5ExpectedInvalidFile, message: Record<string, unknown>): Record<string, unknown> {
  const repaired = clone(message);
  const payload = repaired.payload as Record<string, unknown>;
  switch (file) {
    case "invalid-process-private-field.json":
      delete payload.private;
      break;
    case "invalid-process-stdout-oversize.json":
      payload.content = "ok: process completed\n";
      break;
    case "invalid-process-stderr-oversize.json":
      payload.content = "warning: fixture stderr\n";
      break;
    case "invalid-process-ports-33.json":
      payload.ports = (payload.ports as Array<unknown>).slice(0, LIMITS.maxProcessPorts);
      break;
    case "invalid-process-missing-session.json":
      payload.sessionId = "66666666-6666-4666-8666-666666666666";
      break;
    case "invalid-process-missing-process.json":
      payload.processId = "process-fixture";
      break;
    case "invalid-process-missing-revision.json":
      payload.revision = "process-r1";
      break;
    case "invalid-process-pid.json":
      payload.pid = 4123;
      break;
    case "invalid-process-status.json":
      payload.status = "running";
      break;
    case "invalid-process-action.json":
      payload.supportedActions = ["stop"];
      break;
    case "invalid-process-stream.json":
      payload.stream = "stdout";
      break;
    case "invalid-process-host-stream.json":
      repaired.streamId = "session:66666666-6666-4666-8666-666666666666";
      break;
  }
  return repaired;
}

test("R5 valid fixtures carry exhaustive controls, capability, snapshots, and distinct output streams", () => {
  const find = (file: string): FixtureRecord => JSON.parse(readFileSync(join(corpus, file), "utf8")) as FixtureRecord;
  const hello = find("hello-valid.json");
  expect((hello.message.payload as Record<string, unknown>).requiredCapabilities).not.toContain("runtime.processes.v1");
  expect((hello.message.payload as Record<string, unknown>).optionalCapabilities).toContain("runtime.processes.v1");
  expect((hello.message.payload as Record<string, unknown>).optionalCapabilities).toContain("git-ci.v1");
  expect((find("response-hello-accepted-valid.json").message.payload as Record<string, unknown>).capabilities).toContain("runtime.processes.v1");
  expect((find("response-hello-accepted-valid.json").message.payload as Record<string, unknown>).capabilities).toContain("git-ci.v1");
  expect(find("command-process-stop-valid.json").valid).toBe(true);
  expect(find("control-process-snapshot-request-valid.json").valid).toBe(true);
  expect(find("control-process-output-page-valid.json").valid).toBe(true);
  expect(find("response-process-snapshot-result-valid.json").valid).toBe(true);
  expect(find("response-process-output-page-result-valid.json").valid).toBe(true);

  const snapshot = find("event-process-snapshot-valid.json").message.payload as Record<string, unknown>;
  expect(snapshot).toMatchObject({ processId: "process-fixture", revision: "process-r1", status: "running", pid: 4123, cwd: "packages/protocol-fixtures", capability: "runtime.processes.v1", supportedActions: ["stop"] });
  const stdout = find("event-process-output-valid.json").message.payload as Record<string, unknown>;
  const stderr = find("process-output-stderr-valid.json").message.payload as Record<string, unknown>;
  expect(stdout).toMatchObject({ sessionId: snapshot.sessionId, processId: snapshot.processId, revision: snapshot.revision, stream: "stdout", content: "ok: process completed\n" });
  expect(stderr).toMatchObject({ sessionId: snapshot.sessionId, processId: snapshot.processId, revision: snapshot.revision, stream: "stderr", content: "warning: fixture stderr\n" });
  for (const code of ["process_unavailable", "process_not_found", "process_stale", "process_failed"]) {
    expect(find(`error-${code.replaceAll("_", "-")}-valid.json`).valid).toBe(true);
  }
});

test("R5 expected-invalid fixtures isolate one schema invariant and prove one-field repairs", () => {
  for (const file of r5ExpectedInvalidFiles) {
    const fixture = JSON.parse(readFileSync(join(corpus, file), "utf8")) as FixtureRecord;
    expect(fixture.valid, file).toBe(false);
    expect(fixture.expectation, file).toBe("expected-invalid");
    expect(validateFixture(fixture), file).toBe(true);
    const repairedMessage = repairR5ExpectedInvalid(file, fixture.message);
    expect(JSON.stringify(repairedMessage), file).not.toBe(JSON.stringify(fixture.message));
    expect(validateFixture({ ...clone(fixture), valid: true, message: repairedMessage }), file).toBe(true);
  }
});

type ProcessSemanticError = "invalid_state" | "process_stale";
type ProcessAuthority = { readonly revision: string; readonly status: string; readonly supportedActions: readonly string[] };
function validateProcessSemantics(message: Record<string, unknown>, authority: ProcessAuthority): ProcessSemanticError | undefined {
  const payload = message.payload as Record<string, unknown>;
  if (payload.expectedRevision !== authority.revision) return "process_stale";
  const action = message.type as string;
  if (!authority.supportedActions.includes(action.slice("process.".length))) return "invalid_state";
  if (action === "process.restart" && authority.status === "running") return "invalid_state";
  return undefined;
}

const r6ExpectedInvalidFiles = [
  "invalid-git-summary-private-field.json",
  "invalid-git-summary-url-http.json",
  "invalid-git-summary-url-hostless.json",
  "invalid-git-summary-url-bad.json",
  "invalid-git-summary-failed-checks-21.json",
  "invalid-git-summary-check-name-oversize.json",
  "invalid-git-summary-check-log-oversize.json",
  "invalid-git-summary-branch-oversize.json",
  "invalid-git-summary-repository-oversize.json",
  "invalid-git-summary-count-oversize.json",
  "invalid-git-summary-detached-branch-mismatch.json",
  "invalid-git-summary-missing-ci-status.json",
  "invalid-git-summary-missing-failed-checks.json",
  "invalid-git-command-missing-session.json",
  "invalid-git-command-missing-confirmation.json",
  "invalid-git-command-missing-revision.json",
  "invalid-git-summary-cancel-missing-target.json",
  "invalid-git-summary-session-stream.json",
  "invalid-git-unavailable-private-field.json",
] as const;

type R6ExpectedInvalidFile = typeof r6ExpectedInvalidFiles[number];

function repairR6ExpectedInvalid(file: R6ExpectedInvalidFile, message: Record<string, unknown>): Record<string, unknown> {
  const repaired = clone(message);
  const payload = repaired.payload as Record<string, unknown>;
  switch (file) {
    case "invalid-git-summary-private-field.json":
      delete payload.private;
      break;
    case "invalid-git-summary-url-http.json":
    case "invalid-git-summary-url-hostless.json":
      payload.repositoryUrl = "https://example.test/pi-mob";
      break;
    case "invalid-git-summary-url-bad.json":
      (payload.latestCommit as Record<string, unknown>).url = "https://example.test/pi-mob/commit/aaa";
      break;
    case "invalid-git-summary-failed-checks-21.json":
      payload.failedChecks = (payload.failedChecks as Array<unknown>).slice(0, LIMITS.maxFailedChecks);
      break;
    case "invalid-git-summary-check-name-oversize.json":
      ((payload.failedChecks as Array<Record<string, unknown>>)[0]!).name = "protocol-schema";
      break;
    case "invalid-git-summary-check-log-oversize.json":
      ((payload.failedChecks as Array<Record<string, unknown>>)[0]!).logSummary = "protocol schema generation differs from checked-in artifacts";
      break;
    case "invalid-git-summary-branch-oversize.json":
      payload.branch = "feature/git-ci";
      break;
    case "invalid-git-summary-repository-oversize.json":
      payload.repository = "pi-mob/pi-mob";
      break;
    case "invalid-git-summary-count-oversize.json":
      payload.changedCount = 2;
      break;
    case "invalid-git-summary-detached-branch-mismatch.json":
      payload.branch = null;
      break;
    case "invalid-git-summary-missing-ci-status.json":
      payload.ciStatus = { state: "failure" };
      break;
    case "invalid-git-summary-missing-failed-checks.json":
      payload.failedChecks = [{
        name: "protocol-schema",
        status: "failure",
        summary: "schema check failed",
        logSummary: "protocol schema generation differs from checked-in artifacts",
        url: "https://example.test/pi-mob/checks/1",
      }];
      break;
    case "invalid-git-command-missing-session.json":
      payload.sessionId = "66666666-6666-4666-8666-666666666666";
      break;
    case "invalid-git-command-missing-confirmation.json":
      payload.confirmation = {
        confirmationId: "confirm-commit-1",
        summary: "Commit the reviewed changes through Pi",
      };
      break;
    case "invalid-git-command-missing-revision.json":
      payload.expectedRevision = "git-r1";
      break;
    case "invalid-git-summary-cancel-missing-target.json":
      payload.targetRequestId = "22222222-2222-4222-8222-222222222222";
      break;
    case "invalid-git-summary-session-stream.json":
      repaired.streamId = "host:66666666-6666-4666-8666-666666666666";
      break;
    case "invalid-git-unavailable-private-field.json":
      delete payload.private;
      break;
  }
  return repaired;
}

type GitSemanticError = "git_stale" | "invalid_state";
type GitAuthority = { readonly revision: string; readonly supportedActions: readonly string[] };
function validateGitSemantics(message: Record<string, unknown>, authority: GitAuthority): GitSemanticError | undefined {
  const payload = message.payload as Record<string, unknown>;
  if (payload.expectedRevision !== authority.revision) return "git_stale";
  const action = message.type === "git.commit.request"
    ? "commit_through_pi"
    : message.type === "git.push.request"
    ? "push_through_pi"
    : undefined;
  if (action !== undefined && !authority.supportedActions.includes(action)) return "invalid_state";
  return undefined;
}

test("R6 valid fixtures cover Git/CI commands, controls, events, responses, and stable errors", () => {
  const find = (file: string): FixtureRecord => JSON.parse(readFileSync(join(corpus, file), "utf8")) as FixtureRecord;
  expect(find("command-git-commit-request-valid.json").valid).toBe(true);
  expect(find("command-git-push-request-valid.json").valid).toBe(true);
  expect(find("control-git-summary-request-valid.json").valid).toBe(true);
  expect(find("control-git-summary-cancel-valid.json").valid).toBe(true);
  expect(find("event-git-summary-valid.json").valid).toBe(true);
  expect(find("event-git-unavailable-valid.json").valid).toBe(true);
  expect(find("response-git-summary-result-valid.json").valid).toBe(true);
  for (const code of [
    "git_unavailable",
    "git_remote_missing",
    "git_provider_unavailable",
    "git_auth_missing",
    "git_stale",
    "git_action_failed",
  ]) {
    expect(find(`error-${code.replaceAll("_", "-")}-valid.json`).valid).toBe(true);
  }
  const summary = find("event-git-summary-valid.json").message.payload as Record<string, unknown>;
  expect(summary).toMatchObject({
    workspaceId: "88888888-8888-4888-8888-888888888888",
    revision: "git-r1",
    capability: "git-ci.v1",
    repository: "pi-mob/pi-mob",
    branch: "feature/git-ci",
  });
  expect((summary.failedChecks as Array<Record<string, unknown>>)[0]?.logSummary).toBe(
    "protocol schema generation differs from checked-in artifacts",
  );
});

test("R6 expected-invalid fixtures isolate one schema invariant and prove one-field repairs", () => {
  for (const file of r6ExpectedInvalidFiles) {
    const fixture = JSON.parse(readFileSync(join(corpus, file), "utf8")) as FixtureRecord;
    expect(fixture.valid, file).toBe(false);
    expect(fixture.expectation, file).toBe("expected-invalid");
    expect(validateFixture(fixture), file).toBe(true);
    const repairedMessage = repairR6ExpectedInvalid(file, fixture.message);
    expect(JSON.stringify(repairedMessage), file).not.toBe(JSON.stringify(fixture.message));
    expect(validateFixture({ ...clone(fixture), valid: true, message: repairedMessage }), file).toBe(true);
  }
});

test("R6 semantic-invalid Git actions are schema-valid, hard-coded, and repaired one field at a time", () => {
  const cases = [
    {
      file: "semantic-invalid-git-commit-stale-revision.json",
      expected: "git_stale" as const,
      authority: { revision: "git-r2", supportedActions: ["refresh", "commit_through_pi", "push_through_pi", "open_external"] },
      metadata: { outcome: "rejected", errorCode: "git_stale", currentRevision: "git-r2" },
    },
    {
      file: "semantic-invalid-git-commit-unsupported-action.json",
      expected: "invalid_state" as const,
      authority: { revision: "git-r1", supportedActions: ["refresh", "push_through_pi", "open_external"] },
      metadata: { outcome: "rejected", errorCode: "invalid_state", supportedActions: ["refresh", "push_through_pi", "open_external"] },
    },
    {
      file: "semantic-invalid-git-push-unsupported-action.json",
      expected: "invalid_state" as const,
      authority: { revision: "git-r1", supportedActions: ["refresh", "commit_through_pi", "open_external"] },
      metadata: { outcome: "rejected", errorCode: "invalid_state", supportedActions: ["refresh", "commit_through_pi", "open_external"] },
    },
  ] as const;
  for (const item of cases) {
    const fixture = JSON.parse(readFileSync(join(corpus, item.file), "utf8")) as FixtureRecord;
    expect(fixture.valid, item.file).toBe(true);
    expect(fixture.expectation, item.file).toBe("semantic-invalid");
    expect(validateFixture(fixture), item.file).toBe(true);
    expect(validateGitSemantics(fixture.message, item.authority), item.file).toBe(item.expected);
    expect(fixture.semanticExpectation).toEqual(item.metadata);

    const repairedMessage = clone(fixture.message);
    if (item.file === "semantic-invalid-git-commit-stale-revision.json") {
      (repairedMessage.payload as Record<string, unknown>).expectedRevision = "git-r2";
    } else if (item.file === "semantic-invalid-git-commit-unsupported-action.json") {
      repairedMessage.type = "git.push.request";
    } else {
      repairedMessage.type = "git.commit.request";
    }
    expect(validateGitSemantics(repairedMessage, item.authority), item.file).toBeUndefined();
    expect(validateFixture({ ...clone(fixture), message: repairedMessage }), item.file).toBe(true);
  }
});

test("R5 semantic-invalid process actions are schema-valid, hard-coded, and repaired one field at a time", () => {
  const cases = [
    {
      file: "semantic-invalid-process-stop-unsupported.json",
      expected: "invalid_state" as const,
      authority: { revision: "process-r1", status: "completed", supportedActions: ["restart", "rerun"] },
      metadata: { outcome: "rejected", errorCode: "invalid_state", supportedActions: ["restart", "rerun"] },
    },
    {
      file: "semantic-invalid-process-stale-revision.json",
      expected: "process_stale" as const,
      authority: { revision: "process-r2", status: "running", supportedActions: ["stop"] },
      metadata: { outcome: "rejected", errorCode: "process_stale", currentRevision: "process-r2" },
    },
    {
      file: "semantic-invalid-process-joint-action-state.json",
      expected: "invalid_state" as const,
      authority: { revision: "process-r1", status: "running", supportedActions: ["stop", "restart"] },
      metadata: { outcome: "rejected", errorCode: "invalid_state", status: "running", supportedActions: ["stop", "restart"] },
    },
  ] as const;
  for (const item of cases) {
    const fixture = JSON.parse(readFileSync(join(corpus, item.file), "utf8")) as FixtureRecord;
    expect(fixture.valid, item.file).toBe(true);
    expect(fixture.expectation, item.file).toBe("semantic-invalid");
    expect(validateFixture(fixture), item.file).toBe(true);
    // This expected code is selected by the test case, never by fixture metadata.
    expect(validateProcessSemantics(fixture.message, item.authority), item.file).toBe(item.expected);
    expect(fixture.semanticExpectation).toEqual(item.metadata);

    const repairedMessage = clone(fixture.message);
    if (item.file === "semantic-invalid-process-stop-unsupported.json") {
      repairedMessage.type = "process.restart";
    } else if (item.file === "semantic-invalid-process-stale-revision.json") {
      (repairedMessage.payload as Record<string, unknown>).expectedRevision = "process-r2";
    } else {
      repairedMessage.type = "process.stop";
    }
    expect(validateProcessSemantics(repairedMessage, item.authority), item.file).toBeUndefined();
    expect(validateFixture({ ...clone(fixture), message: repairedMessage }), item.file).toBe(true);
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
