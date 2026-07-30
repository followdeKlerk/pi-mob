/**
 * M5 adapter and runtime integration tests.
 *
 * These tests exercise the OneSessionPiAdapter against an in-memory
 * fake RPC, and drive the M4 runtime control/command flow through a
 * loopback WebSocket to prove `workspace.list`, `session.create`,
 * `prompt.submit`, `turn.abort`, notification replay, and the lost
 * receipt idempotency path end to end. No real Pi binary is required.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BridgeStore,
  DurableBridgeRuntime,
  OneSessionPiAdapter,
  deterministicIdGenerator,
  type PiRpcClient,
  type PiRpcRequestOptions,
  type PiRpcNotification,
  createBridgeServer,
  type AdapterPort,
} from "../src";
import {
  DurableRecipeActivityProjection,
  importExternalSessionHistory,
  reconcileSessionHistoryTail,
} from "../src/pi/external-history";
import { canonicalizeOrThrow, deriveRootId } from "../src/core/workspace-policy";

class FakeRpc implements PiRpcClient {
  readonly requests: PiRpcRequestOptions[] = [];
  readonly responses = new Map<string, unknown>();
  readonly notifications = new Set<(raw: unknown) => void>();
  failWith: Error | null = null;
  retries = 0;
  requestAttempts = 0;
  async manualRetry(): Promise<void> { this.retries += 1; }
  async request(opts: PiRpcRequestOptions): Promise<unknown> {
    this.requestAttempts += 1;
    if (this.failWith) throw this.failWith;
    this.requests.push(opts);
    const key = `${opts.method}:${opts.id ?? ""}`;
    if (this.responses.has(key)) return this.responses.get(key);
    return { echoed: opts.method, id: opts.id ?? null, params: opts.params ?? null };
  }
  on(kind: "notification", handler: (raw: unknown) => void): () => void {
    if (kind !== "notification") return () => undefined;
    this.notifications.add(handler);
    return () => this.notifications.delete(handler);
  }
  emit(raw: PiRpcNotification | Record<string, unknown>): void {
    for (const fn of this.notifications) fn(raw);
  }
  reset(): void { this.requests.length = 0; this.responses.clear(); this.failWith = null; this.requestAttempts = 0; }
}

const trackedTempDirs = new Set<string>();

function trackedTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  trackedTempDirs.add(dir);
  return dir;
}

function setup(opts: {
  workspace?: Partial<ConstructorParameters<typeof OneSessionPiAdapter>[0]["workspace"]>;
  reconcileHistory?: ConstructorParameters<typeof OneSessionPiAdapter>[0]["reconcileHistory"];
} = {}): {
  store: BridgeStore;
  rpc: FakeRpc;
  adapter: OneSessionPiAdapter;
  hostStream: string;
} {
  const store = new BridgeStore(join(trackedTempDir("pi-mob-m5-"), "bridge.sqlite"));
  const identity = store.identity();
  store.ensureStream(`host:${identity.hostId}`, "host");
  const rpc = new FakeRpc();
  const adapter = new OneSessionPiAdapter({
    store,
    rpc,
    workspace: {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      rootPath: opts.workspace?.rootPath ?? trackedTempDir("pi-mob-workspaces-"),
      displayName: "example",
      fingerprint: "fingerprint-fixture",
      policyMode: "full",
      ...opts.workspace,
    },
    newSessionId: deterministicIdGenerator("sess"),
    now: () => 1_700_000_000_000,
    ...(opts.reconcileHistory ? { reconcileHistory: opts.reconcileHistory } : {}),
  });
  return { store, rpc, adapter, hostStream: `host:${identity.hostId}` };
}

afterEach(() => {
  for (const dir of trackedTempDirs) rmSync(dir, { recursive: true, force: true });
  trackedTempDirs.clear();
});

describe("OneSessionPiAdapter", () => {
  test("lists the configured workspace", () => {
    const rootPath = trackedTempDir("pi-mob-workspaces-");
    const { adapter } = setup({ workspace: { rootPath } });
    const listing = adapter.listWorkspaces();
    expect(listing.items).toHaveLength(1);
    const item = listing.items[0]!;
    expect(item.workspaceId).toBe(deriveRootId(canonicalizeOrThrow(rootPath)));
    expect(item.rootPath).toBeUndefined();
    expect(item.trustState).toBeUndefined();
    expect(item.policyMode).toBe("full");
    expect(item.availableSince).toBe("2023-11-14T22:13:20.000Z");
    expect(item.lastSeenAt).toBe("2023-11-14T22:13:20.000Z");
  });

  test("session.create captures Pi get_state sessionFile and restore recovers its missed terminal tail", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pi-mob-rpc-session-file-"));
    const sessionPath = join(directory, "authoritative.jsonl");
    writeFileSync(sessionPath, JSON.stringify({ type: "session", id: "pi-session", version: 1 }) + "\n");
    const calls: Array<{ sessionId: string; liveProcess: boolean }> = [];
    const { store, rpc, adapter, hostStream } = setup({
      reconcileHistory: (sessionId, liveProcess) => {
        calls.push({ sessionId, liveProcess });
        return reconcileSessionHistoryTail(store, sessionId, sessionPath, { liveProcess });
      },
    });
    rpc.responses.set("get_state:", { data: { sessionFile: sessionPath, model: "fixture" } });
    await adapter.dispatch(makeCommand("rpc-session-create", "session.create", hostStream, hostStream, { workspaceId: "ws", policyMode: "full" }));
    const sessionId = store.sessionStates()[0]!.sessionId as string;
    expect(store.sessionState(sessionId)?.piSessionPath).toBe(sessionPath);
    expect(store.sessionState(sessionId)?.externalSession).not.toBe(true);
    expect(store.listEvents(`session:${sessionId}`).some((event) => JSON.stringify(event.payload).includes(sessionPath))).toBe(false);

    store.appendEvent(`session:${sessionId}`, "turn.started", { sessionId, turnId: "turn-rpc", commandId: "rpc-session-create", deliveryMode: "immediate" });
    store.appendEvent(`session:${sessionId}`, "tool.started", { sessionId, turnId: "turn-rpc", toolCallId: "tool-rpc", toolName: "bash", arguments: { command: "fixture" } });
    writeFileSync(sessionPath, [
      { type: "session", id: "pi-session", version: 1 },
      { type: "message", id: "user-rpc", parentId: null, message: { role: "user", content: [{ type: "text", text: "run" }] } },
      { type: "message", id: "assistant-rpc", parentId: "user-rpc", message: { role: "assistant", content: [{ type: "toolCall", id: "tool-rpc", name: "bash", arguments: { command: "fixture" } }] } },
      { type: "message", id: "result-rpc", parentId: "assistant-rpc", message: { role: "toolResult", toolCallId: "tool-rpc", toolName: "bash", isError: false, content: [{ type: "text", text: "done" }] } },
      { type: "message", id: "final-rpc", parentId: "result-rpc", message: { role: "assistant", content: [{ type: "text", text: "finished" }] } },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    store.updateSessionState(sessionId, { ...(store.sessionState(sessionId) ?? {}), runtimeState: "stopped" });
    await adapter.dispatch(makeCommand("rpc-session-restore", "session.activate", `session:${sessionId}`, `session:${sessionId}`, { sessionId }));
    const events = store.listEvents(`session:${sessionId}`);
    expect(events.filter((event) => event.type === "tool.completed" && event.payload.toolCallId === "tool-rpc")).toHaveLength(1);
    expect(events.filter((event) => event.type === "turn.settled")).toHaveLength(1);
    expect(events.some((event) => event.type === "turn.indeterminate")).toBe(false);
    expect(calls).toContainEqual({ sessionId, liveProcess: true });
    adapter.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test("session.create creates a UUID session, registers a stream, and emits host + session metadata", async () => {
    const { store, adapter, hostStream } = setup();
    const command = makeCommand("cmd-create", "session.create", hostStream, hostStream, {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      policyMode: "full",
      name: "first",
    });
    await adapter.dispatch(command);
    const sessions = store.listEvents(hostStream).filter((event) => event.type === "session.summary");
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    const summary = sessions.map((event) => event.payload as Record<string, unknown>)
      .find((payload) => payload.change === "added")!;
    expect(typeof summary.sessionId).toBe("string");
    expect(summary.workspaceId).toBe("11111111-1111-4111-8111-111111111111");
    expect(summary.policyMode).toBe("full");
    expect(summary.name).toBe("first");
    expect(summary.runtimeState).toBe("idle");
    const sessionId = summary.sessionId as string;
    expect(store.sessionExists(sessionId)).toBe(true);
    expect(store.streamPosition(`session:${sessionId}`)).not.toBeNull();
    const state = store.sessionState(sessionId);
    expect(state?.runtimeState).toBe("idle");
    expect(state?.policyMode).toBe("full");
    const sessionEvents = store.listEvents(`session:${sessionId}`);
    expect(sessionEvents.find((event) => event.type === "session.metadata")).toBeDefined();
    expect(adapter.getActiveSessionId()).toBe(sessionId);
  });

  test("session.create host-stream added summary carries the originating command id alongside the fresh session id", async () => {
    const { store, adapter, hostStream } = setup();
    const commandId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await adapter.dispatch(makeCommand(commandId, "session.create", hostStream, hostStream, {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      policyMode: "full",
      name: "correlated",
    }));
    const summaries = store.listEvents(hostStream).filter((event) => event.type === "session.summary");
    const added = summaries.map((event) => event.payload as Record<string, unknown>)
      .find((payload) => payload.change === "added")!;
    expect(added).toBeDefined();
    // Fresh UUID session id (not the command id, not a workspace/name/path fallback).
    expect(typeof added.sessionId).toBe("string");
    expect(added.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(added.sessionId).not.toBe(commandId);
    // Authoritative correlation: the originating session.create command id.
    expect(added.createdByCommandId).toBe(commandId);
    // Stored session state carries the same provenance marker.
    expect(store.sessionState(added.sessionId as string)?.createdByCommandId).toBe(commandId);
  });

  test("session.create binds indexed folder context and a useful default name", async () => {
    const root = trackedTempDir("pi-mob-workspaces-");
    const folder = join(root, "github", "pi-mob");
    mkdirSync(folder, { recursive: true });
    const { store, adapter, hostStream } = setup({
      workspace: { rootPath: root, displayName: "Home" },
    });

    await adapter.dispatch(makeCommand("c-folder", "session.create", hostStream, hostStream, {
      workspaceId: "22222222-2222-4222-8222-222222222222",
      workspaceRelativePath: "github/pi-mob",
      policyMode: "full",
    }));

    const state = store.sessionStates()[0]!;
    expect(state.name).toBe("pi-mob");
    expect(state.displayName).toBe("pi-mob");
    expect(state.workspaceRelativePath).toBe("github/pi-mob");
    expect(state.workspaceRootPath).toBe(realpathSync(folder));
    const summary = store.listEvents(hostStream).filter((event) => event.type === "session.summary").at(-1)!;
    expect((summary.payload as Record<string, unknown>).name).toBe("pi-mob");
  });

  test("host snapshot durably contains the one session summary", async () => {
    const { store, adapter, hostStream } = setup();
    await adapter.dispatch(makeCommand("c1", "session.create", hostStream, hostStream, { workspaceId: "ws", policyMode: "full" }));
    const snapshot = store.captureSnapshot(hostStream);
    const sessions = snapshot.state.sessions as Array<Record<string, unknown>>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.runtimeState).toBe("idle");
    expect(sessions[0]!.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("session.activate performs explicit manual process retry", async () => {
    const { store, rpc, adapter, hostStream } = setup();
    await adapter.dispatch(makeCommand("c1", "session.create", hostStream, hostStream, { workspaceId: "ws", policyMode: "full" }));
    const sessionId = (store.listEvents(hostStream).find((event) => event.type === "session.summary")!.payload as Record<string, unknown>).sessionId as string;
    await adapter.dispatch(makeCommand("retry", "session.activate", `session:${sessionId}`, `session:${sessionId}`, { sessionId }));
    expect(rpc.retries).toBe(1);
    expect(store.sessionState(sessionId)?.runtimeState).toBe("idle");
  });

  test("M10 controls expose configured state and map durable Pi commands", async () => {
    const { store, rpc, adapter, hostStream } = setup();
    rpc.responses.set("get_available_models:", { data: [
      { id: "anthropic/sonnet", name: "Sonnet", provider: "anthropic", available: true },
    ] });
    rpc.responses.set("get_state:", { data: {
      model: "anthropic/sonnet", thinkingLevel: "medium",
      steeringMode: "all", followUpMode: "one-at-a-time",
      autoCompactionEnabled: true,
    } });
    rpc.responses.set("get_session_stats:", { data: {
      inputTokens: 10, outputTokens: 5, contextTokens: 15,
      contextWindow: 1000, cost: 0.001,
    } });
    rpc.responses.set("get_commands:", { data: [
      { name: "review", description: "Review code", source: "skill" },
      { name: "quit", description: "TUI only", source: "extension" },
    ] });
    await adapter.dispatch(makeCommand("create-m10", "session.create", hostStream, hostStream, { workspaceId: "ws", policyMode: "full" }));
    const sessionId = (store.listEvents(hostStream).find((event) => event.type === "session.summary")!.payload as Record<string, unknown>).sessionId as string;
    expect(adapter.listModels(sessionId).items).toHaveLength(1);
    expect(store.sessionState(sessionId)?.modelId).toBe("anthropic/sonnet");
    expect((store.sessionState(sessionId)?.commandCatalogue as unknown[])).toHaveLength(1);
    expect(store.listEvents(`session:${sessionId}`).some((event) => event.type === "context.state")).toBe(true);

    rpc.reset();
    for (const [type, payload, method] of [
      ["model.set", { modelId: "anthropic/sonnet" }, "set_model"],
      ["thinking.set", { level: "high" }, "set_thinking_level"],
      ["compaction.start", {}, "compact"],
      ["compaction.auto.set", { enabled: false }, "set_auto_compaction"],
      ["retry.auto.set", { enabled: true }, "set_auto_retry"],
      ["retry.abort", {}, "abort_retry"],
      ["steering_mode.set", { enabled: true }, "set_steering_mode"],
      ["follow_up_mode.set", { enabled: false }, "set_follow_up_mode"],
    ] as const) {
      await adapter.dispatch(makeCommand(`m10-${type}`, type, `session:${sessionId}`, `session:${sessionId}`, { sessionId, ...payload }));
      expect(rpc.requests.at(-1)?.method).toBe(method);
    }
    expect(store.sessionState(sessionId)?.runtimeState).toBe("idle");
    expect(store.listEvents(`session:${sessionId}`).some((event) => event.type === "compaction.state")).toBe(true);
    expect(store.listEvents(`session:${sessionId}`).some((event) => event.type === "retry.state")).toBe(true);

    await expect(adapter.dispatch(makeCommand("unavailable-model", "model.set", `session:${sessionId}`, `session:${sessionId}`, { sessionId, modelId: "x" }))).rejects.toThrow("model.set provider unavailable");
    store.updateSessionState(sessionId, { ...store.sessionState(sessionId), runtimeState: "running" });
    await expect(adapter.dispatch(makeCommand("blocked-model", "model.set", `session:${sessionId}`, `session:${sessionId}`, { sessionId, modelId: "x" }))).rejects.toThrow("requires an idle session");
  });

  test("prompt.submit immediate calls RPC prompt and turn.abort calls RPC abort", async () => {
    const { store, rpc, adapter, hostStream } = setup();
    const create = makeCommand("cmd-create", "session.create", hostStream, hostStream, {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      policyMode: "full",
    });
    await adapter.dispatch(create);
    rpc.reset();
    const sessionId = (store.listEvents(hostStream).find((event) => event.type === "session.summary")!.payload as Record<string, unknown>).sessionId as string;
    const prompt = makeCommand("cmd-prompt", "prompt.submit", `session:${sessionId}`, `session:${sessionId}`, {
      sessionId,
      deliveryMode: "immediate",
      message: "hello bridge",
      attachmentIds: [],
    });
    await adapter.dispatch(prompt);
    expect(rpc.requests.map((req) => req.method)).toEqual(["prompt"]);
    expect(rpc.requests[0]!.id).toBe("cmd-prompt");
    expect(rpc.requests[0]!.params).toEqual({ message: "hello bridge" });
    const abort = makeCommand("cmd-abort", "turn.abort", `session:${sessionId}`, `session:${sessionId}`, { sessionId });
    await adapter.dispatch(abort);
    expect(rpc.requests.map((req) => req.method)).toEqual(["prompt", "abort"]);
    expect(rpc.requests[1]!.id).toBe("cmd-abort");
  });

  test("prompt.submit steer dispatches while follow_up remains bridge-owned", async () => {
    const { store, rpc, adapter, hostStream } = setup();
    await adapter.dispatch(makeCommand("c1", "session.create", hostStream, hostStream, { workspaceId: "ws", policyMode: "full" }));
    const sessionId = (store.listEvents(hostStream).find((e) => e.type === "session.summary")!.payload as Record<string, unknown>).sessionId as string;
    rpc.reset();
    await adapter.dispatch(makeCommand("c-steer", "prompt.submit", `session:${sessionId}`, `session:${sessionId}`, { sessionId, deliveryMode: "steer", message: "m", attachmentIds: [] }));
    expect(rpc.requests[0]!.method).toBe("steer");
    rpc.reset();
    adapter.commandAccepted("prompt.submit", { sessionId, deliveryMode: "follow_up", message: "later", attachmentIds: [] }, "c-follow");
    await adapter.dispatch(makeCommand("c-follow", "prompt.submit", `session:${sessionId}`, `session:${sessionId}`, { sessionId, deliveryMode: "follow_up", message: "later", attachmentIds: [] }));
    expect(rpc.requests).toEqual([]);
    expect(store.listFollowUps(sessionId)).toHaveLength(1);
  });

  test("rejects prompt.submit and turn.abort for unknown sessions", async () => {
    const { adapter, hostStream } = setup();
    await adapter.dispatch(makeCommand("c1", "session.create", hostStream, hostStream, { workspaceId: "ws", policyMode: "full" }));
    await expect(adapter.dispatch(makeCommand("p", "prompt.submit", `session:missing`, `session:missing`, { sessionId: "missing", deliveryMode: "immediate", message: "x", attachmentIds: [] }))).rejects.toThrow("session not found");
    await expect(adapter.dispatch(makeCommand("a", "turn.abort", `session:missing`, `session:missing`, { sessionId: "missing" }))).rejects.toThrow("session not found");
  });

  test("normalizes Pi notifications into session stream events", async () => {
    const { store, adapter, hostStream } = setup();
    await adapter.dispatch(makeCommand("c1", "session.create", hostStream, hostStream, { workspaceId: "ws", policyMode: "full" }));
    const sessionId = (store.listEvents(hostStream).find((e) => e.type === "session.summary")!.payload as Record<string, unknown>).sessionId as string;
    // Use the public fake-RPC emit path.
    const rpc = adapter.rpc as FakeRpc;
    rpc.emit({ type: "agent_start", sessionId });
    rpc.emit({ type: "message_update", sessionId, assistantMessageEvent: { type: "text_delta", delta: "hi" } });
    rpc.emit({ type: "tool_execution_start", sessionId, toolCallId: "t1", toolName: "read", args: { path: "/private/repo" } });
    rpc.emit({ type: "tool_execution_end", sessionId, toolCallId: "t1", toolName: "read", result: "ok", isError: false });
    rpc.emit({ type: "agent_settled", sessionId });
    const streamId = `session:${sessionId}`;
    const types = store.listEvents(streamId).map((event) => event.type);
    expect(types).toContain("session.state");
    expect(types).toContain("assistant.delta");
    expect(types).toContain("tool.started");
    expect(types).toContain("tool.completed");
    expect(types).toContain("turn.settled");
    const curatedEvents = store.listEvents(streamId).filter((event) => event.type !== "pi.rpc.event");
    expect(JSON.stringify(curatedEvents)).not.toContain("/private/repo");
  });

  test("durably projects recipe activity, suppresses curated reasoning deltas, and dedupes restart replay", async () => {
    const { store, adapter, hostStream, rpc } = setup();
    await adapter.dispatch(makeCommand("create-recipe", "session.create", hostStream, hostStream, { workspaceId: "ws", policyMode: "full" }));
    const sessionId = (store.listEvents(hostStream).find((event) => event.type === "session.summary")!.payload as Record<string, unknown>).sessionId as string;
    await adapter.dispatch(makeCommand("turn-recipe", "prompt.submit", `session:${sessionId}`, `session:${sessionId}`, {
      sessionId, deliveryMode: "immediate", message: "run", attachmentIds: [],
    }));

    const publishedAfterCommit: boolean[] = [];
    const detach = store.onEvent((event) => {
      if (event.type !== "recipe.activity") return;
      publishedAfterCommit.push(store.listEvents(event.streamId).some((stored) => stored.eventId === event.eventId));
    });
    rpc.emit({ type: "turn_start", sessionId });
    rpc.emit({ type: "message_update", sessionId, assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } });
    rpc.emit({ type: "message_update", sessionId, assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "private chain of thought" } });
    rpc.emit({ type: "message_update", sessionId, assistantMessageEvent: { type: "thinking_end", contentIndex: 0 } });
    rpc.emit({ type: "tool_execution_start", sessionId, toolCallId: "tool-r1", toolName: "bash", args: { command: "printf ok" } });
    rpc.emit({ type: "tool_execution_update", sessionId, toolCallId: "tool-r1", partialResult: "ok" });
    rpc.emit({ type: "tool_execution_end", sessionId, toolCallId: "tool-r1", toolName: "bash", result: "ok", isError: false });
    // RPC replay of the same terminal update must not create another recipe
    // snapshot even though the normalized source event is still journaled.
    rpc.emit({ type: "tool_execution_end", sessionId, toolCallId: "tool-r1", toolName: "bash", result: "ok", isError: false });
    rpc.emit({ type: "agent_settled", sessionId });
    detach();

    const streamId = `session:${sessionId}`;
    const events = store.listEvents(streamId);
    const recipes = events.filter((event) => event.type === "recipe.activity");
    expect(recipes.filter((event) => (event.payload as Record<string, unknown>).activityId === "0")).toHaveLength(2);
    expect(recipes.filter((event) => (event.payload as Record<string, unknown>).activityId === "tool-r1")).toHaveLength(2);
    expect(recipes.at(-1)?.payload).toMatchObject({
      kind: "tool", activityId: "tool-r1", status: "completed", output: "ok",
    });
    expect(publishedAfterCommit.every(Boolean)).toBe(true);
    expect(JSON.stringify(events.filter((event) => event.type !== "pi.rpc.event"))).not.toContain("private chain of thought");
    expect(events.some((event) => event.type === "reasoning.delta")).toBe(false);

    const beforeRestart = recipes.length;
    adapter.close();
    const restarted = new OneSessionPiAdapter({
      store,
      rpc,
      workspace: {
        workspaceId: "11111111-1111-4111-8111-111111111111",
        rootPath: "/private/example/repo",
        displayName: "example",
        fingerprint: "fingerprint-fixture",
        policyMode: "full",
      },
      now: () => 1_700_000_000_000,
    });
    expect(store.listEvents(streamId).filter((event) => event.type === "recipe.activity")).toHaveLength(beforeRestart);
    restarted.close();
  });

  test("external history emits recipe activity without persisting private thinking", () => {
    const directory = mkdtempSync(join(tmpdir(), "pi-mob-r1-history-"));
    const source = join(directory, "session.jsonl");
    const sessionId = "77777777-7777-4777-8777-777777777777";
    const store = new BridgeStore(join(directory, "bridge.sqlite"), () => Date.parse("2026-01-01T00:00:10.000Z"));
    store.ensureSession(sessionId, { externalSession: true });
    store.ensureStream(`session:${sessionId}`, "session", sessionId);
    writeFileSync(source, [
      { type: "session", id: sessionId, version: 1 },
      { type: "message", id: "user-1", parentId: null, timestamp: "2026-01-01T00:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "run" }] } },
      { type: "message", id: "assistant-1", parentId: "user-1", timestamp: "2026-01-01T00:00:01.000Z", message: { role: "assistant", content: [
        { type: "thinking", thinking: "historical private chain of thought" },
        { type: "toolCall", id: "history-tool", name: "bash", arguments: { command: "printf ok" } },
      ] } },
      { type: "message", id: "result-1", parentId: "assistant-1", timestamp: "2026-01-01T00:00:03.000Z", message: { role: "toolResult", toolCallId: "history-tool", toolName: "bash", content: [{ type: "text", text: "ok" }], isError: false } },
    ].map((entry) => JSON.stringify(entry)).join("\n"));

    expect(importExternalSessionHistory(store, sessionId, source)).toBeGreaterThan(0);
    const events = store.listEvents(`session:${sessionId}`);
    expect(events.some((event) => event.type === "recipe.activity")).toBe(true);
    expect(events.some((event) => event.type === "reasoning.delta")).toBe(false);
    expect(JSON.stringify(events)).not.toContain("historical private chain of thought");
    const latestTool = events.filter((event) => event.type === "recipe.activity" && event.payload.activityId === "history-tool").at(-1)!;
    expect(latestTool.payload).toMatchObject({ status: "completed", output: "ok" });
    expect((latestTool.payload.timing as Record<string, unknown>).durationMs).toBe(2000);
    expect(importExternalSessionHistory(store, sessionId, source)).toBe(0);
  });

  test("history/live overlap dedupes recipe snapshots by stable identity", () => {
    const store = new BridgeStore(join(mkdtempSync(join(tmpdir(), "pi-mob-r1-overlap-")), "bridge.sqlite"), () => Date.parse("2026-01-01T00:00:00.000Z"));
    const sessionId = "88888888-8888-4888-8888-888888888888";
    store.ensureSession(sessionId);
    store.ensureStream(`session:${sessionId}`, "session", sessionId);
    const projection = new DurableRecipeActivityProjection(store, sessionId);
    projection.append("turn.started", { sessionId, turnId: "turn-1" });
    projection.append("tool.started", { sessionId, turnId: "turn-1", toolCallId: "same-tool", toolName: "read", arguments: { file: "README.md" }, historical: true });
    projection.append("tool.completed", { sessionId, turnId: "turn-1", toolCallId: "same-tool", toolName: "read", result: "ok", historical: true });
    const beforeOverlap = store.listEvents(`session:${sessionId}`).filter((event) => event.type === "recipe.activity");

    projection.append("tool.started", { sessionId, turnId: "turn-1", toolCallId: "same-tool", toolName: "read", arguments: { file: "README.md" } });
    projection.append("tool.completed", { sessionId, turnId: "turn-1", toolCallId: "same-tool", toolName: "read", result: "ok" });
    const afterOverlap = store.listEvents(`session:${sessionId}`).filter((event) => event.type === "recipe.activity");
    expect(afterOverlap).toHaveLength(beforeOverlap.length);
    expect(afterOverlap.at(-1)?.payload).toEqual(beforeOverlap.at(-1)?.payload);
  });

  test("shared RPC binds one notification listener across durable sessions", async () => {
    const { store, adapter, hostStream, rpc } = setup();
    await adapter.dispatch(makeCommand("c1", "session.create", hostStream, hostStream, { workspaceId: "ws", policyMode: "full" }));
    await adapter.dispatch(makeCommand("c2", "session.create", hostStream, hostStream, { workspaceId: "ws", policyMode: "full" }));
    const summaries = store.listEvents(hostStream).filter((event) => event.type === "session.summary");
    const sessionId = (summaries.at(-1)!.payload as Record<string, unknown>).sessionId as string;
    expect(rpc.notifications.size).toBe(1);

    rpc.emit({ type: "message_update", sessionId, assistantMessageEvent: { type: "text_delta", delta: "once" } });

    const deltas = store.listEvents(`session:${sessionId}`).filter((event) => event.type === "assistant.delta");
    expect(deltas).toHaveLength(1);
    expect((deltas[0]!.payload as Record<string, unknown>).text).toBe("once");
  });

  test("assigns each submitted prompt a distinct durable turn id", async () => {
    const { store, adapter, hostStream, rpc } = setup();
    await adapter.dispatch(makeCommand("c1", "session.create", hostStream, hostStream, { workspaceId: "ws", policyMode: "full" }));
    const sessionId = (store.listEvents(hostStream).find((event) => event.type === "session.summary")!.payload as Record<string, unknown>).sessionId as string;

    for (const commandId of ["prompt-one", "prompt-two"]) {
      await adapter.dispatch(makeCommand(commandId, "prompt.submit", `session:${sessionId}`, `session:${sessionId}`, { sessionId, deliveryMode: "immediate", message: commandId, attachmentIds: [] }));
      rpc.emit({ type: "turn_start", sessionId });
      rpc.emit({ type: "agent_settled", sessionId });
    }

    const starts = store.listEvents(`session:${sessionId}`).filter((event) => event.type === "turn.started");
    expect(starts.map((event) => (event.payload as Record<string, unknown>).turnId)).toEqual(["prompt-one", "prompt-two"]);
    expect(starts.map((event) => (event.payload as Record<string, unknown>).commandId)).toEqual(["prompt-one", "prompt-two"]);
  });

  test("routes notifications to the active session when sessionId is omitted on the wire", async () => {
    const { store, adapter, hostStream } = setup();
    await adapter.dispatch(makeCommand("c1", "session.create", hostStream, hostStream, { workspaceId: "ws", policyMode: "full" }));
    const sessionId = (store.listEvents(hostStream).find((e) => e.type === "session.summary")!.payload as Record<string, unknown>).sessionId as string;
    await adapter.dispatch(makeCommand("p", "prompt.submit", `session:${sessionId}`, `session:${sessionId}`, { sessionId, deliveryMode: "immediate", message: "go", attachmentIds: [] }));
    const rpc = adapter.rpc as FakeRpc;
    rpc.emit({ type: "agent_start" });
    const types = store.listEvents(`session:${sessionId}`).map((e) => e.type);
    expect(types).toContain("session.state");
  });

  test("detaches notification listener on close", async () => {
    const { adapter, hostStream } = setup();
    await adapter.dispatch(makeCommand("c1", "session.create", hostStream, hostStream, { workspaceId: "ws", policyMode: "full" }));
    const rpc = adapter.rpc as FakeRpc;
    expect(rpc.notifications.size).toBe(1);
    adapter.close();
    expect(rpc.notifications.size).toBe(0);
    adapter.close(); // idempotent
  });
});

// ---------------- runtime + replay tests via loopback WebSocket ----------------

interface Client { ws: WebSocket; next(): Promise<Record<string, unknown>>; messages: Record<string, unknown>[]; }
async function connect(port: number): Promise<Client> {
  const queue: Array<Record<string, unknown>> = []; const waiters: Array<(v: Record<string, unknown>) => void> = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`, { perMessageDeflate: false });
  ws.onmessage = (event) => { const v = JSON.parse(String(event.data)) as Record<string, unknown>; const w = waiters.shift(); if (w) w(v); else queue.push(v); };
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error("connect failed")); });
  return { ws, messages: queue, next: () => queue.length ? Promise.resolve(queue.shift()!) : new Promise((r) => waiters.push(r)) };
}
function envelope(type: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { protocol: { major: 1, minor: 0 }, messageId: crypto.randomUUID(), requestId: crypto.randomUUID(), sentAt: new Date().toISOString(), type, payload, ...extra };
}
async function hello(client: Client): Promise<{ connectionId: string; hostId: string }> {
  client.ws.send(JSON.stringify(envelope("hello", {
    mobileVersion: "1", platform: "ios", installationId: crypto.randomUUID(),
    requiredCapabilities: ["streams.v1", "commands.v1"], optionalCapabilities: [],
  })));
  const response = await client.next();
  const payload = response.payload as Record<string, unknown>;
  return { connectionId: payload.connectionId as string, hostId: payload.hostId as string };
}

describe("M5 runtime integration", () => {
  test("workspace.list control returns the configured workspace", async () => {
    const rootPath = trackedTempDir("pi-mob-workspaces-");
    const { store, adapter } = setup({ workspace: { rootPath } });
    const runtime = new DurableBridgeRuntime({ store, adapter: adapter as unknown as AdapterPort, bridgeVersion: "0", piVersion: "0.82.0", hostDisplayName: "example" });
    await runtime.start();
    const server = createBridgeServer({ runtime, port: 0 });
    try {
      const client = await connect(server.port!);
      const { connectionId } = await hello(client);
      const requestId = crypto.randomUUID();
      client.ws.send(JSON.stringify(envelope("workspace.list", {}, { connectionId, requestId })));
      const message = await client.next();
      expect(message.type).toBe("workspace.list.result");
      expect((message.requestId as string)).toBe(requestId);
      const items = ((message.payload as Record<string, unknown>).items as Array<Record<string, unknown>>);
      expect(items).toHaveLength(1);
      expect(items[0]!.workspaceId).toBe(deriveRootId(canonicalizeOrThrow(rootPath)));
      expect(items[0]!.rootPath).toBeUndefined();
      client.ws.close();
    } finally { server.stop(true); }
  });

  test("workspace.list fails when adapter lacks listWorkspaces", async () => {
    const { store } = setup();
    const adapter: AdapterPort = { async dispatch() { /* noop */ } };
    const runtime = new DurableBridgeRuntime({ store, adapter, bridgeVersion: "0", piVersion: "0.82.0", hostDisplayName: "h" });
    await runtime.start();
    const server = createBridgeServer({ runtime, port: 0 });
    try {
      const client = await connect(server.port!);
      const { connectionId } = await hello(client);
      const requestId = crypto.randomUUID();
      client.ws.send(JSON.stringify(envelope("workspace.list", {}, { connectionId, requestId })));
      const message = await client.next();
      expect(message.type).toBe("error");
      expect(((message.payload as Record<string, unknown>).code as string)).toBe("workspace_unavailable");
      client.ws.close();
    } finally { server.stop(true); }
  });

  test("full M5 happy path: workspace.list, session.create, prompt.submit, replay after restart, turn.abort", async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), "pi-mob-m5-runtime-"));
    const workspaceRoot = mkdtempSync(join(tmpdir(), "pi-mob-m5-runtime-ws-"));
    const path = join(stateRoot, "bridge.sqlite");
    const workspaceId = deriveRootId(canonicalizeOrThrow(workspaceRoot));
    // Build adapter + runtime + server (fresh state)
    let store = new BridgeStore(path);
    let rpc = new FakeRpc();
    let adapter = new OneSessionPiAdapter({
      store, rpc,
      workspace: {
        workspaceId,
        rootPath: workspaceRoot,
        displayName: "example",
        fingerprint: "fp",
        policyMode: "full",
      },
      newSessionId: deterministicIdGenerator("sess"),
      now: () => 1_700_000_000_000,
    });
    let runtime = new DurableBridgeRuntime({ store, adapter: adapter as unknown as AdapterPort, bridgeVersion: "0", piVersion: "0.82.0", hostDisplayName: "example" });
    await runtime.start();
    let server = createBridgeServer({ runtime, port: 0 });
    try {
      const client = await connect(server.port!);
      const { connectionId, hostId } = await hello(client);

      // workspace.list
      client.ws.send(JSON.stringify(envelope("workspace.list", {}, { connectionId, requestId: crypto.randomUUID() })));
      const listed = await client.next();
      expect(listed.type).toBe("workspace.list.result");

      // Subscribe to host stream so we can observe session.summary
      client.ws.send(JSON.stringify(envelope("subscription.set", { streams: [{ streamId: `host:${hostId}`, detail: "full", afterCursor: "0" }] }, { connectionId })));
      while (true) { const m = await client.next(); if (m.type === "stream.sync.complete") break; }

      // session.create
      const createId = crypto.randomUUID();
      client.ws.send(JSON.stringify({
        protocol: { major: 1, minor: 0 }, messageId: crypto.randomUUID(), requestId: crypto.randomUUID(),
        connectionId, commandId: createId, type: "session.create", sentAt: new Date().toISOString(),
        payload: { workspaceId, policyMode: "full", name: "diagnostic" },
      }));
      // Wait for receipt and the host-stream session.summary
      let sessionId: string | null = null;
      for (let i = 0; i < 30 && !sessionId; i += 1) {
        const m = await client.next();
        if (m.type === "command.receipt") continue;
        if (m.type === "session.summary") sessionId = ((m.payload as Record<string, unknown>).sessionId as string) ?? null;
      }
      expect(sessionId).toBeTruthy();
      const sess = sessionId as string;

      // Subscribe to session stream before submitting prompt
      client.ws.send(JSON.stringify(envelope("subscription.set", { streams: [{ streamId: `host:${hostId}`, detail: "full", afterCursor: "0" }, { streamId: `session:${sess}`, detail: "full", afterCursor: "0" }] }, { connectionId })));
      while (true) { const m = await client.next(); if (m.type === "stream.sync.complete" && (m.payload as Record<string, unknown>).streamId === `session:${sess}`) break; }

      // Acquire the controller lease required by prompt and abort. Lease wire
      // behavior is covered by M4; this test focuses on the M5 adapter path.
      const leaseId = runtime.leases.acquire(
        `session:${sess}`,
        "22222222-2222-4222-8222-222222222222",
        connectionId,
      ).leaseId;

      // prompt.submit (immediate)
      const promptId = crypto.randomUUID();
      client.ws.send(JSON.stringify({
        protocol: { major: 1, minor: 0 }, messageId: crypto.randomUUID(), requestId: crypto.randomUUID(),
        connectionId, commandId: promptId, leaseId, type: "prompt.submit", sentAt: new Date().toISOString(),
        payload: { sessionId: sess, deliveryMode: "immediate", message: "ping", attachmentIds: [] },
      }));
      while (true) { const m = await client.next(); if (m.type === "command.receipt" && m.commandId === promptId) break; }
      await Bun.sleep(10);
      expect(rpc.requests.some((r) => r.method === "prompt" && r.id === promptId)).toBe(true);

      // turn.abort
      const abortId = crypto.randomUUID();
      client.ws.send(JSON.stringify({
        protocol: { major: 1, minor: 0 }, messageId: crypto.randomUUID(), requestId: crypto.randomUUID(),
        connectionId, commandId: abortId, leaseId, type: "turn.abort", sentAt: new Date().toISOString(),
        payload: { sessionId: sess },
      }));
      while (true) { const m = await client.next(); if (m.type === "command.receipt" && m.commandId === abortId) break; }
      await Bun.sleep(10);
      expect(rpc.requests.some((r) => r.method === "abort" && r.id === abortId)).toBe(true);
      client.ws.close();
    } finally { server.stop(true); adapter.close(); store.close(); await rpc_fail_silent(rpc); }

    // Restart: reopen store + adapter + runtime, replay host stream — expect session.summary still present
    store = new BridgeStore(path);
    rpc = new FakeRpc();
    adapter = new OneSessionPiAdapter({
      store, rpc,
      workspace: {
        workspaceId,
        rootPath: workspaceRoot,
        displayName: "example",
        fingerprint: "fp",
        policyMode: "full",
      },
      newSessionId: deterministicIdGenerator("sess"),
      now: () => 1_700_000_000_000,
    });
    runtime = new DurableBridgeRuntime({ store, adapter: adapter as unknown as AdapterPort, bridgeVersion: "0", piVersion: "0.82.0", hostDisplayName: "example" });
    await runtime.start();
    server = createBridgeServer({ runtime, port: 0 });
    try {
      const replay = await connect(server.port!);
      const { connectionId, hostId } = await hello(replay);
      replay.ws.send(JSON.stringify(envelope("subscription.set", { streams: [{ streamId: `host:${hostId}`, detail: "full", afterCursor: "0" }] }, { connectionId })));
      const seen: string[] = [];
      while (true) {
        const m = await replay.next();
        seen.push(String(m.type));
        if (m.type === "stream.sync.complete") break;
      }
      expect(seen).toContain("session.summary");
      replay.ws.close();
    } finally {
      server.stop(true); adapter.close(); store.close(); await rpc_fail_silent(rpc);
      rmSync(stateRoot, { recursive: true, force: true });
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  }, 30_000);

  test("unknown RPC outcome becomes indeterminate and duplicate never reruns", async () => {
    const { store, rpc, adapter, hostStream } = setup();
    const runtime = new DurableBridgeRuntime({ store, adapter, bridgeVersion: "m6", piVersion: "0.82.0", hostDisplayName: "h" });
    await runtime.start();
    await adapter.dispatch(makeCommand("c1", "session.create", hostStream, hostStream, { workspaceId: "ws", policyMode: "full" }));
    const sessionId = (store.listEvents(hostStream).find((event) => event.type === "session.summary")!.payload as Record<string, unknown>).sessionId as string;
    rpc.reset();
    rpc.failWith = new Error("transport lost after write");
    const input = { commandId: "abababab-abab-4bab-8bab-abababababab", type: "prompt.submit", payload: { sessionId, deliveryMode: "immediate", message: "once", attachmentIds: [] }, scopeKey: `session:${sessionId}`, streamId: `session:${sessionId}` };
    const first = runtime.commands.submit(input); await first.completion;
    expect(store.command(input.commandId)?.state).toBe("indeterminate");
    expect(store.listEvents(input.streamId).some((event) => event.type === "turn.indeterminate")).toBe(true);
    const duplicate = runtime.commands.submit(input); await duplicate.completion;
    expect(duplicate.receipt.duplicate).toBe(true);
    expect(rpc.requestAttempts).toBe(1);
  });

  test("lost receipt prompt.submit redispatches once", async () => {
    const { store, rpc, adapter, hostStream } = setup();
    const runtime = new DurableBridgeRuntime({ store, adapter: adapter as unknown as AdapterPort, bridgeVersion: "0", piVersion: "0.82.0", hostDisplayName: "h" });
    await runtime.start();
    // Establish a session via direct adapter dispatch (skip WebSocket for brevity).
    await adapter.dispatch(makeCommand("c1", "session.create", hostStream, hostStream, { workspaceId: "ws", policyMode: "full" }));
    const sessionId = (store.listEvents(hostStream).find((e) => e.type === "session.summary")!.payload as Record<string, unknown>).sessionId as string;
    const commandId = crypto.randomUUID();
    const input = { commandId, type: "prompt.submit" as const, payload: { sessionId, deliveryMode: "immediate" as const, message: "x", attachmentIds: [] }, scopeKey: `session:${sessionId}`, streamId: `session:${sessionId}` };
    const first = runtime.commands.submit(input);
    const resend = runtime.commands.submit(input);
    expect(resend.receipt.duplicate).toBe(true);
    await first.completion;
    const promptCount = rpc.requests.filter((r) => r.method === "prompt").length;
    expect(promptCount).toBe(1);
    expect(store.command(commandId)?.state).toBe("completed");
  });
});

// ---------------- helpers ----------------

function makeCommand(commandId: string, type: string, scopeKey: string, streamId: string, payload: Record<string, unknown>): import("../src/core/store").StoredCommand {
  return { commandId, type, scopeKey, streamId, semanticHash: `${type}:${commandId}`, payload, state: "accepted", dispatchCount: 0 };
}

async function rpc_fail_silent(rpc: FakeRpc): Promise<void> { rpc.reset(); }
