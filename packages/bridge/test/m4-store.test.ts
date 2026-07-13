import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BridgeStore, StoreError } from "../src/core/store";

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

  test("backs up, restores, verifies integrity, and increments generation", () => {
    const path = location("backup"); const { store, sessionStream } = seeded(path); const initial = store.identity();
    store.appendEvent(sessionStream, "turn.started", { value: 1 }); const backupPath = `${path}.backup`; const backup = store.backup(backupPath);
    expect(backup.bytes).toBeGreaterThan(0); store.appendEvent(sessionStream, "turn.failed", {});
    const unregistered = `${path}.unregistered`; copyFileSync(backupPath, unregistered); expect(() => store.restore(unregistered)).toThrow("not registered");
    const restored = store.restore(backupPath); expect(restored.hostId).toBe(initial.hostId); expect(restored.hostGeneration).toBe("2");
    expect(store.integrityCheck()).toBe(true); expect(store.listEvents(sessionStream).map((event) => event.type)).toEqual(["turn.started"]); store.close();
  });
});
