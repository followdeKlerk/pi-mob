import { createHash, randomBytes } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";
import { LIMITS } from "@pi-mob/protocol-schema";

/** Stable, safe failures for the R3 control adapter to map to protocol errors. */
export type WorkspaceFileErrorCode =
  | "workspace_not_found" | "path_invalid" | "path_unavailable"
  | "path_denied" | "path_binary" | "path_oversize" | "file_stale"
  | "page_stale" | "page_invalid";

export class WorkspaceFileError extends Error {
  override readonly name = "WorkspaceFileError";
  constructor(readonly code: WorkspaceFileErrorCode, message: string) { super(message); }
}

export interface WorkspaceFileRoot { readonly workspaceId: string; readonly canonicalPath: string }
export interface FileNode { path: string; kind: "file" | "directory"; depth: number; size?: number; childCount?: number; modifiedAt?: string; isBinary?: boolean; languageHint?: string }
export interface FileMetadata { path: string; size: number; sha256: string; isBinary: boolean; modifiedAt: string; revision: string; lastReadAt: string; languageHint?: string }
export interface FileReadResult { path: string; revision: string; rangeStart: number; rangeEnd: number; totalLines: number; content: string; encoding: "utf-8"; isTruncated: boolean; truncation?: { retainedBytes: number; totalBytes: number; isTruncated: boolean }; lastModifiedAt: string }
export interface Page<T> { workspaceId: string; rootRevision: string; items: T[]; nextPageToken?: string }
export interface FilenameMatch { path: string; matchStart?: number; matchLength?: number }
export interface ContentMatch { path: string; line: number; column: number; matchStart: number; matchLength: number; lineText: string }
export interface FileReference { workspaceId: string; path: string; digest: string; revision: string; ranges?: readonly { startLine: number; endLine: number }[] }

interface Token { key: string; revision: string; offset: number; expiresAt: number }
interface Entry { path: string; absolute: string; kind: "file" | "directory"; depth: number }
const TOKEN_TTL_MS = 60_000;
const decoder = new TextDecoder("utf-8", { fatal: true });
const language: Record<string, string> = { ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".dart": "dart", ".json": "json", ".md": "markdown", ".py": "python", ".rs": "rust", ".go": "go", ".sh": "shell", ".yaml": "yaml", ".yml": "yaml" };

function iso(ms: number): string { return new Date(ms).toISOString(); }
function revision(bytes: Uint8Array, stat: { size: number; mtimeMs: number }): string {
  return createHash("sha256").update(bytes).update(`\0${stat.size}\0${stat.mtimeMs}`).digest("hex");
}
function binary(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return true;
  try { decoder.decode(bytes); return false; } catch { return true; }
}
function byteIndex(text: string, codeUnitIndex: number): number { return Buffer.byteLength(text.slice(0, codeUnitIndex)); }

/**
 * Bounded, read-only workspace browser. It deliberately has no mutation API.
 * Roots must already be canonical allowed workspace roots from workspace-policy.
 */
export class WorkspaceFileService {
  readonly #roots = new Map<string, string>();
  readonly #tokens = new Map<string, Token>();

  constructor(roots: readonly WorkspaceFileRoot[], private readonly now: () => number = Date.now) {
    for (const root of roots) {
      let canonical: string;
      try { canonical = realpathSync(root.canonicalPath); } catch { throw new WorkspaceFileError("workspace_not_found", "Workspace root is unavailable"); }
      if (!statSync(canonical).isDirectory()) throw new WorkspaceFileError("workspace_not_found", "Workspace root is not a directory");
      this.#roots.set(root.workspaceId, canonical);
    }
  }

  #root(workspaceId: string): string {
    const root = this.#roots.get(workspaceId);
    if (!root) throw new WorkspaceFileError("workspace_not_found", "Workspace is unavailable");
    return root;
  }

  #resolve(workspaceId: string, path?: string): { root: string; absolute: string; path?: string } {
    const root = this.#root(workspaceId);
    if (path == null) return { root, absolute: root };
    if (!path || path.length > LIMITS.maxWorkspacePathLength || path.startsWith("/") || path.includes("\\") || path.includes("\0") || /^[A-Za-z]:/.test(path)) throw new WorkspaceFileError("path_invalid", "Path must be workspace-root-relative");
    const segments = path.split("/");
    if (segments.some((part) => !part || part === "." || part === "..")) throw new WorkspaceFileError("path_invalid", "Path traversal is not allowed");
    const absolute = resolve(root, ...segments);
    if (absolute !== root && !absolute.startsWith(root + sep)) throw new WorkspaceFileError("path_invalid", "Path escapes workspace root");
    // Refuse every symlink component. This prevents both escapes and a TOCTOU
    // alias changing meaning between validation and read.
    let cursor = root;
    try {
      for (const segment of segments) { cursor = resolve(cursor, segment); if (lstatSync(cursor).isSymbolicLink()) throw new WorkspaceFileError("path_denied", "Symbolic links are not browsable"); }
      const canonical = realpathSync(absolute);
      if (canonical !== root && !canonical.startsWith(root + sep)) throw new WorkspaceFileError("path_denied", "Canonical path escapes workspace root");
      return { root, absolute: canonical, path };
    } catch (error) {
      if (error instanceof WorkspaceFileError) throw error;
      throw new WorkspaceFileError("path_unavailable", "Path is unavailable");
    }
  }

  #entries(workspaceId: string, under?: string): Entry[] {
    const start = this.#resolve(workspaceId, under);
    const baseDepth = under == null ? 0 : under.split("/").length;
    const output: Entry[] = [];
    const walk = (absolute: string, depth: number) => {
      if (depth > LIMITS.maxTreeDepth) return;
      let names: string[];
      try { names = readdirSync(absolute).sort((a, b) => a.localeCompare(b)); } catch { throw new WorkspaceFileError("path_denied", "Directory cannot be read"); }
      for (const name of names) {
        const child = resolve(absolute, name);
        let stat;
        try { stat = lstatSync(child); } catch { continue; }
        if (stat.isSymbolicLink()) continue;
        const rel = relative(start.root, child).split(sep).join("/");
        const childDepth = rel.split("/").length - baseDepth;
        if (stat.isDirectory()) { output.push({ path: rel, absolute: child, kind: "directory", depth: childDepth }); walk(child, depth + 1); }
        else if (stat.isFile()) output.push({ path: rel, absolute: child, kind: "file", depth: childDepth });
      }
    };
    if (!statSync(start.absolute).isDirectory()) throw new WorkspaceFileError("path_invalid", "Tree path must be a directory");
    walk(start.absolute, 1);
    return output;
  }

  #rootRevision(entries: readonly Entry[]): string {
    const hash = createHash("sha256");
    for (const entry of entries) { const s = statSync(entry.absolute); hash.update(`${entry.path}\0${entry.kind}\0${s.size}\0${s.mtimeMs}\n`); }
    return hash.digest("hex");
  }

  #page<T>(workspaceId: string, key: string, revisionValue: string, all: readonly T[], size: number, token?: string | null): Page<T> {
    let offset = 0;
    if (token) {
      const value = this.#tokens.get(token);
      if (!value || value.expiresAt < this.now() || value.key !== key) {
        this.#tokens.delete(token);
        throw new WorkspaceFileError("page_invalid", "Page token is invalid or expired");
      }
      if (value.revision !== revisionValue) throw new WorkspaceFileError("page_stale", "Workspace changed; restart pagination");
      offset = value.offset;
    }
    const items = all.slice(offset, offset + size);
    let nextPageToken: string | undefined;
    if (offset + items.length < all.length) {
      nextPageToken = randomBytes(24).toString("base64url");
      this.#tokens.set(nextPageToken, { key, revision: revisionValue, offset: offset + items.length, expiresAt: this.now() + TOKEN_TTL_MS });
    }
    return { workspaceId, rootRevision: revisionValue, items, ...(nextPageToken ? { nextPageToken } : {}) };
  }

  treePage(input: { workspaceId: string; path?: string; rootRevision?: string; pageSize: number; pageToken?: string | null }): Page<FileNode> & { path?: string } {
    if (input.pageSize < 1 || input.pageSize > LIMITS.maxTreePageItems) throw new WorkspaceFileError("path_oversize", "Tree page size is out of bounds");
    const entries = this.#entries(input.workspaceId, input.path);
    const rootRevision = this.#rootRevision(entries);
    if (input.rootRevision && input.rootRevision !== rootRevision) throw new WorkspaceFileError("page_stale", "Workspace tree revision changed");
    const nodes = entries.map((entry): FileNode => {
      const s = statSync(entry.absolute);
      if (entry.kind === "directory") return { path: entry.path, kind: entry.kind, depth: entry.depth, childCount: Math.min(readdirSync(entry.absolute).length, LIMITS.maxTreePageItems), modifiedAt: iso(s.mtimeMs) };
      const sample = readFileSync(entry.absolute).subarray(0, 8192);
      return { path: entry.path, kind: entry.kind, depth: entry.depth, size: Math.min(s.size, LIMITS.maxFileSize), modifiedAt: iso(s.mtimeMs), isBinary: binary(sample), ...(language[extname(entry.path).toLowerCase()] ? { languageHint: language[extname(entry.path).toLowerCase()] } : {}) };
    });
    return { ...this.#page(input.workspaceId, `tree:${input.path ?? ""}`, rootRevision, nodes, input.pageSize, input.pageToken), ...(input.path ? { path: input.path } : {}) };
  }

  filenameSearch(input: { workspaceId: string; query: string; path?: string; pageSize?: number; pageToken?: string | null }): Page<FilenameMatch> {
    if (!input.query || input.query.length > 512) throw new WorkspaceFileError("path_invalid", "Search query is out of bounds");
    const size = input.pageSize ?? LIMITS.maxFilenameSearchItems;
    if (size < 1 || size > LIMITS.maxFilenameSearchItems) throw new WorkspaceFileError("path_oversize", "Search page size is out of bounds");
    const entries = this.#entries(input.workspaceId, input.path);
    const rootRevision = this.#rootRevision(entries);
    const needle = input.query.toLocaleLowerCase();
    const matches = entries.filter((e) => e.kind === "file").flatMap((e): FilenameMatch[] => {
      const at = basename(e.path).toLocaleLowerCase().indexOf(needle);
      return at < 0 ? [] : [{ path: e.path, matchStart: byteIndex(e.path, e.path.length - basename(e.path).length + at), matchLength: Buffer.byteLength(basename(e.path).slice(at, at + input.query.length)) }];
    });
    return this.#page(input.workspaceId, `name:${input.path ?? ""}:${input.query}`, rootRevision, matches, size, input.pageToken);
  }

  contentSearch(input: { workspaceId: string; query: string; path?: string; pageSize?: number; pageToken?: string | null }): Page<ContentMatch> & { isTruncated: boolean } {
    if (!input.query || input.query.length > 512) throw new WorkspaceFileError("path_invalid", "Search query is out of bounds");
    const size = input.pageSize ?? LIMITS.maxContentSearchLines;
    if (size < 1 || size > LIMITS.maxContentSearchLines) throw new WorkspaceFileError("path_oversize", "Search page size is out of bounds");
    const entries = this.#entries(input.workspaceId, input.path);
    const rootRevision = this.#rootRevision(entries);
    const matches: ContentMatch[] = [];
    let bytes = 0; let truncated = false;
    outer: for (const entry of entries) {
      if (entry.kind !== "file") continue;
      const s = statSync(entry.absolute); if (s.size > LIMITS.maxFileSize) continue;
      const raw = readFileSync(entry.absolute); if (binary(raw.subarray(0, 8192))) continue;
      const text = decoder.decode(raw);
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!.replace(/\r$/, ""); const at = line.toLocaleLowerCase().indexOf(input.query.toLocaleLowerCase()); if (at < 0) continue;
        const lineText = line.slice(0, 4096); const cost = Buffer.byteLength(lineText);
        if (matches.length >= LIMITS.maxContentSearchLines || bytes + cost > LIMITS.maxContentSearchBytes) { truncated = true; break outer; }
        bytes += cost; matches.push({ path: entry.path, line: i + 1, column: [...line.slice(0, at)].length + 1, matchStart: byteIndex(lineText, at), matchLength: Buffer.byteLength(line.slice(at, at + input.query.length)), lineText });
      }
    }
    return { ...this.#page(input.workspaceId, `content:${input.path ?? ""}:${input.query}`, rootRevision, matches, size, input.pageToken), isTruncated: truncated };
  }

  metadata(input: { workspaceId: string; path: string; expectedRevision?: string }): { workspaceId: string; file: FileMetadata } {
    const resolved = this.#resolve(input.workspaceId, input.path); const s = statSync(resolved.absolute);
    if (!s.isFile()) throw new WorkspaceFileError("path_invalid", "Path is not a file");
    if (s.size > LIMITS.maxFileSize) throw new WorkspaceFileError("path_oversize", "File exceeds the 25 MiB limit");
    let raw: Buffer; try { raw = readFileSync(resolved.absolute); } catch { throw new WorkspaceFileError("path_denied", "File cannot be read"); }
    const digest = createHash("sha256").update(raw).digest("hex"); const rev = revision(raw, s);
    if (input.expectedRevision && input.expectedRevision !== rev) throw new WorkspaceFileError("file_stale", "File revision changed");
    const hint = language[extname(input.path).toLowerCase()];
    return { workspaceId: input.workspaceId, file: { path: input.path, size: s.size, sha256: digest, isBinary: binary(raw.subarray(0, 8192)), modifiedAt: iso(s.mtimeMs), revision: rev, lastReadAt: iso(this.now()), ...(hint ? { languageHint: hint } : {}) } };
  }

  /** Revalidates a draft reference immediately before prompt dispatch. */
  validateReference(reference: FileReference): FileMetadata {
    if (!/^[0-9a-f]{64}$/.test(reference.digest)) throw new WorkspaceFileError("path_invalid", "Reference digest is invalid");
    if ((reference.ranges?.length ?? 0) > 16) throw new WorkspaceFileError("path_oversize", "Too many selected ranges");
    const file = this.metadata({ workspaceId: reference.workspaceId, path: reference.path, expectedRevision: reference.revision }).file;
    if (file.isBinary) throw new WorkspaceFileError("path_binary", "Binary files require the binary attachment flow");
    if (file.sha256 !== reference.digest) throw new WorkspaceFileError("file_stale", "File digest changed");
    if (reference.ranges?.length) {
      const absolute = this.#resolve(reference.workspaceId, reference.path).absolute;
      const raw = readFileSync(absolute); let text: string;
      try { text = decoder.decode(raw); } catch { throw new WorkspaceFileError("path_binary", "File is not valid UTF-8 text"); }
      const totalLines = text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
      for (const range of reference.ranges) {
        if (!Number.isInteger(range.startLine) || !Number.isInteger(range.endLine) || range.startLine < 1 || range.endLine < range.startLine || range.endLine > totalLines) throw new WorkspaceFileError("path_oversize", "Reference line range is unavailable");
      }
    }
    return file;
  }

  read(input: { workspaceId: string; path: string; rangeStart: number; rangeEnd: number; expectedRevision?: string }): { workspaceId: string; result: FileReadResult } {
    if (!Number.isInteger(input.rangeStart) || !Number.isInteger(input.rangeEnd) || input.rangeStart < 1 || input.rangeEnd < input.rangeStart || input.rangeEnd - input.rangeStart + 1 > LIMITS.maxFileReadLines) throw new WorkspaceFileError("path_oversize", "Line range is out of bounds");
    const meta = this.metadata(input); if (meta.file.isBinary) throw new WorkspaceFileError("path_binary", "Binary files cannot be read as text");
    const absolute = this.#resolve(input.workspaceId, input.path).absolute; const raw = readFileSync(absolute); let text: string;
    try { text = decoder.decode(raw); } catch { throw new WorkspaceFileError("path_binary", "File is not valid UTF-8 text"); }
    const lines = text.length === 0 ? [] : text.split("\n");
    if (lines.length && lines.at(-1) === "") lines.pop();
    const selected = lines.slice(input.rangeStart - 1, input.rangeEnd); let content = ""; let retained = 0; let clipped = false;
    for (const line of selected) { const candidate = content ? `${content}\n${line}` : line!; const count = Buffer.byteLength(candidate); if (count > LIMITS.maxFileReadBytes) { clipped = true; break; } content = candidate; retained = count; }
    const returnedLines = content === "" ? 0 : content.split("\n").length; const rangeEnd = returnedLines ? input.rangeStart + returnedLines - 1 : input.rangeStart;
    return { workspaceId: input.workspaceId, result: { path: input.path, revision: meta.file.revision, rangeStart: input.rangeStart, rangeEnd, totalLines: lines.length, content, encoding: "utf-8", isTruncated: clipped, ...(clipped ? { truncation: { retainedBytes: retained, totalBytes: Buffer.byteLength(selected.join("\n")), isTruncated: true } } : {}), lastModifiedAt: meta.file.modifiedAt } };
  }
}
