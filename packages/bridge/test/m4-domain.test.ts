import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ControllerLeaseService, DurableCommandService, StreamContinuityTracker, StreamService, type AdapterPort } from "../src/core/domain";
import { DurableBridgeRuntime } from "../src/core/runtime";
import { BridgeStore, StoreError } from "../src/core/store";

function setup(): { store: BridgeStore; stream: string } {
  const store = new BridgeStore(join(mkdtempSync(join(tmpdir(), "pi-mob-domain-")), "db.sqlite"));
  store.ensureSession("s", { state: "idle", transcript: ["a", "b"] }); const stream = "session:s"; store.ensureStream(stream, "session", "s"); return { store, stream };
}

describe("M4 durable command semantics", () => {
  test("lost receipt resend dispatches once and conflicting payload is rejected", async () => {
    const { store, stream } = setup(); let dispatches = 0;
    const adapter: AdapterPort = { async dispatch() { dispatches += 1; await Bun.sleep(5); } };
    const service = new DurableCommandService(store, adapter);
    const input = { commandId: "one", type: "prompt.submit", payload: { sessionId: "s", message: "safe" }, scopeKey: stream, streamId: stream };
    const first = service.submit(input); const resend = service.submit(input);
    expect(resend.receipt.duplicate).toBe(true); await first.completion; expect(dispatches).toBe(1); expect(store.command("one")?.state).toBe("completed");
    expect(() => service.submit({ ...input, payload: { sessionId: "s", message: "changed" } })).toThrow("idempotency conflict"); store.close();
  });

  test("serializes one scope, permits independent scopes, and recovers truthfully", async () => {
    const { store, stream } = setup(); store.ensureSession("other"); store.ensureStream("session:other", "session", "other");
    let active = 0; let globalMax = 0; const perScope = new Map<string, number>(); let sameScopeMax = 0;
    const adapter: AdapterPort = { async dispatch(command) {
      active += 1; globalMax = Math.max(globalMax, active);
      const scopeActive = (perScope.get(command.scopeKey) ?? 0) + 1; perScope.set(command.scopeKey, scopeActive); sameScopeMax = Math.max(sameScopeMax, scopeActive);
      await Bun.sleep(15); perScope.set(command.scopeKey, scopeActive - 1); active -= 1;
    } };
    const service = new DurableCommandService(store, adapter);
    const submissions = [
      service.submit({ commandId: "a", type: "session.rename", payload: {}, scopeKey: stream, streamId: stream }),
      service.submit({ commandId: "b", type: "session.rename", payload: {}, scopeKey: stream, streamId: stream }),
      service.submit({ commandId: "c", type: "session.rename", payload: {}, scopeKey: "session:other", streamId: "session:other" }),
    ];
    await Promise.all(submissions.map((item) => item.completion)); expect(globalMax).toBeGreaterThan(1); expect(sameScopeMax).toBe(1);
    store.acceptCommand({ commandId: "accepted", type: "prompt.submit", scopeKey: stream, streamId: stream, semanticHash: "h", payload: {} });
    store.acceptCommand({ commandId: "uncertain", type: "prompt.submit", scopeKey: stream, streamId: stream, semanticHash: "h2", payload: {} }); store.transitionCommand("uncertain", ["accepted"], "dispatched");
    const result = await service.recover(); expect(result).toEqual({ resumed: 1, indeterminate: 1 }); expect(store.command("accepted")?.state).toBe("completed"); expect(store.command("uncertain")?.state).toBe("indeterminate"); store.close();
  });

  test("lease command conflicts and unauthorized release never accept, while duplicates bypass expired lease checks", async () => {
    const { store, stream } = setup(); const service = new DurableCommandService(store, { async dispatch() {} });
    store.acquireLease(stream, "owner", "owner-connection", 1_000);
    const before = store.listEvents(stream).length;
    expect(() => service.submit({ commandId: "blocked-acquire", type: "controller.acquire", payload: { scope: "session", sessionId: "s" }, scopeKey: stream, streamId: stream, leaseMutation: { action: "acquire", scopeKey: stream, installationId: "other", connectionId: "other-connection", now: 1_001 } })).toThrow("controller already active");
    expect(() => service.submit({ commandId: "blocked-release", type: "controller.release", payload: { scope: "session", sessionId: "s" }, scopeKey: stream, streamId: stream, leaseMutation: { action: "release", scopeKey: stream, installationId: "other", connectionId: "other-connection", now: 1_002 } })).toThrow("not authorized");
    expect(store.command("blocked-acquire")).toBeNull(); expect(store.command("blocked-release")).toBeNull(); expect(store.listEvents(stream)).toHaveLength(before);
    const first = service.submit({ commandId: "lease-command", type: "controller.takeover", payload: { scope: "session", sessionId: "s" }, scopeKey: stream, streamId: stream, leaseMutation: { action: "takeover", scopeKey: stream, installationId: "other", connectionId: "new", now: 1_003 } });
    await first.completion;
    const duplicate = service.submit({ commandId: "lease-command", type: "controller.takeover", payload: { scope: "session", sessionId: "s" }, scopeKey: stream, streamId: stream, leaseMutation: { action: "takeover", scopeKey: stream, installationId: "third", connectionId: "stale", now: 999_999 } });
    expect(duplicate.receipt.duplicate).toBe(true); store.close();
  });
});

describe("M4 runtime startup recovery", () => {
  test("stays unready until accepted work resumes and uncertain work becomes indeterminate", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-mob-restart-")), "db.sqlite"); let store = new BridgeStore(path);
    const identity = store.identity(); store.ensureStream(`host:${identity.hostId}`, "host");
    store.acceptCommand({ commandId: "resume", type: "session.create", scopeKey: `host:${identity.hostId}`, streamId: `host:${identity.hostId}`, semanticHash: "a", payload: {} });
    store.acceptCommand({ commandId: "uncertain-restart", type: "session.create", scopeKey: `host:${identity.hostId}`, streamId: `host:${identity.hostId}`, semanticHash: "b", payload: {} }); store.transitionCommand("uncertain-restart", ["accepted"], "running"); store.close();
    store = new BridgeStore(path); let dispatches = 0; const runtime = new DurableBridgeRuntime({ store, adapter: { async dispatch() { dispatches += 1; } }, bridgeVersion: "fixture", piVersion: "0.82.0", hostDisplayName: "fixture" });
    expect(runtime.ready().ready).toBe(false); expect(await runtime.start()).toEqual({ resumed: 1, indeterminate: 1 }); expect(runtime.ready().ready).toBe(true);
    expect(dispatches).toBe(1); expect(store.command("resume")?.state).toBe("completed"); expect(store.command("uncertain-restart")?.state).toBe("indeterminate"); store.close();
  });
});

describe("M4 runtime routing and bounded subscriptions", () => {
  test("does not create phantom sessions and filters summary replay/snapshots", async () => {
    const { store, stream } = setup(); const identity = store.identity(); store.ensureStream(`host:${identity.hostId}`, "host");
    store.appendEvent(stream, "assistant.delta", { sessionId: "s", text: "private transcript" }); store.appendEvent(stream, "command.state", { commandId: "c", state: "accepted" });
    const runtime = new DurableBridgeRuntime({ store, adapter: { async dispatch() {} }, bridgeVersion: "fixture", piVersion: "0.82.0", hostDisplayName: "fixture" }); await runtime.start();
    const connection = { connectionId: "connection", installationId: "installation", subscriptions: new Set<string>() };
    expect(() => runtime.command(connection, { type: "session.activate", commandId: "missing-command", leaseId: "missing", payload: { sessionId: "missing" } })).toThrow("session does not exist");
    expect(store.sessionExists("missing")).toBe(false);
    const replay = runtime.subscribe(connection, { streams: [{ streamId: `host:${identity.hostId}`, detail: "full", afterCursor: "0" }, { streamId: stream, detail: "summary", afterCursor: "0" }, { streamId: "session:missing", detail: "summary", afterCursor: "0" }] });
    expect(replay.messages?.some((message) => message.type === "assistant.delta")).toBe(false);
    expect(replay.messages?.some((message) => message.type === "command.state")).toBe(true);
    expect(replay.messages?.some((message) => message.type === "error" && message.payload.code === "stream_not_found")).toBe(true);
    const snapshot = runtime.subscribe(connection, { streams: [{ streamId: `host:${identity.hostId}`, detail: "full", afterCursor: "0" }, { streamId: stream, detail: "summary" }] });
    expect(JSON.stringify(snapshot.messages)).not.toContain("private transcript"); store.close();
  });
});

describe("M4 replay, snapshots, and stream isolation", () => {
  test("classifies current/replay/expired/ahead and replays post-baseline events", () => {
    const { store, stream } = setup(); const first = store.appendEvent(stream, "turn.started", {}); const second = store.appendEvent(stream, "turn.settled", {});
    const service = new StreamService(store, 8);
    expect(service.sync(stream, second.cursor).mode).toBe("current"); expect(service.sync(stream, first.cursor).events.map((event) => event.cursor)).toEqual([second.cursor]);
    service.ack("installation", { [stream]: second.cursor }); expect(store.ackedCursor("installation", stream)).toBe(second.cursor);
    store.setRetentionFloor(stream, second.cursor); expect(service.sync(stream, "0").mode).toBe("snapshot_required"); expect(service.sync(stream, "999").mode).toBe("snapshot_required");
    const original = store.captureSnapshot.bind(store); let added = false;
    store.captureSnapshot = ((id: string) => { const snapshot = original(id); if (!added) { added = true; store.appendEvent(stream, "session.state", { after: true }); } return snapshot; }) as typeof store.captureSnapshot;
    const sync = service.sync(stream); expect(sync.mode).toBe("snapshot_required"); expect(sync.snapshotParts!.length).toBeGreaterThan(1); expect(sync.events.map((event) => event.payload.after)).toContain(true); store.close();
  });

  test("detects duplicates, conflicts, and gaps independently per stream", () => {
    const tracker = new StreamContinuityTracker();
    expect(tracker.apply({ streamId: "a", cursor: "1", eventId: "one" })).toBe("applied");
    expect(tracker.apply({ streamId: "a", cursor: "1", eventId: "one" })).toBe("duplicate");
    expect(tracker.apply({ streamId: "a", cursor: "1", eventId: "other" })).toBe("conflict");
    expect(tracker.apply({ streamId: "a", cursor: "3", eventId: "three" })).toBe("gap");
    expect(tracker.apply({ streamId: "b", cursor: "1", eventId: "independent" })).toBe("applied");
  });
});

describe("M4 controller leases", () => {
  test("acquires, renews, reclaims, takes over, expires, and rejects stale sockets", () => {
    let now = 1_000; const { store, stream } = setup(); const leases = new ControllerLeaseService(store);
    const first = leases.acquire(stream, "install-a", "conn-a", false, now);
    expect(() => leases.acquire(stream, "install-b", "conn-b", false, now)).toThrow(StoreError);
    expect(leases.renew(stream, first.leaseId, "conn-a", now + 1).expiresAt).toBe(now + 1 + 45_000);
    leases.disconnect(stream, "conn-a", now + 2); const reclaimed = leases.acquire(stream, "install-a", "conn-new", false, now + 3);
    expect(() => leases.assertController(stream, reclaimed.leaseId, "conn-a", now + 3)).toThrow("stale controller");
    const takeover = leases.acquire(stream, "install-b", "conn-b", true, now + 4); expect(takeover.installationId).toBe("install-b"); expect(store.leaseHistory(stream).filter((lease) => lease.revokedAt !== null).length).toBeGreaterThanOrEqual(2);
    expect(() => leases.release(stream, takeover.leaseId, "wrong-installation", "conn-b", now + 4)).toThrow("not authorized");
    now = takeover.expiresAt + 1; expect(() => leases.assertController(stream, takeover.leaseId, "conn-b", now)).toThrow("stale controller"); store.close();
  });
});
