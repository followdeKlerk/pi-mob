/**
 * M15 — Handshake capability advertisement for `notifications.v1`.
 *
 * The bridge only advertises `notifications.v1` in the
 * `hello.accepted.capabilities` handshake when a notification
 * service is genuinely available. Capability-aware clients rely on
 * that advertisement to switch out of the "Notifications
 * unavailable" state, so the wiring must be exercised end-to-end
 * through the live server (not just via the runtime's
 * `optionalCapabilities()` accessor).
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createBridgeServer,
  DurableBridgeRuntime,
  type BridgeRuntimePort,
} from "../src";
import { BridgeStore } from "../src/core/store";
import { BridgeNotificationService } from "../src/notifications/service";
import { NoopTransport } from "../src/notifications/transports/noop";
import { hashCredential } from "../src/auth/credentials";

const INSTALLATION_ID = "33333333-3333-4333-8333-333333333333";
const INSTALLATION_CREDENTIAL = "pc_test_credential";
const SERVER_CAPABILITIES = new Set([
  "streams.v1",
  "commands.v1",
  "controller_leases.v1",
]);

function fixtureRuntime(opts: {
  readonly notifications?: BridgeNotificationService;
  readonly bridgeVersion?: string;
}): {
  readonly runtime: DurableBridgeRuntime;
  readonly store: BridgeStore;
  readonly cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "pi-mob-m15-handshake-"));
  const store = new BridgeStore(join(dir, "bridge.sqlite"));
  store.upsertInstallationCredential({ installationId: INSTALLATION_ID, credentialHash: hashCredential(INSTALLATION_CREDENTIAL), enrollmentSecretHash: "e".repeat(64), enrollmentSource: "seed", createdAt: Date.now(), lastSeenAt: Date.now() });
  const adapter: BridgeRuntimePort["control"] = () => ({});
  const adapterPort = {
    dispatch: async () => undefined,
    control,
  } as unknown as ConstructorParameters<typeof DurableBridgeRuntime>[0]["adapter"];
  function control(): unknown { return adapter; }
  const runtime = new DurableBridgeRuntime({
    store,
    adapter: adapterPort,
    bridgeVersion: opts.bridgeVersion ?? "fixture",
    piVersion: "0.82.0",
    hostDisplayName: "fixture",
    ...(opts.notifications ? { notifications: opts.notifications } : {}),
  });
  return {
    runtime,
    store,
    cleanup: () => {
      store.close();
    },
  };
}

function buildNotificationService(store: BridgeStore): BridgeNotificationService {
  return new BridgeNotificationService({
    store,
    apns: new NoopTransport({ platform: "apns" }),
    fcm: new NoopTransport({ platform: "fcm" }),
  });
}

describe("M15 notifications handshake capability advertisement", () => {
  test("optionalCapabilities omits notifications.v1 when no service is configured", () => {
    const handle = fixtureRuntime({});
    try {
      const caps = handle.runtime.optionalCapabilities();
      expect(caps).not.toContain("notifications.v1");
      for (const core of SERVER_CAPABILITIES) expect(caps).not.toContain(core);
    } finally {
      handle.cleanup();
    }
  });

  test("optionalCapabilities advertises notifications.v1 only when a service is injected", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-mob-m15-handshake-"));
    const store = new BridgeStore(join(dir, "bridge.sqlite"));
    const service = buildNotificationService(store);
    const handle = fixtureRuntime({ notifications: service });
    try {
      const caps = handle.runtime.optionalCapabilities();
      expect(caps).toContain("notifications.v1");
      for (const core of SERVER_CAPABILITIES) expect(caps).not.toContain(core);
    } finally {
      service.unregisterInstallation("00000000-0000-4000-8000-000000000000");
      handle.cleanup();
    }
  });

  test("hello.accepted advertises notifications.v1 when a notification service is configured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-mob-m15-handshake-"));
    const store = new BridgeStore(join(dir, "bridge.sqlite"));
    const service = buildNotificationService(store);
    const handle = fixtureRuntime({ notifications: service });
    try {
      await handle.runtime.start();
      const server = createBridgeServer({ runtime: handle.runtime, port: 0 });
      try {
        const accepted = await helloCapabilities(server.port!);
        expect(accepted.capabilities).toContain("notifications.v1");
      } finally {
        server.stop(true);
      }
    } finally {
      service.unregisterInstallation("00000000-0000-4000-8000-000000000000");
      handle.cleanup();
    }
  });

  test("hello.accepted omits notifications.v1 when no notification service is configured", async () => {
    const handle = fixtureRuntime({});
    try {
      await handle.runtime.start();
      const server = createBridgeServer({ runtime: handle.runtime, port: 0 });
      try {
        const accepted = await helloCapabilities(server.port!);
        expect(accepted.capabilities).not.toContain("notifications.v1");
        for (const core of SERVER_CAPABILITIES) expect(accepted.capabilities).toContain(core);
      } finally {
        server.stop(true);
      }
    } finally {
      handle.cleanup();
    }
  });
});

interface HelloAccepted {
  readonly connectionId: string;
  readonly capabilities: readonly string[];
}

async function helloCapabilities(port: number): Promise<HelloAccepted> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`, { perMessageDeflate: false });
    ws.onmessage = (event) => {
      const value = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (value.type !== "hello.accepted") return;
      const payload = value.payload as Record<string, unknown>;
      ws.close();
      resolve({
        connectionId: String(payload.connectionId),
        capabilities: Array.isArray(payload.capabilities)
          ? (payload.capabilities as readonly string[])
          : [],
      });
    };
    ws.onerror = () => reject(new Error("websocket error"));
    ws.onopen = () => {
      ws.send(JSON.stringify({
        protocol: { major: 1, minor: 0 },
        messageId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        type: "hello",
        sentAt: new Date().toISOString(),
        payload: {
          mobileVersion: "1",
          platform: "android",
          installationId: INSTALLATION_ID,
          installationCredential: INSTALLATION_CREDENTIAL,
          requiredCapabilities: ["streams.v1", "commands.v1"],
          optionalCapabilities: [],
        },
      }));
    };
  });
}
