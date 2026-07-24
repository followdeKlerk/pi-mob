import { createHash } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BridgeStore } from "../src/core/store";
import { DurableBridgeRuntime } from "../src/core/runtime";
import { createBridgeServer, type BridgeServer } from "../src/core/server";
import { OneSessionPiAdapter, type PiRpcNotificationHandler, type PiRpcRequestOptions } from "../src/pi/one-session-adapter";

class FakeStreamingRpc {
  requests = 0;
  private readonly handlers = new Set<PiRpcNotificationHandler>();
  async request(_options: PiRpcRequestOptions): Promise<unknown> { this.requests++; return {}; }
  on(_kind: "notification", handler: PiRpcNotificationHandler): () => void {
    this.handlers.add(handler); return () => this.handlers.delete(handler);
  }
  emit(value: Record<string, unknown>): void { for (const handler of this.handlers) handler(value); }
}

const servers: BridgeServer[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });

function websocketClientFrame(value: Record<string, unknown>): Uint8Array {
  const payload = Buffer.from(JSON.stringify(value));
  const lengthBytes = payload.length < 126 ? 0 : payload.length <= 0xffff ? 2 : 8;
  const header = Buffer.alloc(2 + lengthBytes + 4);
  header[0] = 0x81;
  if (lengthBytes === 0) header[1] = 0x80 | payload.length;
  else if (lengthBytes === 2) { header[1] = 0x80 | 126; header.writeUInt16BE(payload.length, 2); }
  else { header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
  const maskOffset = 2 + lengthBytes;
  const mask = Buffer.from([1, 2, 3, 4]); mask.copy(header, maskOffset);
  const body = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index++) body[index] = payload[index]! ^ mask[index % 4]!;
  return Buffer.concat([header, body]);
}

function readServerFrames(buffer: Buffer): { values: Record<string, unknown>[]; rest: Buffer } {
  const values: Record<string, unknown>[] = []; let offset = 0;
  while (buffer.length - offset >= 2) {
    const second = buffer[offset + 1]!; let length = second & 0x7f; let header = 2;
    if (length === 126) { if (buffer.length - offset < 4) break; length = buffer.readUInt16BE(offset + 2); header = 4; }
    else if (length === 127) { if (buffer.length - offset < 10) break; length = Number(buffer.readBigUInt64BE(offset + 2)); header = 10; }
    if (buffer.length - offset < header + length) break;
    const opcode = buffer[offset]! & 0x0f;
    if (opcode === 1) values.push(JSON.parse(buffer.subarray(offset + header, offset + header + length).toString()));
    offset += header + length;
  }
  return { values, rest: buffer.subarray(offset) };
}

function envelope(type: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { protocol: { major: 1, minor: 0 }, messageId: crypto.randomUUID(), requestId: crypto.randomUUID(), type, sentAt: new Date().toISOString(), payload, ...extra };
}
async function client(server: BridgeServer) {
  const queue: Record<string, unknown>[] = []; const waiters: Array<(value: Record<string, unknown>) => void> = [];
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/v1/ws`, { perMessageDeflate: false });
  ws.onmessage = (event) => { const value = JSON.parse(String(event.data)); const waiter = waiters.shift(); waiter ? waiter(value) : queue.push(value); };
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error("connect")); });
  return { ws, next: () => queue.length ? Promise.resolve(queue.shift()!) : new Promise<Record<string, unknown>>((resolve) => waiters.push(resolve)) };
}

describe("M6 slow-consumer continuation and replay", () => {
  test("blocked consumer is dropped while producer settles; replay is identical and dispatch stays once", async () => {
    const store = new BridgeStore(join(mkdtempSync(join(tmpdir(), "pi-mob-m6-slow-")), "bridge.sqlite"));
    const identity = store.identity(); const hostStream = `host:${identity.hostId}`;
    const sessionId = "11111111-1111-4111-8111-111111111111"; const sessionStream = `session:${sessionId}`;
    store.ensureStream(hostStream, "host"); store.ensureSession(sessionId, { sessionId, runtimeState: "idle" }); store.ensureStream(sessionStream, "session", sessionId);
    const rpc = new FakeStreamingRpc();
    const adapter = new OneSessionPiAdapter({
      store, rpc,
      workspace: { workspaceId: "77777777-7777-4777-8777-777777777777", rootPath: "/private/fixture", displayName: "fixture", fingerprint: "fixture", policyMode: "full" },
    });
    const runtime = new DurableBridgeRuntime({ store, adapter, bridgeVersion: "m6", piVersion: "0.82.0", hostDisplayName: "fixture" });
    await runtime.start(); let server = createBridgeServer({ runtime, port: 0, outboundBackpressureLimit: 1_000_000 }); servers.push(server);

    const submission = runtime.commands.submit({ commandId: "22222222-2222-4222-8222-222222222222", type: "prompt.submit", payload: { sessionId, deliveryMode: "immediate", message: "once", attachmentIds: [] }, scopeKey: sessionStream, streamId: sessionStream });
    await submission.completion; expect(rpc.requests).toBe(1);

    let upgraded = false; let subscribed = false; let bytes: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    const slow = await Bun.connect({ hostname: "127.0.0.1", port: server.port!, socket: {
      open(socket) { socket.write(`GET /v1/ws HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`); },
      data(socket, data) {
        bytes = Buffer.concat([bytes, Buffer.from(data)]);
        if (!upgraded) {
          const marker = bytes.indexOf("\r\n\r\n"); if (marker < 0) return;
          upgraded = true; bytes = bytes.subarray(marker + 4);
          socket.write(websocketClientFrame(envelope("hello", { mobileVersion: "1", platform: "ios", installationId: "66666666-6666-4666-8666-666666666666", requiredCapabilities: ["streams.v1", "commands.v1"], optionalCapabilities: [] })));
        }
        const parsed = readServerFrames(bytes); bytes = parsed.rest;
        for (const message of parsed.values) {
          if (message.type === "hello.accepted") {
            const connectionId = (message.payload as Record<string, unknown>).connectionId;
            socket.write(websocketClientFrame(envelope("subscription.set", { streams: [{ streamId: hostStream, detail: "full", afterCursor: "0" }, { streamId: sessionStream, detail: "full", afterCursor: "0" }] }, { connectionId })));
          }
          if (message.type === "stream.sync.complete" && (message.payload as Record<string, unknown>).streamId === sessionStream) {
            subscribed = true; socket.pause();
          }
        }
      },
    } });
    for (let n = 0; !subscribed && n < 200; n++) await Bun.sleep(2);
    expect(upgraded).toBe(true); expect(subscribed).toBe(true);

    for (let index = 0; index < 30 && server.connectionCount() > 0; index++) {
      rpc.emit({ type: "message_update", sessionId, assistantMessageEvent: { type: "text_delta", delta: `${index}:${"x".repeat(500_000)}` } });
    }
    for (let n = 0; server.connectionCount() > 0 && n < 100; n++) await Bun.sleep(2);
    expect(server.connectionCount()).toBe(0);
    slow.end();
    rpc.emit({ type: "agent_settled", sessionId });
    server.stop(true);
    servers.splice(servers.indexOf(server), 1);
    await Bun.sleep(5);
    server = createBridgeServer({ runtime, port: 0, outboundBackpressureLimit: 64 * 1024 * 1024 });
    servers.push(server);
    const expected = store.listEvents(sessionStream);
    const expectedDigest = createHash("sha256").update(JSON.stringify(expected.map((event) => [event.cursor, event.type, event.payload]))).digest("hex");

    const replay = await client(server);
    replay.ws.send(JSON.stringify(envelope("hello", { mobileVersion: "1", platform: "ios", installationId: "33333333-3333-4333-8333-333333333333", requiredCapabilities: ["streams.v1", "commands.v1"], optionalCapabilities: [] })));
    const hello = await replay.next(); const connectionId = (hello.payload as Record<string, unknown>).connectionId as string;
    replay.ws.send(JSON.stringify(envelope("subscription.set", { streams: [{ streamId: hostStream, detail: "full", afterCursor: "0" }, { streamId: sessionStream, detail: "full", afterCursor: "0" }] }, { connectionId })));
    const replayed: Array<[string, string, Record<string, unknown>]> = [];
    let finalCursor = "0";
    while (true) {
      const message = await replay.next();
      if (message.streamId === sessionStream && typeof message.cursor === "string") replayed.push([message.cursor, String(message.type), message.payload as Record<string, unknown>]);
      if (message.type === "stream.sync.complete" && (message.payload as Record<string, unknown>).streamId === sessionStream) { finalCursor = String((message.payload as Record<string, unknown>).currentCursor); break; }
    }
    const actualDigest = createHash("sha256").update(JSON.stringify(replayed)).digest("hex");
    expect(finalCursor).toBe(expected.at(-1)!.cursor);
    expect(actualDigest).toBe(expectedDigest);
    expect(replayed.filter(([, type]) => type !== "pi.rpc.event").at(-1)?.[1]).toBe("turn.settled");
    expect(rpc.requests).toBe(1);
    await new Promise<void>((resolve) => {
      replay.ws.onclose = () => resolve();
      replay.ws.close();
    });
    adapter.close();
    // Server teardown owns the final connection callbacks; the temporary
    // database is process-scoped for this integration proof.
  }, 20_000);
});
