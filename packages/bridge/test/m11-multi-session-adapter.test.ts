/**
 * M11 — multi-session bridge adapter tests.
 *
 * The M11 contract for the bridge adapter:
 *  - Three independent sessions can be admitted, each owning its own
 *    RPC client and stream, and progress independently.
 *  - A fourth `session.create` is rejected with an explicit
 *    `HostCapacityError` (no eligible idle victim) so mobile can
 *    surface a bounded host summary.
 *  - Idle stop is wired through `ProcessSupervisor.stop`, and
 *    `session.activate` lazily restores the session through
 *    `ProcessSupervisor.manualRetry`.
 *  - Notifications carrying `sessionId` are routed to the matching
 *    session only; they never bleed into a sibling session's stream
 *    or summary.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BridgeStore,
  HostCapacityError,
  OneSessionPiAdapter,
  ProcessSupervisor,
  deterministicIdGenerator,
  type PiRpcClient,
  type PiRpcRequestOptions,
  type PiRpcNotification,
} from "../src";

class FakeRpc implements PiRpcClient {
  readonly id: string;
  readonly requests: PiRpcRequestOptions[] = [];
  readonly responses = new Map<string, unknown>();
  readonly notifications = new Set<(raw: unknown) => void>();
  retries = 0;
  constructor(id: string) { this.id = id; }
  async manualRetry(): Promise<void> { this.retries += 1; }
  async request(opts: PiRpcRequestOptions): Promise<unknown> {
    this.requests.push(opts);
    const key = `${opts.method}:${opts.id ?? ""}`;
    if (this.responses.has(key)) return this.responses.get(key);
    return { echoed: opts.method, id: opts.id ?? null, params: opts.params ?? null };
  }
  on(kind: "notification", handler: (raw: unknown) => void): () => void {
    if (kind !== "notification") return () => undefined;
    this.notifications.add(handler);
    return () => this.notifications.delete(handler);
  }
  emit(raw: PiRpcNotification | Record<string, unknown>): void {
    for (const fn of this.notifications) fn(raw);
  }
}

function setup(): {
  store: BridgeStore;
  rpcById: Map<string, FakeRpc>;
  adapter: OneSessionPiAdapter;
  supervisor: ProcessSupervisor;
  hostStream: string;
} {
  const store = new BridgeStore(join(mkdtempSync(join(tmpdir(), "pi-mob-m11-")), "bridge.sqlite"));
  const identity = store.identity();
  store.ensureStream(`host:${identity.hostId}`, "host");
  const rpcById = new Map<string, FakeRpc>();
  const supervisor = new ProcessSupervisor({
    capacity: 3,
    createProcess: () => ({
      pid: undefined,
      async start() { /* stub */ },
      terminate() { /* stub */ },
      async waitForExit() { return true; },
      async forceKillGroup() { /* stub */ },
      diagnostics: () => [],
    }),
    emit: () => undefined,
  });
  const adapter = new OneSessionPiAdapter({
    store,
    supervisor,
    createRpc: (sessionId) => {
      const rpc = new FakeRpc(sessionId);
      rpcById.set(sessionId, rpc);
      return rpc;
    },
    processSpec: (sessionId) => ({ executable: "pi", args: ["--session", sessionId], cwd: "/private/example/repo" }),
    workspace: {
      workspaceId: "22222222-2222-4222-8222-222222222222",
      rootPath: "/private/example/repo",
      displayName: "example",
      fingerprint: "fp-m11",
      policyMode: "full",
    },
    newSessionId: deterministicIdGenerator("sess"),
    now: () => 1_700_000_000_000,
  });
  return { store, rpcById, adapter, supervisor, hostStream: `host:${identity.hostId}` };
}

function makeCommand(commandId: string, type: string, scopeKey: string, streamId: string, payload: Record<string, unknown>) {
  return { commandId, type, scopeKey, streamId, semanticHash: `${type}:${commandId}`, payload, state: "accepted", dispatchCount: 0 } as const;
}

afterEach(() => { /* Fixtures are short-lived per test. */ });

describe("M11 multi-session adapter", () => {
  test("admits three independent sessions with separate RPC clients and streams", async () => {
    const { store, adapter, rpcById, supervisor, hostStream } = setup();
    const created: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await adapter.dispatch(makeCommand(`c-${i}`, "session.create", hostStream, hostStream, { workspaceId: "ws", policyMode: "full", name: `s${i}` }));
      // Find the most recently created session summary.
      const summary = store.listEvents(hostStream)
        .filter((event) => event.type === "session.summary")
        .map((event) => event.payload as Record<string, unknown>)
        .at(-1)!;
      created.push(summary.sessionId as string);
    }
    expect(new Set(created).size).toBe(3);
    expect(supervisor.activeCount()).toBe(3);
    // Each session has its own per-session RPC client.
    for (const id of created) {
      const rpc = rpcById.get(id);
      expect(rpc).toBeDefined();
      expect(rpc!.notifications.size).toBe(1);
    }
    // Every lifecycle summary must satisfy the public schema, including the
    // transitional starting/idle events emitted by the process supervisor.
    const summaryEvents = store.listEvents(hostStream).filter((event) => event.type === "session.summary");
    for (const event of summaryEvents) {
      const payload = event.payload as Record<string, unknown>;
      expect(typeof payload.runtimeState).toBe("string");
      expect(Number.isInteger(payload.queueCount)).toBe(true);
      expect(Number(payload.queueCount)).toBeGreaterThanOrEqual(0);
    }
    // Host stream emitted exactly one session.summary add per create.
    const addEvents = summaryEvents.filter((event) => (event.payload as Record<string, unknown>).change === "added");
    expect(addEvents).toHaveLength(3);
    // Each session has its own stream with session.metadata.
    for (const id of created) {
      const events = store.listEvents(`session:${id}`);
      expect(events.find((event) => event.type === "session.metadata")).toBeDefined();
      expect(store.sessionState(id)?.runtimeState).toBe("idle");
    }
  });

  test("fourth session.create throws HostCapacityError with no eligible victim", async () => {
    const { store, adapter, supervisor, hostStream } = setup();
    for (let i = 0; i < 3; i += 1) {
      await adapter.dispatch(makeCommand(`c-${i}`, "session.create", hostStream, hostStream, { workspaceId: "ws", policyMode: "full" }));
    }
    // Make every active session ineligible for LRU eviction so the
    // supervisor cannot find a victim — this is the M11 no-victim
    // admission failure the host surfaces as `host_capacity`.
    const created = store.listEvents(hostStream)
      .filter((event) => event.type === "session.summary")
      .map((event) => (event.payload as Record<string, unknown>).sessionId as string);
    for (const id of created) supervisor.setAttention(id, "user");
    expect(supervisor.activeCount()).toBe(3);
    expect(adapter.admission()).toEqual({ accepting: false, reason: "host_capacity" });
    let caught: unknown = null;
    try {
      await adapter.dispatch(makeCommand("c-4", "session.create", hostStream, hostStream, { workspaceId: "ws", policyMode: "full" }));
    } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(HostCapacityError);
    const err = caught as HostCapacityError;
    expect(err.active).toBe(3);
    expect(err.capacity).toBe(3);
    // The fourth session was not admitted — no fourth durable row.
    expect(store.sessionStates()).toHaveLength(3);
  });

  test("session.stop releases capacity and session.activate lazily restores", async () => {
    const { store, adapter, rpcById, supervisor, hostStream } = setup();
    const created: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await adapter.dispatch(makeCommand(`c-${i}`, "session.create", hostStream, hostStream, { workspaceId: "ws", policyMode: "full" }));
      const id = (store.listEvents(hostStream).filter((event) => event.type === "session.summary").at(-1)!.payload as Record<string, unknown>).sessionId as string;
      created.push(id);
    }
    const target = created[0]!;
    const targetRpc = rpcById.get(target)!;
    // Idle stop is the documented M11 trigger.
    await adapter.dispatch(makeCommand("stop-1", "session.stop", `session:${target}`, `session:${target}`, { sessionId: target }));
    expect(supervisor.state(target)).toBe("stopped");
    expect(store.sessionState(target)?.runtimeState).toBe("stopped");
    // The host stream publishes a session.summary change with "stopped".
    const stopEvent = store.listEvents(hostStream)
      .filter((event) => event.type === "session.summary")
      .map((event) => event.payload as Record<string, unknown>)
      .find((payload) => payload.sessionId === target && payload.change === "stopped");
    expect(stopEvent).toBeDefined();
    // RPC listener for the stopped session is unbound.
    expect(targetRpc.notifications.size).toBe(0);
    // The freed capacity admits a new session.
    await adapter.dispatch(makeCommand("c-replace", "session.create", hostStream, hostStream, { workspaceId: "ws", policyMode: "full" }));
    expect(supervisor.activeCount()).toBe(3);
    // session.activate lazy-restores the previously stopped session.
    const retriesBefore = targetRpc.retries;
    await adapter.dispatch(makeCommand("act-1", "session.activate", `session:${target}`, `session:${target}`, { sessionId: target }));
    expect(targetRpc.retries).toBe(retriesBefore + 1);
    expect(supervisor.state(target)).toBe("idle");
    expect(store.sessionState(target)?.runtimeState).toBe("idle");
    const restoreEvent = store.listEvents(hostStream)
      .filter((event) => event.type === "session.summary")
      .map((event) => event.payload as Record<string, unknown>)
      .find((payload) => payload.sessionId === target && payload.change === "restored");
    expect(restoreEvent).toBeDefined();
  });

  test("notifications are routed only to the matching session — no cross-session application", async () => {
    const { store, rpcById, adapter, hostStream } = setup();
    const created: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      await adapter.dispatch(makeCommand(`c-${i}`, "session.create", hostStream, hostStream, { workspaceId: "ws", policyMode: "full" }));
      const id = (store.listEvents(hostStream).filter((event) => event.type === "session.summary").at(-1)!.payload as Record<string, unknown>).sessionId as string;
      created.push(id);
    }
    const [a, b] = created as [string, string];
    const rpcA = rpcById.get(a)!;
    const rpcB = rpcById.get(b)!;
    rpcA.emit({ type: "agent_start", sessionId: a });
    rpcA.emit({ type: "message_update", sessionId: a, assistantMessageEvent: { type: "text_delta", delta: "alpha" } });
    rpcB.emit({ type: "agent_start", sessionId: b });
    rpcB.emit({ type: "message_update", sessionId: b, assistantMessageEvent: { type: "text_delta", delta: "beta" } });

    const typesA = store.listEvents(`session:${a}`).map((event) => event.type);
    const typesB = store.listEvents(`session:${b}`).map((event) => event.type);
    // session.state is the only normalized event for agent_start; the
    // text_delta is normalised to assistant.delta.
    expect(typesA).toContain("session.state");
    expect(typesA).toContain("assistant.delta");
    expect(typesB).toContain("session.state");
    expect(typesB).toContain("assistant.delta");

    // No cross-talk: A's assistant.delta payload never appears on B's stream
    // and vice versa. We check the payload text rather than event type
    // because both sessions legitimately emit session.state.
    const aPayloads = store.listEvents(`session:${a}`).map((event) => JSON.stringify(event.payload));
    const bPayloads = store.listEvents(`session:${b}`).map((event) => JSON.stringify(event.payload));
    expect(aPayloads.some((p) => p.includes("alpha"))).toBe(true);
    expect(aPayloads.some((p) => p.includes("beta"))).toBe(false);
    expect(bPayloads.some((p) => p.includes("beta"))).toBe(true);
    expect(bPayloads.some((p) => p.includes("alpha"))).toBe(false);

    // A notification with an unknown sessionId is dropped — it does not
    // reach either stream and never creates a row on the host stream.
    const hostCountBefore = store.streamPosition(hostStream)!.current;
    rpcA.emit({ type: "agent_start", sessionId: "not-a-real-session" });
    const hostCountAfter = store.streamPosition(hostStream)!.current;
    expect(hostCountAfter).toBe(hostCountBefore);
    expect(store.listEvents(`session:${a}`)).toHaveLength(typesA.length);
    expect(store.listEvents(`session:${b}`)).toHaveLength(typesB.length);

    // Sessions are isolated. Each session's lastActivityAt advances
    // independently — the two writes are not coupled.
    const stateA = store.sessionState(a);
    const stateB = store.sessionState(b);
    expect(stateA?.lastActivityAt).toEqual(new Date(1_700_000_000_000).toISOString());
    expect(stateB?.lastActivityAt).toEqual(new Date(1_700_000_000_000).toISOString());
  });
});
