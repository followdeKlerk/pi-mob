import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BridgeStore, type StoredCommand } from "../src/core/store";
import { runDaemon } from "../src/daemon";

const sessionId = "11111111-1111-4111-8111-111111111111";
function seed(stateDir: string, runtimeState: string): void {
  mkdirSync(stateDir, { recursive: true });
  const store = new BridgeStore(join(stateDir, "bridge.sqlite"));
  const host = `host:${store.identity().hostId}`; store.ensureStream(host, "host");
  store.ensureSession(sessionId, { sessionId, runtimeState, attentionState: "ready" });
  store.ensureStream(`session:${sessionId}`, "session", sessionId);
  store.close();
}
function command(type: string): StoredCommand {
  return { commandId: crypto.randomUUID(), type, scopeKey: `session:${sessionId}`, streamId: `session:${sessionId}`, semanticHash: type, payload: { sessionId }, state: "accepted", dispatchCount: 0 };
}
function daemonOptions(root: string, stateDir: string) {
  const sessions = join(root, "sessions"); mkdirSync(sessions, { recursive: true });
  writeFileSync(join(root, "contract-input.txt"), "fixture\n");
  return {
    workspace: root,
    executable: new URL("../node_modules/.bin/pi", import.meta.url).pathname,
    stateDir,
    sessionDir: sessions,
    bridgeVersion: "v-test",
    rpcArgs: ["--no-extensions", "--extension", new URL("./fixtures/contract-provider.ts", import.meta.url).pathname, "--provider", "pi-mob-fixture", "--model", "contract"],
    environment: { HOME: root, LANG: "C.UTF-8", PATH: process.env.PATH ?? "/usr/bin:/bin" },
  };
}

describe("M6 daemon reboot recovery", () => {
  test("running-at-restart is indeterminate and blocked until explicit activation", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-daemon-recover-")); const stateDir = join(root, "state"); seed(stateDir, "running");
    const daemon = await runDaemon(daemonOptions(root, stateDir));
    try {
      expect(daemon.runtime.bridgeVersion).toBe("v-test");
      expect(daemon.store.sessionState(sessionId)?.runtimeState).toBe("indeterminate");
      const connection = { connectionId: "connection", installationId: "installation", subscriptions: new Set<string>() };
      const promptId = crypto.randomUUID();
      expect(() => daemon.runtime.command(connection, { type: "prompt.submit", commandId: promptId, leaseId: crypto.randomUUID(), payload: { sessionId, deliveryMode: "immediate", message: "never replay", attachmentIds: [] } })).toThrow("indeterminate session requires explicit activation");
      expect(daemon.store.command(promptId)).toBeNull();
      await daemon.adapter.dispatch(command("session.activate"));
      expect(daemon.store.sessionState(sessionId)?.runtimeState).toBe("idle");
    } finally { await daemon.close(); }
  }, 15_000);

  test("uncertain running command makes an idle session indeterminate", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-daemon-command-")); const stateDir = join(root, "state"); seed(stateDir, "idle");
    const seeded = new BridgeStore(join(stateDir, "bridge.sqlite"));
    const commandId = "22222222-2222-4222-8222-222222222222";
    seeded.acceptCommand({ commandId, type: "prompt.submit", scopeKey: `session:${sessionId}`, streamId: `session:${sessionId}`, semanticHash: "hash", payload: { sessionId } });
    seeded.transitionCommand(commandId, ["accepted"], "dispatched");
    seeded.transitionCommand(commandId, ["dispatched"], "running");
    seeded.close();
    const daemon = await runDaemon(daemonOptions(root, stateDir));
    try {
      expect(daemon.store.command(commandId)?.state).toBe("indeterminate");
      expect(daemon.store.sessionState(sessionId)?.runtimeState).toBe("indeterminate");
    } finally { await daemon.close(); }
  }, 15_000);

  test("persisted crash loop never auto-starts and manual activation recovers", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-daemon-loop-")); const stateDir = join(root, "state"); seed(stateDir, "crash_loop");
    const daemon = await runDaemon(daemonOptions(root, stateDir));
    try {
      expect(daemon.rpc.state()).toBe("crash_loop");
      expect(daemon.store.sessionState(sessionId)?.runtimeState).toBe("crash_loop");
      await daemon.adapter.dispatch(command("session.activate"));
      expect(daemon.store.sessionState(sessionId)?.runtimeState).toBe("idle");
    } finally { await daemon.close(); }
  }, 15_000);
});
