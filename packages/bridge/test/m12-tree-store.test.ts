import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BridgeStore, StoreError } from "../src";

function setup() {
  let now = Date.parse("2026-07-14T00:00:00Z");
  const store = new BridgeStore(join(mkdtempSync(join(tmpdir(), "pi-mob-m12-store-")), "bridge.sqlite"), () => now);
  store.identity();
  store.ensureStream(`host:${store.identity().hostId}`, "host");
  return { store, now: () => now, advance: (ms: number) => { now += ms; } };
}

function add(store: BridgeStore, id: string, patch: Record<string, unknown> = {}) {
  store.addSessionSummary(id, { name: id.slice(0, 4), ...patch });
}

describe("M12 durable tree and lifecycle store", () => {
  test("lineage projects direct children with stable pagination and excludes tombstones", () => {
    const { store } = setup();
    add(store, "parent", { parentSessionId: null });
    for (let i = 0; i < 5; i += 1) add(store, `child-${i}`, { parentSessionId: "parent", lineageType: i === 0 ? "clone" : "branch", forkOriginEntryId: i ? `entry-${i}` : null, lastActivityAt: i });
    add(store, "other", { parentSessionId: "elsewhere" });
    store.purgeSessionTombstone("child-2");
    const first = store.listSessionSummaries({ parentSessionId: "parent", pageSize: 2, sort: "activity" });
    expect(first.items.map((item) => item.sessionId)).toEqual(["child-4", "child-3"]);
    const second = store.listSessionSummaries({ parentSessionId: "parent", pageSize: 2, sort: "activity", beforeCursor: first.nextBeforeCursor! });
    expect(second.items.map((item) => item.sessionId)).toEqual(["child-1", "child-0"]);
    expect(second.nextBeforeCursor).toBeUndefined();
    store.close();
  });

  test("fallback names are deterministic and explicit rename wins", () => {
    const { store } = setup();
    add(store, "abcdef12-rest", { name: null });
    expect(store.resolvedSessionName("abcdef12-rest")).toBe("Session abcdef12");
    store.changeSessionSummary("abcdef12-rest", { name: "Named branch" });
    expect(store.resolvedSessionName("abcdef12-rest")).toBe("Named branch");
    store.close();
  });

  test("soft delete is idempotent, retained seven days, and restore clears lifecycle", () => {
    const { store, now } = setup();
    add(store, "delete-me");
    const first = store.softDeleteSession("delete-me");
    const second = store.softDeleteSession("delete-me");
    expect(first.purgeAfter).toBe(new Date(now() + 7 * 24 * 60 * 60_000).toISOString());
    expect(second.purgeAfter).toBe(first.purgeAfter);
    const restored = store.restoreSoftDeletedSession("delete-me");
    expect(restored.lifecycleState).toBe("active");
    expect(restored.deletedAt).toBeNull();
    store.close();
  });

  test("restore after deadline is rejected", () => {
    const { store, advance } = setup();
    add(store, "late");
    store.softDeleteSession("late");
    advance(7 * 24 * 60 * 60_000 + 1);
    expect(() => store.restoreSoftDeletedSession("late")).toThrow(StoreError);
    store.close();
  });

  test("delete_failed is visible and requires repair before restore", () => {
    const { store } = setup();
    add(store, "partial");
    store.softDeleteSession("partial");
    const failed = store.markSessionDeleteFailed("partial", "Pi file move failed");
    expect(failed.lifecycleState).toBe("delete_failed");
    expect(failed.repairReason).toBe("Pi file move failed");
    expect(() => store.restoreSoftDeletedSession("partial")).toThrow("repair is required");
    expect(store.listEvents("session:partial").some((event) => event.type === "session.delete_failed")).toBe(true);
    store.close();
  });

  test("purge retains an irreversible non-reusable tombstone", () => {
    const { store } = setup();
    add(store, "never-reuse");
    store.softDeleteSession("never-reuse");
    const tombstone = store.purgeSessionTombstone("never-reuse");
    expect(tombstone).toMatchObject({ sessionId: "never-reuse", lifecycleState: "purged", neverReuse: true });
    expect(store.sessionExists("never-reuse")).toBe(true);
    expect(store.addSessionSummary("never-reuse", { name: "reused" }).added).toBe(false);
    expect(store.listSessionSummaries({ pageSize: 50 }).items.some((item) => item.sessionId === "never-reuse")).toBe(false);
    store.close();
  });
});
