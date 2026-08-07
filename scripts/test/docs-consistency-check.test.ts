import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

describe("docs-consistency-check", () => {
  test("passes against the repository's current public claims", () => {
    const result = spawnSync("bun", ["run", "scripts/docs-consistency-check.ts"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("docs-consistency-check ok");
  });

  test("is part of the canonical docs command", () => {
    const result = spawnSync("bun", ["run", "docs"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("docs-consistency-check ok");
  });
});
