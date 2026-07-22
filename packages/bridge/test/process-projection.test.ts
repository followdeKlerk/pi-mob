import { describe, expect, test } from "bun:test";
import {
  AuthoritativeProcessRegistry,
  type ProcessErrorEvent,
  type ProcessOutput,
  type ProcessSnapshot,
  type ProcessUnavailable,
} from "../src/core/process-projection";

const sessionId = "11111111-1111-4111-8111-111111111111";
const startedAt = "2026-07-15T00:00:00.000Z";

function snapshot(overrides: Partial<ProcessSnapshot> = {}): ProcessSnapshot {
  return {
    sessionId,
    processId: "process-1",
    revision: "process-r1",
    status: "running",
    command: "bun test",
    startedAt,
    capability: "runtime.processes.v1",
    stale: false,
    supportedActions: ["stop"],
    ...overrides,
  };
}

function output(overrides: Partial<ProcessOutput> = {}): ProcessOutput {
  return {
    sessionId,
    processId: "process-1",
    revision: "process-r1",
    stream: "stdout",
    content: "ok\n",
    truncation: { retainedBytes: 3, totalBytes: 3, isTruncated: false },
    cursor: "1",
    pageToken: "page-1",
    ...overrides,
  };
}

function unavailable(overrides: Partial<ProcessUnavailable> = {}): ProcessUnavailable {
  return {
    sessionId,
    capability: "runtime.processes.v1",
    status: {
      state: "unavailable",
      reason: "bridge missing capability",
      remediation: "upgrade bridge",
      revision: "process-r9",
    },
    ...overrides,
  };
}

function processError(overrides: Partial<ProcessErrorEvent> = {}): ProcessErrorEvent {
  return {
    sessionId,
    processId: "process-1",
    revision: "process-r1",
    error: {
      code: "process_failed",
      message: "failed",
      retryable: false,
    },
    ...overrides,
  };
}

describe("authoritative process projection", () => {
  test("preserves simultaneous process ids for one session", () => {
    const registry = new AuthoritativeProcessRegistry();
    registry.applySnapshot(snapshot());
    registry.applySnapshot(snapshot({ processId: "process-2", revision: "process-r2", command: "bun run dev", supportedActions: ["restart"] }));

    expect(registry.snapshotResult(sessionId)).toEqual({
      items: [snapshot(), snapshot({ processId: "process-2", revision: "process-r2", command: "bun run dev", supportedActions: ["restart"] })],
    });
  });

  test("keeps stdout and stderr separate and revision-bound", () => {
    const registry = new AuthoritativeProcessRegistry();
    registry.applySnapshot(snapshot());
    registry.applyOutput(output());
    registry.applyOutput(output({ stream: "stderr", content: "boom\n", truncation: { retainedBytes: 5, totalBytes: 5, isTruncated: false }, cursor: "2", pageToken: "page-2" }));
    registry.applyOutput(output({ revision: "process-r2", content: "stale\n" }));

    const projected = registry.get(sessionId, "process-1");
    expect(projected?.stdout?.content).toBe("ok\n");
    expect(projected?.stderr?.content).toBe("boom\n");
    expect(projected?.stdout?.stream).toBe("stdout");
    expect(projected?.stderr?.stream).toBe("stderr");
    expect(registry.outputPage({ sessionId, processId: "process-1", revision: "process-r1", stream: "stdout", cursor: "1", pageToken: "page-1" })?.content).toBe("ok\n");
    expect(registry.outputPage({ sessionId, processId: "process-1", revision: "process-r1", stream: "stdout", cursor: "9" })).toBeUndefined();
    expect(registry.outputPage({ sessionId, processId: "process-1", revision: "process-r2", stream: "stdout" })).toBeUndefined();
  });

  test("snapshot replacement drops vanished process ids and resets output on revision change", () => {
    const registry = new AuthoritativeProcessRegistry();
    registry.applySnapshot(snapshot());
    registry.applySnapshot(snapshot({ processId: "process-2", revision: "process-r2", command: "bun run dev", supportedActions: ["restart"] }));
    registry.applyOutput(output({ content: "before\n" }));

    registry.applySnapshotResult(sessionId, {
      items: [
        snapshot({ revision: "process-r3", supportedActions: ["restart"] }),
        snapshot({ revision: "process-r4", supportedActions: ["restart", "rerun"] }),
      ],
    });

    expect(registry.get(sessionId, "process-2")).toBeUndefined();
    const current = registry.get(sessionId, "process-1");
    expect(current?.revision).toBe("process-r4");
    expect(current?.stdout).toBeUndefined();
  });

  test("empty snapshot result clears only the named session", () => {
    const registry = new AuthoritativeProcessRegistry();
    registry.applySnapshot(snapshot());
    registry.applySnapshot(snapshot({ sessionId: "22222222-2222-4222-8222-222222222222", processId: "process-2" }));

    registry.applySnapshotResult(sessionId, { items: [] });

    expect(registry.get(sessionId, "process-1")).toBeUndefined();
    expect(registry.get("22222222-2222-4222-8222-222222222222", "process-2")).toBeDefined();
  });

  test("mismatched snapshot result rejects without clearing either session", () => {
    const otherSession = "22222222-2222-4222-8222-222222222222";
    const registry = new AuthoritativeProcessRegistry();
    registry.applySnapshot(snapshot());
    registry.applySnapshot(snapshot({ sessionId: otherSession, processId: "process-2" }));

    expect(() => registry.applySnapshotResult(sessionId, {
      items: [snapshot({ sessionId: otherSession, processId: "process-2" })],
    })).toThrow("session mismatch");

    expect(registry.get(sessionId, "process-1")).toBeDefined();
    expect(registry.get(otherSession, "process-2")).toBeDefined();
  });

  test("process error is retained for the matching revision only", () => {
    const registry = new AuthoritativeProcessRegistry();
    registry.applySnapshot(snapshot());
    registry.applyError(processError());
    expect(registry.get(sessionId, "process-1")?.error).toEqual(processError().error);

    registry.applyError(processError({ revision: "process-r9" }));
    expect(registry.get(sessionId, "process-1")?.error).toEqual(processError().error);

    registry.applySnapshot(snapshot({ revision: "process-r2" }));
    expect(registry.get(sessionId, "process-1")?.error).toBeUndefined();
  });

  test("unavailable clears actions until a fresh snapshot arrives", () => {
    const registry = new AuthoritativeProcessRegistry();
    registry.applySnapshot(snapshot({ supportedActions: ["stop", "restart"] }));
    registry.applyUnavailable(unavailable());

    const blocked = registry.get(sessionId, "process-1");
    expect(blocked?.supportedActions).toEqual([]);
    expect(blocked?.unavailableStatus).toMatchObject({ state: "unavailable" });

    registry.applySnapshot(snapshot({ revision: "process-r2", supportedActions: ["restart"] }));
    const restored = registry.get(sessionId, "process-1");
    expect(restored?.supportedActions).toEqual(["restart"]);
    expect(restored?.unavailableStatus).toBeUndefined();
  });

  test("clones returned payloads instead of leaking mutable references", () => {
    const registry = new AuthoritativeProcessRegistry();
    registry.applySnapshot(snapshot({ ports: [{ port: 4173, protocol: "tcp" }] }));
    registry.applyOutput(output());

    const projection = registry.get(sessionId, "process-1")!;
    (projection.supportedActions as unknown as string[]).push("restart");
    ((projection.ports as unknown as { port: number; protocol: "tcp" | "udp" }[])[0]!).port = 9999;
    (projection.stdout as unknown as { truncation: ProcessOutput['truncation'] }).truncation = { retainedBytes: 0, totalBytes: 0, isTruncated: true };

    const fresh = registry.get(sessionId, "process-1")!;
    expect(fresh.supportedActions).toEqual(["stop"]);
    expect(fresh.ports).toEqual([{ port: 4173, protocol: "tcp" }]);
    expect(fresh.stdout?.truncation).toEqual({ retainedBytes: 3, totalBytes: 3, isTruncated: false });
  });
});
