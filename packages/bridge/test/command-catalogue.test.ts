import { describe, expect, test } from "bun:test";
import { commandPrompt, isTuiOnlyCommand, normalizeCommandCatalogue, searchCommandCatalogue } from "../src";

describe("M10 safe command catalogue", () => {
  test("categorizes, bounds, redacts, searches, and excludes TUI-only commands", () => {
    const commands = normalizeCommandCatalogue([
      { name: "review", description: "Review <path>", source: "skill", sourceInfo: { path: "/private/repo", apiKey: "secret" } },
      { name: "release", description: "Prepare release", source: "prompt" },
      { name: "deploy", description: "Deploy safely", source: "extension" },
      { name: "quit", description: "TUI", source: "extension" },
      { name: "review", description: "duplicate", source: "skill" },
    ]);
    expect(commands.map((item) => item.category)).toEqual(["skill", "template", "extension"]);
    expect(commands[0]).toEqual({ name: "review", description: "Review <path>", category: "skill", requiresInput: true });
    expect(JSON.stringify(commands)).not.toContain("private/repo");
    expect(JSON.stringify(commands)).not.toContain("secret");
    expect(searchCommandCatalogue(commands, "release").map((item) => item.name)).toEqual(["release"]);
    expect(commandPrompt(commands[0]!, "src")).toBe("/review src");
    expect(isTuiOnlyCommand("/quit")).toBe(true);
  });
});
