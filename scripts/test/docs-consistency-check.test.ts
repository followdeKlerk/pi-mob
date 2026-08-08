import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

describe("documentation", () => {
  test("passes the canonical documentation checks", () => {
    const result = spawnSync("bun", ["run", "docs"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("docs:check ok");
    expect(result.stdout).toContain("docs-consistency-check ok");
  });

  test("does not restore merged documentation", () => {
    for (const path of ["docs/README.md", "docs/RELEASE.md", "docs/RUNBOOK.md", "packages/protocol-fixtures/README.md"]) {
      expect(existsSync(join(ROOT, path))).toBe(false);
    }
  });
});
