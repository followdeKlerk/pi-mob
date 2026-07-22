import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
    expect(meta.sha256).toHaveLength(64); expect(meta.languageHint).toBe("typescript");
    const page = service.read({ workspaceId: id, path: "src/alpha.ts", rangeStart: 1, rangeEnd: 2, expectedRevision: meta.revision }).result;
    expect(page.content).toBe("const café = 1;\nsecond line"); expect(page.totalLines).toBe(3); expect(Buffer.byteLength(page.content)).toBeLessThanOrEqual(LIMITS.maxFileReadBytes);
    expect(service.validateReference({ workspaceId: id, path: "src/alpha.ts", revision: meta.revision, digest: meta.sha256, ranges: [{ startLine: 2, endLine: 3 }] }).revision).toBe(meta.revision);
    code(() => service.validateReference({ workspaceId: id, path: "src/alpha.ts", revision: meta.revision, digest: "b".repeat(64) }), "file_stale");
    writeFileSync(join(root, "src", "alpha.ts"), "changed\n");
    code(() => service.read({ workspaceId: id, path: "src/alpha.ts", rangeStart: 1, rangeEnd: 1, expectedRevision: meta.revision }), "file_stale");
    writeFileSync(join(root, "bad.bin"), Buffer.from([0xff, 0, 0x61]));
    expect(service.metadata({ workspaceId: id, path: "bad.bin" }).file.isBinary).toBe(true);
    code(() => service.read({ workspaceId: id, path: "bad.bin", rangeStart: 1, rangeEnd: 1 }), "path_binary");
    code(() => service.read({ workspaceId: id, path: "README.md", rangeStart: 1, rangeEnd: LIMITS.maxFileReadLines + 1 }), "path_oversize");
  });

  test("tree and searches page with revision-bound repeatable opaque tokens", () => {
    const { root, service } = fixture();
    const first = service.treePage({ workspaceId: id, pageSize: 1, pageToken: null }); expect(first.items).toHaveLength(1); expect(first.nextPageToken).toBeTruthy();
    const token = first.nextPageToken!; const second = service.treePage({ workspaceId: id, pageSize: 1, pageToken: token }); expect(second.items).toHaveLength(1);
    expect(service.treePage({ workspaceId: id, pageSize: 1, pageToken: token }).items).toEqual(second.items);
    const stale = service.treePage({ workspaceId: id, pageSize: 1, pageToken: null }); const staleToken = stale.nextPageToken!; writeFileSync(join(root, "new.txt"), "new");
    code(() => service.treePage({ workspaceId: id, pageSize: 1, pageToken: staleToken }), "page_stale");
    const names = service.filenameSearch({ workspaceId: id, query: "alpha" }); expect(names.items.map((x) => x.path)).toEqual(["src/alpha.ts"]);
    const content = service.contentSearch({ workspaceId: id, query: "needle" }); expect(content.items.map((x) => [x.path, x.line])).toEqual([["README.md", 1], ["src/alpha.ts", 3]]); expect(content.isTruncated).toBe(false);
  });
});
