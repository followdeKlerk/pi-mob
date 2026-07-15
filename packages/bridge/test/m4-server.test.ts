import { afterEach, describe, expect, test } from "bun:test";
import { createBridgeServer, exceedsSlowConsumerLimit, MAX_OUTBOUND_BYTES, type BridgeRuntimePort } from "../src/core/server";

const servers: Array<ReturnType<typeof createBridgeServer>> = [];
function runtime(ready = true): BridgeRuntimePort {
  return {
    bridgeVersion: "fixture", piVersion: "0.80.6",
    identity: () => ({ hostId: "11111111-1111-4111-8111-111111111111", hostGeneration: "1", hostDisplayName: "fixture" }),
    ready: () => ready ? { ready: true } : { ready: false, reason: "database unavailable" },
    subscribe: (_connection, payload) => ({ streams: (payload.streams as Array<Record<string,unknown>>).map((item) => ({ streamId: item.streamId, mode: "current" })) }),
    control: (_connection, type) => ({ type }), command: (_connection, message) => ({ state: "accepted", duplicate: false, commandId: message.commandId }),
  };
}
function start(port = runtime()): ReturnType<typeof createBridgeServer> { const server = createBridgeServer({ runtime: port, port: 0 }); servers.push(server); return server; }
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });
function connect(server: ReturnType<typeof createBridgeServer>): Promise<{ ws: WebSocket; messages: Array<Record<string,unknown>>; next: () => Promise<Record<string,unknown>> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/v1/ws`, { perMessageDeflate: false }); const messages: Array<Record<string,unknown>> = []; const waiters: Array<(value:Record<string,unknown>)=>void> = [];
    ws.onmessage = (event) => { const value = JSON.parse(String(event.data)) as Record<string,unknown>; const waiter = waiters.shift(); if (waiter) waiter(value); else messages.push(value); };
    ws.onerror = () => reject(new Error("websocket error"));
    ws.onopen = () => resolve({ ws, messages, next: () => messages.length > 0 ? Promise.resolve(messages.shift()!) : new Promise((done) => waiters.push(done)) });
  });
}
function hello(requestId = "22222222-2222-4222-8222-222222222222"): Record<string,unknown> { return { protocol: { major: 1, minor: 0 }, messageId: crypto.randomUUID(), requestId, type: "hello", sentAt: new Date().toISOString(), payload: { mobileVersion: "1", platform: "ios", installationId: "33333333-3333-4333-8333-333333333333", requiredCapabilities: ["streams.v1", "commands.v1"], optionalCapabilities: [] } }; }
function send(ws: WebSocket, value: Record<string,unknown>): void { ws.send(JSON.stringify(value)); }
function baseControl(type: string, connectionId: string, payload: Record<string,unknown>): Record<string,unknown> { return { protocol: { major:1,minor:0 }, messageId: crypto.randomUUID(), requestId: crypto.randomUUID(), connectionId, type, sentAt: new Date().toISOString(), payload }; }

describe("M4 loopback server", () => {
  test("serves health/readiness and refuses non-loopback", async () => {
    const server = start(runtime(false)); expect((await fetch(`http://127.0.0.1:${server.port}/healthz`)).status).toBe(200); expect((await fetch(`http://127.0.0.1:${server.port}/readyz`)).status).toBe(503);
    expect(() => createBridgeServer({ runtime: runtime(), hostname: "0.0.0.0" })).toThrow("loopback");
  });

  test("enforces hello, identity/capabilities, synchronization, and receipts", async () => {
    const server = start(); const client = await connect(server);
    send(client.ws, { ...hello(), type: "subscription.set" }); expect((await client.next()).type).toBe("error"); client.ws.close();
    const good = await connect(server); send(good.ws, hello()); const accepted = await good.next(); expect(accepted.type).toBe("hello.accepted");
    const connectionId = (accepted.payload as Record<string,unknown>).connectionId as string;
    const command = { protocol: { major: 1, minor: 0 }, messageId: crypto.randomUUID(), requestId: crypto.randomUUID(), connectionId, commandId: crypto.randomUUID(), leaseId: crypto.randomUUID(), type: "session.rename", sentAt: new Date().toISOString(), payload: { sessionId: "55555555-5555-4555-8555-555555555555", name: "n" } };
    send(good.ws, command); expect(((await good.next()).payload as Record<string,unknown>).code).toBe("host_not_ready");
    send(good.ws, { ...command, commandId: undefined, type: "subscription.set", payload: { streams: [{ streamId: "host:11111111-1111-4111-8111-111111111111", detail: "full" }] } }); expect((await good.next()).type).toBe("subscription.accepted");
    send(good.ws, command); expect((await good.next()).type).toBe("command.receipt"); good.ws.close();
  });

  test("opens command admission before the final sync-complete frame is observable", async () => {
    const hostStream = "host:11111111-1111-4111-8111-111111111111";
    const special: BridgeRuntimePort = {
      ...runtime(),
      subscribe: () => ({
        streams: [{ streamId: hostStream, mode: "current" }],
        messages: [{
          type: "stream.sync.complete",
          payload: { streamId: hostStream, currentCursor: "0", mode: "current" },
        }],
      }),
    };
    const server = start(special); const client = await connect(server);
    send(client.ws, hello()); const accepted = await client.next(); const connectionId = (accepted.payload as Record<string,unknown>).connectionId as string;
    send(client.ws, baseControl("subscription.set", connectionId, { streams: [{ streamId: hostStream, detail: "full" }] }));
    expect((await client.next()).type).toBe("subscription.accepted");
    expect((await client.next()).type).toBe("stream.sync.complete");
    const command = { protocol: { major: 1, minor: 0 }, messageId: crypto.randomUUID(), requestId: crypto.randomUUID(), connectionId, commandId: crypto.randomUUID(), leaseId: crypto.randomUUID(), type: "session.rename", sentAt: new Date().toISOString(), payload: { sessionId: "55555555-5555-4555-8555-555555555555", name: "n" } };
    send(client.ws, command);
    expect((await client.next()).type).toBe("command.receipt");
    client.ws.close();
  });

  test("rejects major/host/capability mismatch and rate limits controls", async () => {
    for (const mutation of [
      (value: any) => { value.protocol.major = 2; },
      (value: any) => { value.payload.expectedHostId = "44444444-4444-4444-8444-444444444444"; },
      (value: any) => { value.payload.requiredCapabilities = ["future.required"]; },
    ]) {
      const client = await connect(start()); const value = hello() as any; mutation(value); send(client.ws, value); expect((await client.next()).type).toBe("error"); client.ws.close();
    }
    const server = start(); const client = await connect(server); send(client.ws, hello()); const accepted = await client.next(); const connectionId = (accepted.payload as Record<string,unknown>).connectionId as string;
    send(client.ws, baseControl("subscription.set", connectionId, { streams: [{ streamId: "host:11111111-1111-4111-8111-111111111111", detail: "full", afterCursor: "01" }] }));
    expect(((await client.next()).payload as Record<string,unknown>).code).toBe("cursor_invalid");
    for (let index = 0; index < 22; index += 1) send(client.ws, baseControl("command.current", connectionId, { commandId: crypto.randomUUID() }));
    const replies = await Promise.all(Array.from({ length: 22 }, () => client.next())); expect(replies.some((reply) => (reply.payload as Record<string,unknown>).code === "rate_limited")).toBe(true); client.ws.close();
  });

  test("buffers live events behind replay and filters summary delivery", async () => {
    let emit: ((event: { eventId:string;streamId:string;cursor:string;type:string;payload:Record<string,unknown> }) => void) | undefined;
    const hostStream = "host:11111111-1111-4111-8111-111111111111";
    const special: BridgeRuntimePort = {
      ...runtime(),
      onEvent(listener) { emit = listener; return () => { emit = undefined; }; },
      async subscribe() {
        emit?.({ eventId:"live-2",streamId:hostStream,cursor:"2",type:"command.state",payload:{state:"running"} });
        await Bun.sleep(2);
        return { streams:[{streamId:hostStream,mode:"replay"}], messages:[
          { type:"command.state",payload:{state:"accepted"},eventId:"replay-1",streamId:hostStream,cursor:"1" },
          { type:"stream.sync.complete",payload:{streamId:hostStream,currentCursor:"1",mode:"replay"} },
        ] };
      },
    };
    const server = start(special); const client = await connect(server); send(client.ws, hello()); const accepted = await client.next(); const connectionId = (accepted.payload as Record<string,unknown>).connectionId as string;
    send(client.ws, baseControl("subscription.set", connectionId, { streams:[{streamId:hostStream,detail:"summary",afterCursor:"0"}] }));
    const ordered = [await client.next(), await client.next(), await client.next(), await client.next()];
    expect(ordered.map((message) => message.type)).toEqual(["subscription.accepted","command.state","stream.sync.complete","command.state"]);
    expect((ordered[3]!.payload as Record<string,unknown>).state).toBe("running");
    emit?.({eventId:"hidden",streamId:hostStream,cursor:"3",type:"assistant.delta",payload:{text:"private"}});
    emit?.({eventId:"visible",streamId:hostStream,cursor:"4",type:"command.state",payload:{state:"completed"}});
    await Bun.sleep(5); expect(client.messages.some((message) => message.eventId === "hidden")).toBe(false); expect(client.messages.some((message) => message.eventId === "visible")).toBe(true); client.ws.close();
  });

  test("closes binary, oversized, and a genuinely blocked slow consumer", async () => {
    expect(exceedsSlowConsumerLimit(MAX_OUTBOUND_BYTES - 10, 11)).toBe(true);
    expect(exceedsSlowConsumerLimit(MAX_OUTBOUND_BYTES - 10, 10)).toBe(false);
    const server = start(); const binary = await connect(server); binary.ws.send(new Uint8Array([1,2,3])); expect((await binary.next()).type).toBe("error");
    const oversized = await connect(server); const closed = new Promise<number>((resolve) => { oversized.ws.onclose = (event) => resolve(event.code); }); oversized.ws.send("x".repeat(1_048_577)); expect(await closed).toBeGreaterThan(0);

    let upgraded = false;
    const slow = await Bun.connect({ hostname: "127.0.0.1", port: server.port!, socket: {
      open(socket) { socket.write(`GET /v1/ws HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`); },
      data(socket, data) { if (!upgraded && data.toString().includes("101 Switching Protocols")) { upgraded = true; socket.pause(); } },
    } });
    for (let attempt = 0; !upgraded && attempt < 100; attempt += 1) await Bun.sleep(2);
    expect(upgraded).toBe(true); expect(server.connectionCount()).toBeGreaterThan(0);
    const payload = { type: "fixture.event", payload: { text: "x".repeat(900_000) } };
    for (let index = 0; index < 30 && server.connectionCount() > 0; index += 1) server.broadcastProtocol(payload);
    for (let attempt = 0; server.connectionCount() > 0 && attempt < 100; attempt += 1) await Bun.sleep(2);
    expect(server.connectionCount()).toBe(0); slow.end();
  });
});
