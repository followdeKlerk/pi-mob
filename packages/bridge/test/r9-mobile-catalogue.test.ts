import { describe, expect, test } from "bun:test";
import { MobileCatalogueService } from "../src/pi/mobile-catalogue-service";

describe("R9 mobile catalogue", () => {
  test("reports only authoritative entries and explicit unavailable MCP", async () => {
    const service = new MobileCatalogueService({ read: async () => ({ commands: [{ name: "standup", source: "prompt", description: "Daily summary" }] }) });
    const snapshot = await service.snapshot();
    const entries = snapshot.entries as Array<Record<string, unknown>>;
    expect(entries.some((entry) => entry.name === "standup" && entry.invocation === "/standup")).toBe(true);
    expect(entries.some((entry) => entry.kind === "mcp_server" && (entry.availability as Record<string, unknown>).state === "unavailable")).toBe(true);
    expect(entries.some((entry) => entry.name === "status")).toBe(false);
  });

  test("toggle remains unavailable without an explicit source action", async () => {
    const service = new MobileCatalogueService({ read: async () => [] });
    expect(service.setEnabled("skill:x", true, "rev-1")).rejects.toThrow("unavailable");
  });
});
