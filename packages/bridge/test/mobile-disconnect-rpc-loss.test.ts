/**
 * Regression test for the production bug:
 *
 *   "Two-reviewer subagent card stuck `Running` after mobile backgrounding
 *    and a lost bridge projection/notification boundary."
 *
 * The fixture models a lost bridge projection/notification boundary while
 * Pi's session JSONL continues to receive entries. It does not establish
 * anything about the RPC subprocess's process state.
 *
 * Required behaviour after the fix:
 *   1. The bridge keeps recording events even when the mobile socket is
 *      closed or backgrounded. A WebSocket/controller disconnect must NOT
 *      unsubscribe or cancel host-side Pi notification persistence.
 *   2. When the bridge RPC subprocess reconnects (or the bridge daemon
 *      restarts), the bridge MUST import any JSONL entries appended after
 *      the last durable checkpoint — including a terminal toolResult — and
 *      publish the matching `tool.completed`/`tool.failed` events so the
 *      recipe.activity transitions out of `running`.
 *   3. If the JSONL shows a terminal toolResult, the bridge does NOT
 *      additionally project `turn.indeterminate` (it must converge to a
 *      truthful terminal state instead of permanent Running).
 *   4. If the authoritative JSONL ends with an open tool/turn and no live
 *      Pi process owns it, the bridge synthesizes a bounded indeterminate
 *      terminal state for the orphaned activity rather than leaving the
 *      pill permanently Running.
 *   5. Stable identities make replay idempotent: no duplicate
 *      `recipe.activity` events for the same activity, no duplicate
 *      `tool.completed`/`tool.failed` events.
 *
 * The deterministic portions use a synthetic JSONL and store. The startup
 * restore test also enters through OneSessionPiAdapter's real bootstrap path;
 * no claim is made about the subprocess state.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BridgeStore } from "../src/core/store";
import { importSessionHistoryTail, importExternalSessionHistory, reconcileSessionHistoryTail } from "../src/pi/external-history";
import { OneSessionPiAdapter, type PiRpcClient } from "../src/pi/one-session-adapter";
import { runDaemon } from "../src/daemon";

const SESSION = "11111111-1111-4111-8111-111111111111";
const TURN = "turn-test";
const TOOL = "synthetic-subagent-tool";

function freshStore(): { store: BridgeStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "pi-mob-reconcile-store-"));
  const store = new BridgeStore(join(dir, "bridge.sqlite"));
  const hostId = store.identity().hostId;
  store.ensureStream(`host:${hostId}`, "host");
  store.ensureSession(SESSION, {
    sessionId: SESSION,
    workspaceId: "ws",
    workspaceRootPath: "/tmp/ws",
    workspaceRelativePath: ".",
    workspaceDisplayName: "ws",
    name: "ws",
    policyMode: "full",
    runtimeState: "running",
    attentionState: "needs_attention",
    queueCount: 0,
    lastActivityAt: new Date().toISOString(),
  });
  store.ensureStream(`session:${SESSION}`, "session", SESSION);
  return { store, dir };
}

function writeSessionJsonl(directory: string, entries: unknown[]): string {
  const path = join(directory, "session.jsonl");
  writeFileSync(path, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return path;
}

function openSessionJsonl(directory: string): string {
  return join(directory, "session.jsonl");
}

describe("mobile disconnect / lost projection boundary does not strand a turn", () => {
  let storeDir = "";
  let jsonlDir = "";
  let store: BridgeStore;

  beforeEach(() => {
    const fresh = freshStore();
    store = fresh.store;
    storeDir = fresh.dir;
    jsonlDir = mkdtempSync(join(tmpdir(), "pi-mob-reconcile-jsonl-"));
  });

  afterEach(() => {
    store.close();
    rmSync(storeDir, { recursive: true, force: true });
    rmSync(jsonlDir, { recursive: true, force: true });
  });

  test("startup restore entry point reconciles live sessions, not just legacy external sessions", () => {
    const sessionPath = writeSessionJsonl(jsonlDir, [
      { type: "session", id: SESSION, version: 1 },
      { type: "message", id: "user-restore", parentId: null, message: { role: "user", content: [{ type: "text", text: "restore" }] } },
    ]);
    store.updateSessionState(SESSION, { ...(store.sessionState(SESSION) ?? {}), piSessionPath: sessionPath });
    const fakeRpc: PiRpcClient = {
      request: async () => ({}),
      on: () => () => undefined,
      lifecycleState: () => "idle",
    };
    const calls: Array<{ sessionId: string; liveProcess: boolean }> = [];
    const adapter = new OneSessionPiAdapter({
      store,
      createRpc: () => fakeRpc,
      workspace: { workspaceId: "ws", rootPath: "/tmp/ws", displayName: "ws", fingerprint: "fp", policyMode: "full" },
      reconcileHistory: (sessionId, liveProcess) => {
        calls.push({ sessionId, liveProcess });
        importSessionHistoryTail(store, sessionId, sessionPath);
        return { authoritativeTerminal: false };
      },
    });
    try {
      expect(calls).toEqual([{ sessionId: SESSION, liveProcess: true }]);
      expect(store.listEvents(`session:${SESSION}`).some((event) => event.type === "turn.started")).toBe(true);
    } finally {
      adapter.close();
    }
  });

  test("daemon startup reconciles a terminal live JSONL before crash marking", async () => {
    const daemonDir = mkdtempSync(join(tmpdir(), "pi-mob-startup-terminal-daemon-"));
    const stateDir = join(daemonDir, "state");
    const sessionDir = join(daemonDir, "sessions");
    const workspace = join(daemonDir, "workspace");
    mkdirSync(workspace, { recursive: true });
    const executable = join(daemonDir, "fake-pi");
    writeFileSync(executable, `#!/bin/sh\nexec ${Bun.which("bun")!} ${new URL("./fixtures/fake-pi-rpc.ts", import.meta.url).pathname} "$@"\n`, { mode: 0o755 });
    let sessionId = "44444444-4444-4444-8444-444444444444";
    const turnId = "user-terminal-turn";
    const toolCallId = "terminal-tool";
    const sessionPath = writeSessionJsonl(daemonDir, [
      { type: "session", id: sessionId, version: 1 },
      { type: "message", id: turnId, parentId: null, message: { role: "user", content: [{ type: "text", text: "finish" }] } },
      { type: "message", id: "assistant-tool", parentId: turnId, message: { role: "assistant", content: [{ type: "toolCall", id: toolCallId, name: "bash", arguments: { command: "true" } }] } },
      { type: "message", id: "tool-result", parentId: "assistant-tool", message: { role: "toolResult", toolCallId, toolName: "bash", isError: false, content: [{ type: "text", text: "done" }] } },
      { type: "message", id: "assistant-final", parentId: "tool-result", message: { role: "assistant", content: [{ type: "text", text: "finished" }] } },
    ]);
    let daemon = await runDaemon({
      workspace, executable, stateDir, sessionDir,
      environment: {
        HOME: daemonDir,
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        PI_FIXTURE_SESSION_FILE: sessionPath,
      },
    });
    // Establish the bridge-owned session through the real adapter/RPC startup
    // path. The get_state response is what durably captures piSessionPath;
    // this test must not manufacture that mapping in SQLite.
    const hostStream = `host:${daemon.store.identity().hostId}`;
    await daemon.adapter.dispatch({
      commandId: "startup-flow-session-create",
      type: "session.create",
      scopeKey: hostStream,
      streamId: hostStream,
      semanticHash: "session.create:startup-flow-session-create",
      payload: { workspaceId: "startup", policyMode: "full" },
      state: "accepted",
      dispatchCount: 0,
    });
    sessionId = (daemon.store.sessionStates()[0]!.sessionId as string);
    daemon.store.appendEvent(`session:${sessionId}`, "turn.started", { sessionId, turnId, commandId: turnId, deliveryMode: "immediate" });
    daemon.store.appendEvent(`session:${sessionId}`, "tool.started", { sessionId, turnId, toolCallId, toolName: "bash", arguments: { command: "true" } });
    await daemon.close();

    try {
      daemon = await runDaemon({
        workspace, executable, stateDir, sessionDir,
        environment: { HOME: daemonDir, PATH: process.env.PATH ?? "/usr/bin:/bin" },
      });
      const events = daemon.canonicalSessionStore.readAfter(sessionId, 0).map((event) => ({ type: event.eventType, payload: event.payload }));
      expect(events.some((event) => event.type === "tool.completed" && event.payload.toolCallId === toolCallId)).toBe(true);
      expect(events.some((event) => event.type === "assistant.message.completed")).toBe(true);
      expect(events.some((event) => event.type === "turn.settled" && event.payload.turnId === turnId)).toBe(true);
      expect(events.some((event) => event.type === "turn.indeterminate" && event.payload.reason === "bridge_restart")).toBe(false);
      expect(events.some((event) => event.type === "tool.failed" && (event.payload.errorInfo as Record<string, unknown> | undefined)?.code === "indeterminate")).toBe(false);
      const terminalCount = events.filter((event) => ["tool.completed", "tool.failed", "turn.settled", "turn.indeterminate"].includes(event.type)).length;
      await daemon.close();
      daemon = await runDaemon({
        workspace, executable, stateDir, sessionDir,
        environment: { HOME: daemonDir, PATH: process.env.PATH ?? "/usr/bin:/bin" },
      });
      const restartedEvents = daemon.canonicalSessionStore.readAfter(sessionId, 0);
      expect(restartedEvents.filter((event) => ["tool.completed", "tool.failed", "turn.settled", "turn.indeterminate"].includes(event.eventType))).toHaveLength(terminalCount);
    } finally {
      await daemon.close();
      rmSync(daemonDir, { recursive: true, force: true });
    }
  }, 10_000);

  test("a shared primary client exit reconciles only its explicit owner", async () => {
    const daemonDir = mkdtempSync(join(tmpdir(), "pi-mob-reconcile-daemon-"));
    const stateDir = join(daemonDir, "state");
    const sessionDir = join(daemonDir, "sessions");
    const workspace = join(daemonDir, "workspace");
    mkdirSync(workspace, { recursive: true });
    const executable = join(daemonDir, "fake-pi");
    writeFileSync(executable, `#!/bin/sh\nexec ${Bun.which("bun")!} ${new URL("./fixtures/fake-pi-rpc.ts", import.meta.url).pathname} "$@"\n`, { mode: 0o755 });
    const daemon = await runDaemon({
      workspace,
      executable,
      stateDir,
      sessionDir,
      environment: { HOME: daemonDir, PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
    const first = "22222222-2222-4222-8222-222222222222";
    const second = "33333333-3333-4333-8333-333333333333";
    const firstPath = writeSessionJsonl(daemonDir, [
      { type: "session", id: first, version: 1 },
      { type: "message", id: "user-first", parentId: null, message: { role: "user", content: [{ type: "text", text: "run" }] } },
      { type: "message", id: "assistant-first", parentId: "user-first", message: { role: "assistant", content: [{ type: "toolCall", id: "first-open-tool", name: "bash", arguments: { command: "fixture" } }] } },
    ]);
    const secondPath = writeSessionJsonl(daemonDir, [
      { type: "session", id: second, version: 1 },
      { type: "message", id: "user-second", parentId: null, message: { role: "user", content: [{ type: "text", text: "run" }] } },
      { type: "message", id: "assistant-second", parentId: "user-second", message: { role: "assistant", content: [{ type: "toolCall", id: "second-open-tool", name: "bash", arguments: { command: "fixture" } }] } },
    ]);
    const add = (sessionId: string, path: string | null) => {
      daemon.store.ensureSession(sessionId, { sessionId, ...(path ? { piSessionPath: path } : {}), runtimeState: "running", attentionState: "needs_attention" });
      daemon.store.ensureStream(`session:${sessionId}`, "session", sessionId);
    };
    add(first, null);
    add(second, secondPath);
    try {
      const firstRpc = daemon.adapter.resolveRpc(first) as unknown as { start(): Promise<void>; markDispatchStart(): void; snapshot(): { sessions: Array<{ pid?: number }> }; state(): string };
      const secondRpc = daemon.adapter.resolveRpc(second) as unknown as { start(): Promise<void>; snapshot(): { sessions: Array<{ pid?: number }> }; state(): string };
      daemon.store.updateSessionState(first, { ...(daemon.store.sessionState(first) ?? {}), piSessionPath: firstPath });
      await secondRpc.start();
      await firstRpc.start();
      firstRpc.markDispatchStart();
      const firstPid = firstRpc.snapshot().sessions[0]?.pid;
      expect(firstPid).toBeDefined();
      process.kill(firstPid!, "SIGKILL");
      const deadline = Date.now() + 3_000;
      while (firstRpc.state() === "running") {
        if (Date.now() > deadline) throw new Error("owner exit was not observed");
        await Bun.sleep(10);
      }
      const firstEvents = daemon.canonicalSessionStore.readAfter(first, 0);
      const secondEvents = daemon.canonicalSessionStore.readAfter(second, 0);
      expect(firstEvents.some((event) => event.eventType === "turn.indeterminate")).toBe(true);
      expect(secondEvents.some((event) => event.eventType === "turn.indeterminate")).toBe(false);
      expect(secondRpc.state()).toBe("idle");
    } finally {
      await daemon.close();
      rmSync(daemonDir, { recursive: true, force: true });
    }
  }, 10_000);

  test("importSessionHistoryTail exists and is callable from any session with piSessionPath", () => {
    // Sanity: the new tail-reconciler exists and is callable for a
    // live-RPC session (no `externalSession: true` flag required).
    expect(typeof importSessionHistoryTail).toBe("function");
    const sessionPath = writeSessionJsonl(jsonlDir, [
      { type: "session", id: SESSION, version: 1 },
    ]);
    store.updateSessionState(SESSION, { ...(store.sessionState(SESSION) ?? {}), piSessionPath: sessionPath });
    expect(importSessionHistoryTail(store, SESSION, sessionPath)).toBe(0);
  });

  test("bridge writes live tool.started but durable projection misses tool.completed", () => {
    // Step 1: bridge records turn.started + tool.started via the RPC
    // notification stream.
    store.appendEvent(`session:${SESSION}`, "turn.started", {
      sessionId: SESSION,
      turnId: TURN,
      commandId: TURN,
      deliveryMode: "immediate",
      message: "run fixture tasks",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    store.appendEvent(`session:${SESSION}`, "tool.started", {
      sessionId: SESSION,
      turnId: TURN,
      toolCallId: TOOL,
      toolName: "subagent",
      builtIn: true,
      arguments: { tasks: [{ agent: "reviewer", prompt: "one" }, { agent: "reviewer", prompt: "two" }] },
    });

    const sessionPath = openSessionJsonl(jsonlDir);
    // Step 2: the bridge projection boundary misses later notifications;
    // the session JSONL records what happened next.
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ type: "session", id: SESSION, version: 1 }),
        JSON.stringify({
          type: "message",
          id: "user-1",
          parentId: null,
          timestamp: "2026-01-01T00:00:01.000Z",
          message: { role: "user", content: [{ type: "text", text: "run fixture tasks" }] },
        }),
        JSON.stringify({
          type: "message",
          id: "asst-1",
          parentId: "user-1",
          timestamp: "2026-01-01T00:00:02.000Z",
          message: {
            role: "assistant",
            content: [{ type: "thinking", thinking: "thinking" }, {
              type: "toolCall",
              id: TOOL,
              name: "subagent",
              arguments: { tasks: [{ agent: "reviewer", prompt: "one" }, { agent: "reviewer", prompt: "two" }] },
            }],
          },
        }),
      ].join("\n") + "\n",
    );
    store.updateSessionState(SESSION, { ...(store.sessionState(SESSION) ?? {}), piSessionPath: sessionPath });
    // Step 3: bridge calls the reconciler. The only assistant entry in the
    // JSONL contains the toolCall whose id matches the already-durable
    // tool.started, so the inferred anchor sits at the last branch entry
    // and the import past it is empty. The reconciler must NOT duplicate
    // the user/turn/assistant/tool.started events and must NOT fabricate
    // a terminal tool event.
    expect(importSessionHistoryTail(store, SESSION, sessionPath)).toBe(0);

    const streamEvents = store.listEvents(`session:${SESSION}`);
    const types = streamEvents.map((e) => e.type);
    // No terminal tool event was present in the partial JSONL; the bridge
    // must NOT fabricate one.
    expect(types).not.toContain("tool.completed");
    expect(types).not.toContain("tool.failed");
    expect(types).not.toContain("turn.settled");
  });

  test("after restore/reconnect lifecycle and JSONL tail, tool.completed is projected and recipe.activity transitions out of running", () => {
    const sessionPath = openSessionJsonl(jsonlDir);

    // Step 1: bridge recorded turn.started + tool.started.
    store.appendEvent(`session:${SESSION}`, "turn.started", {
      sessionId: SESSION, turnId: TURN, commandId: TURN, deliveryMode: "immediate",
      message: "run fixture tasks", timestamp: "2026-01-01T00:00:00.000Z",
    });
    store.appendEvent(`session:${SESSION}`, "tool.started", {
      sessionId: SESSION, turnId: TURN, toolCallId: TOOL, toolName: "subagent",
      builtIn: true,
      arguments: { tasks: [{ agent: "reviewer", prompt: "one" }, { agent: "reviewer", prompt: "two" }] },
    });
    store.updateSessionState(SESSION, { ...(store.sessionState(SESSION) ?? {}), piSessionPath: sessionPath });

    // Step 2: bridge calls reconciler with the truncated JSONL — no
    // toolResult yet. Nothing terminal is published.
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ type: "session", id: SESSION, version: 1 }),
        JSON.stringify({
          type: "message", id: "user-1", parentId: null,
          timestamp: "2026-01-01T00:00:01.000Z",
          message: { role: "user", content: [{ type: "text", text: "run fixture tasks" }] },
        }),
        JSON.stringify({
          type: "message", id: "asst-1", parentId: "user-1",
          timestamp: "2026-01-01T00:00:02.000Z",
          message: {
            role: "assistant",
            content: [{ type: "toolCall", id: TOOL, name: "subagent",
              arguments: { tasks: [{ agent: "reviewer", prompt: "one" }, { agent: "reviewer", prompt: "two" }] } }],
          },
        }),
      ].join("\n") + "\n",
    );
    importSessionHistoryTail(store, SESSION, sessionPath);
    expect(store.listEvents(`session:${SESSION}`).some((e) => e.type === "tool.completed" || e.type === "tool.failed")).toBe(false);

    // Step 3: the bridge lifecycle reconnect/restore boundary runs after Pi appended the
    // timeout toolResult. The reconciler is called again — this is the
    // production reconnect/restart hook.
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ type: "session", id: SESSION, version: 1 }),
        JSON.stringify({
          type: "message", id: "user-1", parentId: null,
          timestamp: "2026-01-01T00:00:01.000Z",
          message: { role: "user", content: [{ type: "text", text: "run fixture tasks" }] },
        }),
        JSON.stringify({
          type: "message", id: "asst-1", parentId: "user-1",
          timestamp: "2026-01-01T00:00:02.000Z",
          message: {
            role: "assistant",
            content: [{ type: "toolCall", id: TOOL, name: "subagent",
              arguments: { tasks: [{ agent: "reviewer", prompt: "one" }, { agent: "reviewer", prompt: "two" }] } }],
          },
        }),
        JSON.stringify({
          type: "message", id: "tool-result", parentId: "asst-1",
          timestamp: "2026-01-01T00:00:03.000Z",
          message: {
            role: "toolResult",
            toolCallId: TOOL,
            toolName: "subagent",
            isError: true,
            content: [{
              type: "text",
              text: "fixture tasks failed",
            }],
          },
        }),
      ].join("\n") + "\n",
    );

    const imported = importSessionHistoryTail(store, SESSION, sessionPath);
    expect(imported).toBeGreaterThan(0);

    // Assert: a tool.failed event was projected for the orphaned subagent.
    const events = store.listEvents(`session:${SESSION}`);
    const toolFailed = events.find((e) => e.type === "tool.failed");
    expect(toolFailed).toBeDefined();
    expect(toolFailed!.payload.toolCallId).toBe(TOOL);
    expect(toolFailed!.payload.isError).toBe(true);

    // Assert: recipe.activity converges to "failed" (not stuck on "running").
    const recipes = events.filter((e) => e.type === "recipe.activity");
    const subagentRecipe = recipes.findLast((r) => r.payload.activityId === TOOL);
    expect(subagentRecipe).toBeDefined();
    expect(subagentRecipe!.payload.status).toBe("failed");

    // Assert: NO `turn.indeterminate` was synthesized because the JSONL
    // had a terminal toolResult.
    expect(events.some((e) => e.type === "turn.indeterminate" && e.payload.reason === "no_live_rpc")).toBe(false);
  });

  test("idempotent: re-running importSessionHistoryTail after a full import is a no-op", () => {
    const sessionPath = openSessionJsonl(jsonlDir);
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ type: "session", id: SESSION, version: 1 }),
        JSON.stringify({
          type: "message", id: "user-1", parentId: null,
          timestamp: "2026-01-01T00:00:01.000Z",
          message: { role: "user", content: [{ type: "text", text: "hi" }] },
        }),
        JSON.stringify({
          type: "message", id: "asst-1", parentId: "user-1",
          timestamp: "2026-01-01T00:00:02.000Z",
          message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
        }),
        JSON.stringify({
          type: "message", id: "tool-result", parentId: "asst-1",
          timestamp: "2026-01-01T00:00:03.000Z",
          message: {
            role: "toolResult", toolCallId: "some-tool", toolName: "bash",
            isError: false,
            content: [{ type: "text", text: "done" }],
          },
        }),
      ].join("\n") + "\n",
    );
    store.updateSessionState(SESSION, { ...(store.sessionState(SESSION) ?? {}), piSessionPath: sessionPath });
    const first = importSessionHistoryTail(store, SESSION, sessionPath);
    expect(first).toBeGreaterThan(0);
    const second = importSessionHistoryTail(store, SESSION, sessionPath);
    expect(second).toBe(0);
  });

  test("jsonl tail imports delta after partial import", () => {
    const sessionPath = openSessionJsonl(jsonlDir);

    // First, write the partial JSONL matching what the bridge had observed
    // before projection was interrupted.
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ type: "session", id: SESSION, version: 1 }),
        JSON.stringify({
          type: "message", id: "user-1", parentId: null,
          timestamp: "2026-01-01T00:00:01.000Z",
          message: { role: "user", content: [{ type: "text", text: "hi" }] },
        }),
      ].join("\n") + "\n",
    );
    store.updateSessionState(SESSION, { ...(store.sessionState(SESSION) ?? {}), piSessionPath: sessionPath });
    const firstImport = importSessionHistoryTail(store, SESSION, sessionPath);
    expect(firstImport).toBeGreaterThan(0);

    // Append the toolResult tail after the projection boundary resumes.
    const existing = require("node:fs").readFileSync(sessionPath, "utf8").replace(/\n$/, "");
    writeFileSync(
      sessionPath,
      [
        existing,
        JSON.stringify({
          type: "message", id: "asst-1", parentId: "user-1",
          timestamp: "2026-01-01T00:00:02.000Z",
          message: { role: "assistant", content: [{ type: "text", text: "answer" }] },
        }),
        JSON.stringify({
          type: "message", id: "tool-result", parentId: "asst-1",
          timestamp: "2026-01-01T00:00:03.000Z",
          message: {
            role: "toolResult", toolCallId: "t1", toolName: "bash",
            isError: false,
            content: [{ type: "text", text: "ok" }],
          },
        }),
      ].join("\n") + "\n",
    );

    const secondImport = importSessionHistoryTail(store, SESSION, sessionPath);
    expect(secondImport).toBeGreaterThan(0);

    const events = store.listEvents(`session:${SESSION}`);
    expect(events.some((e) => e.type === "assistant.completed")).toBe(true);
    // toolCompleted appears because toolResult (isError=false) is a success.
    const toolCompleted = events.find((e) => e.type === "tool.completed");
    expect(toolCompleted).toBeDefined();
    expect(toolCompleted!.payload.toolCallId).toBe("t1");
  });

  test("reconciliation bounds an orphaned open tool and turn as indeterminate", () => {
    const sessionPath = writeSessionJsonl(jsonlDir, [
      { type: "session", id: SESSION, version: 1 },
      { type: "message", id: "user-orphan", parentId: null, message: { role: "user", content: [{ type: "text", text: "run" }] } },
      { type: "message", id: "assistant-orphan", parentId: "user-orphan", message: { role: "assistant", content: [{ type: "toolCall", id: "orphan-tool", name: "bash", arguments: { command: "sleep" } }] } },
    ]);
    store.updateSessionState(SESSION, { ...(store.sessionState(SESSION) ?? {}), piSessionPath: sessionPath });
    const result = reconcileSessionHistoryTail(store, SESSION, sessionPath, { liveProcess: false });
    expect(result.authoritativeTerminal).toBe(true);
    const events = store.listEvents(`session:${SESSION}`);
    expect(events.some((event) => event.type === "tool.failed" && (event.payload.errorInfo as Record<string, unknown> | undefined)?.code === "indeterminate")).toBe(true);
    expect(events.some((event) => event.type === "turn.indeterminate" && event.payload.reason === "no_live_rpc")).toBe(true);
    const again = reconcileSessionHistoryTail(store, SESSION, sessionPath, { liveProcess: false });
    expect(again.imported).toBe(0);
    expect(store.listEvents(`session:${SESSION}`).filter((event) => event.type === "turn.indeterminate")).toHaveLength(1);
  });

  test("jsonl tail imports tool.completed for successful (non-error) toolResults", () => {
    const sessionPath = openSessionJsonl(jsonlDir);
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ type: "session", id: SESSION, version: 1 }),
        JSON.stringify({
          type: "message", id: "user-1", parentId: null,
          timestamp: "2026-01-01T00:00:01.000Z",
          message: { role: "user", content: [{ type: "text", text: "go" }] },
        }),
        JSON.stringify({
          type: "message", id: "tool-result", parentId: "user-1",
          timestamp: "2026-01-01T00:00:03.000Z",
          message: {
            role: "toolResult", toolCallId: "ok-tool", toolName: "bash",
            isError: false,
            content: [{ type: "text", text: "ok" }],
          },
        }),
      ].join("\n") + "\n",
    );
    store.updateSessionState(SESSION, { ...(store.sessionState(SESSION) ?? {}), piSessionPath: sessionPath });
    expect(importSessionHistoryTail(store, SESSION, sessionPath)).toBeGreaterThan(0);
    const events = store.listEvents(`session:${SESSION}`);
    expect(events.some((e) => e.type === "tool.completed")).toBe(true);
    expect(events.some((e) => e.type === "tool.failed")).toBe(false);
  });

  test("jsonl tail imports tool.failed for isError toolResults", () => {
    const sessionPath = openSessionJsonl(jsonlDir);
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ type: "session", id: SESSION, version: 1 }),
        JSON.stringify({
          type: "message", id: "user-1", parentId: null,
          timestamp: "2026-01-01T00:00:01.000Z",
          message: { role: "user", content: [{ type: "text", text: "go" }] },
        }),
        JSON.stringify({
          type: "message", id: "tool-result", parentId: "user-1",
          timestamp: "2026-01-01T00:00:03.000Z",
          message: {
            role: "toolResult", toolCallId: "err-tool", toolName: "bash",
            isError: true,
            content: [{ type: "text", text: "boom" }],
          },
        }),
      ].join("\n") + "\n",
    );
    store.updateSessionState(SESSION, { ...(store.sessionState(SESSION) ?? {}), piSessionPath: sessionPath });
    expect(importSessionHistoryTail(store, SESSION, sessionPath)).toBeGreaterThan(0);
    const events = store.listEvents(`session:${SESSION}`);
    const toolFailed = events.find((e) => e.type === "tool.failed");
    expect(toolFailed).toBeDefined();
    expect(toolFailed!.payload.toolCallId).toBe("err-tool");
    expect(toolFailed!.payload.isError).toBe(true);
    expect(toolFailed!.payload.errorInfo).toMatchObject({ code: "tool_failed" });
  });
});

/**
 * Anchor-inference regression tests for the first-reconciliation duplication
 * bug:
 *
 *   "A bridge-owned live session whose durable journal predates this fix
 *    has no `externalHistoryLeafId`. Calling importSessionHistoryTail on
 *    it must not replay the full active JSONL branch over the already-
 *    durable transcript."
 *
 * Synthetic IDs only — never reuse a captured session id or filesystem
 * path. Each test asserts both the no-duplicate invariant and an exact
 * count of newly imported events so a future regression can be diagnosed
 * from the count line alone.
 */
describe("first-reconciliation anchor inference (no leaf marker, nonempty durable journal)", () => {
  const A_SESSION = "99999999-9999-4999-8999-999999999991";
  const EARLY_TURN = "synthetic-turn-1";
  const EARLY_TOOL = "synthetic-early-tool";
  const STUCK_TOOL = "synthetic-stuck-tool";
  const STUCK_RESULT = "synthetic-stuck-result";
  const LATER_TOOL = "synthetic-later-tool";

  function freshStore(): { store: BridgeStore; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), "pi-mob-anchor-store-"));
    const store = new BridgeStore(join(dir, "bridge.sqlite"));
    const hostId = store.identity().hostId;
    store.ensureStream(`host:${hostId}`, "host");
    store.ensureSession(A_SESSION, {
      sessionId: A_SESSION,
      workspaceId: "ws",
      workspaceRootPath: "/tmp/ws",
      workspaceRelativePath: ".",
      workspaceDisplayName: "ws",
      name: "ws",
      policyMode: "full",
      runtimeState: "running",
      attentionState: "needs_attention",
      queueCount: 0,
      lastActivityAt: new Date().toISOString(),
    });
    store.ensureStream(`session:${A_SESSION}`, "session", A_SESSION);
    return { store, dir };
  }

  test("matching durable tool.started anchors at the assistant toolCall entry and only the missing toolResult + later tail are imported", () => {
    const { store, dir } = freshStore();
    try {
      // Bridge already durable-recorded the early turn.started, the early
      // tool.completed, and the stuck subagent's tool.started. The
      // authoritative JSONL also contains the early turn + tool lifecycle
      // (already durable, must NOT be duplicated) and the stuck subagent
      // toolCall matching the durable tool.started (anchor). After the
      // anchor, only the missing toolResult + a fresh user turn + a new
      // tool.started are still missing.
      store.appendEvent(`session:${A_SESSION}`, "turn.started", {
        sessionId: A_SESSION, turnId: EARLY_TURN, commandId: EARLY_TURN,
        deliveryMode: "immediate", message: "early", timestamp: "2026-02-01T00:00:00.000Z",
      });
      store.appendEvent(`session:${A_SESSION}`, "tool.started", {
        sessionId: A_SESSION, turnId: EARLY_TURN, toolCallId: EARLY_TOOL,
        toolName: "bash", arguments: { command: "echo early" },
      });
      store.appendEvent(`session:${A_SESSION}`, "tool.output", {
        sessionId: A_SESSION, turnId: EARLY_TURN, toolCallId: EARLY_TOOL,
        toolName: "bash", output: "early\n",
        retainedBytes: 6, totalBytes: 6, isTruncated: false,
      });
      store.appendEvent(`session:${A_SESSION}`, "tool.completed", {
        sessionId: A_SESSION, turnId: EARLY_TURN, toolCallId: EARLY_TOOL,
        toolName: "bash", result: "early\n", isError: false,
        retainedBytes: 6, totalBytes: 6, isTruncated: false,
      });
      store.appendEvent(`session:${A_SESSION}`, "tool.started", {
        sessionId: A_SESSION, turnId: EARLY_TURN, toolCallId: STUCK_TOOL,
        toolName: "subagent",
        arguments: { tasks: [{ agent: "reviewer", prompt: "one" }] },
      });

      const sessionPath = join(dir, "session.jsonl");
      writeFileSync(sessionPath, [
        { type: "session", id: A_SESSION, version: 1 },
        { type: "message", id: "early-user", parentId: null,
          timestamp: "2026-02-01T00:00:01.000Z",
          message: { role: "user", content: [{ type: "text", text: "early" }] } },
        { type: "message", id: "early-asst", parentId: "early-user",
          timestamp: "2026-02-01T00:00:02.000Z",
          message: { role: "assistant", content: [
            { type: "toolCall", id: EARLY_TOOL, name: "bash", arguments: { command: "echo early" } },
          ] } },
        { type: "message", id: "early-result", parentId: "early-asst",
          timestamp: "2026-02-01T00:00:03.000Z",
          message: { role: "toolResult", toolCallId: EARLY_TOOL, toolName: "bash",
            isError: false, content: [{ type: "text", text: "early" }] } },
        { type: "message", id: "stuck-asst", parentId: "early-result",
          timestamp: "2026-02-01T00:00:04.000Z",
          message: { role: "assistant", content: [
            { type: "toolCall", id: STUCK_TOOL, name: "subagent",
              arguments: { tasks: [{ agent: "reviewer", prompt: "one" }] } },
          ] } },
        { type: "message", id: STUCK_RESULT, parentId: "stuck-asst",
          timestamp: "2026-02-01T00:00:05.000Z",
          message: { role: "toolResult", toolCallId: STUCK_TOOL, toolName: "subagent",
            isError: false,
            content: [{ type: "text", text: "synthetic two reviewer ok" }] } },
        { type: "message", id: "later-user", parentId: STUCK_RESULT,
          timestamp: "2026-02-01T00:00:06.000Z",
          message: { role: "user", content: [{ type: "text", text: "later" }] } },
        { type: "message", id: "later-asst", parentId: "later-user",
          timestamp: "2026-02-01T00:00:07.000Z",
          message: { role: "assistant", content: [
            { type: "toolCall", id: LATER_TOOL, name: "bash",
              arguments: { command: "echo later" } },
          ] } },
      ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
      store.updateSessionState(A_SESSION, { ...(store.sessionState(A_SESSION) ?? {}), piSessionPath: sessionPath });

      const imported = importSessionHistoryTail(store, A_SESSION, sessionPath);
      // Imported source events:
      //   tool.output  (STUCK_TOOL)
      //   tool.completed (STUCK_TOOL)
      //   turn.settled  (EARLY_TURN — closing the durable open turn
      //                  before the new user message)
      //   turn.started (LATER_TURN)
      //   tool.started (LATER_TOOL)
      // The trailing assistant entry has no text part so no
      // assistant.started/delta/completed triple is emitted.
      // Earlier assistant/tool/turn events were the anchor and must NOT be
      // duplicated.
      expect(imported).toBe(5);

      const events = store.listEvents(`session:${A_SESSION}`);
      const counts = countByType(events);
      // No duplication of the early lifecycle.
      expect(counts["turn.started"] ?? 0).toBe(2); // EARLY_TURN + LATER_TURN
      expect(counts["tool.started"] ?? 0).toBe(3); // EARLY_TOOL + STUCK_TOOL + LATER_TOOL
      expect(counts["tool.completed"] ?? 0).toBe(2); // EARLY_TOOL + STUCK_TOOL
      expect(counts["tool.output"] ?? 0).toBe(2); // EARLY_TOOL + STUCK_TOOL
      expect(counts["turn.settled"] ?? 0).toBe(1); // EARLY_TURN closes at the user-role boundary
      // Anchor sanity: no duplicate tool.completed for EARLY_TOOL.
      expect(events.filter((e) => e.type === "tool.completed" && e.payload.toolCallId === EARLY_TOOL)).toHaveLength(1);
      expect(events.filter((e) => e.type === "tool.completed" && e.payload.toolCallId === STUCK_TOOL)).toHaveLength(1);
      // The missing terminal result for the stuck subagent is now durable.
      expect(events.some((e) => e.type === "tool.completed" && (e.payload as Record<string, unknown>).toolCallId === STUCK_TOOL)).toBe(true);
      // The later turn is freshly durable with a brand-new id (not a
      // duplicate of the early turn).
      expect(events.some((e) => e.type === "turn.started" && (e.payload as Record<string, unknown>).turnId === "later-user")).toBe(true);
      expect(events.some((e) => e.type === "turn.started" && (e.payload as Record<string, unknown>).turnId === EARLY_TURN)).toBe(true);
      // Idempotence: a second call must be a no-op (source-revision marker
      // recorded during the first call).
      expect(importSessionHistoryTail(store, A_SESSION, sessionPath)).toBe(0);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("latest durable terminal toolResult is a stronger anchor than the toolCall", () => {
    const { store, dir } = freshStore();
    try {
      store.appendEvent(`session:${A_SESSION}`, "turn.started", {
        sessionId: A_SESSION, turnId: EARLY_TURN, commandId: EARLY_TURN,
        deliveryMode: "immediate", message: "early", timestamp: "2026-02-01T00:00:00.000Z",
      });
      store.appendEvent(`session:${A_SESSION}`, "tool.started", {
        sessionId: A_SESSION, turnId: EARLY_TURN, toolCallId: EARLY_TOOL,
        toolName: "bash", arguments: { command: "echo early" },
      });
      store.appendEvent(`session:${A_SESSION}`, "tool.completed", {
        sessionId: A_SESSION, turnId: EARLY_TURN, toolCallId: EARLY_TOOL,
        toolName: "bash", result: "early\n", isError: false,
        retainedBytes: 6, totalBytes: 6, isTruncated: false,
      });

      const sessionPath = join(dir, "session.jsonl");
      writeFileSync(sessionPath, [
        { type: "session", id: A_SESSION, version: 1 },
        { type: "message", id: "early-user", parentId: null,
          timestamp: "2026-02-01T00:00:01.000Z",
          message: { role: "user", content: [{ type: "text", text: "early" }] } },
        { type: "message", id: "early-asst", parentId: "early-user",
          timestamp: "2026-02-01T00:00:02.000Z",
          message: { role: "assistant", content: [
            { type: "toolCall", id: EARLY_TOOL, name: "bash", arguments: { command: "echo early" } },
          ] } },
        { type: "message", id: "early-result", parentId: "early-asst",
          timestamp: "2026-02-01T00:00:03.000Z",
          message: { role: "toolResult", toolCallId: EARLY_TOOL, toolName: "bash",
            isError: false, content: [{ type: "text", text: "early" }] } },
        { type: "message", id: "fresh-after", parentId: "early-result",
          timestamp: "2026-02-01T00:00:04.000Z",
          message: { role: "user", content: [{ type: "text", text: "after" }] } },
      ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
      store.updateSessionState(A_SESSION, { ...(store.sessionState(A_SESSION) ?? {}), piSessionPath: sessionPath });

      const imported = importSessionHistoryTail(store, A_SESSION, sessionPath);
      // Only the trailing user turn is past the terminal anchor; the
      // closing of the durable open turn and the fresh turn.started are
      // imported.
      expect(imported).toBe(2); // turn.settled (EARLY_TURN) + turn.started (fresh-after)
      const events = store.listEvents(`session:${A_SESSION}`);
      const counts = countByType(events);
      // EARLY_TOOL tool.completed remains singular; no duplicate.
      expect(events.filter((e) => e.type === "tool.completed" && (e.payload as Record<string, unknown>).toolCallId === EARLY_TOOL)).toHaveLength(1);
      expect(counts["tool.completed"] ?? 0).toBe(1);
      expect(counts["turn.started"] ?? 0).toBe(2); // EARLY_TURN + fresh-after
      expect(counts["turn.settled"] ?? 0).toBe(1); // EARLY_TURN closes at the user-role boundary
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("nonempty durable journal with no safe overlap does not full-replay", () => {
    const { store, dir } = freshStore();
    try {
      // The durable journal has a tool.started with an id that does NOT
      // match any toolCall in the JSONL. No safe anchor exists.
      store.appendEvent(`session:${A_SESSION}`, "turn.started", {
        sessionId: A_SESSION, turnId: EARLY_TURN, commandId: EARLY_TURN,
        deliveryMode: "immediate", message: "durable only", timestamp: "2026-02-01T00:00:00.000Z",
      });
      store.appendEvent(`session:${A_SESSION}`, "tool.started", {
        sessionId: A_SESSION, turnId: EARLY_TURN, toolCallId: "completely-different-id",
        toolName: "bash", arguments: { command: "echo durable" },
      });

      const sessionPath = join(dir, "session.jsonl");
      writeFileSync(sessionPath, [
        { type: "session", id: A_SESSION, version: 1 },
        { type: "message", id: "u", parentId: null,
          timestamp: "2026-02-01T00:00:01.000Z",
          message: { role: "user", content: [{ type: "text", text: "jsonl" }] } },
        { type: "message", id: "a", parentId: "u",
          timestamp: "2026-02-01T00:00:02.000Z",
          message: { role: "assistant", content: [
            { type: "toolCall", id: "jsonl-only-tool", name: "bash",
              arguments: { command: "echo jsonl" } },
          ] } },
        { type: "message", id: "r", parentId: "a",
          timestamp: "2026-02-01T00:00:03.000Z",
          message: { role: "toolResult", toolCallId: "jsonl-only-tool", toolName: "bash",
            isError: false, content: [{ type: "text", text: "jsonl ok" }] } },
      ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
      store.updateSessionState(A_SESSION, { ...(store.sessionState(A_SESSION) ?? {}), piSessionPath: sessionPath });

      // Refuse to full-replay: a no-overlap import must not duplicate the
      // existing durable journal nor invent an unrelated anchor.
      expect(importSessionHistoryTail(store, A_SESSION, sessionPath)).toBe(0);
      const events = store.listEvents(`session:${A_SESSION}`);
      const counts = countByType(events);
      expect(counts["turn.started"] ?? 0).toBe(1);
      expect(counts["tool.started"] ?? 0).toBe(1);
      expect(counts["tool.completed"] ?? 0).toBe(0);
      // The source revision marker is NOT advanced: a no-overlap import
      // does not record progress, so a later JSONL append that produces a
      // safe anchor can still be reconciled.
      expect(store.sessionState(A_SESSION)?.externalHistorySourceRevision).toBeUndefined();
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("legacy empty external import still imports the full branch", () => {
    const { store, dir } = freshStore();
    try {
      // Mark the session as a legacy TUI import so the legacy full-branch
      // path remains the contract for an empty journal.
      store.updateSessionState(A_SESSION, { ...(store.sessionState(A_SESSION) ?? {}), externalSession: true });
      const sessionPath = join(dir, "session.jsonl");
      writeFileSync(sessionPath, [
        { type: "session", id: A_SESSION, version: 1 },
        { type: "message", id: "fresh-user", parentId: null,
          timestamp: "2026-02-01T00:00:01.000Z",
          message: { role: "user", content: [{ type: "text", text: "fresh" }] } },
        { type: "message", id: "fresh-asst", parentId: "fresh-user",
          timestamp: "2026-02-01T00:00:02.000Z",
          message: { role: "assistant", content: [
            { type: "toolCall", id: "fresh-tool", name: "bash",
              arguments: { command: "echo fresh" } },
          ] } },
        { type: "message", id: "fresh-result", parentId: "fresh-asst",
          timestamp: "2026-02-01T00:00:03.000Z",
          message: { role: "toolResult", toolCallId: "fresh-tool", toolName: "bash",
            isError: false, content: [{ type: "text", text: "fresh" }] } },
      ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");

      const imported = importExternalSessionHistory(store, A_SESSION, sessionPath);
      // Full branch import: user + assistant lifecycle + tool.started +
      // tool.output + tool.completed + turn.settled.
      expect(imported).toBeGreaterThan(0);
      const events = store.listEvents(`session:${A_SESSION}`);
      expect(events.some((e) => e.type === "tool.completed")).toBe(true);
      // Second import is idempotent.
      expect(importExternalSessionHistory(store, A_SESSION, sessionPath)).toBe(0);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("second reconcile against an unchanged JSONL is a no-op", () => {
    const { store, dir } = freshStore();
    try {
      store.appendEvent(`session:${A_SESSION}`, "turn.started", {
        sessionId: A_SESSION, turnId: EARLY_TURN, commandId: EARLY_TURN,
        deliveryMode: "immediate", message: "early", timestamp: "2026-02-01T00:00:00.000Z",
      });
      store.appendEvent(`session:${A_SESSION}`, "tool.started", {
        sessionId: A_SESSION, turnId: EARLY_TURN, toolCallId: STUCK_TOOL,
        toolName: "subagent", arguments: { tasks: [] },
      });

      const sessionPath = join(dir, "session.jsonl");
      writeFileSync(sessionPath, [
        { type: "session", id: A_SESSION, version: 1 },
        { type: "message", id: "u", parentId: null,
          timestamp: "2026-02-01T00:00:01.000Z",
          message: { role: "user", content: [{ type: "text", text: "early" }] } },
        { type: "message", id: "a", parentId: "u",
          timestamp: "2026-02-01T00:00:02.000Z",
          message: { role: "assistant", content: [
            { type: "toolCall", id: STUCK_TOOL, name: "subagent",
              arguments: { tasks: [] } },
          ] } },
        { type: "message", id: "r", parentId: "a",
          timestamp: "2026-02-01T00:00:03.000Z",
          message: { role: "toolResult", toolCallId: STUCK_TOOL, toolName: "subagent",
            isError: false, content: [{ type: "text", text: "synthetic ok" }] } },
      ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
      store.updateSessionState(A_SESSION, { ...(store.sessionState(A_SESSION) ?? {}), piSessionPath: sessionPath });

      const first = importSessionHistoryTail(store, A_SESSION, sessionPath);
      expect(first).toBeGreaterThan(0);
      const second = importSessionHistoryTail(store, A_SESSION, sessionPath);
      expect(second).toBe(0);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Regression tests for the production semantic:
 *
 *   "A terminal toolResult only terminalizes the tool. It does NOT
 *    prove the parent assistant turn settled. Pi normally continues
 *    after a toolResult with more reasoning or further toolCalls. If the
 *    JSONL ends at a toolResult because the owner dies, the turn is
 *    incomplete."
 *
 * The historical importer must NOT synthesise `turn.settled` solely on a
 * trailing toolResult. A trailing visible assistant text block is the
 * authoritative settled boundary; reconcileSessionHistoryTail then
 * decides between `turn.indeterminate` (no live owner) and leaving the
 * turn open (live owner may continue).
 */
describe("historical tail does not auto-settle a turn that ends at a toolResult", () => {
  const A_SESSION = "88888888-8888-4888-8888-888888888881";
  const TURN_ID = "historical-tool-result-tail";
  const TOOL_ID = "historical-stuck-tool";

  function freshStore(): { store: BridgeStore; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), "pi-mob-settle-guard-"));
    const store = new BridgeStore(join(dir, "bridge.sqlite"));
    const hostId = store.identity().hostId;
    store.ensureStream(`host:${hostId}`, "host");
    store.ensureSession(A_SESSION, {
      sessionId: A_SESSION,
      workspaceId: "ws",
      workspaceRootPath: "/tmp/ws",
      workspaceRelativePath: ".",
      workspaceDisplayName: "ws",
      name: "ws",
      policyMode: "full",
      runtimeState: "running",
      attentionState: "needs_attention",
      queueCount: 0,
      lastActivityAt: new Date().toISOString(),
    });
    store.ensureStream(`session:${A_SESSION}`, "session", A_SESSION);
    return { store, dir };
  }

  test("importSessionHistoryTail ends at a toolResult: tool.completed emitted, NO turn.settled, NO tool.failed", () => {
    const { store, dir } = freshStore();
    try {
      // The bridge already durable-recorded the user turn and the
      // subagent tool.started. The authoritative JSONL mirrors that plus
      // a terminal toolResult with isError=false. Pi's contract reports
      // success — the importer must record tool.completed (not failed)
      // and leave the parent turn open.
      store.appendEvent(`session:${A_SESSION}`, "turn.started", {
        sessionId: A_SESSION, turnId: TURN_ID, commandId: TURN_ID,
        deliveryMode: "immediate", message: "tail", timestamp: "2026-03-01T00:00:00.000Z",
      });
      store.appendEvent(`session:${A_SESSION}`, "tool.started", {
        sessionId: A_SESSION, turnId: TURN_ID, toolCallId: TOOL_ID,
        toolName: "subagent",
        arguments: { tasks: [{ agent: "reviewer", prompt: "one" }] },
      });
      const sessionPath = join(dir, "session.jsonl");
      writeFileSync(sessionPath, [
        { type: "session", id: A_SESSION, version: 1 },
        { type: "message", id: "u", parentId: null,
          timestamp: "2026-03-01T00:00:01.000Z",
          message: { role: "user", content: [{ type: "text", text: "tail" }] } },
        { type: "message", id: "a", parentId: "u",
          timestamp: "2026-03-01T00:00:02.000Z",
          message: { role: "assistant", content: [
            { type: "toolCall", id: TOOL_ID, name: "subagent",
              arguments: { tasks: [{ agent: "reviewer", prompt: "one" }] } },
          ] } },
        { type: "message", id: "r", parentId: "a",
          timestamp: "2026-03-01T00:00:03.000Z",
          message: { role: "toolResult", toolCallId: TOOL_ID, toolName: "subagent",
            isError: false,
            content: [{ type: "text", text: "synthetic reviewer timeout details" }] } },
      ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
      store.updateSessionState(A_SESSION, { ...(store.sessionState(A_SESSION) ?? {}), piSessionPath: sessionPath });

      const imported = importSessionHistoryTail(store, A_SESSION, sessionPath);
      // The tail past the assistant toolCall anchor is only the toolResult
      // (2 source events: tool.output + tool.completed). The turn stays
      // open because Pi normally continues after a toolResult.
      expect(imported).toBe(2);

      const events = store.listEvents(`session:${A_SESSION}`);
      // Authoritative isError=false must produce tool.completed.
      expect(events.some((e) => e.type === "tool.completed" && (e.payload as Record<string, unknown>).toolCallId === TOOL_ID)).toBe(true);
      // The importer must NOT flip a successful toolResult to tool.failed
      // by parsing the output text.
      expect(events.some((e) => e.type === "tool.failed")).toBe(false);
      // Crucial: the parent turn is NOT auto-settled on a trailing
      // toolResult. Pi normally continues; the bridge cannot prove a
      // settled boundary from the JSONL alone.
      expect(events.some((e) => e.type === "turn.settled")).toBe(false);
      expect(events.some((e) => e.type === "turn.indeterminate")).toBe(false);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reconcileSessionHistoryTail(liveProcess:false) after a toolResult tail synthesises exactly one turn.indeterminate", () => {
    const { store, dir } = freshStore();
    try {
      store.appendEvent(`session:${A_SESSION}`, "turn.started", {
        sessionId: A_SESSION, turnId: TURN_ID, commandId: TURN_ID,
        deliveryMode: "immediate", message: "tail", timestamp: "2026-03-01T00:00:00.000Z",
      });
      store.appendEvent(`session:${A_SESSION}`, "tool.started", {
        sessionId: A_SESSION, turnId: TURN_ID, toolCallId: TOOL_ID,
        toolName: "subagent",
        arguments: { tasks: [{ agent: "reviewer", prompt: "one" }] },
      });
      const sessionPath = join(dir, "session.jsonl");
      writeFileSync(sessionPath, [
        { type: "session", id: A_SESSION, version: 1 },
        { type: "message", id: "u", parentId: null,
          timestamp: "2026-03-01T00:00:01.000Z",
          message: { role: "user", content: [{ type: "text", text: "tail" }] } },
        { type: "message", id: "a", parentId: "u",
          timestamp: "2026-03-01T00:00:02.000Z",
          message: { role: "assistant", content: [
            { type: "toolCall", id: TOOL_ID, name: "subagent",
              arguments: { tasks: [{ agent: "reviewer", prompt: "one" }] } },
          ] } },
        { type: "message", id: "r", parentId: "a",
          timestamp: "2026-03-01T00:00:03.000Z",
          message: { role: "toolResult", toolCallId: TOOL_ID, toolName: "subagent",
            isError: false,
            content: [{ type: "text", text: "synthetic reviewer timeout details" }] } },
      ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
      store.updateSessionState(A_SESSION, { ...(store.sessionState(A_SESSION) ?? {}), piSessionPath: sessionPath });

      const result = reconcileSessionHistoryTail(store, A_SESSION, sessionPath, { liveProcess: false });
      expect(result.authoritativeTerminal).toBe(true);
      const events = store.listEvents(`session:${A_SESSION}`);
      // Pi's authoritative isError=false: tool.completed, no tool.failed.
      expect(events.some((e) => e.type === "tool.completed" && (e.payload as Record<string, unknown>).toolCallId === TOOL_ID)).toBe(true);
      expect(events.some((e) => e.type === "tool.failed")).toBe(false);
      // The parent turn is open (no tool-only auto-settle, no visible
      // assistant text). With no live owner, the reconciler MUST
      // synthesise exactly one turn.indeterminate.
      expect(events.some((e) => e.type === "turn.settled")).toBe(false);
      const indeterminates = events.filter((e) => e.type === "turn.indeterminate" && e.payload.turnId === TURN_ID);
      expect(indeterminates).toHaveLength(1);
      expect(indeterminates[0]!.payload.reason).toBe("no_live_rpc");
      expect(indeterminates[0]!.payload.historical).toBe(true);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reconcileSessionHistoryTail(liveProcess:true) after a toolResult tail leaves the turn open/running", () => {
    const { store, dir } = freshStore();
    try {
      store.appendEvent(`session:${A_SESSION}`, "turn.started", {
        sessionId: A_SESSION, turnId: TURN_ID, commandId: TURN_ID,
        deliveryMode: "immediate", message: "tail", timestamp: "2026-03-01T00:00:00.000Z",
      });
      store.appendEvent(`session:${A_SESSION}`, "tool.started", {
        sessionId: A_SESSION, turnId: TURN_ID, toolCallId: TOOL_ID,
        toolName: "subagent",
        arguments: { tasks: [{ agent: "reviewer", prompt: "one" }] },
      });
      const sessionPath = join(dir, "session.jsonl");
      writeFileSync(sessionPath, [
        { type: "session", id: A_SESSION, version: 1 },
        { type: "message", id: "u", parentId: null,
          timestamp: "2026-03-01T00:00:01.000Z",
          message: { role: "user", content: [{ type: "text", text: "tail" }] } },
        { type: "message", id: "a", parentId: "u",
          timestamp: "2026-03-01T00:00:02.000Z",
          message: { role: "assistant", content: [
            { type: "toolCall", id: TOOL_ID, name: "subagent",
              arguments: { tasks: [{ agent: "reviewer", prompt: "one" }] } },
          ] } },
        { type: "message", id: "r", parentId: "a",
          timestamp: "2026-03-01T00:00:03.000Z",
          message: { role: "toolResult", toolCallId: TOOL_ID, toolName: "subagent",
            isError: false,
            content: [{ type: "text", text: "synthetic reviewer timeout details" }] } },
      ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
      store.updateSessionState(A_SESSION, { ...(store.sessionState(A_SESSION) ?? {}), piSessionPath: sessionPath });

      const result = reconcileSessionHistoryTail(store, A_SESSION, sessionPath, { liveProcess: true });
      // Live owner: the import lands, but no boundary is synthesised.
      expect(result.imported).toBe(2);
      const events = store.listEvents(`session:${A_SESSION}`);
      expect(events.some((e) => e.type === "tool.completed" && (e.payload as Record<string, unknown>).toolCallId === TOOL_ID)).toBe(true);
      expect(events.some((e) => e.type === "tool.failed")).toBe(false);
      // No false terminal while a healthy owner may continue.
      expect(events.some((e) => e.type === "turn.settled")).toBe(false);
      expect(events.some((e) => e.type === "turn.indeterminate")).toBe(false);
      // Turn is still durably open.
      const turnStarted = events.filter((e) => e.type === "turn.started" && (e.payload as Record<string, unknown>).turnId === TURN_ID);
      expect(turnStarted).toHaveLength(1);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("toolResult followed by a visible assistant text settles the turn exactly once", () => {
    const { store, dir } = freshStore();
    try {
      store.appendEvent(`session:${A_SESSION}`, "turn.started", {
        sessionId: A_SESSION, turnId: TURN_ID, commandId: TURN_ID,
        deliveryMode: "immediate", message: "tail", timestamp: "2026-03-01T00:00:00.000Z",
      });
      store.appendEvent(`session:${A_SESSION}`, "tool.started", {
        sessionId: A_SESSION, turnId: TURN_ID, toolCallId: TOOL_ID,
        toolName: "bash", arguments: { command: "echo tail" },
      });
      const sessionPath = join(dir, "session.jsonl");
      writeFileSync(sessionPath, [
        { type: "session", id: A_SESSION, version: 1 },
        { type: "message", id: "u", parentId: null,
          timestamp: "2026-03-01T00:00:01.000Z",
          message: { role: "user", content: [{ type: "text", text: "tail" }] } },
        { type: "message", id: "a", parentId: "u",
          timestamp: "2026-03-01T00:00:02.000Z",
          message: { role: "assistant", content: [
            { type: "toolCall", id: TOOL_ID, name: "bash", arguments: { command: "echo tail" } },
          ] } },
        { type: "message", id: "r", parentId: "a",
          timestamp: "2026-03-01T00:00:03.000Z",
          message: { role: "toolResult", toolCallId: TOOL_ID, toolName: "bash",
            isError: false, content: [{ type: "text", text: "tail" }] } },
        { type: "message", id: "final", parentId: "r",
          timestamp: "2026-03-01T00:00:04.000Z",
          message: { role: "assistant", content: [
            { type: "text", text: "done" },
          ] } },
      ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
      store.updateSessionState(A_SESSION, { ...(store.sessionState(A_SESSION) ?? {}), piSessionPath: sessionPath });

      const imported = importSessionHistoryTail(store, A_SESSION, sessionPath);
      const events = store.listEvents(`session:${A_SESSION}`);
      // Source events past the anchor: tool.output + tool.completed +
      // assistant.started + assistant.delta + assistant.completed +
      // turn.settled = 6.
      expect(imported).toBe(6);
      expect(events.filter((e) => e.type === "turn.settled" && (e.payload as Record<string, unknown>).turnId === TURN_ID)).toHaveLength(1);
      expect(events.some((e) => e.type === "turn.indeterminate")).toBe(false);
      expect(events.some((e) => e.type === "tool.completed" && (e.payload as Record<string, unknown>).toolCallId === TOOL_ID)).toBe(true);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("second reconciliation after a toolResult-tail/no-live is a no-op and does not duplicate the indeterminate", () => {
    const { store, dir } = freshStore();
    try {
      store.appendEvent(`session:${A_SESSION}`, "turn.started", {
        sessionId: A_SESSION, turnId: TURN_ID, commandId: TURN_ID,
        deliveryMode: "immediate", message: "tail", timestamp: "2026-03-01T00:00:00.000Z",
      });
      store.appendEvent(`session:${A_SESSION}`, "tool.started", {
        sessionId: A_SESSION, turnId: TURN_ID, toolCallId: TOOL_ID,
        toolName: "subagent", arguments: { tasks: [] },
      });
      const sessionPath = join(dir, "session.jsonl");
      writeFileSync(sessionPath, [
        { type: "session", id: A_SESSION, version: 1 },
        { type: "message", id: "u", parentId: null,
          timestamp: "2026-03-01T00:00:01.000Z",
          message: { role: "user", content: [{ type: "text", text: "tail" }] } },
        { type: "message", id: "a", parentId: "u",
          timestamp: "2026-03-01T00:00:02.000Z",
          message: { role: "assistant", content: [
            { type: "toolCall", id: TOOL_ID, name: "subagent", arguments: { tasks: [] } },
          ] } },
        { type: "message", id: "r", parentId: "a",
          timestamp: "2026-03-01T00:00:03.000Z",
          message: { role: "toolResult", toolCallId: TOOL_ID, toolName: "subagent",
            isError: false, content: [{ type: "text", text: "synthetic ok" }] } },
      ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
      store.updateSessionState(A_SESSION, { ...(store.sessionState(A_SESSION) ?? {}), piSessionPath: sessionPath });

      // First reconcile synthesises the terminal indeterminate.
      const first = reconcileSessionHistoryTail(store, A_SESSION, sessionPath, { liveProcess: false });
      expect(first.imported).toBeGreaterThan(0);
      // Second reconcile: source-revision marker blocks re-import; no
      // second indeterminate, no second tool lifecycle.
      const second = reconcileSessionHistoryTail(store, A_SESSION, sessionPath, { liveProcess: false });
      expect(second.imported).toBe(0);
      const events = store.listEvents(`session:${A_SESSION}`);
      expect(events.filter((e) => e.type === "turn.indeterminate" && (e.payload as Record<string, unknown>).turnId === TURN_ID)).toHaveLength(1);
      expect(events.filter((e) => e.type === "tool.completed" && (e.payload as Record<string, unknown>).toolCallId === TOOL_ID)).toHaveLength(1);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Startup-state regression tests for the daemon reconciliation loop.
 *
 * Required behaviour:
 *   1. When startup reconciliation imports a JSONL whose visible assistant
 *      text settles the active turn, the persisted session row must move
 *      from `runtimeState: "running"` to `runtimeState: "idle",
 *      attentionState: "ready"`, and the host stream must emit a
 *      `session.summary` so mobile clients learn the new state.
 *   2. A trailing toolResult + no live owner must converge to
 *      `runtimeState: "indeterminate"`, `attentionState:
 *      "needs_attention"` — not idle, because the parent turn was open.
 *   3. A live owner must not have its persisted runtime state flipped
 *      to idle purely because reconciliation ran.
 *   4. Per-session isolation: reconciling one session must not touch
 *      another session's persisted state.
 *   5. Old historical terminal events from a previous run must not be
 *      mistaken for the reconciled active turn when the JSONL is
 *      unresolved (the reconciler reports `live` and the persisted state
 *      is preserved).
 *   6. No duplicate transcript events from the reconciliation.
 *
 * All session ids and jsonl paths are synthetic; no production identifier
 * is reused.
 */
describe("startup reconciliation maps persisted session row to the reconciled active turn", () => {
  const WS = "/tmp/pi-mob-startup-state";
  const SESS_A = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const SESS_B = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const SESS_C = "33333333-cccc-4ccc-8ccc-cccccccccccc";
  const SESS_D = "44444444-dddd-4ddd-8ddd-dddddddddddd";
  const SESS_E = "55555555-eeee-4eee-8eee-eeeeeeeeeeee";

  function freshStore(): { store: BridgeStore; dir: string; workspace: string } {
    const dir = mkdtempSync(join(tmpdir(), "pi-mob-startup-state-"));
    mkdirSync(join(dir, "sessions"), { recursive: true });
    mkdirSync(join(dir, "state"), { recursive: true });
    const workspace = join(dir, "workspace");
    mkdirSync(workspace, { recursive: true });
    const executable = join(dir, "fake-pi");
    writeFileSync(executable, `#!/bin/sh\nexec ${Bun.which("bun")!} ${new URL("../fixtures/fake-pi-rpc.ts", import.meta.url).pathname} "$@"\n`, { mode: 0o755 });
    const store = new BridgeStore(join(dir, "state", "bridge.sqlite"));
    const hostId = store.identity().hostId;
    store.ensureStream(`host:${hostId}`, "host");
    return { store, dir, workspace };
  }

  function ensureSession(store: BridgeStore, sessionId: string, runtimeState: string): void {
    store.ensureSession(sessionId, {
      sessionId,
      workspaceId: WS,
      workspaceRootPath: WS,
      workspaceRelativePath: ".",
      workspaceDisplayName: WS,
      name: WS,
      policyMode: "full",
      runtimeState,
      attentionState: runtimeState === "running" ? "needs_attention" : "ready",
      queueCount: 0,
      lastActivityAt: "2026-04-01T00:00:00.000Z",
    });
    store.ensureStream(`session:${sessionId}`, "session", sessionId);
  }

  function writeTerminalJsonl(dir: string, sessionId: string, _turnId: string, toolCallId: string): string {
    const path = join(dir, `${sessionId}.jsonl`);
    writeFileSync(path, [
      { type: "session", id: sessionId, version: 1 },
      { type: "message", id: "u", parentId: null,
        timestamp: "2026-04-01T00:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "finish" }] } },
      { type: "message", id: "a1", parentId: "u",
        timestamp: "2026-04-01T00:00:02.000Z",
        message: { role: "assistant", content: [
          { type: "toolCall", id: toolCallId, name: "bash", arguments: { command: "true" } },
        ] } },
      { type: "message", id: "r", parentId: "a1",
        timestamp: "2026-04-01T00:00:03.000Z",
        message: { role: "toolResult", toolCallId, toolName: "bash",
          isError: false, content: [{ type: "text", text: "done" }] } },
      { type: "message", id: "a2", parentId: "r",
        timestamp: "2026-04-01T00:00:04.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "final answer" }] } },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    return path;
  }

  function writeToolResultTailJsonl(dir: string, sessionId: string, _turnId: string, toolCallId: string): string {
    const path = join(dir, `${sessionId}.jsonl`);
    writeFileSync(path, [
      { type: "session", id: sessionId, version: 1 },
      { type: "message", id: "u", parentId: null,
        timestamp: "2026-04-01T00:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "run" }] } },
      { type: "message", id: "a", parentId: "u",
        timestamp: "2026-04-01T00:00:02.000Z",
        message: { role: "assistant", content: [
          { type: "toolCall", id: toolCallId, name: "subagent",
            arguments: { tasks: [] } },
        ] } },
      { type: "message", id: "r", parentId: "a",
        timestamp: "2026-04-01T00:00:03.000Z",
        message: { role: "toolResult", toolCallId, toolName: "subagent",
          isError: false,
          content: [{ type: "text", text: "synthetic reviewer timeout details" }] } },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    return path;
  }

  test("stale persisted running + authoritative JSONL assistant stop -> session state idle/ready and session.summary idle; exact tool terminal; no duplicate transcript", async () => {
    const { store, dir } = freshStore();
    try {
      const turnId = "sess-a-turn";
      const toolCallId = "sess-a-tool";
      ensureSession(store, SESS_A, "running");
      store.appendEvent(`session:${SESS_A}`, "turn.started", {
        sessionId: SESS_A, turnId, commandId: turnId,
        deliveryMode: "immediate", message: "finish",
        timestamp: "2026-04-01T00:00:00.000Z",
      });
      store.appendEvent(`session:${SESS_A}`, "tool.started", {
        sessionId: SESS_A, turnId, toolCallId,
        toolName: "bash", arguments: { command: "true" },
      });
      const sessionPath = writeTerminalJsonl(dir, SESS_A, turnId, toolCallId);
      store.updateSessionState(SESS_A, { ...(store.sessionState(SESS_A) ?? {}), piSessionPath: sessionPath });

      // Start the daemon so the startup reconciliation loop runs.
      const daemon = await runDaemon({
        workspace: join(dir, "workspace"),
        executable: join(dir, "fake-pi"),
        stateDir: join(dir, "state"),
        sessionDir: join(dir, "sessions"),
        environment: { HOME: dir, PATH: process.env.PATH ?? "/usr/bin:/bin" },
      });
      try {
        const session = daemon.store.sessionState(SESS_A);
        expect(session?.runtimeState).toBe("idle");
        expect(session?.attentionState).toBe("ready");
        const streamEvents = daemon.store.listEvents(`host:${daemon.store.identity().hostId}`);
        const summary = streamEvents.filter((e) => e.type === "session.summary" && (e.payload as Record<string, unknown>).sessionId === SESS_A).at(-1);
        expect(summary).toBeDefined();
        expect((summary!.payload as Record<string, unknown>).runtimeState).toBe("idle");
        expect((summary!.payload as Record<string, unknown>).attentionState).toBe("ready");
        // The terminal tool lifecycle must be durable exactly once.
        const toolTerminals = daemon.canonicalSessionStore.readAfter(SESS_A, 0)
          .filter((e) => (e.eventType === "tool.completed" || e.eventType === "tool.failed") && (e.payload as Record<string, unknown>).toolCallId === toolCallId);
        expect(toolTerminals).toHaveLength(1);
        expect(toolTerminals[0]!.eventType).toBe("tool.completed");
        const canonicalEvents = daemon.canonicalSessionStore.readAfter(SESS_A, 0);
        // The importer derives the canonical turn identity from the JSONL
        // user message (`u`), rather than from the stale pre-import turn id.
        const importedTurn = canonicalEvents.find((e) => e.eventType === "turn.started" && e.payload.commandId === "u");
        expect(importedTurn).toBeDefined();
        const importedTurnId = importedTurn!.payload.turnId;
        // The settled boundary must be durable exactly once for that derived
        // identity, and the transcript must not be replayed.
        const settled = canonicalEvents.filter((e) => e.eventType === "turn.settled" && e.payload.turnId === importedTurnId);
        expect(settled).toHaveLength(1);
        const turnStarts = canonicalEvents.filter((e) => e.eventType === "turn.started" && e.payload.turnId === importedTurnId);
        expect(turnStarts).toHaveLength(1);
      } finally {
        await daemon.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("trailing toolResult + no owner => indeterminate, not idle", async () => {
    const { store, dir } = freshStore();
    try {
      const turnId = "sess-b-turn";
      const toolCallId = "sess-b-tool";
      ensureSession(store, SESS_B, "running");
      store.appendEvent(`session:${SESS_B}`, "turn.started", {
        sessionId: SESS_B, turnId, commandId: turnId,
        deliveryMode: "immediate", message: "run",
        timestamp: "2026-04-01T00:00:00.000Z",
      });
      store.appendEvent(`session:${SESS_B}`, "tool.started", {
        sessionId: SESS_B, turnId, toolCallId,
        toolName: "subagent", arguments: { tasks: [] },
      });
      const sessionPath = writeToolResultTailJsonl(dir, SESS_B, turnId, toolCallId);
      store.updateSessionState(SESS_B, { ...(store.sessionState(SESS_B) ?? {}), piSessionPath: sessionPath });

      const daemon = await runDaemon({
        workspace: join(dir, "workspace"),
        executable: join(dir, "fake-pi"),
        stateDir: join(dir, "state"),
        sessionDir: join(dir, "sessions"),
        environment: { HOME: dir, PATH: process.env.PATH ?? "/usr/bin:/bin" },
      });
      try {
        const session = daemon.store.sessionState(SESS_B);
        expect(session?.runtimeState).toBe("indeterminate");
        expect(session?.attentionState).toBe("needs_attention");
        const streamEvents = daemon.store.listEvents(`host:${daemon.store.identity().hostId}`);
        const summary = streamEvents.filter((e) => e.type === "session.summary" && (e.payload as Record<string, unknown>).sessionId === SESS_B).at(-1);
        expect(summary).toBeDefined();
        expect((summary!.payload as Record<string, unknown>).runtimeState).toBe("indeterminate");
        // Pi's isError=false produces tool.completed, not tool.failed.
        const toolTerminals = daemon.canonicalSessionStore.readAfter(SESS_B, 0)
          .filter((e) => (e.eventType === "tool.completed" || e.eventType === "tool.failed") && (e.payload as Record<string, unknown>).toolCallId === toolCallId);
        expect(toolTerminals).toHaveLength(1);
        expect(toolTerminals[0]!.eventType).toBe("tool.completed");
        const canonicalEvents = daemon.canonicalSessionStore.readAfter(SESS_B, 0);
        // The importer derives the turn id from the JSONL user entry. Reuse
        // the actual imported terminal tool identity instead of masking that
        // mapping with a guessed fixture id.
        const importedTurnId = toolTerminals[0]!.payload.turnId;
        const indeterminates = canonicalEvents
          .filter((e) => e.eventType === "turn.indeterminate" && e.payload.turnId === importedTurnId);
        expect(indeterminates).toHaveLength(1);
      } finally {
        await daemon.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("session isolation: reconciling session A does not mutate session B's row or summary", async () => {
    const { store, dir } = freshStore();
    try {
      const aTurn = "sess-c-a-turn";
      const aTool = "sess-c-a-tool";
      ensureSession(store, SESS_C, "running");
      // Session D is already in a canonical terminal state ("idle"). The
      // generic startup recovery loop skips idle sessions, so D's row
      // must remain untouched while C's reconciliation runs.
      ensureSession(store, SESS_D, "idle");
      store.updateSessionState(SESS_D, { ...(store.sessionState(SESS_D) ?? {}), attentionState: "ready" });
      store.appendEvent(`session:${SESS_C}`, "turn.started", {
        sessionId: SESS_C, turnId: aTurn, commandId: aTurn,
        deliveryMode: "immediate", message: "finish",
        timestamp: "2026-04-01T00:00:00.000Z",
      });
      store.appendEvent(`session:${SESS_C}`, "tool.started", {
        sessionId: SESS_C, turnId: aTurn, toolCallId: aTool,
        toolName: "bash", arguments: { command: "true" },
      });
      const aPath = writeTerminalJsonl(dir, SESS_C, aTurn, aTool);
      store.updateSessionState(SESS_C, { ...(store.sessionState(SESS_C) ?? {}), piSessionPath: aPath });

      const daemon = await runDaemon({
        workspace: join(dir, "workspace"),
        executable: join(dir, "fake-pi"),
        stateDir: join(dir, "state"),
        sessionDir: join(dir, "sessions"),
        environment: { HOME: dir, PATH: process.env.PATH ?? "/usr/bin:/bin" },
      });
      try {
        expect(daemon.store.sessionState(SESS_C)?.runtimeState).toBe("idle");
        expect(daemon.store.sessionState(SESS_C)?.attentionState).toBe("ready");
        // Session D row stays "idle" — reconciliation for session C must
        // never leak across the row or summary stream.
        expect(daemon.store.sessionState(SESS_D)?.runtimeState).toBe("idle");
        expect(daemon.store.sessionState(SESS_D)?.attentionState).toBe("ready");
        const dSummaries = daemon.store.listEvents(`host:${daemon.store.identity().hostId}`)
          .filter((e) => e.type === "session.summary" && (e.payload as Record<string, unknown>).sessionId === SESS_D);
        // No session.summary for D: the reconciliation loop must never
        // touch a session it did not reconcile.
        expect(dSummaries).toHaveLength(0);
      } finally {
        await daemon.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("old historical terminal events do not flip an unresolved session to idle", async () => {
    const { store, dir } = freshStore();
    try {
      // Session E has a stale running row + a durable turn.settled from
      // a previous run + an unresolved JSONL. The reconciler must NOT
      // mistake the old terminal event for the reconciled active turn;
      // because the reconciler finds an open turn, it must report
      // indeterminate (no live owner). The persisted runtimeState must
      // converge to indeterminate, not idle.
      ensureSession(store, SESS_E, "running");
      const turnId = "sess-e-turn";
      store.appendEvent(`session:${SESS_E}`, "turn.started", {
        sessionId: SESS_E, turnId, commandId: turnId,
        deliveryMode: "immediate", message: "stale",
        timestamp: "2026-03-31T23:59:00.000Z",
      });
      store.appendEvent(`session:${SESS_E}`, "turn.settled", {
        sessionId: SESS_E, turnId,
      });
      store.appendEvent(`session:${SESS_E}`, "turn.started", {
        sessionId: SESS_E, turnId: `${turnId}-new`, commandId: `${turnId}-new`,
        deliveryMode: "immediate", message: "fresh",
        timestamp: "2026-04-01T00:00:00.000Z",
      });
      const sessionPath = writeToolResultTailJsonl(dir, SESS_E, `${turnId}-new`, `${turnId}-new-tool`);
      store.updateSessionState(SESS_E, { ...(store.sessionState(SESS_E) ?? {}), piSessionPath: sessionPath });

      const daemon = await runDaemon({
        workspace: join(dir, "workspace"),
        executable: join(dir, "fake-pi"),
        stateDir: join(dir, "state"),
        sessionDir: join(dir, "sessions"),
        environment: { HOME: dir, PATH: process.env.PATH ?? "/usr/bin:/bin" },
      });
      try {
        const session = daemon.store.sessionState(SESS_E);
        expect(session?.runtimeState).toBe("indeterminate");
        expect(session?.attentionState).toBe("needs_attention");
      } finally {
        await daemon.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function countByType(events: ReadonlyArray<{ readonly type: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const event of events) out[event.type] = (out[event.type] ?? 0) + 1;
  return out;
}
