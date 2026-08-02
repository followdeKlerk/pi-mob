/**
 * Phase 4 RED — `notification.device.register` may only register the authenticated
 * connection's installationId; a payload cannot register a different
 * installationId.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DurableBridgeRuntime } from "../src";
import { BridgeStore } from "../src/core/store";
import { generateInstallationCredential, hashCredential } from "../src/auth/credentials";

function makeRuntime(): { runtime: DurableBridgeRuntime; store: BridgeStore; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "pi-mob-device-register-"));
  const store = new BridgeStore(join(dir, "bridge.sqlite"));
  const runtime = new DurableBridgeRuntime({
    store,
    adapter: {} as never,
    bridgeVersion: "v-test",
    piVersion: "0.82.0",
    hostDisplayName: "fixture",
  });
  return { runtime, store, cleanup: () => store.close() };
}

describe("Phase 4 device.register identity binding", () => {
  test("payload claiming a different installationId is rejected", async () => {
    const handle = makeRuntime();
    try {
      const own = "99999999-9999-4999-8999-999999999999";
      const other = "88888888-8888-4888-8888-888888888888";
      const plain = generateInstallationCredential();
      handle.store.upsertInstallationCredential({
        installationId: own,
        credentialHash: hashCredential(plain),
        enrollmentSecretHash: "9".repeat(64),
        enrollmentSource: "seed",
        createdAt: 1,
        lastSeenAt: 1,
      });
      handle.store.upsertInstallationCredential({
        installationId: other,
        credentialHash: hashCredential(generateInstallationCredential()),
        enrollmentSecretHash: "8".repeat(64),
        enrollmentSource: "seed",
        createdAt: 1,
        lastSeenAt: 1,
      });
      await handle.runtime.start();
      expect(() => handle.runtime.command(
        { connectionId: "connection", installationId: own, subscriptions: new Set() },
        {
          protocol: { major: 1, minor: 0 },
          messageId: crypto.randomUUID(),
          requestId: crypto.randomUUID(),
          commandId: crypto.randomUUID(),
          type: "notification.device.register",
          sentAt: new Date().toISOString(),
          payload: { deviceId: crypto.randomUUID(), installationId: other, platform: "fcm", token: "t", appVersion: "v" },
        },
      )).toThrow("installation identity does not match");
    } finally {
      handle.cleanup();
    }
  });
});
