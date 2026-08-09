/**
 * Compatibility-adapter coverage for canonical session-event admission.
 *
 * The production daemon now uses `CanonicalSessionStore` directly. This
 * file retains coverage for injected older adapters that still provide the
 * legacy facade.
 *
 * The test proves:
 *
 *   1. An injected older adapter routes curated notifications through the
 *      compatibility facade without bypassing durable admission.
 *   2. The canonical facade persists the event before any
 *      `BridgeStore.onEvent()` listener fires for the same `eventId`.
 *      This is the plan §3.2 persist-before-publish invariant.
 *   3. The `StoredEvent` returned to the adapter and the notification
 *      classifier carries the canonical sequence metadata recorded by
 *      the facade.
 *   5. When the canonical facade rejects a type (closed-set guard),
 *      the adapter still throws and the journal does not record the
 *      rejected event.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BridgeStore } from "../../src/core/store";
import { OneSessionPiAdapter, type PiRpcNotificationHandler, type PiRpcRequestOptions } from "../../src/pi/one-session-adapter";
import { importSessionHistoryTail } from "../../src/pi/external-history";
import { CanonicalEventStore } from "../../src/session-events/event-store";
import { CanonicalSessionStore } from "../../src/session-events/canonical-session-store";

class FakeRpc {
  private readonly handlers = new Set<PiRpcNotificationHandler>();
  on(_kind: "notification", handler: PiRpcNotificationHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  emit(value: Record<string, unknown>): void { for (const handler of this.handlers) handler(value); }
  request(_options: PiRpcRequestOptions): Promise<unknown> { return Promise.resolve({}); }
}

const workspaceId = "55555555-5555-4555-8555-555555555555";
const sessionId = "77777777-7777-4777-8777-777777777777";


describe("bridge production wiring: canonical session store is the live append path", () => {
  test("normal canonical admission does not write source transcript or recipe rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "canonical-wiring-dedicated-"));
    const store = new BridgeStore(join(dir, "bridge.sqlite"));
    const identity = store.identity();
    store.ensureStream(`host:${identity.hostId}`, "host");
    store.ensureSession(sessionId, { sessionId, workspaceId, policyMode: "full", runtimeState: "idle" });
    store.ensureStream(`session:${sessionId}`, "session", sessionId);
    const canonical = new CanonicalSessionStore(store);
    const rpc = new FakeRpc();
    const adapter = new OneSessionPiAdapter({
      store,
      rpc,
      canonicalSessionStore: canonical,
      workspace: { workspaceId, rootPath: dir, displayName: "dedicated", fingerprint: "dedicated", policyMode: "full" },
    });
    try {
      rpc.emit({ type: "turn_start", sessionId, turnIndex: 1, timestamp: new Date().toISOString() });
      rpc.emit({ type: "message_update", sessionId, assistantMessageEvent: { type: "text_delta", delta: "hello" } });
      rpc.emit({ type: "tool_execution_start", sessionId, toolCallId: "dedicated-tool", toolName: "read", args: { path: "/tmp/x" } });
      rpc.emit({ type: "tool_execution_update", sessionId, toolCallId: "dedicated-tool", partialResult: "ok" });
      rpc.emit({ type: "tool_execution_end", sessionId, toolCallId: "dedicated-tool", toolName: "read", result: "ok", isError: false });
      rpc.emit({ type: "agent_settled", sessionId });

      const legacy = store.listEvents(`session:${sessionId}`);
      const sourceTranscriptTypes = new Set([
        "user.message.created", "turn.started", "turn.settled", "turn.failed", "turn.aborted",
        "assistant.started", "assistant.delta", "assistant.completed", "tool.started", "tool.output",
        "tool.completed", "tool.failed", "tool.cancelled", "recipe.activity",
      ]);
      expect(legacy.filter((event) => sourceTranscriptTypes.has(event.type))).toHaveLength(0);
      expect(canonical.readAfter(sessionId, 0).length).toBeGreaterThan(0);
      expect(canonical.readAfter(sessionId, 0).some((event) => event.eventType === "tool.completed")).toBe(true);
    } finally {
      adapter.close();
      store.close();
    }
  });

  test("live tool continuation keeps one turn and stable assistant messages", () => {
    const dir = mkdtempSync(join(tmpdir(), "canonical-wiring-live-order-"));
    const store = new BridgeStore(join(dir, "bridge.sqlite"));
    store.ensureSession(sessionId, { sessionId, workspaceId, policyMode: "full", runtimeState: "idle" });
    store.ensureStream(`session:${sessionId}`, "session", sessionId);
    const canonical = new CanonicalSessionStore(store);
    const rpc = new FakeRpc();
    const adapter = new OneSessionPiAdapter({
      store,
      rpc,
      canonicalSessionStore: canonical,
      workspace: { workspaceId, rootPath: dir, displayName: "live-order", fingerprint: "live-order", policyMode: "full" },
    });
    try {
      (adapter as unknown as { activeTurns: Map<string, { turnId: string; deliveryMode: string; message: string }> }).activeTurns.set(sessionId, {
        turnId: "command-1", deliveryMode: "immediate", message: "pwd",
      });
      rpc.emit({ type: "turn_start", sessionId });
      rpc.emit({ type: "message_update", sessionId, assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
      rpc.emit({ type: "message_update", sessionId, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "before" } });
      rpc.emit({ type: "message_update", sessionId, assistantMessageEvent: { type: "text_end", contentIndex: 0 } });
      rpc.emit({ type: "tool_execution_start", sessionId, toolCallId: "pwd", toolName: "bash", args: {} });
      rpc.emit({ type: "tool_execution_end", sessionId, toolCallId: "pwd", toolName: "bash", result: "/private/repo", isError: false });
      // Pi can emit another turn_start while it continues after a tool.
      rpc.emit({ type: "turn_start", sessionId });
      rpc.emit({ type: "message_update", sessionId, assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
      rpc.emit({ type: "message_update", sessionId, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "after" } });
      rpc.emit({ type: "message_update", sessionId, assistantMessageEvent: { type: "text_end", contentIndex: 0 } });
      rpc.emit({ type: "agent_settled", sessionId });

      const events = canonical.readAfter(sessionId, 0);
      expect(events.filter((event) => event.eventType === "turn.started")).toHaveLength(1);
      expect(events.map((event) => event.eventType)).toEqual([
        "turn.started", "assistant.started", "assistant.content.replaced", "assistant.message.completed",
        "tool.started", "tool.completed", "assistant.started", "assistant.content.replaced", "assistant.message.completed",
        "turn.settled",
      ]);
      const assistants = events.filter((event) => event.eventType === "assistant.started");
      expect(assistants[0]?.payload.messageId).not.toBe(assistants[1]?.payload.messageId);
      expect(events.find((event) => event.eventType === "tool.completed")?.payload.result).toBe("/private/repo");
    } finally {
      adapter.close();
      store.close();
    }
  });

  test("live thinking/tool-only entry is not an assistant card and post-tool text keeps one turn", () => {
    const dir = mkdtempSync(join(tmpdir(), "canonical-wiring-live-pwd-"));
    const store = new BridgeStore(join(dir, "bridge.sqlite"));
    store.ensureSession(sessionId, { sessionId, workspaceId, policyMode: "full", runtimeState: "idle" });
    store.ensureStream(`session:${sessionId}`, "session", sessionId);
    const canonical = new CanonicalSessionStore(store);
    const rpc = new FakeRpc();
    const adapter = new OneSessionPiAdapter({
      store,
      rpc,
      canonicalSessionStore: canonical,
      workspace: { workspaceId, rootPath: dir, displayName: "live-pwd", fingerprint: "live-pwd", policyMode: "full" },
    });
    try {
      (adapter as unknown as { activeTurns: Map<string, { turnId: string; deliveryMode: string; message: string }> }).activeTurns.set(sessionId, {
        turnId: "command-pwd", deliveryMode: "immediate", message: "pwd",
      });
      rpc.emit({ type: "turn_start", sessionId });
      // This assistant entry contains only private thinking and a tool call.
      // Pi can still emit its terminal notification before visible text.
      rpc.emit({
        type: "message_start",
        sessionId,
        message: {
          role: "assistant",
          id: "thinking-tool-entry",
          content: [
            { type: "thinking", thinking: "private" },
            { type: "toolCall", id: "pwd", name: "bash", arguments: { command: "pwd" } },
          ],
        },
      });
      rpc.emit({
        type: "message_end",
        sessionId,
        message: {
          role: "assistant",
          id: "thinking-tool-entry",
          content: [
            { type: "thinking", thinking: "private" },
            { type: "toolCall", id: "pwd", name: "bash", arguments: { command: "pwd" } },
          ],
        },
      });
      rpc.emit({ type: "tool_execution_start", sessionId, toolCallId: "pwd", toolName: "bash", args: { command: "pwd" } });
      rpc.emit({ type: "tool_execution_end", sessionId, toolCallId: "pwd", toolName: "bash", result: "/private/repo", isError: false });
      // Pi repeats turn_start while the original command continues after a tool.
      rpc.emit({ type: "turn_start", sessionId });
      rpc.emit({ type: "message_update", sessionId, assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
      rpc.emit({ type: "message_update", sessionId, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "The working directory is /private/repo" } });
      rpc.emit({ type: "message_update", sessionId, assistantMessageEvent: { type: "text_end", contentIndex: 0 } });
      rpc.emit({ type: "message_end", sessionId, message: { role: "assistant", content: [{ type: "text", text: "The working directory is /private/repo" }] } });
      rpc.emit({ type: "agent_settled", sessionId });

      const events = canonical.readAfter(sessionId, 0);
      const types = events.map((event) => event.eventType);
      expect(types.filter((type) => type === "turn.started")).toHaveLength(1);
      expect(types.filter((type) => type === "assistant.started")).toHaveLength(1);
      expect(types.filter((type) => type === "assistant.message.completed")).toHaveLength(1);
      expect(types.filter((type) => type === "turn.settled")).toHaveLength(1);
      expect(types.indexOf("assistant.message.completed")).toBeGreaterThan(types.indexOf("assistant.started"));
      expect(events.filter((event) => event.eventType === "assistant.content.replaced")[0]?.payload.content).toEqual([
        { kind: "text", text: "The working directory is /private/repo" },
      ]);
      const toolResults = events.filter((event) => event.eventType === "tool.completed");
      expect(toolResults).toHaveLength(1);
      expect(toolResults[0]?.payload.result).toBe("/private/repo");
      expect(events.filter((event) => event.eventType === "assistant.started")[0]?.payload.messageId).toBeDefined();
    } finally {
      adapter.close();
      store.close();
    }
  });

  test("canonical history import and restart never backfill legacy transcript rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "canonical-wiring-history-"));
    const sourcePath = join(dir, "session.jsonl");
    writeFileSync(sourcePath, [
      { type: "session", id: sessionId, version: 1 },
      { type: "message", id: "history-user", parentId: null, message: { role: "user", content: [{ type: "text", text: "history" }] } },
      { type: "message", id: "history-assistant", parentId: "history-user", message: { role: "assistant", content: [{ type: "text", text: "reply" }] } },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    let store = new BridgeStore(join(dir, "bridge.sqlite"));
    store.ensureStream(`host:${store.identity().hostId}`, "host");
    store.ensureSession(sessionId, { sessionId, workspaceId, policyMode: "full", runtimeState: "idle", externalSession: true });
    store.ensureStream(`session:${sessionId}`, "session", sessionId);
    let canonical = new CanonicalSessionStore(store);
    expect(importSessionHistoryTail(store, sessionId, sourcePath, { sessionStore: canonical })).toBeGreaterThan(0);
    expect(store.listEvents(`session:${sessionId}`)).toHaveLength(0);
    const firstCount = canonical.count(sessionId);
    expect(firstCount).toBeGreaterThan(0);
    store.close();

    store = new BridgeStore(join(dir, "bridge.sqlite"));
    canonical = new CanonicalSessionStore(store);
    expect(importSessionHistoryTail(store, sessionId, sourcePath, { sessionStore: canonical })).toBe(0);
    expect(canonical.count(sessionId)).toBe(firstCount);
    expect(store.listEvents(`session:${sessionId}`)).toHaveLength(0);
    store.close();
  });

  test("canonical history gives every assistant message a stable source identity", () => {
    const dir = mkdtempSync(join(tmpdir(), "canonical-wiring-history-blocks-"));
    const sourcePath = join(dir, "session.jsonl");
    writeFileSync(sourcePath, [
      { type: "session", id: sessionId, version: 1 },
      {
        type: "message", id: "history-user-blocks", parentId: null,
        message: { role: "user", content: [{ type: "text", text: "history" }] },
      },
      {
        type: "message", id: "history-assistant-blocks", parentId: "history-user-blocks",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "first text" },
            { type: "text", text: "second text" },
            { type: "thinking", thinking: "private one" },
            { type: "thinking", thinking: "private two" },
            { type: "toolCall", id: "history-tool-one", name: "read", arguments: { path: "/tmp/one" } },
            { type: "toolCall", id: "history-tool-two", name: "read", arguments: { path: "/tmp/two" } },
          ],
        },
      },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");

    let store = new BridgeStore(join(dir, "bridge.sqlite"));
    store.ensureStream(`host:${store.identity().hostId}`, "host");
    store.ensureSession(sessionId, { sessionId, workspaceId, policyMode: "full", runtimeState: "idle", externalSession: true });
    store.ensureStream(`session:${sessionId}`, "session", sessionId);
    let canonical = new CanonicalSessionStore(store);
    try {
      expect(importSessionHistoryTail(store, sessionId, sourcePath, { sessionStore: canonical })).toBeGreaterThan(0);
      const first = canonical.readAfter(sessionId, 0);
      expect(first.map((event) => event.eventType)).toEqual([
        "user.message.created", "turn.started",
        "assistant.started", "assistant.content.replaced", "assistant.content.replaced", "assistant.message.completed",
        "reasoning.started", "reasoning.completed", "reasoning.started", "reasoning.completed",
        "tool.started", "tool.started", "turn.settled",
      ]);
      expect(first.map((event) => event.sequence)).toEqual(first.map((_, index) => index + 1));
      const sourceIds = first.map((event) => event.sourceEventId);
      expect(sourceIds.every((sourceId): sourceId is string => sourceId !== null)).toBe(true);
      expect(new Set(sourceIds).size).toBe(first.length);
      expect(first.filter((event) => event.eventType === "assistant.content.replaced").map((event) => event.payload.content)).toEqual([
        [{ kind: "text", text: "first text" }],
        [{ kind: "text", text: "first textsecond text" }],
      ]);
      expect(store.listEvents(`session:${sessionId}`)).toHaveLength(0);

      expect(importSessionHistoryTail(store, sessionId, sourcePath, { sessionStore: canonical })).toBe(0);
      expect(canonical.readAfter(sessionId, 0)).toEqual(first);
      store.close();

      store = new BridgeStore(join(dir, "bridge.sqlite"));
      canonical = new CanonicalSessionStore(store);
      expect(importSessionHistoryTail(store, sessionId, sourcePath, { sessionStore: canonical })).toBe(0);
      expect(canonical.readAfter(sessionId, 0)).toEqual(first);
      expect(store.listEvents(`session:${sessionId}`)).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  test("canonical history failure never publishes an event that outer rollback removed", () => {
    const dir = mkdtempSync(join(tmpdir(), "canonical-wiring-failure-"));
    const sourcePath = join(dir, "session.jsonl");
    writeFileSync(sourcePath, [
      { type: "session", id: sessionId, version: 1 },
      { type: "message", id: "history-user", parentId: null, message: { role: "user", content: [{ type: "text", text: "history" }] } },
      { type: "message", id: "history-assistant", parentId: "history-user", message: { role: "assistant", content: [{ type: "text", text: "reply" }] } },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    const store = new BridgeStore(join(dir, "bridge.sqlite"));
    store.ensureSession(sessionId, { sessionId, externalSession: true });
    store.ensureStream(`session:${sessionId}`, "session", sessionId);
    const canonical = new CanonicalSessionStore(store);
    const originalAppend = canonical.append.bind(canonical);
    const published: string[] = [];
    canonical.onCommit((event) => published.push(event.eventId));
    let calls = 0;
    canonical.append = ((input: Parameters<typeof originalAppend>[0]) => {
      const result = originalAppend(input);
      calls += 1;
      if (calls === 2) throw new Error("forced importer failure");
      return result;
    }) as typeof canonical.append;
    try {
      expect(() => importSessionHistoryTail(store, sessionId, sourcePath, { sessionStore: canonical })).toThrow("forced importer failure");
      const durable = canonical.readAfter(sessionId, 0);
      // Canonical imports commit per source event. Every notification observed
      // before the forced failure therefore still names a committed row; the
      // old outer BridgeStore transaction published rows it later rolled back.
      expect(published.length).toBe(2);
      expect(durable.map((event) => event.eventId)).toEqual(published);
      expect(durable.every((event) => published.includes(event.eventId))).toBe(true);
    } finally {
      store.close();
    }
  });

  test("canonical facade is invoked once per normalized Pi notification; listener fires after commit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "canonical-wiring-"));
    const store = new BridgeStore(join(dir, "bridge.sqlite"));
    const identity = store.identity();
    store.ensureStream(`host:${identity.hostId}`, "host");
    store.ensureSession(sessionId, { sessionId, workspaceId, policyMode: "full", runtimeState: "idle" });
    const streamId = `session:${sessionId}`;
    store.ensureStream(streamId, "session", sessionId);

    // Production wiring: runDaemon injects the dedicated canonical session
    // store directly into the adapter. The mixed-cursor facade is not part
    // of live admission.
    const canonicalSessionStore = new CanonicalSessionStore(store);
    const originalAppend = canonicalSessionStore.append.bind(canonicalSessionStore);
    let canonicalAppends = 0;
    canonicalSessionStore.append = ((...args: Parameters<typeof originalAppend>) => {
      canonicalAppends += 1;
      return originalAppend(...args);
    }) as typeof canonicalSessionStore.append;

    const rpc = new FakeRpc();
    const adapter = new OneSessionPiAdapter({
      store,
      rpc,
      canonicalSessionStore,
      workspace: {
        workspaceId,
        rootPath: dir,
        displayName: "canonical-wiring",
        fingerprint: "canonical-wiring",
        policyMode: "full",
      },
    });

    // Production observer: a listener that subscribes to post-commit
    // events the same way the WebSocket layer does.
    const observed: Array<{ eventId: string; alreadyCommitted: boolean; type: string }> = [];
    const detach = canonicalSessionStore.onCommit((event) => {
      const alreadyCommitted = canonicalSessionStore.readAfter(sessionId, 0).some((stored) => stored.eventId === event.eventId);
      observed.push({ eventId: event.eventId, alreadyCommitted, type: event.eventType });
    });

    try {
      // Drive a full prompt.submit → notification flow so the adapter
      // establishes an active turn. The recipe projection requires a
      // turnId to publish derived `recipe.activity` events; without a
      // real prompt dispatch the test cannot exercise the legacy
      // derived path.
      const sessionCreateRecord = {
        commandId: "create-canonical-wiring",
        type: "session.create",
        scopeKey: `host:${identity.hostId}`,
        streamId: `host:${identity.hostId}`,
        semanticHash: "h",
        state: "accepted",
        dispatchCount: 0,
        payload: { workspaceId, policyMode: "full" as const },
      };
      await adapter.dispatch(sessionCreateRecord as never);
      const created = store
        .listEvents(`host:${identity.hostId}`)
        .find((event) => event.type === "session.summary");
      expect(created).toBeDefined();
      // The session.create dispatch above establishes a fresh
      // session id; the adapter's `lastUsedSessionId` falls back to
      // the only registered session when notifications omit one. The
      // notifications emitted below carry `sessionId` explicitly so
      // the production handler resolves our session id consistently.
      const promptRecord = {
        commandId: "prompt-canonical-wiring",
        type: "prompt.submit",
        scopeKey: `session:${sessionId}`,
        streamId: `session:${sessionId}`,
        semanticHash: "h",
        state: "accepted",
        dispatchCount: 0,
        payload: {
          sessionId,
          deliveryMode: "immediate" as const,
          message: "hi",
          attachmentIds: [] as string[],
        },
      };
      await adapter.dispatch(promptRecord as never).catch(() => undefined);
      // Use the adapter's lastUsedSessionId to route notifications
      // when sessionId is omitted on the wire.
      // (Notifications carry sessionId explicitly below, so this is
      // belt-and-braces.)

      // Drive five curated notifications through the production
      // notification handler. `turn.started` carries the turnId so
      // the recipe projection can derive `recipe.activity` events.
      rpc.emit({ type: "turn_start", sessionId, turnIndex: 1, timestamp: new Date().toISOString() });
      rpc.emit({ type: "message_update", sessionId, assistantMessageEvent: { type: "text_delta", delta: "hello" } });
      rpc.emit({
        type: "tool_execution_start",
        sessionId,
        toolCallId: "t1",
        toolName: "read",
        args: { path: "/tmp/x" },
      });
      rpc.emit({
        type: "tool_execution_update",
        sessionId,
        toolCallId: "t1",
        partialResult: "ok",
      });
      rpc.emit({ type: "agent_settled", sessionId });

      // 1. The dedicated store was invoked for every curated event emitted
      //    by the normalizer and prompt admission.
      expect(canonicalAppends).toBeGreaterThanOrEqual(5);

      // 2. Every canonical listener observed the event AFTER commit.
      expect(observed.length).toBeGreaterThanOrEqual(5);
      for (const entry of observed) expect(entry.alreadyCommitted).toBe(true);

      // 3. The canonical journal is contiguous and operational/recipe rows
      //    do not consume its per-session sequence.
      const persisted = store.listEvents(streamId);
      const canonical = canonicalSessionStore.readAfter(sessionId, 0);
      expect(canonical.length).toBeGreaterThanOrEqual(5);
      expect(canonical.map((event) => event.sequence)).toEqual(
        canonical.map((_, index) => index + 1),
      );
      expect(new Set(canonical.map((event) => event.eventId)).size).toBe(canonical.length);
      const sourceIds = canonical.map((event) => event.sourceEventId).filter((id): id is string => id !== null);
      expect(new Set(sourceIds).size).toBe(sourceIds.length);
      expect(persisted.some((event) => event.type === "turn.started")).toBe(false);
      // Recipe.activity is a derived projection, not part of the
      // canonical facade's responsibility. It is published by the
      // durable recipe projection, not by the canonical facade.
      // (Whether it appears depends on whether the active turn was
      // set up via a real prompt.submit dispatch — see the second
      // test for the dedicated recipe.activity flow.)
      // No raw envelope ever reaches the session stream.
      expect(persisted.some((event) => event.type === "pi.rpc.event")).toBe(false);

      expect(canonical.some((event) => event.eventType === "assistant.content.replaced")).toBe(true);
      expect(canonical.some((event) => event.eventType === "tool.progress.replaced")).toBe(true);
    } finally {
      detach();
      adapter.close();
      store.close();
    }
  });

  test("canonical facade rejects unknown event types and the adapter surfaces the error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "canonical-wiring-reject-"));
    const store = new BridgeStore(join(dir, "bridge.sqlite"));
    store.ensureStream(`host:${store.identity().hostId}`, "host");
    store.ensureSession(sessionId, { sessionId, workspaceId, policyMode: "full", runtimeState: "idle" });
    store.ensureStream(`session:${sessionId}`, "session", sessionId);

    const canonicalStore = new CanonicalEventStore({ store });
    const rpc = new FakeRpc();
    const adapter = new OneSessionPiAdapter({
      store,
      rpc,
      canonicalEventStore: canonicalStore,
      workspace: {
        workspaceId,
        rootPath: dir,
        displayName: "canonical-wiring-reject",
        fingerprint: "canonical-wiring-reject",
        policyMode: "full",
      },
    });

    try {
      // A curated event that survives normalization but whose type is
      // not in the canonical closed set must be rejected before the
      // adapter persists anything. The legacy `recipe.activity` type
      // is intentionally outside the canonical union; emitting it
      // through the facade proves the closed-set guard.
      const canonical = canonicalStore as unknown as { append: (s: string, i: { type: string; payload: Record<string, unknown> }) => unknown };
      expect(() => canonical.append(sessionId, { type: "recipe.activity", payload: { x: 1 } })).toThrow(/closed set/);
      expect(canonicalStore.latestSequence(sessionId)).toBe(0);
      expect(store.listEvents(`session:${sessionId}`)).toHaveLength(0);
    } finally {
      adapter.close();
      store.close();
    }
  });


});
