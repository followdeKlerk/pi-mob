import { describe, expect, test } from "bun:test";
import { normalizeReportedCommandCatalogue } from "../src/pi/catalogue-service";

describe("catalogue-service", () => {
  test("wraps normalized commands and reports explicit unavailable tool and MCP status", () => {
    const result = normalizeReportedCommandCatalogue([
      { name: "review", description: "Review <path>", source: "skill" },
      { name: "quit", description: "TUI", source: "extension" },
    ]);
    expect(result.commands.map((item) => item.name)).toEqual(["review"]);
    expect(result.tools).toEqual({
      state: "unavailable",
      reason: "Pi did not report tool availability in get_commands.",
      entries: [],
    });
    expect(result.mcp).toEqual({
      state: "unavailable",
      reason: "Pi did not report MCP availability in get_commands.",
      entries: [],
    });
  });

  test("uses only reported tool and MCP entries without fabricating extras", () => {
    const result = normalizeReportedCommandCatalogue({
      commands: [{ name: "release", description: "Prepare release", source: "prompt" }],
      tools: [
        { name: "read", description: "File reader" },
        { name: "bash", status: "unavailable", reason: "Shell disabled" },
      ],
      mcpServers: [{ name: "github", description: "GitHub MCP" }],
    });
    expect(result.commands.map((item) => item.name)).toEqual(["release"]);
    expect(result.tools).toEqual({
      state: "available",
      entries: [
        { name: "read", description: "File reader" },
        { name: "bash", unavailableReason: "Shell disabled" },
      ],
    });
    expect(result.mcp).toEqual({
      state: "available",
      entries: [{ name: "github", description: "GitHub MCP" }],
    });
  });
});
