import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BridgeStore } from "../src/core/store";
import { DurableBridgeRuntime } from "../src/core/runtime";
import type { AdapterPort } from "../src/core/domain";

describe("M6 host drain admission", () => {
  test("rejects new mutation before durable acceptance while allowing existing duplicate lookup", async () => {
    const store = new BridgeStore(join(mkdtempSync(join(tmpdir(), "pi-mob-drain-")), "bridge.sqlite"));
    const sessionId = "11111111-1111-4111-8111-111111111111";
    store.ensureSession(sessionId, { sessionId }); store.ensureStream(`session:${sessionId}`, "session", sessionId);
    let draining = false; let dispatches = 0;
    const adapter: AdapterPort = {
      async dispatch() { dispatches++; },
      admission: () => draining ? { accepting: false, reason: "host_draining" } : { accepting: true },
    };
    const runtime = new DurableBridgeRuntime({ store, adapter, bridgeVersion: "m6", piVersion: "0.82.0", hostDisplayName: "host" });
    await runtime.start();
    const connection = { connectionId: "connection", installationId: "installation", subscriptions: new Set<string>() };
    const command = { type: "session.create", commandId: "22222222-2222-4222-8222-222222222222", payload: { workspaceId: "33333333-3333-4333-8333-333333333333", policyMode: "full" } };
    runtime.command(connection, command); await Bun.sleep(5); expect(dispatches).toBe(1);
    draining = true;
    expect(runtime.command(connection, command)).toMatchObject({ duplicate: true });
    const blockedId = "44444444-4444-4444-8444-444444444444";
    expect(() => runtime.command(connection, { ...command, commandId: blockedId })).toThrow("host is not accepting");
    expect(store.command(blockedId)).toBeNull();

    draining = false;
    store.updateSessionState(sessionId, { sessionId, runtimeState: "indeterminate" });
    const promptId = "55555555-5555-4555-8555-555555555555";
    expect(() => runtime.command(connection, {
      type: "prompt.submit", commandId: promptId, leaseId: "unused",
      payload: { sessionId, deliveryMode: "immediate", message: "must not repeat", attachmentIds: [] },
    })).toThrow("indeterminate session requires explicit activation");
    expect(store.command(promptId)).toBeNull();
    store.close();
  });
});
