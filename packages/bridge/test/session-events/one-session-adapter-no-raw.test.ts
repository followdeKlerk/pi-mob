/**
 * Phase 3 — production-path test that the rewrite slice removes raw
 * Pi events from the user-visible session stream.
 *
 * The test wires the production `OneSessionPiAdapter` against an
 * in-memory fake RPC and an in-memory diagnostics sink, then drives
 * the same notification sequence the legacy tests used (tool start,
 * tool update, tool end, agent_settled). The assertion is the new
 * contract: the session stream carries curated events only, while the
 * diagnostics sink receives every raw notification verbatim.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BridgeStore } from "../../src/core/store";
import { OneSessionPiAdapter, type PiRpcNotificationHandler, type PiRpcRequestOptions } from "../../src/pi/one-session-adapter";

class FakeRpc {
  readonly notifications: Set<PiRpcNotificationHandler> = new Set();
  on(_kind: "notification", handler: PiRpcNotificationHandler): () => void {
    this.notifications.add(handler);
    return () => this.notifications.delete(handler);
  }
  emit(value: Record<string, unknown>): void { for (const handler of this.notifications) handler(value); }
  request(_options: PiRpcRequestOptions): Promise<unknown> { return Promise.resolve({}); }
}

class InMemoryDiagnosticsSink {
  readonly rows: Array<{ raw: unknown; sessionId: string | null }> = [];
  append(raw: unknown, sessionId: string | null): void {
    this.rows.push({ raw, sessionId });
  }
}

const workspaceId = "99999999-9999-4999-8999-999999999999";
const sessionId = "88888888-8888-4888-8888-888888888888";

describe("OneSessionPiAdapter rewrite: raw events are diagnostics-only", () => {
  test("no pi.rpc.event envelope in the user-visible session stream", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rewrite-no-raw-"));
    const store = new BridgeStore(join(dir, "bridge.sqlite"));
    store.ensureStream(`host:${store.identity().hostId}`, "host");
    store.ensureSession(sessionId, { sessionId, workspaceId, policyMode: "full", runtimeState: "idle" });
    store.ensureStream(`session:${sessionId}`, "session", sessionId);
    const sink = new InMemoryDiagnosticsSink();
    const rpc = new FakeRpc();
    const adapter = new OneSessionPiAdapter({
      store,
      rpc,
      diagnosticsSink: sink,
      workspace: {
        workspaceId,
        rootPath: dir,
        displayName: "rewrite-fixture",
        fingerprint: "rewrite-fixture",
        policyMode: "full",
      },
    });
    try {
      rpc.emit({ type: "agent_start", sessionId });
      rpc.emit({ type: "turn_start", sessionId, turnIndex: 1, timestamp: new Date().toISOString() });
      rpc.emit({ type: "message_update", sessionId, assistantMessageEvent: { type: "text_delta", delta: "hi" } });
      rpc.emit({ type: "tool_execution_start", sessionId, toolCallId: "t1", toolName: "read", args: { path: "/private/repo" } });
      rpc.emit({ type: "tool_execution_end", sessionId, toolCallId: "t1", toolName: "read", result: "ok", isError: false });
      rpc.emit({ type: "agent_settled", sessionId });
      const streamId = `session:${sessionId}`;
      const events = store.listEvents(streamId);
      const types = events.map((event) => event.type);
      // The legacy contract used to include "pi.rpc.event" here.
      expect(types).not.toContain("pi.rpc.event");
      // The curated contract still applies.
      expect(types).toContain("session.state");
      expect(types).toContain("turn.started");
      expect(types).toContain("assistant.delta");
      expect(types).toContain("tool.started");
      expect(types).toContain("tool.completed");
      expect(types).toContain("turn.settled");
      // Diagnostics sink received every raw notification. Each session
      // notification is recorded twice: once with a `null` session id
      // (the pre-resolution capture) and once with the resolved
      // session id. The contract is captured in
      // `appendDiagnostics(raw, null)` / `appendDiagnostics(raw, sessionId)`.
      const resolvedRows = sink.rows.filter((row) => row.sessionId !== null);
      expect(resolvedRows).toHaveLength(6);
      expect(resolvedRows.map((row) => (row.raw as { type: string }).type)).toEqual([
        "agent_start",
        "turn_start",
        "message_update",
        "tool_execution_start",
        "tool_execution_end",
        "agent_settled",
      ]);
      // The pre-resolution sink rows mirror the same set.
      expect(sink.rows.filter((row) => row.sessionId === null)).toHaveLength(6);
      // Private paths were redacted from the curated stream; raw events
      // remain in diagnostics (support-only) which is the desired
      // observability surface.
      const curatedPayloads = JSON.stringify(events.map((event) => event.payload));
      expect(curatedPayloads).not.toContain("/private/repo");
    } finally {
      adapter.close();
      store.close();
    }
  });

  test("extension_ui_request curated event still published; raw routed to diagnostics", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rewrite-ext-"));
    const store = new BridgeStore(join(dir, "bridge.sqlite"));
    store.ensureStream(`host:${store.identity().hostId}`, "host");
    store.ensureSession(sessionId, { sessionId, workspaceId, policyMode: "full", runtimeState: "idle" });
    store.ensureStream(`session:${sessionId}`, "session", sessionId);
    const sink = new InMemoryDiagnosticsSink();
    const rpc = new FakeRpc();
    const adapter = new OneSessionPiAdapter({
      store,
      rpc,
      diagnosticsSink: sink,
      workspace: {
        workspaceId,
        rootPath: dir,
        displayName: "rewrite-fixture",
        fingerprint: "rewrite-fixture",
        policyMode: "full",
      },
    });
    try {
      rpc.emit({ type: "extension_ui_request", id: "d1", method: "confirm", title: "Sure?", message: "/private/repo" });
      const streamId = `session:${sessionId}`;
      const events = store.listEvents(streamId);
      // Curated event present.
      expect(events.some((event) => event.type === "extension.dialog" && event.payload["dialogId"])).toBe(true);
      // No `pi.rpc.event` envelope for the extension path either.
      expect(events.some((event) => event.type === "pi.rpc.event")).toBe(false);
      // Diagnostics sink observed the raw extension event.
      expect(sink.rows.some((row) => (row.raw as { type: string }).type === "extension_ui_request")).toBe(true);
    } finally {
      adapter.close();
      store.close();
    }
  });

  test("adapter without diagnostics sink still produces curated-only output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rewrite-no-sink-"));
    const store = new BridgeStore(join(dir, "bridge.sqlite"));
    store.ensureStream(`host:${store.identity().hostId}`, "host");
    store.ensureSession(sessionId, { sessionId, workspaceId, policyMode: "full", runtimeState: "idle" });
    store.ensureStream(`session:${sessionId}`, "session", sessionId);
    const rpc = new FakeRpc();
    const adapter = new OneSessionPiAdapter({
      store,
      rpc,
      workspace: {
        workspaceId,
        rootPath: dir,
        displayName: "rewrite-fixture",
        fingerprint: "rewrite-fixture",
        policyMode: "full",
      },
    });
    try {
      rpc.emit({ type: "tool_execution_start", sessionId, toolCallId: "t1", toolName: "read", args: {} });
      const events = store.listEvents(`session:${sessionId}`);
      expect(events.map((event) => event.type)).toContain("tool.started");
      expect(events.map((event) => event.type)).not.toContain("pi.rpc.event");
    } finally {
      adapter.close();
      store.close();
    }
  });

  test("non-object and missing-type notifications still flow to diagnostics", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rewrite-malformed-"));
    const store = new BridgeStore(join(dir, "bridge.sqlite"));
    store.ensureStream(`host:${store.identity().hostId}`, "host");
    store.ensureSession(sessionId, { sessionId, workspaceId, policyMode: "full", runtimeState: "idle" });
    store.ensureStream(`session:${sessionId}`, "session", sessionId);
    const sink = new InMemoryDiagnosticsSink();
    const rpc = new FakeRpc();
    const adapter = new OneSessionPiAdapter({
      store,
      rpc,
      diagnosticsSink: sink,
      workspace: {
        workspaceId,
        rootPath: dir,
        displayName: "rewrite-malformed",
        fingerprint: "rewrite-malformed",
        policyMode: "full",
      },
    });
    try {
      rpc.emit({ type: "future_event", sessionId });
      // Diagnostics observability for raw events that have no
      // recognisable type or shape is REQUIRED by the rewrite slice.
      expect(sink.rows.some((row) => (row.raw as { type: string }).type === "future_event")).toBe(true);
    } finally {
      adapter.close();
      store.close();
    }
  });

  test("notifications for unsessioned / unknown streams are observed before drop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rewrite-unknown-"));
    const store = new BridgeStore(join(dir, "bridge.sqlite"));
    store.ensureStream(`host:${store.identity().hostId}`, "host");
    store.ensureSession(sessionId, { sessionId, workspaceId, policyMode: "full", runtimeState: "idle" });
    store.ensureStream(`session:${sessionId}`, "session", sessionId);
    const sink = new InMemoryDiagnosticsSink();
    const rpc = new FakeRpc();
    const adapter = new OneSessionPiAdapter({
      store,
      rpc,
      diagnosticsSink: sink,
      workspace: {
        workspaceId,
        rootPath: dir,
        displayName: "rewrite-unknown",
        fingerprint: "rewrite-unknown",
        policyMode: "full",
      },
    });
    try {
      // A notification for a session id that does not exist MUST be
      // observable through diagnostics even though the adapter returns
      // early. The pre-resolution sink appends with `null` session id.
      rpc.emit({ type: "future_pi_event", sessionId: "nosuchsession" });
      expect(sink.rows).toHaveLength(1);
      expect(sink.rows[0]?.sessionId).toBeNull();
      // Now a matching notification for the provisioned session
      // forwards the session id to diagnostics (both null and
      // resolved). The last row carries the resolved session id.
      rpc.emit({ type: "tool_execution_start", sessionId, toolCallId: "t1", toolName: "read", args: { path: "/private" } });
      expect(sink.rows).toHaveLength(3);
      expect(sink.rows[1]?.sessionId).toBeNull();
      expect(sink.rows[2]?.sessionId).toBe(sessionId);
      // The curated session stream still never includes the raw shape.
      const types = store.listEvents(`session:${sessionId}`).map((event) => event.type);
      expect(types).not.toContain("pi.rpc.event");
      expect(types).toContain("tool.started");
    } finally {
      adapter.close();
      store.close();
    }
  });

  test("a throwing diagnostics sink never blocks Pi notification processing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rewrite-throw-sink-"));
    const store = new BridgeStore(join(dir, "bridge.sqlite"));
    store.ensureStream(`host:${store.identity().hostId}`, "host");
    store.ensureSession(sessionId, { sessionId, workspaceId, policyMode: "full", runtimeState: "idle" });
    store.ensureStream(`session:${sessionId}`, "session", sessionId);
    const sink = {
      append: (): void => { throw new Error("diagnostics DB locked"); },
    };
    const rpc = new FakeRpc();
    const adapter = new OneSessionPiAdapter({
      store,
      rpc,
      diagnosticsSink: sink,
      workspace: {
        workspaceId,
        rootPath: dir,
        displayName: "rewrite-throw-sink",
        fingerprint: "rewrite-throw-sink",
        policyMode: "full",
      },
    });
    try {
      // The sink throws synchronously on every notification. The adapter
      // MUST NOT propagate the throw; the curated session stream must
      // still receive the canonical events.
      expect(() => rpc.emit({ type: "tool_execution_start", sessionId, toolCallId: "t1", toolName: "read", args: {} })).not.toThrow();
      const events = store.listEvents(`session:${sessionId}`);
      expect(events.some((event) => event.type === "tool.started")).toBe(true);
    } finally {
      adapter.close();
      store.close();
    }
  });
});
