// pi-mob:security-test-fixture — deliberate credential/path redaction probes.
import { describe, expect, test } from "bun:test";
import { ProcessSupervisor, type ManagedProcess, type ProcessLifecycleEvent, type ProcessSpawnSpec } from "../src/core/process-supervisor";

class FakeProcess implements ManagedProcess {
  pid = 42; started = 0; terminated = 0; forced = 0; exits = true; diagnosticsValue: string[] = [];
  async start(_spec: ProcessSpawnSpec): Promise<void> { this.started++; }
  terminate(): void { this.terminated++; }
  async waitForExit(_timeoutMs: number): Promise<boolean> { return this.exits; }
  async forceKillGroup(): Promise<void> { this.forced++; }
  diagnostics(): readonly string[] { return this.diagnosticsValue; }
}

function setup(capacity = 3) {
  let now = 1_000;
  const processes = new Map<string, FakeProcess>();
  const events: ProcessLifecycleEvent[] = [];
  const supervisor = new ProcessSupervisor({
    capacity, now: () => now,
    createProcess: (id) => { const process = new FakeProcess(); processes.set(id, process); return process; },
    emit: (event) => events.push(event),
    retryDelayMs: 10, idleTimeoutMs: 100, gracefulStopMs: 5,
  });
  return { supervisor, processes, events, advance: (ms: number) => { now += ms; } };
}
const spec = { executable: "/bin/pi", args: ["--mode", "rpc"], cwd: "/workspace" };

describe("M6 process supervisor", () => {
  test("uses three-process and thirty-minute production defaults", async () => {
    let now = 0;
    const supervisor = new ProcessSupervisor({
      now: () => now,
      createProcess: () => new FakeProcess(),
    });
    supervisor.register("a");
    await supervisor.start("a", spec);
    expect(supervisor.snapshot().capacity).toBe(3);
    now = 30 * 60_000 - 1;
    await supervisor.tick();
    expect(supervisor.state("a")).toBe("idle");
    now += 1;
    await supervisor.tick();
    expect(supervisor.state("a")).toBe("stopped");
  });

  test("enforces explicit lifecycle and capacity bounds", async () => {
    expect(() => new ProcessSupervisor({ capacity: 0, createProcess: () => new FakeProcess() })).toThrow(RangeError);
    const h = setup(2);
    h.supervisor.register("a"); h.supervisor.register("b"); h.supervisor.register("c");
    await h.supervisor.start("a", spec); h.supervisor.transition("a", "running");
    await h.supervisor.start("b", spec); h.supervisor.transition("b", "waiting_for_input", "user");
    await expect(h.supervisor.start("c", spec)).rejects.toMatchObject({ code: "host_capacity" });
    expect(h.supervisor.activeCount()).toBe(2);
  });

  test("evicts only least-recent idle without attention", async () => {
    const h = setup(2);
    h.supervisor.register("a"); h.supervisor.register("b"); h.supervisor.register("c");
    await h.supervisor.start("a", spec); h.advance(1);
    await h.supervisor.start("b", spec); h.advance(1);
    await h.supervisor.start("c", spec);
    expect(h.supervisor.state("a")).toBe("stopped");
    expect(h.processes.get("a")?.terminated).toBe(1);
    expect(h.supervisor.state("b")).toBe("idle");
    expect(h.supervisor.state("c")).toBe("idle");
  });

  test("idle timeout never stops running or attention sessions", async () => {
    const h = setup();
    for (const id of ["idle", "running", "attention"]) { h.supervisor.register(id); await h.supervisor.start(id, spec); }
    h.supervisor.transition("running", "running");
    h.supervisor.setAttention("attention", "dialog");
    h.advance(101); await h.supervisor.tick();
    expect(h.supervisor.state("idle")).toBe("stopped");
    expect(h.supervisor.state("running")).toBe("running");
    expect(h.supervisor.state("attention")).toBe("idle");
  });

  test("forces process-group cleanup after bounded graceful timeout", async () => {
    const h = setup(); h.supervisor.register("a"); await h.supervisor.start("a", spec);
    h.processes.get("a")!.exits = false;
    await h.supervisor.stop("a", "test");
    expect(h.processes.get("a")!.terminated).toBe(1);
    expect(h.processes.get("a")!.forced).toBe(1);
    expect(h.supervisor.snapshot().sessions[0]!.forcedCleanup).toBe(true);
  });

  test("marks running action indeterminate and restarts below threshold", async () => {
    const h = setup(); h.supervisor.register("a"); await h.supervisor.start("a", spec); h.supervisor.transition("a", "running");
    await h.supervisor.unexpectedExit("a", { exitCode: 9, runningAction: true });
    expect(h.supervisor.state("a")).toBe("retry_wait");
    expect(h.events.some((event) => event.type === "turn.indeterminate")).toBe(true);
    h.advance(11); await h.supervisor.tick();
    expect(h.supervisor.state("a")).toBe("idle");
    expect(h.processes.get("a")!.started).toBe(1);
  });

  test("three crashes in five-minute window enter crash loop until manual retry", async () => {
    const h = setup(); h.supervisor.register("a");
    for (let index = 0; index < 3; index++) {
      if (index === 0) await h.supervisor.start("a", spec);
      await h.supervisor.unexpectedExit("a");
      if (index < 2) { h.advance(11); await h.supervisor.tick(); }
    }
    expect(h.supervisor.state("a")).toBe("crash_loop");
    await expect(h.supervisor.start("a", spec)).rejects.toMatchObject({ code: "crash_loop" });
    await h.supervisor.manualRetry("a");
    expect(h.supervisor.state("a")).toBe("idle");
  });

  test("drain rejects admission, stops eligible idle, and retains active", async () => {
    const h = setup(); h.supervisor.register("idle"); h.supervisor.register("active"); h.supervisor.register("new");
    await h.supervisor.start("idle", spec); await h.supervisor.start("active", spec); h.supervisor.transition("active", "running");
    const result = await h.supervisor.drain();
    expect(result).toEqual({ stopped: ["idle"], retained: ["active"] });
    await expect(h.supervisor.start("new", spec)).rejects.toMatchObject({ code: "host_draining" });
    h.supervisor.transition("active", "idle");
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.supervisor.state("active")).toBe("stopped");
  });

  test("reboot restoration preserves crash loop but never pretends live processes continued", async () => {
    const h = setup(); h.supervisor.register("active"); h.supervisor.register("loop", "crash_loop");
    h.supervisor.configure("loop", spec);
    await h.supervisor.start("active", spec); h.supervisor.transition("active", "running");
    const snapshot = h.supervisor.snapshot();
    const restored = setup().supervisor; restored.restoreAfterReboot(snapshot);
    expect(restored.state("active")).toBe("stopped");
    expect(restored.state("loop")).toBe("crash_loop");
    expect(restored.snapshot().draining).toBe(false);
    await restored.manualRetry("loop");
    expect(restored.state("loop")).toBe("idle");
  });

  test("diagnostics are bounded and redact credentials/private paths", async () => {
    const h = setup(); h.supervisor.register("a"); await h.supervisor.start("a", spec); h.supervisor.transition("a", "running");
    h.processes.get("a")!.diagnosticsValue = ["Bearer secret /Users/alice/project sk-abcdefghijklmnop"];
    await h.supervisor.unexpectedExit("a");
    const text = h.supervisor.snapshot().sessions[0]!.diagnostics.join(" ");
    expect(text).not.toContain("secret"); expect(text).not.toContain("/Users/alice"); expect(text).not.toContain("sk-abc");
  });
});
