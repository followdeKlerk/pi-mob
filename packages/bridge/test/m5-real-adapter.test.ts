import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BridgeStore } from "../src/core/store";
import { OneSessionPiAdapter } from "../src/pi/one-session-adapter";
import { RpcProcess } from "../src/pi/rpc-process";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";

function command(id: string, type: string, streamId: string, payload: Record<string, unknown>): import("../src/core/store").StoredCommand {
  return { commandId: id, type, scopeKey: streamId, streamId, semanticHash: id, payload, state: "accepted", dispatchCount: 0 };
}

describe("M5 real Pi adapter proof", () => {
  test("real prompt normalizes to an ordered settled session and abort RPC works", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-m5-real-"));
    const home = join(root, "home"); const sessions = join(root, "sessions");
    mkdirSync(home); mkdirSync(sessions); writeFileSync(join(root, "contract-input.txt"), "fixture input\n");
    const rpc = new RpcProcess({
      executable: new URL("../node_modules/.bin/pi", import.meta.url).pathname,
      args: ["--mode", "rpc", "--no-extensions", "--extension", new URL("./fixtures/contract-provider.ts", import.meta.url).pathname, "--session-dir", sessions, "--provider", "pi-mob-fixture", "--model", "contract"],
      cwd: root, environment: { HOME: home, LANG: "C.UTF-8" },
      pathDirs: ["/usr/local/bin", "/usr/bin", "/bin"], defaultRequestTimeoutMs: 10_000, closeGracePeriodMs: 1_000,
    });
    const store = new BridgeStore(join(root, "bridge.sqlite"));
    store.ensureStream(`host:${store.identity().hostId}`, "host");
    const adapter = new OneSessionPiAdapter({
      store, rpc,
      workspace: { workspaceId, rootPath: root, displayName: "fixture", fingerprint: "fixture", policyMode: "full" },
      newSessionId: () => sessionId,
    });
    try {
      await rpc.start();
      await adapter.dispatch(command("33333333-3333-4333-8333-333333333333", "session.create", `host:${store.identity().hostId}`, { workspaceId, policyMode: "full" }));
      await adapter.dispatch(command("44444444-4444-4444-8444-444444444444", "prompt.submit", `session:${sessionId}`, { sessionId, deliveryMode: "immediate", message: "run deterministic contract", attachmentIds: [] }));
      const deadline = Date.now() + 10_000;
      while (!store.listEvents(`session:${sessionId}`).some((event) => event.type === "turn.settled")) {
        if (Date.now() > deadline) throw new Error("real Pi prompt did not settle through adapter");
        await Bun.sleep(10);
      }
      const events = store.listEvents(`session:${sessionId}`);
      expect(events.some((event) => event.type === "tool.started")).toBe(true);
      expect(events.some((event) => event.type === "tool.completed")).toBe(true);
      expect(events.at(-1)?.type).toBe("turn.settled");
      expect(events.map((event) => event.cursor)).toEqual(events.map((_, index) => String(index + 1)));

      await expect(adapter.dispatch(command("55555555-5555-4555-8555-555555555555", "turn.abort", `session:${sessionId}`, { sessionId }))).resolves.toBeUndefined();
    } finally {
      adapter.close(); await rpc.close(); store.close();
    }
  }, 20_000);

  test("aborts an active real Pi turn and journals the aborted boundary", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-m5-abort-"));
    const home = join(root, "home"); const sessions = join(root, "sessions");
    mkdirSync(home); mkdirSync(sessions);
    const rpc = new RpcProcess({
      executable: new URL("../node_modules/.bin/pi", import.meta.url).pathname,
      args: ["--mode", "rpc", "--no-extensions", "--extension", new URL("./fixtures/slow-provider.ts", import.meta.url).pathname, "--session-dir", sessions, "--provider", "pi-mob-slow", "--model", "slow"],
      cwd: root, environment: { HOME: home, LANG: "C.UTF-8" },
      pathDirs: ["/usr/local/bin", "/usr/bin", "/bin"], defaultRequestTimeoutMs: 10_000, closeGracePeriodMs: 1_000,
    });
    const store = new BridgeStore(join(root, "bridge.sqlite"));
    store.ensureStream(`host:${store.identity().hostId}`, "host");
    const adapter = new OneSessionPiAdapter({
      store, rpc,
      workspace: { workspaceId, rootPath: root, displayName: "fixture", fingerprint: "fixture", policyMode: "full" },
      newSessionId: () => sessionId,
    });
    try {
      await rpc.start();
      await adapter.dispatch(command("66666666-6666-4666-8666-666666666666", "session.create", `host:${store.identity().hostId}`, { workspaceId, policyMode: "full" }));
      await adapter.dispatch(command("77777777-7777-4777-8777-777777777777", "prompt.submit", `session:${sessionId}`, { sessionId, deliveryMode: "immediate", message: "wait", attachmentIds: [] }));
      const startedBy = Date.now() + 2_000;
      while (!store.listEvents(`session:${sessionId}`).some((event) => event.type === "turn.started")) {
        if (Date.now() > startedBy) throw new Error("turn did not start");
        await Bun.sleep(5);
      }
      await adapter.dispatch(command("88888888-8888-4888-8888-888888888888", "turn.abort", `session:${sessionId}`, { sessionId }));
      const abortedBy = Date.now() + 2_000;
      while (!store.listEvents(`session:${sessionId}`).some((event) => event.type === "turn.aborted")) {
        if (Date.now() > abortedBy) throw new Error(`active turn did not abort: ${store.listEvents(`session:${sessionId}`).map((event) => event.type).join(",")}`);
        await Bun.sleep(5);
      }
      expect(store.sessionState(sessionId)?.runtimeState).toBe("idle");
    } finally {
      adapter.close(); await rpc.close(); store.close();
    }
  }, 10_000);
});
