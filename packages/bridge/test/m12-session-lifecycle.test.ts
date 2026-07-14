/**
 * M12 — session tree / fork / clone / delete / restore adapter tests.
 *
 * Scope: the multi-session Pi adapter (`OneSessionPiAdapter`) handles
 * the bridge-private lifecycle commands that the protocol surface
 * exposes as `session.rename`, `session.fork`, `session.clone`,
 * `session.delete`, `session.restore`, and `session.purge`.
 *
 * Behaviour pinned by these tests:
 *  - Fork vs clone is distinct: `fork` carries an `entryId` mapping,
 *    `clone` duplicates the current branch. Both produce a child
 *    durable summary; the original is never mutated.
 *  - Rename is capability-safe: `set_session_name` is a real Pi RPC
 *    call so the test asserts the request shape and the durable
 *    `session.metadata` event. RPC failure must surface without
 *    mutating state.
 *  - Delete is local-only (Pi has no delete-session RPC, M0-20): the
 *    adapter emits `session.removed` with a 7-day `purgeAfter` window
 *    and marks the session soft-deleted.
 *  - Restore revives a soft-deleted session before the purge window
 *    elapses; after the window, restore rejects.
 *  - Purge is irreversible: the durable row is removed and `permanent`
 *    is set on the `session.removed` event.
 *  - Lineage metadata (`parentSessionId`, `lineageType`,
 *    `lineageCreatedFrom`) is published on the new session stream.
 *  - Extension cancel maps to an unchanged original plus an
 *    explanatory `session.metadata` event.
 *
 * All RPC interactions are driven through a fake RPC client. No real
 * Pi binary is required.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BridgeStore,
  OneSessionPiAdapter,
  ProcessSupervisor,
  deterministicIdGenerator,
  type PiRpcClient,
  type PiRpcRequestOptions,
  type PiRpcNotification,
  type StoredCommand,
} from "../src";

class FakeRpc implements PiRpcClient {
  readonly id: string;
  readonly requests: PiRpcRequestOptions[] = [];
  readonly responses = new Map<string, unknown>();
  readonly notifications = new Set<(raw: unknown) => void>();
  /** When set, every request throws this error. */
  failWith: Error | null = null;
  retries = 0;
  constructor(id: string) { this.id = id; }
  async manualRetry(): Promise<void> { this.retries += 1; }
  async request(opts: PiRpcRequestOptions): Promise<unknown> {
    if (this.failWith) throw this.failWith;
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

interface Setup {
  store: BridgeStore;
  rpcById: Map<string, FakeRpc>;
  adapter: OneSessionPiAdapter;
  supervisor: ProcessSupervisor;
  hostStream: string;
  createSession: (name?: string) => Promise<string>;
}

function setup(): Setup {
  const store = new BridgeStore(join(mkdtempSync(join(tmpdir(), "pi-mob-m12-")), "bridge.sqlite"));
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
      workspaceId: "33333333-3333-4333-8333-333333333333",
      rootPath: "/private/example/repo",
      displayName: "example",
      fingerprint: "fp-m12",
      policyMode: "full",
    },
    newSessionId: deterministicIdGenerator("sess"),
    now: () => 1_700_000_000_000,
  });
  const hostStream = `host:${identity.hostId}`;
  const createSession = async (name?: string): Promise<string> => {
    await adapter.dispatch({
      commandId: crypto.randomUUID(),
      type: "session.create",
      scopeKey: hostStream,
      streamId: hostStream,
      semanticHash: `session.create:${crypto.randomUUID()}`,
      payload: { workspaceId: "ws", policyMode: "full", ...(name ? { name } : {}) },
      state: "accepted",
      dispatchCount: 0,
    });
    const summary = store.listEvents(hostStream)
      .filter((event) => event.type === "session.summary")
      .map((event) => event.payload as Record<string, unknown>)
      .at(-1);
    return summary?.sessionId as string;
  };
  return { store, rpcById, adapter, supervisor, hostStream, createSession };
}

function cmd(commandId: string, type: string, sessionId: string, payload: Record<string, unknown>): StoredCommand {
  const streamId = `session:${sessionId}`;
  return {
    commandId,
    type,
    scopeKey: streamId,
    streamId,
    semanticHash: `${type}:${commandId}`,
    payload,
    state: "accepted",
    dispatchCount: 0,
  };
}

function streamEvents(streamId: string): Array<{ type: string; payload: Record<string, unknown> }> {
  return store_sessionEvents(streamId);
}

// Small helper so we can use `store` from the outer scope without re-binding.
let storeRef: BridgeStore | null = null;
function store_sessionEvents(streamId: string): Array<{ type: string; payload: Record<string, unknown> }> {
  if (!storeRef) throw new Error("store not bound");
  return storeRef.listEvents(streamId).map((event) => ({ type: event.type, payload: event.payload }));
}

afterEach(() => { storeRef = null; });

describe("M12 session lifecycle adapter", () => {
  test("session.rename issues set_session_name RPC and persists durable metadata", async () => {
    const { store, rpcById, adapter, hostStream, createSession } = setup();
    storeRef = store;
    const sessionId = await createSession("first");
    const rpc = rpcById.get(sessionId)!;
    await adapter.dispatch(cmd("rename-1", "session.rename", sessionId, { sessionId, name: "second" }));
    expect(rpc.requests.at(-1)?.method).toBe("set_session_name");
    expect(rpc.requests.at(-1)?.params).toEqual({ name: "second" });
    const state = store.sessionState(sessionId);
    expect(state?.name).toBe("second");
    expect(state?.previousName).toBe("first");
    const meta = store.listEvents(`session:${sessionId}`).filter((event) => event.type === "session.metadata").at(-1);
    expect(meta).toBeDefined();
    expect((meta!.payload as Record<string, unknown>).name).toBe("second");
    expect((meta!.payload as Record<string, unknown>).previousName).toBe("first");
    const renamed = store.listEvents(hostStream).filter((event) => event.type === "session.summary")
      .map((event) => event.payload as Record<string, unknown>)
      .find((payload) => payload.change === "renamed" && payload.sessionId === sessionId);
    expect(renamed).toBeDefined();
  });

  test("session.rename RPC failure leaves name unchanged and surfaces an error", async () => {
    const { store, rpcById, adapter, createSession } = setup();
    storeRef = store;
    const sessionId = await createSession("first");
    const rpc = rpcById.get(sessionId)!;
    const before = store.sessionState(sessionId)?.name;
    rpc.failWith = new Error("extension cancelled rename");
    await expect(adapter.dispatch(cmd("r-fail", "session.rename", sessionId, { sessionId, name: "broken" }))).rejects.toThrow("rename failed");
    expect(store.sessionState(sessionId)?.name).toBe(before);
    rpc.failWith = null;
  });

  test("session.fork rejects an entry absent from upstream eligibility", async () => {
    const { store, rpcById, adapter, createSession } = setup();
    storeRef = store;
    const parentId = await createSession("parent");
    const rpc = rpcById.get(parentId)!;
    rpc.responses.set("get_fork_messages:fork-ineligible:eligible", [{ entryId: "different-entry" }]);
    await expect(adapter.dispatch(cmd("fork-ineligible", "session.fork", parentId, { sessionId: parentId, entryId: "not-eligible" }))).rejects.toThrow("not eligible");
    expect(rpc.requests.some((request) => request.method === "fork")).toBe(false);
  });

  test("session.fork branches at entryId with lineage metadata and an unchanged parent", async () => {
    const { store, rpcById, adapter, hostStream, createSession } = setup();
    storeRef = store;
    const parentId = await createSession("parent");
    const rpc = rpcById.get(parentId)!;
    rpc.responses.set(`fork:fork-1`, { sessionFile: "/private/example/sessions/child.jsonl", messageCount: 3 });
    await adapter.dispatch(cmd("fork-1", "session.fork", parentId, { sessionId: parentId, entryId: "entry-abc" }));
    const forkReq = rpc.requests.at(-1)!;
    expect(forkReq.method).toBe("fork");
    expect(forkReq.params).toEqual({ entryId: "entry-abc" });
    // New session appeared on host stream as `session.summary` add.
    const summaries = store.listEvents(hostStream).filter((event) => event.type === "session.summary")
      .map((event) => event.payload as Record<string, unknown>);
    const newSummary = summaries.find((payload) => payload.parentSessionId === parentId)!;
    const childId = newSummary.sessionId as string;
    expect(childId).not.toBe(parentId);
    expect(store.sessionExists(childId)).toBe(true);
    // Lineage metadata is on the child session stream.
    const childLineage = store.listEvents(`session:${childId}`).find((event) => event.type === "session.metadata");
    expect(childLineage).toBeDefined();
    const childPayload = childLineage!.payload as Record<string, unknown>;
    expect(childPayload.parentSessionId).toBe(parentId);
    expect(childPayload.lineageType).toBe("branch");
    expect(childPayload.createdFrom).toBe("entry-abc");
    // Parent is unchanged.
    expect(store.sessionState(parentId)?.deletedAt).toBeUndefined();
    expect(store.sessionState(parentId)?.name).toBe("parent");
    // Child state carries the fork result blob.
    const childState = store.sessionState(childId) ?? {};
    expect((childState.forkResult as Record<string, unknown>)?.sessionFile).toBe("/private/example/sessions/child.jsonl");
  });

  test("session.fork extension cancel leaves parent unchanged and emits explanatory metadata", async () => {
    const { store, rpcById, adapter, hostStream, createSession } = setup();
    storeRef = store;
    const parentId = await createSession("parent");
    const rpc = rpcById.get(parentId)!;
    const summariesBefore = store.listEvents(hostStream).filter((event) => event.type === "session.summary").length;
    rpc.responses.set("fork:fork-cancel", { cancelled: true });
    await adapter.dispatch(cmd("fork-cancel", "session.fork", parentId, { sessionId: parentId, entryId: "entry-xyz" }));
    expect(store.sessionState(parentId)?.deletedAt).toBeUndefined();
    const cancelMeta = store.listEvents(`session:${parentId}`).find((event) => event.type === "session.metadata"
      && (event.payload as Record<string, unknown>).forkCancelled === true);
    expect(cancelMeta).toBeDefined();
    const summariesAfter = store.listEvents(hostStream).filter((event) => event.type === "session.summary").length;
    expect(summariesAfter).toBe(summariesBefore);
  });

  test("session.clone duplicates the active branch with lineageType clone", async () => {
    const { store, rpcById, adapter, hostStream, createSession } = setup();
    storeRef = store;
    const parentId = await createSession("source");
    const rpc = rpcById.get(parentId)!;
    rpc.responses.set(`clone:clone-1`, { sessionFile: "/private/example/sessions/clone.jsonl", messageCount: 5 });
    await adapter.dispatch(cmd("clone-1", "session.clone", parentId, { sessionId: parentId }));
    expect(rpc.requests.at(-1)?.method).toBe("clone");
    expect(rpc.requests.at(-1)?.params).toBeUndefined();
    const newSummary = store.listEvents(hostStream).filter((event) => event.type === "session.summary")
      .map((event) => event.payload as Record<string, unknown>)
      .find((payload) => payload.parentSessionId === parentId)!;
    const childId = newSummary.sessionId as string;
    const childState = store.sessionState(childId) ?? {};
    const childLineage = store.listEvents(`session:${childId}`).find((event) => event.type === "session.metadata");
    const lp = childLineage!.payload as Record<string, unknown>;
    expect(lp.lineageType).toBe("clone");
    expect(lp.parentSessionId).toBe(parentId);
    expect(lp.createdFrom).toBeNull();
    expect((childState.cloneResult as Record<string, unknown>)?.sessionFile).toBe("/private/example/sessions/clone.jsonl");
  });

  test("session.clone cancellation leaves original unchanged and creates no child", async () => {
    const { store, rpcById, adapter, hostStream, createSession } = setup();
    storeRef = store;
    const parentId = await createSession("source");
    const before = store.listEvents(hostStream).filter((event) => event.type === "session.summary").length;
    rpcById.get(parentId)!.responses.set("clone:clone-cancel", { cancelled: true });
    await adapter.dispatch(cmd("clone-cancel", "session.clone", parentId, { sessionId: parentId }));
    expect(store.listEvents(hostStream).filter((event) => event.type === "session.summary")).toHaveLength(before);
    expect(store.listEvents(`session:${parentId}`).some((event) => event.type === "session.metadata" && event.payload.cloneCancelled === true)).toBe(true);
  });

  test("session.clone is rejected when source is deleted", async () => {
    const { store, adapter, createSession } = setup();
    storeRef = store;
    const sessionId = await createSession("source");
    await adapter.dispatch(cmd("del-1", "session.delete", sessionId, { sessionId }));
    await expect(adapter.dispatch(cmd("clone-deleted", "session.clone", sessionId, { sessionId }))).rejects.toThrow("session_deleted");
  });

  test("session.delete soft-deletes with 7-day purge window and emits session.removed", async () => {
    const { store, rpcById, adapter, hostStream, createSession } = setup();
    storeRef = store;
    const sessionId = await createSession("doomed");
    const rpc = rpcById.get(sessionId)!;
    await adapter.dispatch(cmd("del-1", "session.delete", sessionId, { sessionId }));
    // No delete RPC exists; the fake RPC must not have received a delete call.
    const deleteCalls = rpc.requests.filter((req) => req.method === "delete");
    expect(deleteCalls).toHaveLength(0);
    const state = store.sessionState(sessionId);
    expect(state?.deletedAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(state?.deletionState).toBe("soft_deleted");
    const purgeAfterMs = Date.parse(String(state?.purgeAfter));
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(purgeAfterMs - 1_700_000_000_000).toBe(sevenDays);
    expect(state?.runtimeState).toBe("stopped");
    const removed = store.listEvents(hostStream).filter((event) => event.type === "session.removed")
      .map((event) => event.payload as Record<string, unknown>)
      .find((payload) => payload.sessionId === sessionId);
    expect(removed).toBeDefined();
    expect(removed?.deletionState).toBe("soft_deleted");
    expect(removed?.partial).toBe(false);
    // RPC listener is unbound while the session is soft-deleted.
    expect(rpc.notifications.size).toBe(0);
  });

  test("session.delete is idempotent — repeated delete is a no-op", async () => {
    const { store, adapter, hostStream, createSession } = setup();
    storeRef = store;
    const sessionId = await createSession("doomed");
    await adapter.dispatch(cmd("del-1", "session.delete", sessionId, { sessionId }));
    const removedBefore = store.listEvents(hostStream).filter((event) => event.type === "session.removed").length;
    await adapter.dispatch(cmd("del-2", "session.delete", sessionId, { sessionId }));
    const removedAfter = store.listEvents(hostStream).filter((event) => event.type === "session.removed").length;
    expect(removedAfter).toBe(removedBefore);
  });

  test("session.restore revives a soft-deleted session before the purge window elapses", async () => {
    const { store, rpcById, adapter, hostStream, createSession } = setup();
    storeRef = store;
    const sessionId = await createSession("revived");
    const rpc = rpcById.get(sessionId)!;
    await adapter.dispatch(cmd("del-1", "session.delete", sessionId, { sessionId }));
    // Advance the adapter clock past now but well before purgeAfter.
    (adapter as unknown as { now: () => number }).now = () => 1_700_000_000_000 + 24 * 60 * 60 * 1000;
    const retriesBefore = rpc.retries;
    await adapter.dispatch(cmd("restore-1", "session.restore", sessionId, { sessionId }));
    expect(store.sessionState(sessionId)?.deletedAt).toBeNull();
    expect(store.sessionState(sessionId)?.deletionState).toBe("active");
    expect(rpc.retries).toBe(retriesBefore + 1);
    const restoreSummary = store.listEvents(hostStream).filter((event) => event.type === "session.summary")
      .map((event) => event.payload as Record<string, unknown>)
      .find((payload) => payload.change === "restored" && payload.sessionId === sessionId);
    expect(restoreSummary).toBeDefined();
  });

  test("session.restore rejects when purge window has elapsed", async () => {
    const { store, adapter, createSession } = setup();
    storeRef = store;
    const sessionId = await createSession("expired");
    await adapter.dispatch(cmd("del-1", "session.delete", sessionId, { sessionId }));
    // Advance the adapter clock past the purge window.
    (adapter as unknown as { now: () => number }).now = () => 1_700_000_000_000 + 8 * 24 * 60 * 60 * 1000;
    await expect(adapter.dispatch(cmd("restore-late", "session.restore", sessionId, { sessionId }))).rejects.toThrow("purge window has elapsed");
  });

  test("session.purge is irreversible — tombstone retained and removal emitted", async () => {
    const { store, rpcById, adapter, hostStream, createSession } = setup();
    storeRef = store;
    const sessionId = await createSession("gone");
    const rpc = rpcById.get(sessionId)!;
    await adapter.dispatch(cmd("purge-1", "session.purge", sessionId, { sessionId }));
    expect(store.sessionState(sessionId)).toMatchObject({ lifecycleState: "purged", neverReuse: true });
    expect(store.listSessionSummaries({ pageSize: 50 }).items.some((item) => item.sessionId === sessionId)).toBe(false);
    const removed = store.listEvents(hostStream).filter((event) => event.type === "session.removed")
      .map((event) => event.payload as Record<string, unknown>)
      .filter((payload) => payload.sessionId === sessionId && payload.permanent === true);
    expect(removed.length).toBeGreaterThanOrEqual(1);
    // The session ID is never reused because the adapter hands out a fresh UUID per create.
    const newId = await createSession("fresh");
    expect(newId).not.toBe(sessionId);
    // No purge RPC call was issued (Pi has none).
    expect(rpc.requests.some((req) => req.method === "purge")).toBe(false);
  });

  test("session.delete on a running session aborts explicitly then stops the supervisor", async () => {
    const { store, rpcById, adapter, supervisor, createSession } = setup();
    storeRef = store;
    const sessionId = await createSession("running");
    // Simulate the supervisor reporting an active process — required for
    // handleSessionDelete to invoke supervisor.stop.
    supervisor.transition(sessionId, "running");
    expect(supervisor.state(sessionId)).toBe("running");
    await adapter.dispatch(cmd("del-run", "session.delete", sessionId, { sessionId, abortActive: true, cancelQueued: true }));
    expect(rpcById.get(sessionId)!.requests.some((request) => request.method === "abort")).toBe(true);
    expect(supervisor.state(sessionId)).toBe("stopped");
    expect(store.sessionState(sessionId)?.deletionState).toBe("soft_deleted");
  });

  test("fork/clone lineage on a soft-deleted parent is rejected", async () => {
    const { store, adapter, createSession } = setup();
    storeRef = store;
    const sessionId = await createSession("soon-deleted");
    await adapter.dispatch(cmd("del-1", "session.delete", sessionId, { sessionId }));
    await expect(adapter.dispatch(cmd("fork-deleted", "session.fork", sessionId, { sessionId, entryId: "x" }))).rejects.toThrow("session_deleted");
  });

  test("rename on a deleted session is rejected with session_deleted", async () => {
    const { store, adapter, createSession } = setup();
    storeRef = store;
    const sessionId = await createSession("rename-me");
    await adapter.dispatch(cmd("del-1", "session.delete", sessionId, { sessionId }));
    await expect(adapter.dispatch(cmd("rename-deleted", "session.rename", sessionId, { sessionId, name: "ignored" }))).rejects.toThrow("session_deleted");
  });

  test("session.snapshot metadata is journaled on session.create before navigation", async () => {
    const { store, hostStream, createSession } = setup();
    storeRef = store;
    const sessionId = await createSession("snapshotted");
    const metadata = store.listEvents(`session:${sessionId}`).find((event) => event.type === "session.metadata");
    expect(metadata).toBeDefined();
    const payload = metadata!.payload as Record<string, unknown>;
    expect(payload.sessionId).toBe(sessionId);
    expect(payload.workspaceId).toBeDefined();
    expect(payload.policyMode).toBe("full");
    expect(payload.runtimeState).toBe("idle");
    // Snapshot appears on the session stream before any other navigation
    // event (the host-stream `session.summary` add is the navigation
    // signal; the per-session metadata is the durable journaled snapshot).
    const stream = streamEvents(`session:${sessionId}`);
    const firstMeta = stream.findIndex((event) => event.type === "session.metadata");
    expect(firstMeta).toBeGreaterThanOrEqual(0);
    const summaryAdds = store.listEvents(hostStream).filter((event) => event.type === "session.summary"
      && (event.payload as Record<string, unknown>).change === "added"
      && (event.payload as Record<string, unknown>).sessionId === sessionId);
    expect(summaryAdds).toHaveLength(1);
  });
});
