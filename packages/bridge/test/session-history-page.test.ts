import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableBridgeRuntime } from "../src/core/runtime";
import { createBridgeServer } from "../src/core/server";
import { BridgeStore } from "../src/core/store";
import type { AdapterPort } from "../src/core/domain";
import { hashCredential } from "../src/auth/credentials";

const INSTALLATION_CREDENTIAL = "pc_test_credential";
const SESSION_ID = "55555555-5555-4555-8555-555555555555";
const UNKNOWN_SESSION_ID = "66666666-6666-4666-8666-666666666666";
const INSTALLATION_ID = "33333333-3333-4333-8333-333333333333";
const servers: Array<ReturnType<typeof createBridgeServer>> = [];
const stores: BridgeStore[] = [];

interface Client {
  readonly ws: WebSocket;
  next(): Promise<Record<string, unknown>>;
}

function start(): { store: BridgeStore; server: ReturnType<typeof createBridgeServer> } {
  const path = join(mkdtempSync(join(tmpdir(), "pi-mob-history-page-")), "bridge.sqlite");
  const store = new BridgeStore(path);
  store.ensureSession(SESSION_ID, { runtimeState: "idle" });
  store.ensureStream(`session:${SESSION_ID}`, "session", SESSION_ID);
  store.upsertInstallationCredential({ installationId: INSTALLATION_ID, credentialHash: hashCredential(INSTALLATION_CREDENTIAL), enrollmentSecretHash: "e".repeat(64), enrollmentSource: "seed", createdAt: Date.now(), lastSeenAt: Date.now() });
  const adapter: AdapterPort = { async dispatch() {} };
  const runtime = new DurableBridgeRuntime({
    store,
    adapter,
    bridgeVersion: "fixture",
    piVersion: "0.82.0",
    hostDisplayName: "fixture",
  });
  runtime.setReadyForTest(true);
  const server = createBridgeServer({ runtime, port: 0 });
  stores.push(store);
  servers.push(server);
  return { store, server };
}

async function connect(server: ReturnType<typeof createBridgeServer>): Promise<{ client: Client; connectionId: string }> {
  const queue: Array<Record<string, unknown>> = [];
  const waiters: Array<(value: Record<string, unknown>) => void> = [];
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/v1/ws`, { perMessageDeflate: false });
  ws.onmessage = (event) => {
    const value = JSON.parse(String(event.data)) as Record<string, unknown>;
    const waiter = waiters.shift();
    if (waiter) waiter(value); else queue.push(value);
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("websocket connection failed"));
  });
  const client: Client = {
    ws,
    next: () => queue.length > 0 ? Promise.resolve(queue.shift()!) : new Promise((resolve) => waiters.push(resolve)),
  };
  send(client, envelope("hello", {
    mobileVersion: "1",
    platform: "ios",
    installationId: INSTALLATION_ID,
    installationCredential: INSTALLATION_CREDENTIAL,
    requiredCapabilities: ["streams.v1", "commands.v1"],
    optionalCapabilities: [],
  }));
  const hello = await client.next();
  expect(hello.type).toBe("hello.accepted");
  return { client, connectionId: (hello.payload as Record<string, unknown>).connectionId as string };
}

function envelope(type: string, payload: Record<string, unknown>, connectionId?: string): Record<string, unknown> {
  return {
    protocol: { major: 1, minor: 0 },
    messageId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    ...(connectionId ? { connectionId } : {}),
    type,
    sentAt: new Date().toISOString(),
    payload,
  };
}

function send(client: Client, value: Record<string, unknown>): void {
  client.ws.send(JSON.stringify(value));
}

async function history(
  client: Client,
  connectionId: string,
  input: { sessionId?: string; pageSize: number; pageToken: string | null },
): Promise<Record<string, unknown>> {
  send(client, envelope("session.history.page", {
    sessionId: input.sessionId ?? SESSION_ID,
    pageSize: input.pageSize,
    pageToken: input.pageToken,
  }, connectionId));
  return client.next();
}

function payloadOf(message: Record<string, unknown>): Record<string, unknown> {
  return message.payload as Record<string, unknown>;
}

function itemsOf(message: Record<string, unknown>): Array<Record<string, unknown>> {
  return payloadOf(message).items as Array<Record<string, unknown>>;
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const store of stores.splice(0)) store.close();
});

describe("session.history.page durable bridge integration", () => {
  test("returns 100/100/50 newest-first pages in canonical order with stable IDs", async () => {
    const { store, server } = start();
    for (let index = 1; index <= 250; index += 1) {
      store.appendEvent(`session:${SESSION_ID}`, "assistant.delta", { index }, `event-${index}`);
    }
    const { client, connectionId } = await connect(server);

    const first = await history(client, connectionId, { pageSize: 100, pageToken: null });
    expect(first.type).toBe("session.history.page.result");
    expect(payloadOf(first).snapshotRevision).toBe("250");
    expect(itemsOf(first).map((item) => item.cursor)).toEqual(Array.from({ length: 100 }, (_, index) => String(index + 151)));
    expect(itemsOf(first).map((item) => item.eventId)).toEqual(Array.from({ length: 100 }, (_, index) => `event-${index + 151}`));
    const firstToken = payloadOf(first).nextPageToken as string;
    expect(firstToken.length).toBeGreaterThan(20);

    const second = await history(client, connectionId, { pageSize: 100, pageToken: firstToken });
    expect(itemsOf(second).map((item) => item.cursor)).toEqual(Array.from({ length: 100 }, (_, index) => String(index + 51)));
    const secondToken = payloadOf(second).nextPageToken as string;

    const third = await history(client, connectionId, { pageSize: 100, pageToken: secondToken });
    expect(itemsOf(third).map((item) => item.cursor)).toEqual(Array.from({ length: 50 }, (_, index) => String(index + 1)));
    expect(payloadOf(third).nextPageToken).toBeUndefined();
    client.ws.close();
  });

  test("rejects token tampering, page-size rebinding, and an unknown session", async () => {
    const { store, server } = start();
    for (let index = 1; index <= 101; index += 1) store.appendEvent(`session:${SESSION_ID}`, "assistant.delta", { index }, `event-${index}`);
    const { client, connectionId } = await connect(server);
    const first = await history(client, connectionId, { pageSize: 100, pageToken: null });
    const token = payloadOf(first).nextPageToken as string;
    const replacement = token.endsWith("a") ? "b" : "a";

    const tampered = await history(client, connectionId, { pageSize: 100, pageToken: `${token.slice(0, -1)}${replacement}` });
    expect(tampered.type).toBe("error");
    expect(payloadOf(tampered).code).toBe("invalid_message");

    const rebound = await history(client, connectionId, { pageSize: 99, pageToken: token });
    expect(rebound.type).toBe("error");
    expect(payloadOf(rebound).code).toBe("invalid_message");

    const unknown = await history(client, connectionId, { sessionId: UNKNOWN_SESSION_ID, pageSize: 100, pageToken: null });
    expect(unknown.type).toBe("error");
    expect(payloadOf(unknown).code).toBe("session_not_found");
    client.ws.close();
  });

  test("bumps snapshotRevision after a journal append", async () => {
    const { store, server } = start();
    store.appendEvent(`session:${SESSION_ID}`, "assistant.delta", { index: 1 }, "event-1");
    const { client, connectionId } = await connect(server);
    const first = await history(client, connectionId, { pageSize: 100, pageToken: null });
    expect(payloadOf(first).snapshotRevision).toBe("1");

    store.appendEvent(`session:${SESSION_ID}`, "assistant.delta", { index: 2 }, "event-2");
    const refreshed = await history(client, connectionId, { pageSize: 100, pageToken: null });
    expect(payloadOf(refreshed).snapshotRevision).toBe("2");
    expect(itemsOf(refreshed).map((item) => item.eventId)).toEqual(["event-1", "event-2"]);
    client.ws.close();
  });
});
