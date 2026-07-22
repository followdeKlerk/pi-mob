import { describe, expect, test } from "bun:test";
import { LIMITS, validateFixture } from "@pi-mob/protocol-schema";
import { GitSummaryService, validateGitHttpsUrl, type GitCommandRunner } from "../src/git/summary-service";

const workspaceId = "22222222-2222-4222-8222-222222222222";

const runner = (outputs: Record<string, { code: number; stdout: string; stderr?: string }>, options?: { onRun?: (args: readonly string[]) => void }): GitCommandRunner => ({
  async run(_command, args, runOptions) {
    options?.onRun?.(args);
    if (runOptions.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const key = args.join(" ");
    const output = outputs[key] ?? { code: 1, stdout: "", stderr: "missing" };
    return { ...output, stderr: output.stderr ?? "" };
  },
});

function validSummaryPayload(payload: unknown): boolean {
  return validateFixture({
    name: "git-summary-service-summary",
    kind: "event",
    valid: true,
    message: {
      protocol: { major: 1, minor: 0 },
      messageId: "11111111-1111-4111-8111-111111111111",
      sentAt: "2026-01-02T00:00:00.000Z",
      eventId: "33333333-3333-4333-8333-333333333333",
      streamId: "host:44444444-4444-4444-8444-444444444444",
      cursor: "1",
      type: "git.summary",
      payload,
    },
  });
}

function validUnavailablePayload(payload: unknown): boolean {
  return validateFixture({
    name: "git-summary-service-unavailable",
    kind: "event",
    valid: true,
    message: {
      protocol: { major: 1, minor: 0 },
      messageId: "11111111-1111-4111-8111-111111111111",
      sentAt: "2026-01-02T00:00:00.000Z",
      eventId: "33333333-3333-4333-8333-333333333333",
      streamId: "host:44444444-4444-4444-8444-444444444444",
      cursor: "1",
      type: "git.unavailable",
      payload,
    },
  });
}

function baseOutputs(overrides: Record<string, { code: number; stdout: string; stderr?: string }> = {}) {
  return {
    "rev-parse --show-toplevel": { code: 0, stdout: "/repo\n" },
    "remote get-url origin": { code: 0, stdout: "git@github.com:acme/repo.git\n" },
    "log -1 --format=%H%x00%s%x00%an%x00%aI": {
      code: 0,
      stdout: "abcdef1234567890abcdef1234567890abcdef12\0First commit\nsecond line\0A. Author\x002026-01-01T00:00:00+00:00\n",
    },
    "symbolic-ref --quiet --short HEAD": { code: 0, stdout: "main\n" },
    "status --porcelain=v1 -z --untracked-files=normal": { code: 0, stdout: "M  a.txt\0?? b.txt\0" },
    "rev-list --left-right --count HEAD...@{upstream}": { code: 0, stdout: "2 3\n" },
    ...overrides,
  };
}

test("validates HTTPS links and rejects credentials, whitespace, and oversize URLs", () => {
  expect(validateGitHttpsUrl("https://github.com/acme/repo")).toBe("https://github.com/acme/repo");
  expect(validateGitHttpsUrl("http://github.com/acme/repo")).toBeNull();
  expect(validateGitHttpsUrl("https://u:p@github.com/acme/repo")).toBeNull();
  expect(validateGitHttpsUrl("https://github.com/acme/repo\n")).toBeNull();
  expect(validateGitHttpsUrl(`https://example.test/${"x".repeat(LIMITS.maxExternalUrlLength)}`)).toBeNull();
});

test("builds an attached summary that matches the R6 wire schema", async () => {
  const result = await new GitSummaryService({
    runner: runner(baseOutputs()),
    now: () => new Date("2026-01-02T00:00:00Z"),
    supportedActions: ["refresh", "commit_through_pi", "open_external"],
  }).summarize(workspaceId, "/repo");

  expect(validSummaryPayload(result)).toBe(true);
  expect(result).toMatchObject({
    repository: "acme/repo",
    detached: false,
    branch: "main",
    workingTreeState: "dirty",
    changedCount: 2,
    ahead: 2,
    behind: 3,
    supportedActions: ["refresh", "commit_through_pi", "open_external"],
    latestCommit: {
      message: "First commit",
      authoredAt: "2026-01-01T00:00:00.000Z",
      url: "https://github.com/acme/repo/commit/abcdef1234567890abcdef1234567890abcdef12",
    },
  });
});

test("keeps detached summaries valid without inventing a branch or upstream counts", async () => {
  const result = await new GitSummaryService({
    runner: runner(baseOutputs({ "symbolic-ref --quiet --short HEAD": { code: 1, stdout: "", stderr: "detached" } })),
    now: () => new Date("2026-01-02T00:00:00Z"),
  }).summarize(workspaceId, "/repo");

  expect(validSummaryPayload(result)).toBe(true);
  expect(result).toMatchObject({ detached: true, branch: null, ahead: 0, behind: 0 });
});

test("returns unavailable for missing remote", async () => {
  const result = await new GitSummaryService({ runner: runner({ "rev-parse --show-toplevel": { code: 0, stdout: "/repo\n" } }) }).summarize(workspaceId, "/repo");
  expect(validUnavailablePayload(result)).toBe(true);
  expect(result).toMatchObject({ status: { state: "unavailable", reason: "Repository has no origin remote" } });
});

test("returns unavailable instead of false zeroes when upstream is missing", async () => {
  const result = await new GitSummaryService({
    runner: runner(baseOutputs({ "rev-list --left-right --count HEAD...@{upstream}": { code: 128, stdout: "", stderr: "no upstream" } })),
  }).summarize(workspaceId, "/repo");

  expect(validUnavailablePayload(result)).toBe(true);
  expect(result).toMatchObject({ status: { reason: "Upstream tracking status is unavailable" } });
});

describe("provider validation", () => {
  test("does not fabricate CI when the provider throws", async () => {
    const result = await new GitSummaryService({
      runner: runner(baseOutputs()),
      provider: { summary: async () => { throw new Error("offline"); } },
    }).summarize(workspaceId, "/repo");
    expect(validUnavailablePayload(result)).toBe(true);
    expect(result).toMatchObject({ status: { reason: "Git provider is unavailable" } });
  });

  test("rejects malformed provider payloads instead of clipping them into a fake summary", async () => {
    const result = await new GitSummaryService({
      runner: runner(baseOutputs()),
      provider: {
        summary: async () => ({
          ciStatus: { state: "failure" },
          failedChecks: Array.from({ length: LIMITS.maxFailedChecks + 1 }, (_, index) => ({ name: `check-${index}`, status: "failure" })),
        }),
      },
    }).summarize(workspaceId, "/repo");

    expect(validUnavailablePayload(result)).toBe(true);
    expect(result).toMatchObject({ status: { reason: "Git provider returned an invalid summary payload" } });
  });

  test("validates bounded PR and failed-check links when the provider payload is well formed", async () => {
    const result = await new GitSummaryService({
      runner: runner(baseOutputs()),
      provider: {
        summary: async () => ({
          pullRequest: { number: 42, title: "Open PR", url: "https://github.com/acme/repo/pull/42" },
          ciStatus: { state: "failure" },
          failedChecks: [{
            name: "schema",
            status: "failure",
            summary: "schema failed",
            logSummary: "details",
            url: "https://github.com/acme/repo/actions/runs/1",
          }],
        }),
      },
      supportedActions: ["refresh", "open_external"],
    }).summarize(workspaceId, "/repo");

    expect(validSummaryPayload(result)).toBe(true);
    expect(result).toMatchObject({
      pullRequest: { number: 42, title: "Open PR" },
      ciStatus: { state: "failure" },
      failedChecks: [{ name: "schema", status: "failure", summary: "schema failed", logSummary: "details" }],
      supportedActions: ["refresh", "open_external"],
    });
  });
});

test("injects supported actions explicitly and never infers commit or push from provider presence", async () => {
  const result = await new GitSummaryService({
    runner: runner(baseOutputs()),
    provider: {
      summary: async () => ({
        ciStatus: { state: "success" },
        failedChecks: [],
      }),
    },
    supportedActions: ["refresh"],
  }).summarize(workspaceId, "/repo");

  expect(validSummaryPayload(result)).toBe(true);
  expect(result).toMatchObject({ supportedActions: ["refresh"] });
});

test("returns unavailable on cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  const calls: string[] = [];
  const result = await new GitSummaryService({ runner: runner(baseOutputs(), { onRun: (args) => calls.push(args.join(" ")) }) }).summarize(workspaceId, "/repo", controller.signal);
  expect(validUnavailablePayload(result)).toBe(true);
  expect(result).toMatchObject({ status: { reason: "Git summary refresh timed out or was cancelled" } });
  expect(calls).toEqual(["rev-parse --show-toplevel"]);
});
