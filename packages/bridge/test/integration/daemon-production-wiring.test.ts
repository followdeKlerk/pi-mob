/**
 * Highest-priority production-wiring proof for the canonical session-event
 * path. This test deliberately starts the real `runDaemon` construction path
 * rather than assembling a DurableBridgeRuntime by hand.
 *
 * It covers the released handshake contract and the durable transport across
 * a mobile disconnect/reconnect and a daemon restart. Pi is not started: the
 * canonical store is populated through the daemon-created store, which keeps
 * this test focused on bridge production wiring and avoids making a provider
 * or external model a test dependency.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDaemon, type DaemonHandle } from "../../src/daemon";
import { generateInstallationCredential, hashCredential } from "../../src/auth/credentials";

const INSTALLATION_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const BASELINE_CAPABILITIES = [
  "commands.v1",
  "controller_leases.v1",
  "session_events.v2",
  "streams.v1",
] as const;

interface Client {
  readonly socket: WebSocket;
  readonly messages: Array<Record<string, unknown>>;
}

let temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    try { rmSync(directory, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function openClient(port: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`, { perMessageDeflate: false });
    const messages: Array<Record<string, unknown>> = [];
    socket.onmessage = (event) => {
      try { messages.push(JSON.parse(String(event.data)) as Record<string, unknown>); }
      catch { /* protocol errors are asserted by the caller when relevant */ }
    };
    socket.onerror = () => {
      socket.close();
      reject(new Error("WebSocket connection failed"));
    };
    socket.onopen = () => resolve({ socket, messages });
  });
}

async function nextMessage(
  client: Client,
  predicate: (message: Record<string, unknown>) => boolean,
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const index = client.messages.findIndex(predicate);
    if (index >= 0) return client.messages.splice(index, 1)[0]!;
    await Bun.sleep(5);
  }
  throw new Error("timed out waiting for WebSocket message");
}


async function closeClient(client: Client): Promise<void> {
  if (client.socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 1_000);
    client.socket.addEventListener("close", () => { clearTimeout(timer); resolve(); }, { once: true });
    client.socket.close();
  });
}

function envelope(
  type: string,
  payload: Record<string, unknown>,
  connectionId?: string,
  requestId = crypto.randomUUID(),
): Record<string, unknown> {
  return {
    protocol: { major: 1, minor: 0 },
    messageId: crypto.randomUUID(),
    requestId,
    ...(connectionId ? { connectionId } : {}),
    type,
    sentAt: new Date().toISOString(),
    payload,
  };
}

async function authenticate(client: Client, credential: string): Promise<string> {
  client.socket.send(JSON.stringify(envelope("hello", {
    mobileVersion: "0.0.3-alpha.1",
    platform: "android",
    installationId: INSTALLATION_ID,
    installationCredential: credential,
    requiredCapabilities: [...BASELINE_CAPABILITIES],
    optionalCapabilities: [],
  })));
  const accepted = await nextMessage(client, (message) => message.type === "hello.accepted");
  const payload = accepted.payload as { capabilities: string[]; connectionId: string };
  expect([...payload.capabilities].sort()).toEqual([...BASELINE_CAPABILITIES].sort());
  expect(payload.capabilities).toContain("session_events.v2");
  return payload.connectionId;
}

async function subscribe(client: Client, connectionId: string, afterSequence: number): Promise<Record<string, unknown>> {
  const requestId = crypto.randomUUID();
  client.socket.send(JSON.stringify(envelope("session.events.subscribe", {
    sessionId: SESSION_ID,
    afterSequence,
  }, connectionId, requestId)));
  return nextMessage(client, (message) => message.type === "session.events.replay.result" && message.requestId === requestId);
}

function replayEvents(message: Record<string, unknown>): Array<Record<string, unknown>> {
  return (message.payload as { events: Array<Record<string, unknown>> }).events;
}

describe("normal daemon production wiring: canonical session events", () => {

  test("auth, replay/live ordering, reconnect cursors, and durable restart replay", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-daemon-wiring-"));
    temporaryDirectories.push(root);
    const stateDir = join(root, "state");
    const ompSessionDir = join(root, "pi-sessions");
    const credential = generateInstallationCredential();
    let daemon: DaemonHandle | undefined;
    let client: Client | undefined;

    try {
      daemon = await runDaemon({
        workspace: root,
        ompExecutable: process.execPath,
        stateDir,
        ompSessionDir,
        bridgeVersion: "test",
      });
      daemon.store.upsertInstallationCredential({
        installationId: INSTALLATION_ID,
        credentialHash: hashCredential(credential),
        enrollmentSecretHash: hashCredential("test-enrollment", "enrollment"),
        enrollmentSource: "manual",
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
      });
      daemon.store.addSessionSummary(SESSION_ID, { name: "production wiring" });

      // The store and canonical transport below are the instances made by
      // runDaemon. Seed two events before the first mobile connection.
      daemon.canonicalSessionStore.append({
        sessionId: SESSION_ID,
        type: "turn.started",
        payload: { turnId: "turn-1" },
        eventId: "event-1",
        occurredAt: "2026-08-14T12:00:01.000Z",
      });
      daemon.canonicalSessionStore.append({
        sessionId: SESSION_ID,
        type: "assistant.completed",
        payload: { turnId: "turn-1", text: "first" },
        eventId: "event-2",
        occurredAt: "2026-08-14T12:00:02.000Z",
      });
      expect(daemon.canonicalSessionStore.readAfter(SESSION_ID, 0).map((event) => event.sequence)).toEqual([1, 2]);

      client = await openClient(daemon.server.port!);
      const connectionId = await authenticate(client, credential);
      const initialReplay = await subscribe(client, connectionId, 0);
      expect(replayEvents(initialReplay).map((event) => event.sequence)).toEqual([1, 2]);
      expect((initialReplay.payload as { latestSequence: number }).latestSequence).toBe(2);

      daemon.canonicalSessionStore.append({
        sessionId: SESSION_ID,
        type: "turn.settled",
        payload: { turnId: "turn-1" },
        eventId: "event-3",
        occurredAt: "2026-08-14T12:00:03.000Z",
      });
      const live = await nextMessage(client, (message) => message.type === "session.event");
      expect((live.payload as { eventId: string; sequence: number }).eventId).toBe("event-3");
      expect((live.payload as { sequence: number }).sequence).toBe(3);

      await closeClient(client);
      client = undefined;
      daemon.canonicalSessionStore.append({
        sessionId: SESSION_ID,
        type: "assistant.completed",
        payload: { turnId: "turn-2", text: "second" },
        eventId: "event-4",
        occurredAt: "2026-08-14T12:00:04.000Z",
      });

      // Reconnect from the last applied sequence. Only event-4 is replayed;
      // the already-delivered event-3 must not be duplicated.
      client = await openClient(daemon.server.port!);
      const reconnectId = await authenticate(client, credential);
      const reconnectReplay = await subscribe(client, reconnectId, 3);
      expect(replayEvents(reconnectReplay).map((event) => event.eventId)).toEqual(["event-4"]);
      expect(replayEvents(reconnectReplay).map((event) => event.sequence)).toEqual([4]);

      await closeClient(client);
      client = undefined;
      daemon.canonicalSessionStore.append({
        sessionId: SESSION_ID,
        type: "turn.started",
        payload: { turnId: "turn-2" },
        eventId: "event-5",
        occurredAt: "2026-08-14T12:00:05.000Z",
      });
      await daemon.close();
      daemon = undefined;

      // A fresh daemon creates a fresh transport over the same durable
      // SQLite state. Replaying after sequence 4 proves the canonical log,
      // not an in-memory runtime, is the restart authority.
      daemon = await runDaemon({
        workspace: root,
        ompExecutable: process.execPath,
        stateDir,
        ompSessionDir,
        bridgeVersion: "test",
      });
      client = await openClient(daemon.server.port!);
      const restartedId = await authenticate(client, credential);
      const restartReplay = await subscribe(client, restartedId, 4);
      expect(replayEvents(restartReplay).map((event) => event.eventId)).toEqual(["event-5"]);
      expect(replayEvents(restartReplay).map((event) => event.sequence)).toEqual([5]);
      expect(daemon.canonicalSessionStore.readAfter(SESSION_ID, 0).map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
      // The normal runDaemon wiring must not mirror canonical transcript
      // events into the legacy session stream or derive recipe.activity rows.
      const legacySessionEvents = daemon.store.listEvents(`session:${SESSION_ID}`);
      expect(legacySessionEvents.filter((event) => [
        "turn.started", "turn.settled", "assistant.completed", "tool.completed", "recipe.activity",
      ].includes(event.type))).toHaveLength(0);
    } finally {
      if (client) await closeClient(client);
      if (daemon) await daemon.close();
    }
  });
});
