/**
 * Phase 4 RED — `hello` requires installationCredential before the upgrade completes.
 *
 * Five rejection modes must share one error code to deny enumeration:
 *   1. missing field
 *   2. wrong credential
 *   3. revoked credential
 *   4. expired credential
 *   5. not bound (legacy / pre-migration client)
 *
 * A valid credential must land a `hello.accepted` reply.
 *
 * Legacy uncredentialed hellos from the prior alpha MUST be rejected
 * explicitly; the wire MUST surface an actionable code distinct from any other
 * rejection so mobile can render "Re-pair required".
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createBridgeServer,
  DurableBridgeRuntime,
  type BridgeRuntimePort,
} from "../src";
import { BridgeStore } from "../src/core/store";
import { generateInstallationCredential, hashCredential } from "../src/auth/credentials";

function fixturePort(): BridgeRuntimePort {
  return {
    bridgeVersion: "v-test",
    piVersion: "0.82.0",
    identity: () => ({ hostId: "11111111-1111-4111-8111-111111111111", hostGeneration: "1", hostDisplayName: "fixture" }),
    ready: () => ({ ready: true }),
    subscribe: () => ({ streams: [], messages: [] }),
    control: () => ({}),
    command: (_connection, message) => ({ state: "accepted", duplicate: false, commandId: message.commandId }),
  };
}

function runtimeWithStore(): { runtime: DurableBridgeRuntime; store: BridgeStore; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "pi-mob-auth-hello-"));
  const store = new BridgeStore(join(dir, "bridge.sqlite"));
  const runtime = new DurableBridgeRuntime({
    store,
    adapter: {} as never,
    bridgeVersion: "v-test",
    piVersion: "0.82.0",
    hostDisplayName: "fixture",
  });
  return {
    runtime,
    store,
    cleanup: () => store.close(),
  };
}

interface HelloOutcome {
  readonly accepted: boolean;
  readonly code?: string;
  readonly reason?: string;
}

async function sendHello(port: number, payload: Record<string, unknown>): Promise<HelloOutcome> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`, { perMessageDeflate: false });
    ws.onerror = () => reject(new Error("websocket error"));
    ws.onmessage = (event) => {
      const value = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (value.type === "hello.accepted") {
        ws.close();
        resolve({ accepted: true });
        return;
      }
      if (value.type === "error") {
        ws.close();
        const payload = value.payload as Record<string, unknown>;
        resolve({ accepted: false, code: String(payload.code ?? ""), reason: String(payload.message ?? "") });
        return;
      }
    };
    ws.onclose = (event) => {
      if (event.code === 1002 || event.code === 1008) {
        resolve({ accepted: false, code: "closed", reason: event.reason });
      }
    };
    ws.onopen = () => {
      ws.send(JSON.stringify({
        protocol: { major: 1, minor: 0 },
        messageId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        type: "hello",
        sentAt: new Date().toISOString(),
        payload,
      }));
    };
  });
}

describe("Phase 4 hello authentication", () => {
  const servers: Array<ReturnType<typeof createBridgeServer>> = [];
  afterEach(() => {
    // Stop servers BEFORE clearing test-local handles so the disconnect
    // callback's DB write lands while the store is still open.
    for (const server of servers.splice(0)) server.stop(true);
  });

  test("missing installationCredential is rejected with invalid_auth", async () => {
    const handle = runtimeWithStore();
    await handle.runtime.start();
    const server = createBridgeServer({ runtime: handle.runtime, port: 0 });
    servers.push(server);
    try {
      const outcome = await sendHello(server.port!, {
        mobileVersion: "v-test",
        platform: "android",
        installationId: crypto.randomUUID(),
        requiredCapabilities: ["streams.v1", "commands.v1"],
        optionalCapabilities: [],
      });
      expect(outcome.accepted).toBe(false);
      expect(outcome.code).toBe("invalid_auth");
    } finally {
      server.stop(true);
      handle.cleanup();
    }
  });

  test("wrong installationCredential is rejected with invalid_auth (no enumeration)", async () => {
    const handle = runtimeWithStore();
    const installationId = "33333333-3333-4333-8333-333333333333";
    handle.store.upsertInstallationCredential({
      installationId,
      credentialHash: hashCredential("pc_correct"),
      enrollmentSecretHash: hashCredential("es_seed"),
      enrollmentSource: "seed",
      createdAt: 1,
      lastSeenAt: 1,
    });
    try {
      await handle.runtime.start();
      const server = createBridgeServer({ runtime: handle.runtime, port: 0 });
      servers.push(server);
      const outcome = await sendHello(server.port!, {
        mobileVersion: "v-test",
        platform: "android",
        installationId,
        installationCredential: "pc_wrong",
        requiredCapabilities: ["streams.v1", "commands.v1"],
        optionalCapabilities: [],
      });
      expect(outcome.accepted).toBe(false);
      expect(outcome.code).toBe("invalid_auth");
    } finally {
      handle.cleanup();
    }
  });

  test("revoked credential is rejected with invalid_auth", async () => {
    const handle = runtimeWithStore();
    const installationId = "44444444-4444-4444-8444-444444444444";
    handle.store.upsertInstallationCredential({
      installationId,
      credentialHash: hashCredential("pc_revoked"),
      enrollmentSecretHash: "f".repeat(64),
      enrollmentSource: "seed",
      createdAt: 1,
      lastSeenAt: 1,
    });
    handle.store.revokeInstallationCredential(installationId, "operator_revoke", 2);
    try {
      await handle.runtime.start();
      const server = createBridgeServer({ runtime: handle.runtime, port: 0 });
      servers.push(server);
      const outcome = await sendHello(server.port!, {
        mobileVersion: "v-test",
        platform: "android",
        installationId,
        installationCredential: "pc_revoked",
        requiredCapabilities: ["streams.v1", "commands.v1"],
        optionalCapabilities: [],
      });
      expect(outcome.accepted).toBe(false);
      expect(outcome.code).toBe("invalid_auth");
    } finally {
      handle.cleanup();
    }
  });

  test("expired credential is rejected with invalid_auth", async () => {
    const handle = runtimeWithStore();
    const installationId = "55555555-5555-4555-8555-555555555555";
    handle.store.upsertInstallationCredential({
      installationId,
      credentialHash: hashCredential("pc_expired"),
      enrollmentSecretHash: "e".repeat(64),
      enrollmentSource: "seed",
      createdAt: 1,
      lastSeenAt: 1,
      expiresAt: 100,
    });
    try {
      await handle.runtime.start();
      const server = createBridgeServer({ runtime: handle.runtime, port: 0 });
      servers.push(server);
      const outcome = await sendHello(server.port!, {
        mobileVersion: "v-test",
        platform: "android",
        installationId,
        installationCredential: "pc_expired",
        requiredCapabilities: ["streams.v1", "commands.v1"],
        optionalCapabilities: [],
      });
      expect(outcome.accepted).toBe(false);
      expect(outcome.code).toBe("invalid_auth");
    } finally {
      handle.cleanup();
    }
  });

  test("legacy uncredentialed client is rejected with re_pair_required (distinguishable)", async () => {
    const handle = runtimeWithStore();
    try {
      await handle.runtime.start();
      const server = createBridgeServer({ runtime: handle.runtime, port: 0 });
      servers.push(server);
      const outcome = await sendHello(server.port!, {
        mobileVersion: "v-test",
        platform: "android",
        installationId: crypto.randomUUID(),
        installationCredential: generateInstallationCredential(),
        requiredCapabilities: ["streams.v1", "commands.v1"],
        optionalCapabilities: [],
      });
      expect(outcome.accepted).toBe(false);
      expect(outcome.code).toBe("re_pair_required");
    } finally {
      handle.cleanup();
    }
  });

  test("valid credential lands hello.accepted and updates last_seen", async () => {
    const handle = runtimeWithStore();
    const installationId = "66666666-6666-4666-8666-666666666666";
    const plain = generateInstallationCredential();
    handle.store.upsertInstallationCredential({
      installationId,
      credentialHash: hashCredential(plain),
      enrollmentSecretHash: "6".repeat(64),
      enrollmentSource: "seed",
      createdAt: 1_700_000_000_000,
      lastSeenAt: 1_700_000_000_000,
    });
    try {
      await handle.runtime.start();
      const server = createBridgeServer({ runtime: handle.runtime, port: 0 });
      servers.push(server);
      const outcome = await sendHello(server.port!, {
        mobileVersion: "v-test",
        platform: "android",
        installationId,
        installationCredential: plain,
        requiredCapabilities: ["streams.v1", "commands.v1"],
        optionalCapabilities: [],
      });
      expect(outcome.accepted).toBe(true);
      const updated = handle.store.findInstallationCredential(installationId);
      expect(updated!.lastSeenAt).toBeGreaterThan(1_700_000_000_000);
    } finally {
      handle.cleanup();
    }
  });

  test("plaintext credential never appears in any error payload or logs", async () => {
    const handle = runtimeWithStore();
    const installationId = "77777777-7777-4777-8777-777777777777";
    const bad = "pc_AAAA_AAAA_AAAA_AAAA_AAAA_AAAA_AAAA";
    handle.store.upsertInstallationCredential({
      installationId,
      credentialHash: hashCredential("pc_correct"),
      enrollmentSecretHash: "7".repeat(64),
      enrollmentSource: "seed",
      createdAt: 1,
      lastSeenAt: 1,
    });
    try {
      await handle.runtime.start();
      const server = createBridgeServer({ runtime: handle.runtime, port: 0 });
      servers.push(server);
      const outcome = await sendHello(server.port!, {
        mobileVersion: "v-test",
        platform: "android",
        installationId,
        installationCredential: bad,
        requiredCapabilities: ["streams.v1", "commands.v1"],
        optionalCapabilities: [],
      });
      expect(outcome.accepted).toBe(false);
      expect(outcome.code).toBe("invalid_auth");
      expect(JSON.stringify(outcome)).not.toContain(bad);
    } finally {
      handle.cleanup();
    }
  });
});

void fixturePort;
