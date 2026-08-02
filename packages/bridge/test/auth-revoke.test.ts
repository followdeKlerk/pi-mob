/**
 * Phase 4 RED — host-side revocation path.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBridgeServer, DurableBridgeRuntime } from "../src";
import { BridgeStore } from "../src/core/store";
import { generateInstallationCredential, hashCredential } from "../src/auth/credentials";
import { revokeInstallationCredential } from "../src/auth/revoke";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "pi-mob-auth-revoke-"));
  const store = new BridgeStore(join(dir, "bridge.sqlite"));
  return { store, cleanup: () => store.close() };
}

describe("Phase 4 host-side revocation", () => {
  const handles: Array<ReturnType<typeof setup>> = [];
  afterEach(async () => {
    while (handles.length) await handles.pop()!.cleanup();
  });

  test("revocation marks revoked_at and refuses later hello", async () => {
    const handle = setup();
    handles.push(handle);
    const installationId = "11111111-2222-4333-8444-aaaaaaaaaaaa";
    const plain = generateInstallationCredential();
    handle.store.upsertInstallationCredential({
      installationId,
      credentialHash: hashCredential(plain),
      enrollmentSecretHash: "0".repeat(64),
      enrollmentSource: "seed",
      createdAt: 1,
      lastSeenAt: 1,
    });
    revokeInstallationCredential({ store: handle.store, installationId, reason: "operator_revoke", at: 2 });
    const row = handle.store.findInstallationCredential(installationId);
    expect(row?.revokedAt).toBe(2);
    expect(row?.revokedReason).toBe("operator_revoke");

    const runtime = new DurableBridgeRuntime({ store: handle.store, adapter: {} as never, bridgeVersion: "v-test", piVersion: "0.82.0", hostDisplayName: "fixture" });
    await runtime.start();
    const server = createBridgeServer({ runtime, port: 0 });
    try {
      const outcome = await new Promise<{ accepted: boolean; code?: string }>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/v1/ws`, { perMessageDeflate: false });
        ws.onerror = () => reject(new Error("ws"));
        ws.onmessage = (event) => {
          const value = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (value.type === "hello.accepted") {
            ws.close();
            resolve({ accepted: true });
            return;
          }
          if (value.type === "error") {
            ws.close();
            resolve({ accepted: false, code: String((value.payload as Record<string, unknown>).code) });
          }
        };
        ws.onopen = () => ws.send(JSON.stringify({
          protocol: { major: 1, minor: 0 },
          messageId: crypto.randomUUID(),
          requestId: crypto.randomUUID(),
          type: "hello",
          sentAt: new Date().toISOString(),
          payload: {
            mobileVersion: "v-test",
            platform: "android",
            installationId,
            installationCredential: plain,
            requiredCapabilities: ["streams.v1", "commands.v1"],
            optionalCapabilities: [],
          },
        }));
      });
      expect(outcome.accepted).toBe(false);
      expect(outcome.code).toBe("invalid_auth");
    } finally {
      server.stop(true);
    }
  });
});
