import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LIMITS } from "@pi-mob/protocol-schema";
import { WorkspaceFileError, WorkspaceFileService, type WorkspaceFileErrorCode } from "../src/core/workspace-files";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-r3-")); roots.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "alpha.ts"), "const café = 1;\nsecond line\nneedle here\n");
  writeFileSync(join(root, "README.md"), "Needle docs\n");
  return { root, service: new WorkspaceFileService([{ workspaceId: "00000000-0000-4000-8000-000000000003", canonicalPath: realpathSync(root) }], () => 1_700_000_000_000) };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function code(fn: () => unknown, expected: WorkspaceFileErrorCode) { try { fn(); throw new Error("did not throw"); } catch (error) { expect(error).toBeInstanceOf(WorkspaceFileError); expect((error as WorkspaceFileError).code).toBe(expected); } }
const id = "00000000-0000-4000-8000-000000000003";

describe("bounded workspace file service", () => {
  test("confines canonical paths and rejects traversal and every symlink", () => {
    const { root, service } = fixture(); const outside = mkdtempSync(join(tmpdir(), "pi-outside-")); roots.push(outside);
    writeFileSync(join(outside, "secret"), "secret"); symlinkSync(join(outside, "secret"), join(root, "link"));
    code(() => service.metadata({ workspaceId: id, path: "../secret" }), "path_invalid");
    code(() => service.metadata({ workspaceId: id, path: "/etc/passwd" }), "path_invalid");
    code(() => service.metadata({ workspaceId: id, path: "link" }), "path_denied");
    expect(JSON.stringify(service.treePage({ workspaceId: id, pageSize: 20, pageToken: null }))).not.toContain(outside);
    expect(service.treePage({ workspaceId: id, pageSize: 20, pageToken: null }).items.map((x) => x.path)).not.toContain("link");
  });

  test("metadata/read require bounded valid UTF-8 text and revisions", () => {
    const { root, service } = fixture();
    const meta = service.metadata({ workspaceId: id, path: "src/alpha.ts" }).file;
    expect(meta.sha256).toHaveLength(64); expect(meta.languageHint).toBe("typescript"); expect(meta.revision).toMatch(/^file-[0-9a-f]{64}$/);
    const page = service.read({ workspaceId: id, path: "src/alpha.ts", rangeStart: 1, rangeEnd: 2, expectedRevision: meta.revision }).result;
    expect(page.content).toBe("const café = 1;\nsecond line"); expect(page.totalLines).toBe(3); expect(Buffer.byteLength(page.content)).toBeLessThanOrEqual(LIMITS.maxFileReadBytes);
    expect(service.validateReference({ workspaceId: id, path: "src/alpha.ts", revision: meta.revision, digest: meta.sha256, ranges: [{ startLine: 2, endLine: 3 }] }).revision).toBe(meta.revision);
    code(() => service.validateReference({ workspaceId: id, path: "src/alpha.ts", revision: meta.revision, digest: "b".repeat(64) }), "file_stale");
    writeFileSync(join(root, "src", "alpha.ts"), "changed\n");
    code(() => service.read({ workspaceId: id, path: "src/alpha.ts", rangeStart: 1, rangeEnd: 1, expectedRevision: meta.revision }), "file_stale");
    writeFileSync(join(root, "bad.bin"), Buffer.from([...Buffer.from("ok\n"), 0xff]));
    expect(service.metadata({ workspaceId: id, path: "bad.bin" }).file.isBinary).toBe(true);
    code(() => service.read({ workspaceId: id, path: "bad.bin", rangeStart: 1, rangeEnd: 1 }), "path_binary");
    code(() => service.read({ workspaceId: id, path: "README.md", rangeStart: 1, rangeEnd: LIMITS.maxFileReadLines + 1 }), "path_oversize");
  });

  test("tree and searches page with workspace-bound repeatable opaque tokens", () => {
    const { root, service } = fixture();
    const first = service.treePage({ workspaceId: id, pageSize: 1, pageToken: null }); expect(first.items).toHaveLength(1); expect(first.nextPageToken).toBeTruthy(); expect(first.rootRevision).toMatch(/^tree-[0-9a-f]{64}$/);
    const token = first.nextPageToken!; const second = service.treePage({ workspaceId: id, pageSize: 1, pageToken: token }); expect(second.items).toHaveLength(1);
    expect(service.treePage({ workspaceId: id, pageSize: 1, pageToken: token }).items).toEqual(second.items);
    const otherRoot = mkdtempSync(join(tmpdir(), "pi-r3-other-")); roots.push(otherRoot); writeFileSync(join(otherRoot, "other.txt"), "other");
    const other = new WorkspaceFileService([{ workspaceId: "00000000-0000-4000-8000-000000000004", canonicalPath: realpathSync(otherRoot) }], () => 1_700_000_000_000);
    code(() => other.treePage({ workspaceId: "00000000-0000-4000-8000-000000000004", pageSize: 1, pageToken: token }), "page_invalid");
    const stale = service.treePage({ workspaceId: id, pageSize: 1, pageToken: null }); const staleToken = stale.nextPageToken!; writeFileSync(join(root, "new.txt"), "new");
    code(() => service.treePage({ workspaceId: id, pageSize: 1, pageToken: staleToken }), "page_stale");
    const names = service.filenameSearch({ workspaceId: id, query: "alpha" }); expect(names.items.map((x) => x.path)).toEqual(["src/alpha.ts"]);
    const longNeedlePrefix = "x".repeat(5000);
    writeFileSync(join(root, "src", "long.txt"), `${longNeedlePrefix}needle tail\n`);
    const content = service.contentSearch({ workspaceId: id, query: "needle" }); expect(content.items.map((x) => [x.path, x.line])).toEqual([["README.md", 1], ["src/alpha.ts", 3], ["src/long.txt", 1]]); expect(content.items[2]!.lineText).toContain("needle"); expect(content.items[2]!.matchStart + content.items[2]!.matchLength).toBeLessThanOrEqual(Buffer.byteLength(content.items[2]!.lineText)); expect(content.isTruncated).toBe(false);
  });

  test("bounds huge traversal before building an unbounded response", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-r3-huge-")); roots.push(root);
    for (let i = 0; i <= 10_000; i++) writeFileSync(join(root, `file-${i.toString().padStart(5, '0')}.txt`), "x\n");
    const service = new WorkspaceFileService([{ workspaceId: id, canonicalPath: realpathSync(root) }], () => 1_700_000_000_000);
    code(() => service.treePage({ workspaceId: id, pageSize: 1, pageToken: null }), "path_oversize");
  });

  test("evicts expired and oldest page tokens from the bounded token map", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-r3-tokens-")); roots.push(root);
    for (let i = 0; i < 3; i++) writeFileSync(join(root, `file-${i.toString().padStart(4, '0')}.txt`), "x\n");
    let now = 1_700_000_000_000;
    const service = new WorkspaceFileService([{ workspaceId: id, canonicalPath: realpathSync(root) }], () => now);
    const first = service.treePage({ workspaceId: id, pageSize: 1, pageToken: null });
    const firstToken = first.nextPageToken!;
    for (let i = 0; i < 260; i++) service.treePage({ workspaceId: id, pageSize: 1, pageToken: null });
    code(() => service.treePage({ workspaceId: id, pageSize: 1, pageToken: firstToken }), "page_invalid");
    const expiring = service.treePage({ workspaceId: id, pageSize: 1, pageToken: null }).nextPageToken!;
    now += 60_001;
    code(() => service.treePage({ workspaceId: id, pageSize: 1, pageToken: expiring }), "page_invalid");
  });

  test("content search truncates when scan budget or elapsed time is exhausted", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-r3-search-")); roots.push(root);
    for (let i = 0; i < 4; i++) writeFileSync(join(root, `match-${i}.txt`), `${"a".repeat(100_000)} needle ${i}\n`);
    let now = 1_700_000_000_000;
    const service = new WorkspaceFileService([{ workspaceId: id, canonicalPath: realpathSync(root) }], () => now, () => { now += 800; });
    const result = service.contentSearch({ workspaceId: id, query: "needle" });
    expect(result.isTruncated).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.length).toBeLessThan(4);
  });

  test("rejects inode swaps that occur after open but before canonical verification", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-r3-swap-")); roots.push(root);
    writeFileSync(join(root, "safe.txt"), "safe\n");
    writeFileSync(join(root, "replacement.txt"), "replacement\n");
    const service = new WorkspaceFileService([{ workspaceId: id, canonicalPath: realpathSync(root) }], () => 1_700_000_000_000, (absolute) => {
      if (!absolute.endsWith("safe.txt")) return;
      const moved = join(root, "safe-moved.txt");
      if (!readFileSync(absolute, "utf8").startsWith("safe")) return;
      renameSync(absolute, moved);
      symlinkSync(join(root, "replacement.txt"), absolute);
    });
    code(() => service.metadata({ workspaceId: id, path: "safe.txt" }), "path_unavailable");
  });
});
