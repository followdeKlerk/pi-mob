import { validateFixture } from "@pi-mob/protocol-schema";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AdapterPort } from "../src/core/domain";
import { DurableBridgeRuntime, RuntimeProtocolError } from "../src/core/runtime";
import { BridgeStore } from "../src/core/store";
import { AuthoritativeProcessRegistry, type ProcessSnapshot } from "../src/core/process-projection";
import { GitSummaryService, type GitCommandRunner } from "../src/git/summary-service";

const workspaceId = "22222222-2222-4222-8222-222222222222";
const connection = {
  connectionId: "33333333-3333-4333-8333-333333333333",
  installationId: "44444444-4444-4444-8444-444444444444",
  subscriptions: new Set<string>(),
};
const adapter: AdapterPort = { async dispatch() {} };

function runtimeFor(opts: { processes?: AuthoritativeProcessRegistry; git?: GitSummaryService; resolveGitCwd?: (workspaceId: string) => string | undefined }): DurableBridgeRuntime {
  const path = join(mkdtempSync(join(tmpdir(), "pi-mob-r5-r6-runtime-")), "bridge.sqlite");
  return new DurableBridgeRuntime({
    store: new BridgeStore(path),
    adapter,
    bridgeVersion: "test",
    piVersion: "0.82.0",
    hostDisplayName: "test",
    ...(opts.processes ? { processes: opts.processes } : {}),
    ...(opts.git ? { git: opts.git } : {}),
    ...(opts.resolveGitCwd ? { resolveGitCwd: opts.resolveGitCwd } : {}),
  });
}

const sessionId = "11111111-1111-4111-8111-111111111111";

function snapshot(overrides: Partial<ProcessSnapshot> = {}): ProcessSnapshot {
  return {
    sessionId,
    processId: "process-1",
    revision: "process-r1",
    status: "running",
    command: "bun test",
    startedAt: "2026-07-15T00:00:00.000Z",
    capability: "runtime.processes.v1",
    stale: false,
    supportedActions: ["stop"],
    ...overrides,
  };
}

const sessionA = "11111111-1111-4111-8111-111111111111";
const sessionB = "22222222-2222-4222-8222-222222222222";

describe("R5 runtime integration", () => {
  test("processes.v1 is advertised only when the registry is installed", () => {
    expect(runtimeFor({}).optionalCapabilities()).toEqual([]);
    const processes = new AuthoritativeProcessRegistry();
    expect(runtimeFor({ processes }).optionalCapabilities()).toEqual(["processes.v1"]);
  });

  test("process.snapshot.request returns the frozen closed {items} shape (D-039)", () => {
    const processes = new AuthoritativeProcessRegistry();
    processes.applySnapshot(snapshot());
    processes.applySnapshot(snapshot({ sessionId: sessionB, processId: "process-2" }));
    const runtime = runtimeFor({ processes });

    const response = runtime.control(connection, "process.snapshot.request", { sessionId: sessionA }) as { items: ProcessSnapshot[] };
    expect(response.items).toHaveLength(1);
    expect(response.items[0]?.processId).toBe("process-1");
    expect(response.items[0]?.sessionId).toBe(sessionA);
  });

  test("D-039 — empty process snapshot result clears only the requested session", () => {
    const processes = new AuthoritativeProcessRegistry();
    processes.applySnapshot(snapshot());
    processes.applySnapshot(snapshot({ sessionId: sessionB, processId: "process-2" }));
    const runtime = runtimeFor({ processes });

    const response = runtime.control(connection, "process.snapshot.request", { sessionId: sessionA }) as { items: ProcessSnapshot[] };
    expect(response.items).toHaveLength(1);

    // Empty authoritative replacement applies only to the recorded session.
    processes.applySnapshotResult(sessionA, { items: [] });

    const afterA = runtime.control(connection, "process.snapshot.request", { sessionId: sessionA }) as { items: ProcessSnapshot[] };
    const afterB = runtime.control(connection, "process.snapshot.request", { sessionId: sessionB }) as { items: ProcessSnapshot[] };
    expect(afterA.items).toHaveLength(0);
    expect(afterB.items).toHaveLength(1);
    expect(afterB.items[0]?.processId).toBe("process-2");
  });

  test("D-039 — cross-session items in a snapshot result are rejected and leave state untouched", () => {
    const processes = new AuthoritativeProcessRegistry();
    processes.applySnapshot(snapshot());
    processes.applySnapshot(snapshot({ sessionId: sessionB, processId: "process-2" }));
    const runtime = runtimeFor({ processes });

    expect(() =>
      processes.applySnapshotResult(sessionA, {
        items: [snapshot({ sessionId: sessionB, processId: "process-2" })],
      }),
    ).toThrow(/session mismatch/);

    const afterA = runtime.control(connection, "process.snapshot.request", { sessionId: sessionA }) as { items: ProcessSnapshot[] };
    expect(afterA.items).toHaveLength(1);
  });

  test("process.output.page returns one bounded output for the matching cursor/pageToken", () => {
    const processes = new AuthoritativeProcessRegistry();
    processes.applySnapshot(snapshot());
    processes.applyOutput({
      sessionId,
      processId: "process-1",
      revision: "process-r1",
      stream: "stdout",
      content: "ok\n",
      truncation: { retainedBytes: 3, totalBytes: 3, isTruncated: false },
      cursor: "1",
      pageToken: "page-1",
    });
    const runtime = runtimeFor({ processes });

    const response = runtime.control(connection, "process.output.page", {
      sessionId,
      processId: "process-1",
      revision: "process-r1",
      stream: "stdout",
      cursor: "1",
      pageToken: "page-1",
    }) as { content: string } | undefined;
    expect(response?.content).toBe("ok\n");

    // Stale cursor → no output (implicit cancellation of the prior page).
    const stale = runtime.control(connection, "process.output.page", {
      sessionId,
      processId: "process-1",
      revision: "process-r1",
      stream: "stdout",
      cursor: "9",
    });
    expect(stale).toBeUndefined();
  });

  test("process controls fail closed when the registry is not installed", () => {
    const runtime = runtimeFor({});
    expect(() => runtime.control(connection, "process.snapshot.request", { sessionId: sessionA })).toThrow(RuntimeProtocolError);
    expect(() => runtime.control(connection, "process.output.page", {
      sessionId,
      processId: "process-1",
      revision: "process-r1",
      stream: "stdout",
    })).toThrow(/unavailable/);
  });
});

const gitRunner = (outputs: Record<string, { code: number; stdout: string; stderr?: string }>): GitCommandRunner => ({
  async run(_command, args, runOptions) {
    if (runOptions.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const key = args.join(" ");
    const output = outputs[key] ?? { code: 1, stdout: "", stderr: "missing" };
    return { ...output, stderr: output.stderr ?? "" };
  },
});

function baseGitOutputs(): Record<string, { code: number; stdout: string; stderr?: string }> {
  return {
    "rev-parse --show-toplevel": { code: 0, stdout: "/repo\n" },
    "remote get-url origin": { code: 0, stdout: "git@github.com:acme/repo.git\n" },
    "log -1 --format=%H%x00%s%x00%an%x00%aI": {
      code: 0,
      stdout: "abcdef1234567890abcdef1234567890abcdef12\0First commit\0A. Author\x002026-01-01T00:00:00+00:00\n",
    },
    "symbolic-ref --quiet --short HEAD": { code: 0, stdout: "main\n" },
    "status --porcelain=v1 -z --untracked-files=normal": { code: 0, stdout: "" },
    "rev-list --left-right --count HEAD...@{upstream}": { code: 0, stdout: "0\t0\n" },
  };
}

describe("R6 runtime integration", () => {
  test("git.v1 is advertised only when the git service is installed", () => {
    expect(runtimeFor({}).optionalCapabilities()).toEqual([]);
    const git = new GitSummaryService({ runner: gitRunner(baseGitOutputs()) });
    expect(runtimeFor({ git, resolveGitCwd: () => "/repo" }).optionalCapabilities()).toEqual(["git.v1"]);
  });

  test("git.summary.request returns the closed GitSummary schema", async () => {
    const git = new GitSummaryService({ runner: gitRunner(baseGitOutputs()) });
    const runtime = runtimeFor({ git, resolveGitCwd: () => "/repo" });

    const response = (await runtime.control(connection, "git.summary.request", {
      workspaceId,
      requestId: "55555555-5555-4555-8555-555555555555",
    })) as { repository: string; branch: string | null; capability: string };

    expect(response.repository).toBe("acme/repo");
    expect(response.branch).toBe("main");
    expect(response.capability).toBe("git-ci.v1");
  });

  test("git.summary.request throws unsupported_capability when the workspace cwd is unknown", async () => {
    const git = new GitSummaryService({ runner: gitRunner(baseGitOutputs()) });
    const runtime = runtimeFor({ git, resolveGitCwd: () => undefined });

    await expect(
      runtime.control(connection, "git.summary.request", {
        workspaceId,
        requestId: "55555555-5555-4555-8555-555555555555",
      }),
    ).rejects.toThrow(/cwd/i);
  });

  test("git.summary.request rejects fabricated summary when service reports GitUnavailable", async () => {
    const git = new GitSummaryService({ runner: gitRunner({ "rev-parse --show-toplevel": { code: 0, stdout: "/repo\n" } }) });
    const runtime = runtimeFor({ git, resolveGitCwd: () => "/repo" });

    await expect(
      runtime.control(connection, "git.summary.request", {
        workspaceId,
        requestId: "55555555-5555-4555-8555-555555555555",
      }),
    ).rejects.toThrow(/origin remote/i);
  });

  test("git.summary.cancel aborts an in-flight summary by requestId", async () => {
    const abortSeen: { aborted: boolean } = { aborted: false };
    let pendingResolve: () => void = () => {};
    const pendingPromise = new Promise<void>((resolve) => { pendingResolve = resolve; });
    const slowRunner: GitCommandRunner = {
      async run(_command, args, runOptions) {
        if (runOptions.signal?.aborted) {
          abortSeen.aborted = true;
          throw new DOMException("Aborted", "AbortError");
        }
        // Only the first git command (rev-parse) is reached; the rest await it.
        if (args[0] === "rev-parse") {
          await pendingPromise;
          if (runOptions.signal?.aborted) {
            abortSeen.aborted = true;
            throw new DOMException("Aborted", "AbortError");
          }
        }
        return { code: 0, stdout: "/repo\n", stderr: "" };
      },
    };
    const git = new GitSummaryService({ runner: slowRunner });
    const runtime = runtimeFor({ git, resolveGitCwd: () => "/repo" });
    const requestId = "66666666-6666-4666-8666-666666666666";

    const requestPromise = runtime.control(connection, "git.summary.request", {
      workspaceId,
      requestId,
    });

    const cancelResponse = runtime.control(connection, "git.summary.cancel", { targetRequestId: requestId }) as { cancelled: boolean };
    expect(cancelResponse.cancelled).toBe(true);

    pendingResolve();
    await expect(requestPromise).rejects.toThrow();
    expect(abortSeen.aborted).toBe(true);

    // Second cancel is a no-op (the entry was cleared).
    const second = runtime.control(connection, "git.summary.cancel", { targetRequestId: requestId }) as { cancelled: boolean };
    expect(second.cancelled).toBe(false);
  });

  test("git.summary.cancel with unknown targetRequestId is a no-op, not an error", () => {
    const runtime = runtimeFor({});
    const response = runtime.control(connection, "git.summary.cancel", {
      targetRequestId: "77777777-7777-4777-8777-777777777777",
    }) as { cancelled: boolean };
    expect(response.cancelled).toBe(false);
  });
});

describe("R6 runtime integration — git.unavailable host-stream event", () => {
  test("git.unavailable event lands on the host stream when the service reports GitUnavailable", async () => {
    const git = new GitSummaryService({ runner: gitRunner({ "rev-parse --show-toplevel": { code: 0, stdout: "/repo\n" } }) });
    const runtime = runtimeFor({ git, resolveGitCwd: () => "/repo" });
    const hostStream = `host:${runtime.identity().hostId}`;

    const captured: Array<{ type: string; payload: Record<string, unknown>; streamId: string }> = [];
    const detach = runtime.options.store.onEvent((event) => {
      if (event.type === "git.unavailable") captured.push({ type: event.type, payload: event.payload, streamId: event.streamId });
    });

    await expect(
      runtime.control(connection, "git.summary.request", {
        workspaceId,
        requestId: "55555555-5555-4555-8555-555555555555",
      }),
    ).rejects.toThrow(/origin remote/i);

    detach();

    expect(captured).toHaveLength(1);
    expect(captured[0]?.streamId).toBe(hostStream);
    expect(captured[0]?.payload).toEqual({
      workspaceId,
      capability: "git-ci.v1",
      status: {
        state: "unavailable",
        reason: "Repository has no origin remote",
        remediation: "Configure an HTTPS-capable origin remote and refresh.",
      },
    });

    // The emitted event must validate against the closed git.unavailable
    // protocol envelope; a future schema change that breaks the bridge
    // emit shape should fail this test loudly.
    const event = captured[0];
    if (!event) throw new Error("captured git.unavailable event is missing");
    expect(
      validateFixture({
        name: "r5-r6-runtime-git-unavailable",
        kind: "event",
        valid: true,
        message: {
          protocol: { major: 1, minor: 0 },
          messageId: "11111111-1111-4111-8111-111111111111",
          sentAt: "2026-01-02T00:00:00.000Z",
          eventId: "33333333-3333-4333-8333-333333333333",
          streamId: hostStream,
          cursor: "1",
          type: "git.unavailable",
          payload: event.payload,
        },
      }),
    ).toBe(true);
  });

  test("git.unavailable event is NOT emitted on the success path", async () => {
    const git = new GitSummaryService({ runner: gitRunner(baseGitOutputs()) });
    const runtime = runtimeFor({ git, resolveGitCwd: () => "/repo" });

    const captured: string[] = [];
    const detach = runtime.options.store.onEvent((event) => {
      if (event.type === "git.unavailable") captured.push(event.payload.workspaceId as string);
    });

    const response = await runtime.control(connection, "git.summary.request", {
      workspaceId,
      requestId: "55555555-5555-4555-8555-555555555555",
    });

    detach();

    expect((response as { repository: string }).repository).toBe("acme/repo");
    expect(captured).toEqual([]);
  });

  test("git.unavailable event is NOT emitted when cwd is unknown (strict validation, not service truth)", async () => {
    const git = new GitSummaryService({ runner: gitRunner(baseGitOutputs()) });
    const runtime = runtimeFor({ git, resolveGitCwd: () => undefined });

    const captured: string[] = [];
    const detach = runtime.options.store.onEvent((event) => {
      if (event.type === "git.unavailable") captured.push(event.payload.workspaceId as string);
    });

    await expect(
      runtime.control(connection, "git.summary.request", {
        workspaceId,
        requestId: "55555555-5555-4555-8555-555555555555",
      }),
    ).rejects.toThrow(/cwd/i);

    detach();

    // cwd-unknown is a host-side validation failure, not a truthful Git
    // unavailability. The bridge rejects the request without faking a
    // git.unavailable event.
    expect(captured).toEqual([]);
  });
});
