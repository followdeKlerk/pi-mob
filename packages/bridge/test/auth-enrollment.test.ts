/**
 * Phase 4 RED — one-time enrollment secret binds atomically.
 *
 * The QR / typed pair flow mints an enrollment secret. The first client to
 * POST it with an installationId atomically binds both. Replays and races
 * must fail without rolling back, and the secret must expire.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createBridgeServer,
  DurableBridgeRuntime,
} from "../src";
import { BridgeStore } from "../src/core/store";
import {
  generateInstallationCredential,
  hashPairingPasscode,
  issuePairingPasscode,
} from "../src/auth/credentials";
import { bindEnrollment } from "../src/auth/enrollment";

function setupStore(): { store: BridgeStore; cleanup: () => void } {
  const store = new BridgeStore(join(mkdtempSync(join(tmpdir(), "pi-mob-auth-enroll-")), "bridge.sqlite"));
  return { store, cleanup: () => store.close() };
}

function setupRuntime(): { runtime: DurableBridgeRuntime; store: BridgeStore; cleanup: () => void } {
  const handle = setupStore();
  const runtime = new DurableBridgeRuntime({
    store: handle.store,
    adapter: {} as never,
    bridgeVersion: "v-test",
    piVersion: "0.82.0",
    hostDisplayName: "fixture",
  });
  return { runtime, store: handle.store, cleanup: handle.cleanup };
}

describe("Phase 4 enrollment binding", () => {
  let store: BridgeStore;
  let cleanup: () => void;
  beforeEach(() => {
    const handle = setupRuntime();
    store = handle.store;
    cleanup = handle.cleanup;
  });
  afterEach(() => cleanup());

  test("first bind mints the long-lived credential and consumes the enrollment secret", async () => {
    const secret = issuePairingPasscode();
    store.createEnrollmentSecret({ secretHash: hashPairingPasscode(secret), createdAt: 1, expiresAt: 1_000_000 });
    const installationId = "11111111-2222-4333-8444-555555555555";
    const result = bindEnrollment({
      store,
      installationId,
      plainPasscode: secret,
      issueCredential: () => generateInstallationCredential(),
      now: () => 5,
    });
    expect(result.kind).toBe("bound");
    if (result.kind !== "bound") throw new Error("expected bound");
    expect(result.credential).toMatch(/^pc_[A-Za-z0-9_-]{43}$/);
    expect(store.findInstallationCredential(installationId)).not.toBeNull();
  });

  test("replay of the same enrollment secret is rejected", () => {
    const secret = issuePairingPasscode();
    store.createEnrollmentSecret({ secretHash: hashPairingPasscode(secret), createdAt: 1, expiresAt: 1_000_000 });
    const installationId = "11111111-2222-4333-8444-666666666666";
    expect(bindEnrollment({
      store,
      installationId,
      plainPasscode: secret,
      issueCredential: () => generateInstallationCredential(),
      now: () => 5,
    }).kind).toBe("bound");
    expect(bindEnrollment({
      store,
      installationId,
      plainPasscode: secret,
      issueCredential: () => generateInstallationCredential(),
      now: () => 6,
    }).kind).toBe("already_used");
  });

  test("racing concurrent binds leave exactly one winner", async () => {
    const secret = issuePairingPasscode();
    store.createEnrollmentSecret({ secretHash: hashPairingPasscode(secret), createdAt: 1, expiresAt: 1_000_000 });
    const installationId = "11111111-2222-4333-8444-777777777777";
    const promises = Array.from({ length: 8 }, () => Promise.resolve().then(() => bindEnrollment({
      store,
      installationId,
      plainPasscode: secret,
      issueCredential: () => generateInstallationCredential(),
      now: () => 7,
    })));
    const outcomes = await Promise.all(promises);
    const winners = outcomes.filter((item) => item.kind === "bound");
    expect(winners.length).toBe(1);
  });

  test("expired enrollment secret is refused (no credential is minted)", () => {
    const secret = issuePairingPasscode();
    store.createEnrollmentSecret({ secretHash: hashPairingPasscode(secret), createdAt: 1, expiresAt: 2 });
    const installationId = "11111111-2222-4333-8444-888888888888";
    const result = bindEnrollment({
      store,
      installationId,
      plainPasscode: secret,
      issueCredential: () => generateInstallationCredential(),
      now: () => 10,
    });
    expect(result.kind).toBe("expired");
    expect(store.findInstallationCredential(installationId)).toBeNull();
  });

  test("unknown enrollment secret is rejected without enrollment row", () => {
    const installationId = "11111111-2222-4333-8444-999999999999";
    const result = bindEnrollment({
      store,
      installationId,
      plainPasscode: "000000",
      issueCredential: () => generateInstallationCredential(),
      now: () => 1,
    });
    expect(result.kind).toBe("unknown");
    expect(store.findInstallationCredential(installationId)).toBeNull();
  });
});

describe("Phase 4 enrollment endpoint on the bridge", () => {
  test("POST /v1/enroll binds the credential and returns a one-time plaintext", async () => {
    const handle = setupStore();
    try {
      const runtime = new DurableBridgeRuntime({
        store: handle.store,
        adapter: {} as never,
        bridgeVersion: "v-test",
        piVersion: "0.82.0",
        hostDisplayName: "fixture",
      });
      await runtime.start();
      const server = createBridgeServer({ runtime, port: 0 });
      try {
        // Issue a pending enrollment secret via the runtime's admin path.
        const secret = issuePairingPasscode();
        handle.store.createEnrollmentSecret({ secretHash: hashPairingPasscode(secret), createdAt: Date.now(), expiresAt: Date.now() + 60_000 });
        const installationId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
        const response = await fetch(`http://127.0.0.1:${server.port}/v1/enroll`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ installationId, passcode: secret }),
        });
        expect(response.status).toBe(201);
        const body = await response.json() as Record<string, unknown>;
        expect(body.installationId).toBe(installationId);
        expect(body.installationCredential).toMatch(/^pc_[A-Za-z0-9_-]{43}$/);
        const replay = await fetch(`http://127.0.0.1:${server.port}/v1/enroll`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ installationId, passcode: secret }),
        });
        expect(replay.status).toBe(410);
      } finally {
        server.stop(true);
      }
    } finally {
      handle.cleanup();
    }
  });
});
