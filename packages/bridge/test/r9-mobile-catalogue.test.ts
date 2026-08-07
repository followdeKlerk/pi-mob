import { describe, expect, test } from "bun:test";
import { MobileCatalogueService } from "../src/pi/mobile-catalogue-service";

describe("R9 mobile catalogue", () => {
  test("reports only authoritative entries and explicit unavailable MCP", async () => {
    const service = new MobileCatalogueService({
      read: async () => ({
        commands: [{ name: "standup", source: "prompt", description: "Daily summary" }],
      }),
    });
    const snapshot = await service.snapshot("session-1");
    const entries = snapshot.entries as unknown as readonly Record<string, unknown>[];
    expect(entries.some((entry) => entry["name"] === "standup" && entry["invocation"] === "/standup")).toBe(true);
    expect(entries.some((entry) => entry["kind"] === "mcp_server" && (entry["availability"] as Record<string, unknown>)["state"] === "unavailable")).toBe(true);
    expect(entries.some((entry) => entry["name"] === "status")).toBe(false);
    expect(snapshot.sessionId).toBe("session-1");
    expect(snapshot.revision).toBe("catalogue-1");
  });

  test("toggle remains unavailable without an explicit source action", async () => {
    const service = new MobileCatalogueService({ read: async () => [] });
    await expect(service.setEnabled("skill:x", true, "rev-1")).rejects.toThrow("unavailable");
  });

  test("toggle is forwarded to the source when it advertises setEnabled", async () => {
    let received: { entryId: string; enabled: boolean; expectedRevision: string } | null = null;
    const service = new MobileCatalogueService({
      read: async () => ({ commands: [] }),
      setEnabled: async (entryId, enabled, expectedRevision) => {
        received = { entryId, enabled, expectedRevision };
        return { revision: "catalogue-2", reloadRequired: true };
      },
    });
    const result = await service.setEnabled("skill:standup", false, "catalogue-1");
    expect(result).toMatchObject({ revision: "catalogue-2", reloadRequired: true });
    expect(received).toMatchObject({ entryId: "skill:standup", enabled: false, expectedRevision: "catalogue-1" });
  });

  test("clamps oversize catalogue snapshot to the canonical 512-entry bound", async () => {
    const commands = Array.from({ length: 600 }, (_, i) => ({
      name: `cmd-${i}`,
      source: "prompt",
    }));
    const service = new MobileCatalogueService({ read: async () => ({ commands }) });
    const snapshot = await service.snapshot("session-1");
    // The normalised command catalogue already caps the per-category list;
    // this test ensures the combined entries array never overflows the
    // 512-entry bound at the wire layer regardless of upstream cardinality.
    expect(snapshot.entries.length).toBeLessThanOrEqual(512);
    expect(snapshot.entries.length).toBeGreaterThan(0);
  });
});
