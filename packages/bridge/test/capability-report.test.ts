import { describe, expect, test } from "bun:test";
import { buildReport, snapshot } from "../../../scripts/capability-report";

const WITHOUT = ["catalogue.v1", "commands.v1", "controller_leases.v1", "session_events.v2", "streams.v1"];
const WITH = ["catalogue.v1", "commands.v1", "controller_leases.v1", "notifications.v1", "session_events.v2", "streams.v1"];

describe("normal daemon capability contract", () => {
  test("without-FCM live path returns the exact set including catalogue", async () => {
    const result = await snapshot("without-fcm");
    expect(result.capabilities).toEqual(WITHOUT);
  });

  test("with-FCM live path returns the exact set including catalogue and notifications", async () => {
    const result = await snapshot("with-fcm");
    expect(result.capabilities).toEqual(WITH);
    expect(result.capabilities).toContain("notifications.v1");
  });

  test("buildReport independently proves docs parity, metadata, and row release versions", async () => {
    const report = await buildReport();
    expect(report.releaseVersion).toBe("0.0.2-alpha.1");
    expect(report.snapshots.find((item) => item.configuration === "without-fcm")?.capabilities).toEqual(WITHOUT);
    expect(report.snapshots.find((item) => item.configuration === "with-fcm")?.capabilities).toEqual(WITH);
    expect(report.capabilities.map((item) => item.capability)).toEqual([
      "streams.v1", "commands.v1", "controller_leases.v1", "session_events.v2", "catalogue.v1", "notifications.v1",
    ]);
    for (const item of report.capabilities) {
      expect(item.providerConstructionSource).toContain("packages/bridge/src/daemon.ts");
      expect(item.mobileEntryPoint).toContain("apps/mobile/");
      expect(item.focusedTestPath).toMatch(/^packages\/bridge\/test\/(capability-report\.test\.ts|session-events\/canonical-server-runtime\.test\.ts|integration\/daemon-production-wiring\.test\.ts)$/);
      expect(item.releaseVersion).toBe("0.0.2-alpha.1");
    }
  });
});
