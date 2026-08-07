import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBridgeServer } from "../src/core/server";
import { DurableBridgeRuntime } from "../src/core/runtime";
import { BridgeStore } from "../src/core/store";
import type { AdapterPort } from "../src/core/domain";

const INSTALLATION_CREDENTIAL = "pc_test_credential";
interface Client { ws: WebSocket; next(): Promise<Record<string,unknown>>; }
async function connect(port: number): Promise<Client> {
  const queue: Array<Record<string,unknown>> = []; const waiters: Array<(value:Record<string,unknown>)=>void> = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`, { perMessageDeflate: false });
  ws.onmessage = (event) => { const value = JSON.parse(String(event.data)) as Record<string,unknown>; const waiter = waiters.shift(); if (waiter) waiter(value); else queue.push(value); };
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error("connect failed")); });
  return { ws, next: () => queue.length ? Promise.resolve(queue.shift()!) : new Promise((resolve) => waiters.push(resolve)) };
}
function send(client: Client, value: Record<string,unknown>): void { client.ws.send(JSON.stringify(value)); }
function base(type: string, payload: Record<string,unknown>, extra: Record<string,unknown> = {}): Record<string,unknown> { return { protocol:{major:1,minor:0},messageId:crypto.randomUUID(),requestId:crypto.randomUUID(),type,sentAt:new Date().toISOString(),payload,...extra }; }
async function hello(client: Client): Promise<{ connectionId: string; hostId: string }> {
  send(client, base("hello", { mobileVersion:"1",platform:"ios",installationId:"33333333-3333-4333-8333-333333333333",installationCredential:INSTALLATION_CREDENTIAL,requiredCapabilities:["streams.v1","commands.v1"],optionalCapabilities:[] }));
  const response = await client.next(); const payload = response.payload as Record<string,unknown>; return { connectionId: payload.connectionId as string, hostId: payload.hostId as string };
}
async function subscribe(client: Client, connectionId: string, hostId: string, afterCursor?: string): Promise<Record<string,unknown>[]> {
  send(client, base("subscription.set", { streams:[{streamId:`host:${hostId}`,detail:"full",...(afterCursor === undefined ? {} : {afterCursor})}] }, { connectionId }));
  const seen: Record<string,unknown>[] = [];
  while (true) { const message = await client.next(); seen.push(message); if (message.type === "stream.sync.complete") return seen; }
}

test("M4 checkpoint: lost receipt resends once and replays across restart", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "pi-mob-m4-demo-")), "bridge.sqlite"); let dispatches = 0;
  const adapter: AdapterPort = { async dispatch() { dispatches += 1; await Bun.sleep(5); } };
  let store = new BridgeStore(path); store.upsertInstallationCredential({ installationId:"33333333-3333-4333-8333-333333333333",credentialHash:new Bun.CryptoHasher("sha256").update(INSTALLATION_CREDENTIAL).digest("hex"),enrollmentSecretHash:"e".repeat(64),enrollmentSource:"seed",createdAt:Date.now(),lastSeenAt:Date.now() }); let runtime = new DurableBridgeRuntime({ store, adapter, bridgeVersion:"fixture",piVersion:"0.82.0",hostDisplayName:"fixture" });
  await runtime.start();
  let server = createBridgeServer({ runtime, port:0 });
  const first = await connect(server.port!); const identity = await hello(first); await subscribe(first, identity.connectionId, identity.hostId);
  const commandId = crypto.randomUUID(); const command = base("session.create", { workspaceId:"44444444-4444-4444-8444-444444444444",policyMode:"full" }, { connectionId:identity.connectionId,commandId });
  send(first, command); first.ws.close();
  for (let attempts=0; dispatches===0 && attempts<100; attempts+=1) await Bun.sleep(2);
  expect(dispatches).toBe(1); await Bun.sleep(20); server.stop(true); store.close();

  store = new BridgeStore(path); runtime = new DurableBridgeRuntime({ store, adapter, bridgeVersion:"fixture",piVersion:"0.82.0",hostDisplayName:"fixture" }); await runtime.start(); server = createBridgeServer({ runtime,port:0 });
  const second = await connect(server.port!); const identity2 = await hello(second); const replay = await subscribe(second, identity2.connectionId, identity2.hostId, "0");
  expect(replay.filter((message) => message.type === "command.state").length).toBeGreaterThanOrEqual(2);
  send(second, { ...command, messageId:crypto.randomUUID(),requestId:crypto.randomUUID(),connectionId:identity2.connectionId });
  const receipt = await second.next(); expect(receipt.type).toBe("command.receipt"); expect((receipt.payload as Record<string,unknown>).duplicate).toBe(true);
  await Bun.sleep(10); expect(dispatches).toBe(1);
  const liveId = crypto.randomUUID(); send(second, { ...command, messageId:crypto.randomUUID(),requestId:crypto.randomUUID(),commandId:liveId,connectionId:identity2.connectionId });
  const live: Record<string,unknown>[] = [];
  while (!live.some((message) => message.type === "command.state" && (message.payload as Record<string,unknown>).state === "completed")) live.push(await second.next());
  const states = live.filter((message) => message.type === "command.state").map((message) => (message.payload as Record<string,unknown>).state);
  expect(states).toEqual(["accepted", "dispatched", "running", "completed"]); expect(dispatches).toBe(2);
  second.ws.close(); server.stop(true); store.close();
}, 20_000);
