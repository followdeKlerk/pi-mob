import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SupervisedRpcClient } from "../src/pi/supervised-rpc-client";
import { resolvePiLaunchConfig } from "../src/pi/launch-config";
import type { ProcessLifecycleEvent } from "../src/core/process-supervisor";

describe("M6 supervised real subprocess", () => {
  test("unexpected process-group exit becomes indeterminate and restarts without command replay", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-supervised-rpc-")); mkdirSync(join(root, "home"));
    const events: ProcessLifecycleEvent[] = [];
    const client = new SupervisedRpcClient({
      processId: "11111111-1111-4111-8111-111111111111",
      restartDelayMs: 10,
      emit: (event) => events.push(event),
      rpc: {
        launchConfig: resolvePiLaunchConfig({ executable: Bun.which("bun")!, cwd: root, env: { HOME: join(root, "home"), PATH: process.env.PATH ?? "/usr/bin:/bin" } }),
        args: [new URL("./fixtures/fake-pi-rpc.ts", import.meta.url).pathname],
        defaultRequestTimeoutMs: 2_000,
        closeGracePeriodMs: 100,
      },
    });
    try {
      await client.start();
      await expect(client.request({ id: "first", method: "echo" })).resolves.toMatchObject({ echoed: "echo" });
      client.markDispatchStart();
      const firstPid = client.snapshot().sessions[0]!.pid!;
      process.kill(firstPid, "SIGKILL");
      const deadline = Date.now() + 3_000;
      while (client.state() !== "idle" || client.snapshot().sessions[0]!.pid === firstPid) {
        if (Date.now() > deadline) throw new Error(`did not restart: ${client.state()}`);
        await Bun.sleep(10);
      }
      const secondPid = client.snapshot().sessions[0]!.pid!;
      expect(secondPid).not.toBe(firstPid);
      expect(events.some((event) => event.type === "turn.indeterminate")).toBe(true);
      // Supervision restarts the transport only. It never replays the first RPC.
      await expect(client.request({ id: "second", method: "echo" })).resolves.toMatchObject({ echoed: "echo" });
    } finally { await client.close(); }
  }, 10_000);

  test("three real subprocess exits enter crash loop without a fourth start", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-supervised-loop-")); mkdirSync(join(root, "home"));
    const events: ProcessLifecycleEvent[] = [];
    const client = new SupervisedRpcClient({
      processId: "22222222-2222-4222-8222-222222222222",
      restartDelayMs: 5,
      maintenanceIntervalMs: 5,
      emit: (event) => events.push(event),
      rpc: {
        launchConfig: resolvePiLaunchConfig({ executable: Bun.which("bun")!, cwd: root, env: { HOME: join(root, "home"), PATH: process.env.PATH ?? "/usr/bin:/bin" } }),
        args: [new URL("./fixtures/fake-pi-rpc.ts", import.meta.url).pathname],
        defaultRequestTimeoutMs: 2_000, closeGracePeriodMs: 100,
      },
    });
    try {
      await client.start();
      let pid = client.snapshot().sessions[0]!.pid!;
      for (let crash = 0; crash < 3; crash++) {
        client.markDispatchStart(); process.kill(pid, "SIGKILL");
        const deadline = Date.now() + 2_000;
        if (crash < 2) {
          while (client.state() !== "idle" || client.snapshot().sessions[0]!.pid === pid) {
            if (Date.now() > deadline) throw new Error("restart timeout");
            await Bun.sleep(5);
          }
          pid = client.snapshot().sessions[0]!.pid!;
        } else {
          while (client.state() !== "crash_loop") {
            if (Date.now() > deadline) throw new Error("crash loop timeout");
            await Bun.sleep(5);
          }
        }
      }
      expect(events.some((event) => event.type === "host.degraded" && event.payload.reason === "crash_loop")).toBe(true);
      expect(client.snapshot().sessions[0]!.restartTimestamps).toHaveLength(3);
    } finally { await client.close(); }
  }, 10_000);
});
