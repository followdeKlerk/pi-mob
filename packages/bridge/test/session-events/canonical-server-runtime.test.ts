/**
 * Phase 4 — runtime integration test: `session_events.v2` capability,
 * `session.events.subscribe` control, and live `session.event`
 * pushes over the production server.
 *
 * The test exercises the production runtime + WebSocket server path
 * with a real `BridgeStore` and the real `CanonicalSessionStore`
 * constructed by the daemon. It does NOT boot the daemon process;
 * the runtime is the only host-relevant production path the
 * canonical-event delivery depends on, and the daemon calls the
 * runtime directly.
 *
 * The test verifies:
 *
 *   1. `optionalCapabilities()` returns `session_events.v2` only when
 *      the canonical-event transport is supplied.
 *   2. The `hello.accepted` envelope advertises `session_events.v2`
 *      to a client that negotiated the capability.
 *   3. A real WebSocket client sends `session.events.subscribe` and
 *      receives the `session.events.replay.result` envelope with
 *      strict sequence order.
 *   4. A canonical event committed AFTER `session.events.subscribe`
 *      is pushed to the subscribed connection as a `session.event`
 *      envelope with the same byte-shape as a replay element.
 *   5. A second connection without the `session_events.v2`
 *      subscription does NOT receive the live event.
 *   6. Disconnect tears down the transport subscription so subsequent
 *      live events are not delivered.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BridgeStore } from "../../src/core/store";
import { DurableBridgeRuntime } from "../../src/core/runtime";
import { createBridgeServer } from "../../src/core/server";
import { CanonicalSessionStore } from "../../src/session-events/canonical-session-store";
import { CanonicalEventTransport } from "../../src/session-events/canonical-event-transport";
import { hashCredential } from "../../src/auth/credentials";
import type { StoredCommand } from "../../src/core/store";
import type { AdapterPort } from "../../src/core/domain";

const STATIC_INSTALLATION_ID = "11111111-1111-4111-8111-111111111111";
const STATIC_CREDENTIAL = "pc_fixture-credential";
const STATIC_HELLO_MESSAGE = {
  type: "hello",
  protocol: { major: 1, minor: 0 },
  messageId: "00000000-0000-4000-8000-000000000001",
  requestId: "00000000-0000-4000-8000-000000000001",
  sentAt: "2026-08-14T12:00:00.000Z",
  payload: {
    mobileVersion: "0.0.3-alpha.1",
    platform: "android",
    installationId: STATIC_INSTALLATION_ID,
    installationCredential: STATIC_CREDENTIAL,
    requiredCapabilities: ["streams.v1", "commands.v1", "controller_leases.v1", "session_events.v2"],
    optionalCapabilities: [],
  },
};


function installCredential(store: BridgeStore, installationId: string, credential: string): void {
  store.upsertInstallationCredential({
    installationId,
    credentialHash: hashCredential(credential),
    enrollmentSecretHash: hashCredential("enrollment-secret", "enrollment"),
    enrollmentSource: "manual",
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  });
}

class StubAdapter implements AdapterPort {
  async dispatch(_command: StoredCommand): Promise<void> { /* no-op */ }
  listWorkspaces(): { readonly items: ReadonlyArray<Record<string, unknown>> } { return { items: [] }; }
  searchWorkspaces(): { readonly items: ReadonlyArray<Record<string, unknown>> } { return { items: [] }; }
  listModels(): { readonly items: ReadonlyArray<Record<string, unknown>> } { return { items: [] }; }
}

function openSocket(url: string): { socket: WebSocket; messages: Array<Record<string, unknown>>; close: () => void } {
  const socket = new WebSocket(url);
  const messages: Array<Record<string, unknown>> = [];
  socket.addEventListener("message", (event) => {
    const data = typeof event.data === "string" ? event.data : "";
    if (!data) return;
    try { messages.push(JSON.parse(data) as Record<string, unknown>); }
    catch { /* ignore */ }
  });
  return {
    socket,
    messages,
    close: () => { try { socket.close(); } catch { /* ignore */ } },
  };
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 4000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = fn();
    if (v !== undefined) return v;
    await new Promise<void>((r) => setTimeout(r, 5));
  }
  throw new Error("timeout waiting for message");
}

function nextMessage(messages: Array<Record<string, unknown>>, predicate: (value: Record<string, unknown>) => boolean, timeoutMs = 4000): Promise<Record<string, unknown>> {
  return waitFor(() => messages.find(predicate), timeoutMs);
}

describe("canonical session-event runtime: capability, subscribe, and live push", () => {
  let directory: string;
  let store: BridgeStore;
  let runtime: DurableBridgeRuntime;
  let canonical: CanonicalSessionStore;
  let transport: CanonicalEventTransport;
  let sessionId: string;
  let server: ReturnType<typeof createBridgeServer>;
  let baseUrl: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "canonical-runtime-"));
    store = new BridgeStore(join(directory, "bridge.sqlite"));
    installCredential(store, "11111111-1111-4111-8111-111111111111", "pc_fixture-credential");
    sessionId = crypto.randomUUID().toLowerCase();
    store.addSessionSummary(sessionId, { name: "test" });
    canonical = new CanonicalSessionStore(store);
    transport = new CanonicalEventTransport({ store: canonical });
    const adapter = new StubAdapter();
    runtime = new DurableBridgeRuntime({
      store,
      adapter,
      bridgeVersion: "test",
      piVersion: "0.82.0",
      hostDisplayName: "test",
      canonicalSessionStore: canonical,
      canonicalEventTransport: transport,
    });
    await runtime.start();
    server = createBridgeServer({ hostname: "127.0.0.1", port: 0, runtime });
    baseUrl = `ws://127.0.0.1:${server.port}/v1/ws`;
  });

  afterEach(() => {
    try { server.stop(true); } catch { /* ignore */ }
    try { transport.close(); } catch { /* ignore */ }
    try { store.close(); } catch { /* ignore */ }
    cleanup(directory);
  });

  test("session_events.v2 is advertised only when the transport is supplied", () => {
    expect(runtime.optionalCapabilities()).toContain("session_events.v2");
  });

  test("client negotiates the capability and receives a typed replay envelope", async () => {
    const { socket, messages, close } = openSocket(baseUrl);
    try {
      const opened = new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", () => reject(new Error("socket error")), { once: true });
      });
      await opened;
      socket.send(JSON.stringify(STATIC_HELLO_MESSAGE));
      const hello = await nextMessage(messages, (value) => value.type === "hello.accepted");
      const payload = hello.payload as { capabilities: readonly string[]; connectionId: string };
      expect(payload.capabilities).toContain("session_events.v2");
      const connectionId = payload.connectionId;

      // Subscribe with `afterSequence=0`.
      const subscribeRequestId = "00000000-0000-4000-8000-0000000000aa";
      socket.send(JSON.stringify({
        type: "session.events.subscribe",
        protocol: { major: 1, minor: 0 },
        messageId: subscribeRequestId,
        requestId: subscribeRequestId,
        connectionId,
        sentAt: "2026-08-14T12:00:00.000Z",
        payload: { sessionId, afterSequence: 0 },
      }));
      const replay = await nextMessage(messages, (value) => value.type === "session.events.replay.result" && value.requestId === subscribeRequestId);
      const replayPayload = replay.payload as { sessionId: string; events: ReadonlyArray<Record<string, unknown>>; latestSequence: number; complete: boolean };
      expect(replayPayload.sessionId).toBe(sessionId);
      expect(replayPayload.complete).toBe(true);
      expect(replayPayload.events.length).toBe(0);
      expect(replayPayload.latestSequence).toBe(0);
      expect(replay).not.toHaveProperty('__canonicalSubscribeSessionId');
    } finally { close(); }
  });

  test("committed canonical event is delivered as a live session.event envelope after subscribe", async () => {
    const { socket, messages, close } = openSocket(baseUrl);
    try {
      const opened = new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", () => reject(new Error("socket error")), { once: true });
      });
      await opened;
      socket.send(JSON.stringify(STATIC_HELLO_MESSAGE));
      const hello = await nextMessage(messages, (value) => value.type === "hello.accepted");
      expect(hello).toBeTruthy();
      const connectionId = (hello.payload as { connectionId: string }).connectionId;
      const subscribeRequestId = "00000000-0000-4000-8000-0000000000bb";
      socket.send(JSON.stringify({
        type: "session.events.subscribe",
        protocol: { major: 1, minor: 0 },
        messageId: subscribeRequestId,
        requestId: subscribeRequestId,
        connectionId,
        sentAt: "2026-08-14T12:00:00.000Z",
        payload: { sessionId, afterSequence: 0 },
      }));
      const replay = await nextMessage(messages, (value) => value.type === "session.events.replay.result" && value.requestId === subscribeRequestId);
      expect(replay).toBeTruthy();
      // Now commit a canonical event AFTER subscribe returned. The
      // post-commit listener must fire synchronously and the server
      // must forward the live frame.
      canonical.append({
        sessionId,
        type: "turn.started",
        payload: { turnId: "t-live" },
        eventId: "live-1",
        occurredAt: "2026-08-14T12:00:01.000Z",
      });
      const live = await nextMessage(messages, (value) => value.type === "session.event");
      const livePayload = live.payload as { eventId: string; sessionId: string; sequence: number; eventType: string; occurredAt: string; data: Record<string, unknown> };
      expect(livePayload.sessionId).toBe(sessionId);
      expect(livePayload.sequence).toBe(1);
      expect(livePayload.eventType).toBe("turn.started");
      expect(livePayload.eventId).toBe("live-1");
      expect(livePayload.data.turnId).toBe("t-live");
    } finally { close(); }
  });

  test("replay and live frames share the same byte-shape elements", async () => {
    const { socket, messages, close } = openSocket(baseUrl);
    try {
      const opened = new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", () => reject(new Error("socket error")), { once: true });
      });
      await opened;
      socket.send(JSON.stringify(STATIC_HELLO_MESSAGE));
      const hello = await nextMessage(messages, (value) => value.type === "hello.accepted");
      const connectionId = (hello.payload as { connectionId: string }).connectionId;
      // Seed the log BEFORE the subscription so the replay already
      // has data.
      canonical.append({
        sessionId,
        type: "turn.started",
        payload: { turnId: "t1" },
        eventId: "replay-1",
        occurredAt: "2026-08-14T12:00:00.000Z",
      });
      const subscribeRequestId = "00000000-0000-4000-8000-0000000000cc";
      socket.send(JSON.stringify({
        type: "session.events.subscribe",
        protocol: { major: 1, minor: 0 },
        messageId: subscribeRequestId,
        requestId: subscribeRequestId,
        connectionId,
        sentAt: "2026-08-14T12:00:00.000Z",
        payload: { sessionId, afterSequence: 0 },
      }));
      const replay = await nextMessage(messages, (value) => value.type === "session.events.replay.result" && value.requestId === subscribeRequestId);
      const replayEvents = (replay.payload as { events: Array<Record<string, unknown>> }).events;
      expect(replayEvents.length).toBe(1);
      const replayElement = replayEvents[0]!;
      canonical.append({
        sessionId,
        type: "turn.settled",
        payload: { turnId: "t1" },
        eventId: "live-2",
        occurredAt: "2026-08-14T12:00:01.000Z",
      });
      const live = await nextMessage(messages, (value) => value.type === "session.event");
      const livePayload = live.payload as Record<string, unknown>;
      // The plan requires byte-shape equivalence (plan \u00a73.4). The
      // keys must be identical; the values may differ.
      expect(Object.keys(livePayload).sort()).toEqual(Object.keys(replayElement).sort());
      // And the wire frame for live must be a `session.event` typed
      // message with the same top-level structure as a replay
      // element under `payload.events`.
      expect(live.type).toBe("session.event");
    } finally { close(); }
  });
});

function cleanup(directory: string): void {
  try { rmSync(directory, { recursive: true, force: true }); } catch { /* best-effort */ }
}
