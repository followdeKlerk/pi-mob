import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDaemon } from "../../src/daemon";
import { BridgeStore } from "../../src/core/store";
import { StreamService } from "../../src/core/domain";

const INSTALLATION_ID = "33333333-3333-4333-8333-333333333333";

let temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    try { rmSync(directory, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for legacy maintenance");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

describe("normal daemon legacy event maintenance", () => {
  test("runs after binding and startup reconciliation without changing the protocol path", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-legacy-maintenance-"));
    temporaryDirectories.push(root);
    const stateDir = join(root, "state");
    const dbPath = join(stateDir, "bridge.sqlite");
    const seed = new BridgeStore(dbPath);
    const hostStream = `host:${seed.identity().hostId}`;
    seed.ensureStream(hostStream, "host");
    seed.appendEvent(hostStream, "legacy.one", {});
    seed.appendEvent(hostStream, "legacy.two", {});
    seed.upsertInstallationCredential({
      installationId: INSTALLATION_ID,
      credentialHash: "credential-hash",
      enrollmentSecretHash: "enrollment-hash",
      enrollmentSource: "manual",
      createdAt: 1,
      lastSeenAt: 1,
    });
    seed.ackCursor(INSTALLATION_ID, hostStream, "2");
    seed.close();
    const records: Array<{ event: string; fields?: Record<string, string | number | boolean | null | undefined> }> = [];
    const daemon = await runDaemon({
      workspace: root,
      ompExecutable: process.execPath,
      stateDir,
      ompSessionDir: join(root, "sessions"),
      logger: { log(record) { records.push(record); } },
    });
    try {
      expect(daemon.store.listEvents(hostStream)).toMatchObject([
        { cursor: "3", type: "host.state", payload: { ready: true } },
      ]);
      expect(daemon.store.streamPosition(hostStream)).toMatchObject({ current: "3", floor: "2" });
      expect(records.some((record) => record.event === "legacy-event-compaction" && record.fields?.deletedRows === 2)).toBe(true);
    } finally {
      await daemon.close();
    }
  });

  test("drains repeated bounded batches while readiness and reconnect floors remain usable", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-legacy-batches-"));
    temporaryDirectories.push(root);
    const stateDir = join(root, "state");
    const dbPath = join(stateDir, "bridge.sqlite");
    const seed = new BridgeStore(dbPath);
    const hostStream = `host:${seed.identity().hostId}`;
    seed.ensureStream(hostStream, "host");
    for (let index = 1; index <= 1_005; index += 1) seed.appendEvent(hostStream, "legacy", { index }, `legacy-${index}`);
    seed.upsertInstallationCredential({
      installationId: INSTALLATION_ID,
      credentialHash: "credential-hash",
      enrollmentSecretHash: "enrollment-hash",
      enrollmentSource: "manual",
      createdAt: 1,
      lastSeenAt: 1,
    });
    seed.upsertInstallationCredential({
      installationId: "44444444-4444-4444-8444-444444444444",
      credentialHash: "unsubscribed-credential-hash",
      enrollmentSecretHash: "unsubscribed-enrollment-hash",
      enrollmentSource: "manual",
      createdAt: 1,
      lastSeenAt: 1,
    });
    seed.ackCursor(INSTALLATION_ID, hostStream, "1005");
    seed.close();

    const records: Array<{ event: string; fields?: Record<string, string | number | boolean | null | undefined> }> = [];
    const daemon = await runDaemon({
      workspace: root,
      ompExecutable: process.execPath,
      stateDir,
      ompSessionDir: join(root, "sessions"),
      logger: { log(record) { records.push(record); } },
    });
    try {
      // Runtime readiness is established before best-effort maintenance runs.
      expect(daemon.runtime.ready().ready).toBe(true);
      await waitFor(() => daemon.store.listEvents(hostStream).every((event) => event.type !== "legacy"));
      expect(daemon.store.streamPosition(hostStream)).toMatchObject({ current: "1006", floor: "1005" });
      const batches = records.filter((record) => record.event === "legacy-event-compaction");
      expect(batches.some((record) => record.fields?.deletedRows === 1000)).toBe(true);
      expect(batches.some((record) => record.fields?.deletedRows === 5)).toBe(true);

      const streams = new StreamService(daemon.store);
      expect(streams.sync(hostStream, "0").mode).toBe("snapshot_required");
      expect(streams.sync(hostStream, "1005")).toMatchObject({
        mode: "replay",
        events: [{ cursor: "1006", type: "host.state", payload: { ready: true } }],
      });
      daemon.store.appendEvent(hostStream, "live", { reconnect: true }, "live-after-compaction");
      expect(streams.sync(hostStream, "1006").mode).toBe("replay");
      expect(streams.sync(hostStream, "1006").events.map((event) => event.eventId)).toEqual(["live-after-compaction"]);
    } finally {
      await daemon.close();
    }
  });
});
