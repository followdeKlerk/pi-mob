import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BridgeStore } from "../src/core/store";
import { BridgeNotificationService } from "../src/notifications/service";
import { NoopTransport } from "../src/notifications/transports/noop";
import {
  loadFcmServiceAccount,
  parseCliArgs,
  parseFcmServiceAccountJson,
  UnavailableApnsTransport,
} from "../src/daemon";

describe("M15 production FCM daemon configuration", () => {
  const fixture = {
    type: "service_account",
    project_id: "fixture-project",
    client_email: "push@fixture-project.iam.gserviceaccount.com",
    private_key: [
      ["-----BEGIN", "PRIVATE KEY-----"].join(" "),
      "ZmFrZQ==",
      ["-----END", "PRIVATE KEY-----"].join(" "),
      "",
    ].join("\n"),
  };

  test("loads only the required service-account fields without exposing the key", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-mob-fcm-"));
    const path = join(dir, "service-account.json");
    writeFileSync(path, JSON.stringify(fixture), { mode: 0o600 });
    chmodSync(path, 0o600);

    const loaded = loadFcmServiceAccount(path);
    expect(loaded.projectId).toBe("fixture-project");
    expect(loaded.serviceAccountEmail).toBe(
      "push@fixture-project.iam.gserviceaccount.com",
    );
    expect(loaded.privateKey).toBe(fixture.private_key);

    chmodSync(path, 0o644);
    expect(() => loadFcmServiceAccount(path)).toThrow("group or other users");
  });

  test("rejects malformed credentials and relative CLI paths", () => {
    expect(() => parseFcmServiceAccountJson({ ...fixture, type: "user" })).toThrow(
      "type",
    );
    expect(() =>
      parseFcmServiceAccountJson({ ...fixture, private_key: "secret" }),
    ).toThrow("PEM");
    expect(() =>
      parseCliArgs(["--fcm-service-account", "relative/key.json"]),
    ).toThrow("absolute");
  });

  test("FCM-only service rejects and hides APNs registrations", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-mob-fcm-store-"));
    const store = new BridgeStore(join(dir, "bridge.sqlite"));
    const service = new BridgeNotificationService({
      store,
      apns: new NoopTransport({ platform: "apns" }),
      fcm: new NoopTransport({ platform: "fcm" }),
      supportedPlatforms: ["fcm"],
    });
    const base = {
      installationId: "22222222-2222-4222-8222-222222222222",
      pushToken: "token",
      appVersion: "1",
    } as const;
    expect(() => service.registerDevice({ ...base, platform: "apns" })).toThrow(
      "not configured",
    );
    service.registerDevice({ ...base, platform: "fcm" });
    expect(service.listDevices().map((device) => device.platform)).toEqual([
      "fcm",
    ]);
    store.close();
  });

  test("accepts an absolute credential path and APNs remains unavailable", async () => {
    const parsed = parseCliArgs([
      "--fcm-service-account",
      "/private/pi-mob/firebase-service-account.json",
    ]);
    expect(parsed.fcmServiceAccount).toBe(
      "/private/pi-mob/firebase-service-account.json",
    );
    expect(await new UnavailableApnsTransport().send()).toEqual({
      kind: "transient_failure",
      reason: "apns_not_configured",
    });
  });
});
