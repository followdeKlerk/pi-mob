import { describe, expect, test } from "bun:test";
import { buildReport, snapshot } from "../../../scripts/capability-report";

const WITHOUT = ["commands.v1", "controller_leases.v1", "raw_rpc.v1", "streams.v1"];
const WITH = ["commands.v1", "controller_leases.v1", "notifications.v1", "raw_rpc.v1", "streams.v1"];

describe("normal daemon capability contract", () => {
  test("without-FCM live path returns the exact set and no catalogue", async () => {
    const result = await snapshot("without-fcm");
    expect(result.capabilities).toEqual(WITHOUT);
    expect(result.capabilities).not.toContain("catalogue.v1");
  });

  test("with-FCM live path returns the exact set including notifications and no catalogue", async () => {
    const result = await snapshot("with-fcm");
    expect(result.capabilities).toEqual(WITH);
    expect(result.capabilities).toContain("notifications.v1");
    expect(result.capabilities).not.toContain("catalogue.v1");
  });

  test("buildReport independently proves docs parity, metadata, and row release versions", async () => {
    const report = await buildReport();
    expect(report.releaseVersion).toBe("0.0.1-alpha.1");
    expect(report.snapshots.find((item) => item.configuration === "without-fcm")?.capabilities).toEqual(WITHOUT);
    expect(report.snapshots.find((item) => item.configuration === "with-fcm")?.capabilities).toEqual(WITH);
    expect(report.capabilities.map((item) => item.capability)).toEqual([
      "streams.v1", "commands.v1", "controller_leases.v1", "raw_rpc.v1", "notifications.v1",
    ]);
    for (const item of report.capabilities) {
      expect(item.providerConstructionSource).toContain("packages/bridge/src/daemon.ts");
      expect(item.mobileEntryPoint).toContain("apps/mobile/");
      expect(item.focusedTestPath).toBe("packages/bridge/test/capability-report.test.ts");
      expect(item.releaseVersion).toBe("0.0.1-alpha.1");
    }
  });
});
