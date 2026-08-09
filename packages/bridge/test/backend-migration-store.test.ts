import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BridgeStore, StoreError } from "../src/core/store";

function openStore(): { readonly store: BridgeStore; readonly cleanup: () => void } {
  const store = new BridgeStore(join(mkdtempSync(join(tmpdir(), "pi-mob-backend-store-")), "bridge.sqlite"));
  return { store, cleanup: () => store.close() };
}

const reference = {
  bridgeSessionId: "bridge-session-1",
  backendKind: "omp",
  backendSessionId: "omp-session-1",
  backendSessionFile: "/private/omp/session-1.jsonl",
};

const migration = {
  bridgeSessionId: reference.bridgeSessionId,
  migrationId: "migration-1",
  fromBackendKind: "pi",
  toBackendKind: "omp",
};

describe("OMP backend/session migration state", () => {
  test("applies additive v6 migration and creates a fresh backend session", () => {
    const { store, cleanup } = openStore();
    try {
      expect(store.migrationsApplied()).toContain(6);
      const created = store.ensureBackendSession({ ...reference, at: 100 });
      expect(created).toMatchObject(reference);
      expect(store.backendSession(reference.bridgeSessionId)).toEqual(created);
      expect(store.sessionState(reference.bridgeSessionId)).toEqual({});
    } finally { cleanup(); }
  });

  test("existing session receives one stable backend reference without leaking its private path", () => {
    const { store, cleanup } = openStore();
    try {
      store.ensureSession(reference.bridgeSessionId, { name: "mobile-visible", runtimeState: "idle" });
      const first = store.ensureBackendSession({ ...reference, at: 10 });
      const second = store.ensureBackendSession({ ...reference, at: 20 });
      expect(second).toEqual(first);
      expect(store.sessionState(reference.bridgeSessionId)).toEqual({ name: "mobile-visible", runtimeState: "idle" });
      const resumed = store.ensureBackendSession({ ...reference, backendSessionId: "omp-session-2", at: 30 });
      expect(resumed).toMatchObject({ ...reference, backendSessionId: "omp-session-2", updatedAt: 30 });
      expect(() => store.ensureBackendSession({ ...reference, backendSessionId: "different", backendSessionFile: "/private/omp/other.jsonl" })).toThrow(StoreError);
    } finally { cleanup(); }
  });

  test("interrupted migration requires explicit indeterminate recovery", () => {
    const { store, cleanup } = openStore();
    try {
      store.ensureSession(migration.bridgeSessionId, {});
      expect(store.beginBackendMigration({ ...migration, at: 1 }).state).toBe("running");
      const uncertain = store.markBackendMigrationIndeterminate({ ...migration, reason: "backend process exited\nwithout a terminal result", at: 2 });
      expect(uncertain).toMatchObject({ state: "indeterminate", outcome: "unknown", reason: "backend process exited without a terminal result", completedAt: null });
      expect(() => store.retryBackendMigration({ ...migration, at: 3 })).toThrow("explicit recovery");
      const recovered = store.recoverBackendMigration({ ...migration, outcome: "failed", reason: "operator confirmed no OMP session was committed", retryable: true, at: 4 });
      expect(recovered).toMatchObject({ state: "failed", outcome: "failed", retryable: true, completedAt: 4 });
      expect(store.retryBackendMigration({ ...migration, at: 5 })).toMatchObject({ state: "running", attempt: 2, outcome: null });
    } finally { cleanup(); }
  });

  test("migration start and terminal outcome are idempotent but conflicting retries are rejected", () => {
    const { store, cleanup } = openStore();
    try {
      store.ensureSession(migration.bridgeSessionId, {});
      const first = store.beginBackendMigration({ ...migration, at: 10 });
      expect(store.beginBackendMigration({ ...migration, at: 11 })).toEqual(first);
      const done = store.completeBackendMigration({ ...migration, outcome: "succeeded", reason: "import complete", at: 12 });
      expect(store.completeBackendMigration({ ...migration, outcome: "succeeded", reason: "different report", at: 13 })).toEqual(done);
      expect(() => store.completeBackendMigration({ ...migration, outcome: "failed", at: 14 })).toThrow("conflicts");
      expect(() => store.beginBackendMigration({ ...migration, migrationId: "migration-2", at: 15 })).toThrow("different migration");
    } finally { cleanup(); }
  });
});
