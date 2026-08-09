import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BridgeStore } from "../src/core/store";
import { runDaemon } from "../src/daemon";

const SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("daemon host draining lifecycle", () => {
  test("multiple supervised sessions emit one host.draining event", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-draining-dedupe-"));
    const stateDir = join(root, "state");
    const databasePath = join(stateDir, "bridge.sqlite");
    const seeded = new BridgeStore(databasePath);
    const hostId = seeded.identity().hostId;
    seeded.ensureStream(`host:${hostId}`, "host");
    for (const sessionId of [SESSION_A, SESSION_B]) {
      seeded.ensureSession(sessionId, { sessionId, runtimeState: "idle", attentionState: "ready" });
      seeded.ensureStream(`session:${sessionId}`, "session", sessionId);
    }
    seeded.close();

    try {
      const daemon = await runDaemon({
        workspace: root,
        ompExecutable: "/bin/sh",
        stateDir,
        ompSessionDir: join(root, "sessions"),
        environment: { HOME: root, PATH: process.env.PATH ?? "/usr/bin:/bin" },
      });
      await daemon.close();
      const reopened = new BridgeStore(databasePath);
      try {
        expect(reopened.listEvents(`host:${hostId}`).filter((event) => event.type === "host.draining")).toHaveLength(1);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
