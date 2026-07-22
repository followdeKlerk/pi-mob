import { expect, test } from "bun:test";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import {
  COMMAND_METADATA,
  COMMAND_TYPES,
  CommandSchema,
  CONTROL_TYPES,
  ControlSchema,
  ERROR_CODES,
  ErrorSchema,
  EVENT_STREAM_OWNERSHIP,
  EVENT_TYPES,
  EventSchema,
  GIT_ACTIONS,
  GIT_CI_CAPABILITY,
  GitSummarySchema,
  LIMITS,
  RESPONSE_TYPES,
  ResponseSchema,
  SUPPORTED_CAPABILITIES,
} from "../src/index.ts";

const uuid = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const timestamp = "2026-07-15T00:00:00.000Z";
const revision = "git-r1";

const commandEnvelope = {
  protocol: { major: 1, minor: 0 }, messageId: uuid, requestId: uuid,
  connectionId: uuid, commandId: uuid, leaseId: uuid, sentAt: timestamp,
};
const controlEnvelope = {
  protocol: { major: 1, minor: 0 }, messageId: uuid, requestId: uuid,
  connectionId: uuid, sentAt: timestamp,
};
const responseEnvelope = {
  protocol: { major: 1, minor: 0 }, messageId: uuid, requestId: uuid, sentAt: timestamp,
};
const eventEnvelope = {
  protocol: { major: 1, minor: 0 }, messageId: uuid, eventId: uuid,
  sentAt: timestamp, streamId: `host:${uuid}`, cursor: "1",
};

function gitSummary(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId,
    revision,
    repository: "pi-mob/pi-mob",
    branch: "feature/git-ci",
    workingTreeState: "dirty",
    changedCount: 2,
    ahead: 1,
    behind: 0,
    latestCommit: {
      sha: "a".repeat(40),
      message: "Add Git/CI attention protocol",
      author: "Pi Mobile",
      authoredAt: timestamp,
    },
    pullRequest: {
      number: 42,
      title: "Add Git/CI attention protocol",
      url: "https://example.test/pi-mob/pull/42",
    },
    ciStatus: { state: "failure" },
    failedChecks: {
      totalCount: 1,
      items: [{
        name: "protocol-schema",
        status: "failure",
        summary: "schema check failed",
        url: "https://example.test/pi-mob/checks/1",
      }],
    },
    supportedActions: [...GIT_ACTIONS],
    capability: GIT_CI_CAPABILITY,
    lastRefreshedAt: timestamp,
    ...overrides,
  };
}

function gitCommandPayload(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId,
    expectedRevision: revision,
    confirmation: {
      confirmationId: "confirm-1",
      summary: "Commit the reviewed changes through Pi",
    },
    summaryHint: "Add Git/CI attention protocol",
    ...overrides,
  };
}

test("R6 registers additive Git/CI protocol families without removing established entries", () => {
  expect(COMMAND_TYPES).toEqual(expect.arrayContaining([
    "process.stop", "process.restart", "process.rerun",
    "git.commit.request", "git.push.request",
  ]));
  expect(EVENT_TYPES).toEqual(expect.arrayContaining([
    "process.snapshot", "process.output", "git.summary", "git.unavailable",
  ]));
  expect(CONTROL_TYPES).toEqual(expect.arrayContaining([
    "process.snapshot.request", "process.output.page", "git.summary.request",
  ]));
  expect(RESPONSE_TYPES).toEqual(expect.arrayContaining([
    "process.snapshot.result", "process.output.page.result", "git.summary.result",
  ]));
  expect(SUPPORTED_CAPABILITIES).toContain(GIT_CI_CAPABILITY);
  expect(ERROR_CODES).toEqual(expect.arrayContaining([
    "git_unavailable", "git_remote_missing", "git_provider_unavailable",
    "git_auth_missing", "git_stale", "git_action_failed",
  ]));
});

test("R6 Git summaries cover the full bounded status card and optional groups", () => {
  const summaries = TypeCompiler.Compile(GitSummarySchema);

  expect(summaries.Check(gitSummary())).toBe(true);
  expect(summaries.Check(gitSummary({
    workingTreeState: "clean",
    changedCount: 0,
    ahead: 0,
    pullRequest: undefined,
    ciStatus: undefined,
    failedChecks: undefined,
    supportedActions: [],
  }))).toBe(true);
  expect(summaries.Check(gitSummary({
    workingTreeState: "unknown",
    ciStatus: { state: "unknown" },
    failedChecks: { totalCount: 3, items: [] },
  }))).toBe(true);

  for (const state of ["success", "failure", "pending", "unknown"] as const) {
    expect(summaries.Check(gitSummary({ ciStatus: { state } }))).toBe(true);
    expect(summaries.Check(gitSummary({
      failedChecks: { totalCount: 1, items: [{ name: "check", status: state }] },
    }))).toBe(true);
  }
});

test("R6 Git summaries close fields and enforce identifiers, counts, URLs, checks, and actions", () => {
  const summaries = TypeCompiler.Compile(GitSummarySchema);
  const failedChecks = Array.from({ length: LIMITS.maxFailedChecks + 1 }, (_, index) => ({
    name: `check-${index}`,
    status: "failure",
  }));
  const invalid: unknown[] = [
    gitSummary({ private: "leak" }),
    gitSummary({ repository: "owner/repo with spaces" }),
    gitSummary({ repository: "r".repeat(LIMITS.maxRepositoryLabelLength + 1) }),
    gitSummary({ branch: "../secret" }),
    gitSummary({ branch: "feature@{upstream}" }),
    gitSummary({ branch: "b".repeat(LIMITS.maxBranchLength + 1) }),
    gitSummary({ workingTreeState: "modified" }),
    gitSummary({ changedCount: -1 }),
    gitSummary({ ahead: -1 }),
    gitSummary({ behind: -1 }),
    gitSummary({ latestCommit: { ...gitSummary().latestCommit, sha: "not-a-sha" } }),
    gitSummary({ latestCommit: { ...gitSummary().latestCommit, private: "leak" } }),
    gitSummary({ pullRequest: { number: 42, title: "PR", url: "http://example.test/42" } }),
    gitSummary({ pullRequest: { number: 42, title: "PR", url: `https://example.test/${"x".repeat(LIMITS.maxExternalUrlLength)}` } }),
    gitSummary({ ciStatus: { state: "cancelled" } }),
    gitSummary({ ciStatus: { state: "failure", private: "leak" } }),
    gitSummary({ failedChecks: { totalCount: LIMITS.maxFailedChecks + 1, items: [] } }),
    gitSummary({ failedChecks: { totalCount: LIMITS.maxFailedChecks, items: failedChecks } }),
    gitSummary({ failedChecks: { totalCount: 1, items: [{ name: "check", status: "failure", private: "leak" }] } }),
    gitSummary({ supportedActions: ["checkout"] }),
    gitSummary({ supportedActions: ["refresh", "refresh"] }),
    gitSummary({ capability: "commands.v1" }),
    gitSummary({ lastRefreshedAt: "not-a-timestamp" }),
  ];
  for (const value of invalid) expect(summaries.Check(value)).toBe(false);
});

test("R6 summary read control and response use exact closed workspace payloads", () => {
  const controls = TypeCompiler.Compile(ControlSchema);
  const responses = TypeCompiler.Compile(ResponseSchema);

  expect(controls.Check({ ...controlEnvelope, type: "git.summary.request", payload: { workspaceId } })).toBe(true);
  expect(controls.Check({ ...controlEnvelope, type: "git.summary.request", payload: {} })).toBe(false);
  expect(controls.Check({
    ...controlEnvelope,
    type: "git.summary.request",
    payload: { workspaceId, private: "leak" },
  })).toBe(false);

  expect(responses.Check({ ...responseEnvelope, type: "git.summary.result", payload: gitSummary() })).toBe(true);
  expect(responses.Check({
    ...responseEnvelope,
    type: "git.summary.result",
    payload: gitSummary({ private: "leak" }),
  })).toBe(false);
  expect(responses.Check({
    ...responseEnvelope,
    type: "git.summary.result",
    payload: { summary: gitSummary() },
  })).toBe(false);
});

test("R6 Git summary and unavailable events are closed host-stream records", () => {
  const events = TypeCompiler.Compile(EventSchema);
  const payloads = {
    "git.summary": gitSummary(),
    "git.unavailable": {
      workspaceId,
      capability: GIT_CI_CAPABILITY,
      status: {
        state: "unavailable",
        reason: "Git provider is not configured",
        remediation: "Configure the provider and refresh",
      },
    },
  } as const;

  for (const [type, payload] of Object.entries(payloads)) {
    expect(EVENT_STREAM_OWNERSHIP[type as keyof typeof EVENT_STREAM_OWNERSHIP]).toBe("host");
    expect(events.Check({ ...eventEnvelope, type, payload })).toBe(true);
    expect(events.Check({ ...eventEnvelope, type, streamId: `session:${uuid}`, payload })).toBe(false);
    expect(events.Check({ ...eventEnvelope, type, payload: { ...payload, private: true } })).toBe(false);
  }
});

test("R6 unavailable status is truthful for every capability state", () => {
  const events = TypeCompiler.Compile(EventSchema);
  for (const state of ["available", "degraded", "unavailable", "stale"] as const) {
    const status = state === "available"
      ? { state }
      : { state, reason: `${state} reason`, remediation: `${state} remediation` };
    expect(events.Check({ ...eventEnvelope, type: "git.unavailable", payload: {
      workspaceId, capability: GIT_CI_CAPABILITY, status,
    } })).toBe(true);
  }
  expect(events.Check({ ...eventEnvelope, type: "git.unavailable", payload: {
    workspaceId,
    capability: GIT_CI_CAPABILITY,
    status: { state: "stale" },
  } })).toBe(false);
  expect(events.Check({ ...eventEnvelope, type: "git.unavailable", payload: {
    workspaceId,
    capability: GIT_CI_CAPABILITY,
    status: { state: "unavailable", reason: "why", remediation: "fix", private: true },
  } })).toBe(false);
});

test("R6 Git actions are durable session commands with lease, revision, confirmation, metadata, and stable errors", () => {
  const commands = TypeCompiler.Compile(CommandSchema);
  for (const type of ["git.commit.request", "git.push.request"] as const) {
    const message = { ...commandEnvelope, type, payload: gitCommandPayload() };
    expect(commands.Check(message)).toBe(true);
    expect(commands.Check({ ...message, leaseId: undefined })).toBe(false);
    expect(commands.Check({ ...message, payload: gitCommandPayload({ workspaceId: undefined }) })).toBe(false);
    expect(commands.Check({ ...message, payload: gitCommandPayload({ expectedRevision: undefined }) })).toBe(false);
    expect(commands.Check({ ...message, payload: gitCommandPayload({ confirmation: undefined }) })).toBe(false);
    expect(commands.Check({
      ...message,
      payload: gitCommandPayload({ confirmation: { confirmationId: "bad id" } }),
    })).toBe(false);
    for (const forbidden of ["diff", "stage", "hunk", "checkout"] as const) {
      expect(commands.Check({
        ...message,
        payload: gitCommandPayload({ [forbidden]: "not allowed" }),
      })).toBe(false);
    }

    expect(COMMAND_METADATA.find((entry) => entry.type === type)).toMatchObject({
      scope: "session",
      requiresLeaseId: true,
      requiredCapability: GIT_CI_CAPABILITY,
      semanticHashFields: ["type", "payload"],
      idempotency: "command-id-semantic-payload-sha256",
    });
    expect(COMMAND_METADATA.find((entry) => entry.type === type)?.stableErrors).toEqual([
      "invalid_message",
      "unsupported_capability",
      "invalid_state",
      "idempotency_conflict",
      "git_unavailable",
      "git_remote_missing",
      "git_provider_unavailable",
      "git_auth_missing",
      "git_stale",
      "git_action_failed",
    ]);
  }
});

test("R6 Git/CI stable error codes validate on protocol error responses", () => {
  const errors = TypeCompiler.Compile(ErrorSchema);
  for (const code of [
    "git_unavailable", "git_remote_missing", "git_provider_unavailable",
    "git_auth_missing", "git_stale", "git_action_failed",
  ]) {
    expect(errors.Check({ ...responseEnvelope, type: "error", payload: {
      code, message: code, retryable: false, details: {},
    } })).toBe(true);
  }
});
