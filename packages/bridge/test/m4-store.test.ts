import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BridgeStore, StoreError } from "../src/core/store";
import { CanonicalSessionStore } from "../src/session-events/canonical-session-store";

function location(name: string): string { return join(mkdtempSync(join(tmpdir(), `pi-mob-${name}-`)), "bridge.sqlite"); }
function seeded(path = location("store")): { store: BridgeStore; hostStream: string; sessionStream: string } {
  const store = new BridgeStore(path); const identity = store.identity(); const hostStream = `host:${identity.hostId}`;
  store.ensureStream(hostStream, "host"); store.ensureSession("session", { runtimeState: "idle", name: "fixture" });
  const sessionStream = "session:session"; store.ensureStream(sessionStream, "session", "session");
  return { store, hostStream, sessionStream };
}

describe("M4 durable SQLite store", () => {
  test("enables WAL/FK, persists identity, and orders arbitrary precision cursors", () => {
    const path = location("cursor"); let { store, sessionStream } = seeded(path);
    expect(Object.values(store.pragma("journal_mode") as object)).toContain("wal");
    expect(Object.values(store.pragma("foreign_keys") as object)).toContain(1);
    const host = store.identity(); store.ensureSession("session", {}); expect(store.sessionState("session")).toMatchObject({ runtimeState: "idle", name: "fixture" });
    store.close(); store = new BridgeStore(path); expect(store.identity()).toEqual(host);
    const raw = new Database(path); raw.query("UPDATE streams SET current_cursor=? WHERE stream_id=?").run("9007199254740991", sessionStream); raw.close();
    expect(store.appendEvent(sessionStream, "turn.started", {}).cursor).toBe("9007199254740992");
    expect(store.appendEvent(sessionStream, "turn.settled", {}).cursor).toBe("9007199254740993");
    expect(store.listEvents(sessionStream, "9007199254740991").map((event) => event.cursor)).toEqual(["9007199254740992", "9007199254740993"]);
    store.close();
  });

  test("pages a 250-event session journal newest-first with canonical order inside each page", () => {
    const { store, sessionStream } = seeded();
    for (let index = 1; index <= 250; index += 1) {
      store.appendEvent(sessionStream, "assistant.delta", { index }, `event-${index}`);
    }

    const first = store.pageSessionEvents("session", 100);
    expect(first.snapshotRevision).toBe("250");
    expect(first.items).toHaveLength(100);
    expect(first.items.map((event) => event.cursor)).toEqual(Array.from({ length: 100 }, (_, index) => String(index + 151)));
    expect(first.items.map((event) => event.eventId)).toEqual(Array.from({ length: 100 }, (_, index) => `event-${index + 151}`));
    expect(first.nextBeforeCursor).toBe("151");

    const second = store.pageSessionEvents("session", 100, first.nextBeforeCursor);
    expect(second.items.map((event) => event.cursor)).toEqual(Array.from({ length: 100 }, (_, index) => String(index + 51)));
    expect(second.nextBeforeCursor).toBe("51");

    const third = store.pageSessionEvents("session", 100, second.nextBeforeCursor);
    expect(third.items.map((event) => event.cursor)).toEqual(Array.from({ length: 50 }, (_, index) => String(index + 1)));
    expect(third.nextBeforeCursor).toBeUndefined();
    expect(() => store.pageSessionEvents("missing", 100)).toThrow("session not found");
    store.close();
  });

  test("pages forward with a hard bound, stable through cursor, and exact ordered traversal", () => {
    const { store, sessionStream } = seeded();
    for (let index = 1; index <= 250; index += 1) {
      store.appendEvent(sessionStream, "assistant.delta", { index }, `forward-${index}`);
    }

    expect(() => store.pageEvents(sessionStream, 101)).toThrow("page size must be an integer from 1 through 100");
    const traversed: string[] = [];
    let after = "0";
    let through: string | undefined;
    let pages = 0;
    while (true) {
      const page = store.pageEvents(sessionStream, 100, after, through);
      through ??= page.snapshotRevision;
      pages += 1;
      expect(page.items.length).toBeLessThanOrEqual(100);
      traversed.push(...page.items.map((event) => event.eventId));
      if (!page.nextAfterCursor) break;
      after = page.nextAfterCursor;
    }
    expect(pages).toBe(3);
    expect(through).toBe("250");
    expect(traversed).toEqual(Array.from({ length: 250 }, (_, index) => `forward-${index + 1}`));

    store.appendEvent(sessionStream, "assistant.delta", { index: 251 }, "forward-251");
    const bounded = store.pageEvents(sessionStream, 100, "0", through);
    expect(bounded.items).toHaveLength(100);
    expect(bounded.items.at(-1)?.eventId).toBe("forward-100");
    expect(bounded.items.some((event) => event.eventId === "forward-251")).toBe(false);
    store.close();
  });

  test("idempotent event append returns the exact row on replay and conflicts on changed content", () => {
    const { store, hostStream, sessionStream } = seeded();
    const observed: string[] = [];
    store.onEvent((event) => observed.push(event.eventId));
    const first = store.appendEventIdempotent(sessionStream, "host.degraded", { reason: "busy" }, "operational-1");
    const second = store.appendEventIdempotent(sessionStream, "host.degraded", { reason: "busy" }, "operational-1");
    expect(second).toEqual(first);
    expect(observed).toEqual(["operational-1"]);
    expect(() => store.appendEventIdempotent(hostStream, "host.degraded", { reason: "busy" }, "operational-1")).toThrow(StoreError);
    expect(() => store.appendEventIdempotent(sessionStream, "host.draining", { reason: "busy" }, "operational-1")).toThrow(StoreError);
    expect(() => store.appendEventIdempotent(sessionStream, "host.degraded", { reason: "full" }, "operational-1")).toThrow(StoreError);
    expect(store.listEvents(sessionStream)).toEqual([first]);
    store.close();
  });

  test("accepts command and event atomically, deduplicates, conflicts, and fails closed", () => {
    const { store, sessionStream } = seeded();
    const input = { commandId: "command", type: "prompt.submit", scopeKey: sessionStream, streamId: sessionStream, semanticHash: "hash", payload: { sessionId: "session", message: "safe" } };
    expect(store.acceptCommand(input).kind).toBe("accepted");
    expect(store.acceptCommand(input).kind).toBe("duplicate");
    expect(store.acceptCommand({ ...input, semanticHash: "different" }).kind).toBe("conflict");
    expect(store.listEvents(sessionStream).filter((event) => event.type === "command.state")).toHaveLength(1);
    store.setWritableForTest(false);
    expect(() => store.acceptCommand({ ...input, commandId: "rejected" })).toThrow(StoreError);
    expect(store.command("rejected")).toBeNull(); store.close();
  });

  test("surfaces locked/full/corrupt storage without acceptance", () => {
    const path = location("failures"); const { store, sessionStream } = seeded(path);
    const lock = new Database(path); lock.exec("BEGIN IMMEDIATE");
    const lockedCommand = { commandId: "locked", type: "prompt.submit", scopeKey: sessionStream, streamId: sessionStream, semanticHash: "h", payload: {} };
    try { store.acceptCommand(lockedCommand); throw new Error("expected locked store"); }
    catch (error) { expect(error).toBeInstanceOf(StoreError); expect((error as StoreError).code).toBe("busy"); }
    lock.exec("ROLLBACK"); lock.close(); expect(store.command("locked")).toBeNull();
    const pageCount = Object.values(store.pragma("page_count") as object)[0] as number; store.setMaxPageCountForTest(pageCount);
    const fullCommand = { commandId: "full", type: "prompt.submit", scopeKey: sessionStream, streamId: sessionStream, semanticHash: "h2", payload: { message: "x".repeat(100_000) } };
    try { store.acceptCommand(fullCommand); throw new Error("expected SQLITE_FULL"); }
    catch (error) { expect(error).toBeInstanceOf(StoreError); expect((error as StoreError).code).toBe("full"); }
    expect(store.command("full")).toBeNull(); expect(store.health().ready).toBe(false); store.close();
    const corruptPath = location("corrupt"); writeFileSync(corruptPath, "not sqlite");
    expect(() => new BridgeStore(corruptPath)).toThrow(StoreError);
  });

  test("compacts acknowledged legacy events in bounded durable batches", () => {
    const path = location("compaction"); let { store, sessionStream } = seeded(path);
    const canonical = new CanonicalSessionStore(store);
    canonical.append({ sessionId: "session", type: "turn.started", payload: { turnId: "canonical" }, eventId: "canonical-1" });
    for (let index = 1; index <= 5; index += 1) store.appendEvent(sessionStream, "legacy", { index }, `legacy-${index}`);
    store.upsertInstallationCredential({ installationId: "active", credentialHash: "a", enrollmentSecretHash: "ea", enrollmentSource: "manual", createdAt: 1, lastSeenAt: 1 });
    store.upsertInstallationCredential({ installationId: "other", credentialHash: "b", enrollmentSecretHash: "eb", enrollmentSource: "manual", createdAt: 1, lastSeenAt: 1 });
    store.ackCursor("active", sessionStream, "5"); store.ackCursor("other", sessionStream, "3");
    expect(store.compactLegacyEvents({ maxRows: 2 })).toEqual({ deletedRows: 2, deletedBytes: 22, blockedStreams: [] });
    expect(store.streamPosition(sessionStream)).toMatchObject({ current: "5", floor: "2" });
    expect(store.compactLegacyEvents({ maxRows: 2 })).toEqual({ deletedRows: 1, deletedBytes: 11, blockedStreams: [] });
    expect(store.listEvents(sessionStream).map((event) => event.cursor)).toEqual(["4", "5"]);
    expect(canonical.readAfter("session", 0).map((event) => event.sequence)).toEqual([1]);
    store.close(); store = new BridgeStore(path); expect(store.streamPosition(sessionStream)).toMatchObject({ current: "5", floor: "3" }); expect(new CanonicalSessionStore(store).readAfter("session", 0).map((event) => event.sequence)).toEqual([1]); store.close();
  });

  test("uses only valid acknowledged cursors and does not let an unsubscribed credential pin a stream", () => {
    const { store, sessionStream } = seeded();
    for (let index = 1; index <= 3; index += 1) store.appendEvent(sessionStream, "legacy", { index });
    store.upsertInstallationCredential({ installationId: "active", credentialHash: "a", enrollmentSecretHash: "ea", enrollmentSource: "manual", createdAt: 1, lastSeenAt: 1 });
    store.upsertInstallationCredential({ installationId: "missing", credentialHash: "m", enrollmentSecretHash: "em", enrollmentSource: "manual", createdAt: 1, lastSeenAt: 1 });
    store.upsertInstallationCredential({ installationId: "revoked", credentialHash: "b", enrollmentSecretHash: "eb", enrollmentSource: "manual", createdAt: 1, lastSeenAt: 1 });
    store.upsertInstallationCredential({ installationId: "expired", credentialHash: "c", enrollmentSecretHash: "ec", enrollmentSource: "manual", createdAt: 1, lastSeenAt: 1, expiresAt: 50 });
    store.ackCursor("active", sessionStream, "1"); store.ackCursor("revoked", sessionStream, "3"); store.ackCursor("expired", sessionStream, "3");
    store.revokeInstallationCredential("revoked", "test", 1);
    expect(store.compactLegacyEvents({ now: 100 })).toEqual({ deletedRows: 1, deletedBytes: 11, blockedStreams: [] });
    expect(store.listEvents(sessionStream).map((event) => event.cursor)).toEqual(["2", "3"]);
    store.ackCursor("active", sessionStream, "3"); expect(store.compactLegacyEvents({ now: 100 })).toEqual({ deletedRows: 2, deletedBytes: 22, blockedStreams: [] });
    store.close();

    const noAck = seeded(); noAck.store.appendEvent(noAck.sessionStream, "legacy", {});
    noAck.store.upsertInstallationCredential({ installationId: "missing", credentialHash: "m", enrollmentSecretHash: "em", enrollmentSource: "manual", createdAt: 1, lastSeenAt: 1 });
    expect(noAck.store.compactLegacyEvents()).toEqual({ deletedRows: 0, deletedBytes: 0, blockedStreams: [noAck.sessionStream] });
    expect(noAck.store.streamPosition(noAck.sessionStream)).toMatchObject({ current: "1", floor: "0" }); noAck.store.close();
  });

  test("backs up, restores, verifies integrity, and increments generation", () => {
    const path = location("backup"); const { store, sessionStream } = seeded(path); const initial = store.identity();
    store.appendEvent(sessionStream, "turn.started", { value: 1 }); const backupPath = `${path}.backup`; const backup = store.backup(backupPath);
    expect(backup.bytes).toBeGreaterThan(0); store.appendEvent(sessionStream, "turn.failed", {});
    const unregistered = `${path}.unregistered`; copyFileSync(backupPath, unregistered); expect(() => store.restore(unregistered)).toThrow("not registered");
    const restored = store.restore(backupPath); expect(restored.hostId).toBe(initial.hostId); expect(restored.hostGeneration).toBe("2");
    expect(store.integrityCheck()).toBe(true); expect(store.listEvents(sessionStream).map((event) => event.type)).toEqual(["turn.started"]); store.close();
  });
});
