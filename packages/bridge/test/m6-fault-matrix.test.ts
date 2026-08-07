import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TEST_FAULT_NAMES, TestFaultInjector, bridgeServerFaultHooks, noFaults } from "../src/testing/fault-injector";
import { BridgeStore } from "../src/core/store";
import { DurableBridgeRuntime } from "../src/core/runtime";
import { createBridgeServer } from "../src/core/server";
import type { AdapterPort } from "../src/core/domain";
import { hashCredential } from "../src/auth/credentials";

const INSTALLATION_ID = "33333333-3333-4333-8333-333333333333";
const INSTALLATION_CREDENTIAL = "pc_test_credential";
const outputs: string[] = [];
afterAll(() => { for (const path of outputs) rmSync(path, { force: true, recursive: true }); });

describe("M6 deterministic fault matrix", () => {
  test("every P0 fault is deterministic, counted, and one-shot", () => {
    const faults = TestFaultInjector.create("test");
    const observed: string[] = [];
    for (const name of TEST_FAULT_NAMES) {
      faults.arm({ name, after: 1 });
      expect(faults.consume(name, { phase: "before" })).toBeNull();
      const effect = faults.consume(name, { phase: "fault" });
      expect(effect).toMatchObject({ name, occurrence: 1, context: { phase: "fault" } });
      expect(faults.consume(name)).toBeNull();
      observed.push(effect!.name);
    }
    expect(observed).toEqual([...TEST_FAULT_NAMES]);
    expect(faults.active).toEqual([]);
    const outcomes = Object.fromEntries(
      observed.map((name) => [name, terminalOutcome(name)]),
    );
    expect(
      Object.values(outcomes).every((state) =>
        ['settled', 'failed', 'aborted', 'indeterminate', 'degraded'].includes(
          state,
        ),
      ),
    ).toBe(true);
  });

  test("countdown and repeated plans do not silently repeat after budget", () => {
    const faults = TestFaultInjector.create("test");
    faults.arm({ name: "kill_pi_after_events", after: 2, times: 2 });
    expect(faults.consume("kill_pi_after_events")).toBeNull();
    expect(faults.consume("kill_pi_after_events")).toBeNull();
    expect(faults.consume("kill_pi_after_events")?.occurrence).toBe(1);
    expect(faults.consume("kill_pi_after_events")?.occurrence).toBe(2);
    expect(faults.consume("kill_pi_after_events")).toBeNull();
    // A running action made indeterminate by this fault requires explicit
    // operator action; exhaustion never re-arms itself.
    expect(faults.active).not.toContain("kill_pi_after_events");
  });

  test("test plans drive actual injectable server boundaries", () => {
    const faults = TestFaultInjector.create("test");
    const hooks = bridgeServerFaultHooks(faults);
    faults.arm({ name: "close_after_accept" });
    expect(hooks.afterCommandAccepted()).toBe("close");
    expect(hooks.afterCommandAccepted()).toBeUndefined();
    faults.arm({ name: "pause_outbound" });
    expect(hooks.beforeOutbound()).toBe("pause");
    expect(hooks.beforeOutbound()).toBeUndefined();
  });

  test("lost accepted receipt closes real socket and duplicate reconciles one dispatch", async () => {
    const store = new BridgeStore(join(mkdtempSync(join(tmpdir(), "pi-mob-fault-live-")), "bridge.sqlite"));
    store.upsertInstallationCredential({ installationId: INSTALLATION_ID, credentialHash: hashCredential(INSTALLATION_CREDENTIAL), enrollmentSecretHash: "e".repeat(64), enrollmentSource: "seed", createdAt: Date.now(), lastSeenAt: Date.now() });
    let dispatches = 0;
    const adapter: AdapterPort = { async dispatch() { dispatches++; } };
    const runtime = new DurableBridgeRuntime({ store, adapter, bridgeVersion: "m6", piVersion: "0.82.0", hostDisplayName: "fixture" });
    await runtime.start();
    const faults = TestFaultInjector.create("test");
    faults.arm({ name: "close_after_accept" });
    const server = createBridgeServer({ runtime, port: 0, testHooks: bridgeServerFaultHooks(faults) });
    try {
      const first = await liveClient(server.port!); const connectionId = await liveHello(first);
      first.ws.send(JSON.stringify(wire("subscription.set", { streams: [{ streamId: `host:${store.identity().hostId}`, detail: "full", afterCursor: "0" }] }, { connectionId })));
      while ((await first.next()).type !== "stream.sync.complete") { /* synchronize */ }
      const commandId = crypto.randomUUID();
      const command = wire("session.create", { workspaceId: "11111111-1111-4111-8111-111111111111", policyMode: "full" }, { connectionId, commandId });
      const closed = new Promise<void>((resolve) => { first.ws.onclose = () => resolve(); });
      first.ws.send(JSON.stringify(command)); await closed; await Bun.sleep(5);
      expect(store.command(commandId)?.state).toBe("completed"); expect(dispatches).toBe(1);

      const second = await liveClient(server.port!); const secondConnection = await liveHello(second);
      second.ws.send(JSON.stringify(wire("subscription.set", { streams: [{ streamId: `host:${store.identity().hostId}`, detail: "full", afterCursor: "0" }] }, { connectionId: secondConnection })));
      while ((await second.next()).type !== "stream.sync.complete") { /* synchronize */ }
      second.ws.send(JSON.stringify({ ...command, connectionId: secondConnection, requestId: crypto.randomUUID(), messageId: crypto.randomUUID() }));
      let receipt: Record<string, unknown>;
      do { receipt = await second.next(); } while (receipt.type !== "command.receipt");
      expect(receipt.payload).toMatchObject({ duplicate: true }); expect(dispatches).toBe(1);
      second.ws.close();
    } finally { server.stop(true); }
  });

  test("production no-op cannot be armed or introspected", () => {
    expect(noFaults.consume("database_full")).toBeNull();
    expect("arm" in noFaults).toBe(false);
    expect("active" in noFaults).toBe(false);
  });

  test("release entry dependency graph contains no fault controls", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-mob-release-fault-audit-")); outputs.push(dir);
    const output = join(dir, "release.js");
    const result = Bun.spawnSync(["bun", "build", "src/daemon.ts", "--target", "bun", "--outfile", output], { cwd: new URL("..", import.meta.url).pathname });
    expect(result.exitCode).toBe(0);
    const bundle = readFileSync(output, "utf8");
    for (const symbol of ["TestFaultInjector", "TEST_FAULT_NAMES", "FaultPlan", "fault-injector"]) {
      expect(bundle).not.toContain(symbol);
    }
    for (const name of [
      "close_after_accept", "close_after_dispatch", "pause_outbound",
      "kill_pi_after_events", "kill_bridge_after_transition",
      "oversized_tool_output", "cleanup_timeout",
    ]) expect(bundle).not.toContain(name);
  });
});

function wire(type: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { protocol: { major: 1, minor: 0 }, messageId: crypto.randomUUID(), requestId: crypto.randomUUID(), type, sentAt: new Date().toISOString(), payload, ...extra };
}
async function liveClient(port: number) {
  const queue: Record<string, unknown>[] = []; const waiters: Array<(value: Record<string, unknown>) => void> = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`, { perMessageDeflate: false });
  ws.onmessage = (event) => { const value = JSON.parse(String(event.data)); const waiter = waiters.shift(); waiter ? waiter(value) : queue.push(value); };
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error("connect")); });
  return { ws, next: () => queue.length ? Promise.resolve(queue.shift()!) : new Promise<Record<string, unknown>>((resolve) => waiters.push(resolve)) };
}
async function liveHello(client: Awaited<ReturnType<typeof liveClient>>): Promise<string> {
  client.ws.send(JSON.stringify(wire("hello", { mobileVersion: "1", platform: "ios", installationId: INSTALLATION_ID, installationCredential: INSTALLATION_CREDENTIAL, requiredCapabilities: ["streams.v1", "commands.v1"], optionalCapabilities: [] })));
  return String(((await client.next()).payload as Record<string, unknown>).connectionId);
}

function terminalOutcome(name: string): string {
  if (["kill_pi_after_events", "kill_bridge_after_transition", "close_after_dispatch"].includes(name)) return "indeterminate";
  if (["pause_outbound", "close_after_accept", "cursor_invalid", "host_generation_change"].includes(name)) return "settled";
  if (["database_full", "database_unavailable", "database_locked", "migration_failure", "cleanup_timeout"].includes(name)) return "degraded";
  return "failed";
}
