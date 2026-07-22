import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  type Stats,
} from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";
import { LIMITS } from "@pi-mob/protocol-schema";

/** Stable, safe failures for the R3 control adapter to map to protocol errors. */
export type WorkspaceFileErrorCode =
  | "workspace_not_found" | "path_invalid" | "path_unavailable"
  | "path_denied" | "path_binary" | "path_oversize" | "file_stale"
  | "page_stale" | "page_invalid";

export type WorkspaceFileProtocolErrorCode =
  | "workspace_not_found"
  | "path_not_found"
  | "path_outside_workspace"
  | "path_binary"
  | "path_oversize"
  | "file_stale"
  | "file_unavailable"
  | "invalid_message";

export class WorkspaceFileError extends Error {
  override readonly name = "WorkspaceFileError";
  constructor(readonly code: WorkspaceFileErrorCode, message: string) { super(message); }
}

export function toWorkspaceFileProtocolErrorCode(code: WorkspaceFileErrorCode): WorkspaceFileProtocolErrorCode {
  switch (code) {
    case "workspace_not_found": return "workspace_not_found";
    case "path_invalid": return "path_not_found";
    case "path_denied": return "path_outside_workspace";
    case "path_binary": return "path_binary";
    case "path_oversize": return "path_oversize";
    case "file_stale":
    case "page_stale": return "file_stale";
    case "path_unavailable": return "file_unavailable";
    case "page_invalid": return "invalid_message";
  }
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
interface LoadedFile {
  readonly path: string;
  readonly absolute: string;
  readonly stat: Stats;
  readonly raw: Buffer;
  readonly sha256: string;
  readonly revision: string;
  readonly isBinary: boolean;
  readonly modifiedAt: string;
  readonly languageHint?: string;
}
const TOKEN_TTL_MS = 60_000;
const MAX_PAGE_TOKENS = 256;
const MAX_TRAVERSAL_ENTRIES = 10_000;
const MAX_CONTENT_SEARCH_SCAN_FILES = 512;
const MAX_CONTENT_SEARCH_SCAN_BYTES = 8 * 1024 * 1024;
const MAX_CONTENT_SEARCH_ELAPSED_MS = 1_500;
const decoder = new TextDecoder("utf-8", { fatal: true });
const language: Record<string, string> = { ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".dart": "dart", ".json": "json", ".md": "markdown", ".py": "python", ".rs": "rust", ".go": "go", ".sh": "shell", ".yaml": "yaml", ".yml": "yaml" };

function iso(ms: number): string { return new Date(ms).toISOString(); }
function sameInode(a: Stats, b: Stats): boolean { return `${a.dev}:${a.ino}` === `${b.dev}:${b.ino}`; }
function digestHex(...parts: Array<string | Buffer | Uint8Array>): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}
function fileRevision(bytes: Uint8Array, stat: { size: number; mtimeMs: number }): string {
  return `file-${digestHex(bytes, `\0${stat.size}\0${stat.mtimeMs}`)}`;
}
function treeRevision(entries: readonly Entry[]): string {
  const hash = createHash("sha256");
  for (const entry of entries) {
    const s = statSync(entry.absolute);
    hash.update(`${entry.path}\0${entry.kind}\0${s.size}\0${s.mtimeMs}\n`);
  }
  return `tree-${hash.digest("hex")}`;
}
function binary(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return true;
  try { decoder.decode(bytes); return false; } catch { return true; }
}
function byteIndex(text: string, codeUnitIndex: number): number { return Buffer.byteLength(text.slice(0, codeUnitIndex)); }
function withinRoot(root: string, absolute: string): boolean { return absolute === root || absolute.startsWith(root + sep); }
function toText(raw: Uint8Array): string {
  try { return decoder.decode(raw); } catch { throw new WorkspaceFileError("path_binary", "File is not valid UTF-8 text"); }
}
function splitLines(text: string): string[] {
  const lines = text.length === 0 ? [] : text.split("\n");
  if (lines.length && lines.at(-1) === "") lines.pop();
  return lines;
}
function clipLineText(line: string, matchAt: number, matchLength: number): { lineText: string; matchStart: number } {
  const matchEnd = Math.min(line.length, matchAt + matchLength);
  let low = 0;
  let high = matchAt;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (Buffer.byteLength(line.slice(middle, matchEnd)) <= 4096) high = middle;
    else low = middle + 1;
  }
  const start = low;
  low = matchEnd;
  high = line.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(line.slice(start, middle)) <= 4096) low = middle;
    else high = middle - 1;
  }
  const lineText = line.slice(start, low);
  return { lineText, matchStart: Buffer.byteLength(line.slice(start, matchAt)) };
}

/**
 * Bounded, read-only workspace browser. It deliberately has no mutation API.
 * Roots must already be canonical allowed workspace roots from workspace-policy.
 */
export class WorkspaceFileService {
  readonly #roots = new Map<string, string>();
  readonly #tokens = new Map<string, Token>();

  constructor(
    roots: readonly WorkspaceFileRoot[],
    private readonly now: () => number = Date.now,
    private readonly afterOpenForTest?: (path: string) => void,
  ) {
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

  #resolvePath(workspaceId: string, path?: string): { root: string; absolute: string; path?: string } {
    const root = this.#root(workspaceId);
    if (path == null) return { root, absolute: root };
    if (!path || path.length > LIMITS.maxWorkspacePathLength || path.startsWith("/") || path.includes("\\") || path.includes("\0") || /^[A-Za-z]:/.test(path)) throw new WorkspaceFileError("path_invalid", "Path must be workspace-root-relative");
    const segments = path.split("/");
    if (segments.some((part) => !part || part === "." || part === "..")) throw new WorkspaceFileError("path_invalid", "Path traversal is not allowed");
    const absolute = resolve(root, ...segments);
    if (!withinRoot(root, absolute)) throw new WorkspaceFileError("path_invalid", "Path escapes workspace root");
    return { root, absolute, path };
  }

  #resolveDirectory(workspaceId: string, path?: string): { root: string; absolute: string; path?: string } {
    const resolved = this.#resolvePath(workspaceId, path);
    if (path == null) return resolved;
    const segments = path.split("/");
    let cursor = resolved.root;
    try {
      for (const segment of segments) {
        cursor = resolve(cursor, segment);
        if (lstatSync(cursor).isSymbolicLink()) throw new WorkspaceFileError("path_denied", "Symbolic links are not browsable");
      }
      const canonical = realpathSync(resolved.absolute);
      if (!withinRoot(resolved.root, canonical)) throw new WorkspaceFileError("path_denied", "Canonical path escapes workspace root");
      return { ...resolved, absolute: canonical };
    } catch (error) {
      if (error instanceof WorkspaceFileError) throw error;
      throw new WorkspaceFileError("path_unavailable", "Path is unavailable");
    }
  }

  /**
   * Opens the target inode with O_NOFOLLOW, then proves the still-resolved path
   * names that same inode via post-open realpath/stat checks. The returned bytes
   * always come from the opened handle, so a later swap/rename cannot change the
   * content we hash or read. Residual guarantee: directory enumeration remains
   * path-based because Node/Bun do not expose a portable fd-scoped readdir API on
   * macOS; per-file reads/metadata/search revalidate the final inode at open time.
   */
  #loadFileAbsolute(root: string, displayPath: string, absolute: string): LoadedFile {
    let fd: number;
    try { fd = openSync(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW); }
    catch (error: unknown) {
      if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "ELOOP") {
        throw new WorkspaceFileError("path_denied", "Symbolic links are not readable");
      }
      throw new WorkspaceFileError("path_unavailable", "Path is unavailable");
    }
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile()) throw new WorkspaceFileError("path_invalid", "Path is not a file");
      if (opened.size > LIMITS.maxFileSize) throw new WorkspaceFileError("path_oversize", "File exceeds the 25 MiB limit");
      this.afterOpenForTest?.(absolute);
      const canonical = realpathSync(absolute);
      if (!withinRoot(root, canonical)) throw new WorkspaceFileError("path_denied", "Canonical path escapes workspace root");
      const current = statSync(canonical);
      if (!current.isFile() || !sameInode(opened, current)) throw new WorkspaceFileError("path_unavailable", "Path changed while being opened");
      const raw = readFileSync(fd);
      const hint = language[extname(displayPath).toLowerCase()];
      return {
        path: displayPath,
        absolute: canonical,
        stat: opened,
        raw,
        sha256: createHash("sha256").update(raw).digest("hex"),
        revision: fileRevision(raw, opened),
        isBinary: binary(raw),
        modifiedAt: iso(opened.mtimeMs),
        ...(hint ? { languageHint: hint } : {}),
      };
    } catch (error) {
      if (error instanceof WorkspaceFileError) throw error;
      throw new WorkspaceFileError("path_unavailable", "Path is unavailable");
    } finally {
      closeSync(fd);
    }
  }

  #loadFile(workspaceId: string, path: string): LoadedFile {
    const resolved = this.#resolvePath(workspaceId, path);
    return this.#loadFileAbsolute(resolved.root, path, resolved.absolute);
  }

  #evictExpiredTokens(): void {
    const now = this.now();
    for (const [token, value] of this.#tokens) {
      if (value.expiresAt < now) this.#tokens.delete(token);
    }
  }

  #storeToken(token: string, value: Token): void {
    this.#evictExpiredTokens();
    this.#tokens.set(token, value);
    while (this.#tokens.size > MAX_PAGE_TOKENS) {
      const oldest = this.#tokens.keys().next().value;
      if (oldest == null) break;
      this.#tokens.delete(oldest);
    }
  }

  #entries(workspaceId: string, under?: string): Entry[] {
    const start = this.#resolveDirectory(workspaceId, under);
    const baseDepth = under == null ? 0 : under.split("/").length;
    const output: Entry[] = [];
    const walk = (absolute: string, depth: number) => {
      if (output.length >= MAX_TRAVERSAL_ENTRIES) throw new WorkspaceFileError("path_oversize", "Workspace traversal exceeded the bounded limit");
      if (depth > LIMITS.maxTreeDepth) return;
      let names: string[];
      try { names = readdirSync(absolute).sort((a, b) => a.localeCompare(b)); } catch { throw new WorkspaceFileError("path_denied", "Directory cannot be read"); }
      for (const name of names) {
        const child = resolve(absolute, name);
        let stat: Stats;
        try { stat = lstatSync(child); } catch { continue; }
        if (stat.isSymbolicLink()) continue;
        const rel = relative(start.root, child).split(sep).join("/");
        const childDepth = rel.split("/").length - baseDepth;
        if (stat.isDirectory()) { output.push({ path: rel, absolute: child, kind: "directory", depth: childDepth }); walk(child, depth + 1); }
        else if (stat.isFile()) output.push({ path: rel, absolute: child, kind: "file", depth: childDepth });
        if (output.length >= MAX_TRAVERSAL_ENTRIES) throw new WorkspaceFileError("path_oversize", "Workspace traversal exceeded the bounded limit");
      }
    };
    if (!statSync(start.absolute).isDirectory()) throw new WorkspaceFileError("path_invalid", "Tree path must be a directory");
    walk(start.absolute, 1);
    return output;
  }

  #page<T>(workspaceId: string, key: string, revisionValue: string, all: readonly T[], size: number, token?: string | null): Page<T> {
    this.#evictExpiredTokens();
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
      this.#storeToken(nextPageToken, { key, revision: revisionValue, offset: offset + items.length, expiresAt: this.now() + TOKEN_TTL_MS });
    }
    return { workspaceId, rootRevision: revisionValue, items, ...(nextPageToken ? { nextPageToken } : {}) };
  }

  treePage(input: { workspaceId: string; path?: string; rootRevision?: string; pageSize: number; pageToken?: string | null }): Page<FileNode> & { path?: string } {
    if (input.pageSize < 1 || input.pageSize > LIMITS.maxTreePageItems) throw new WorkspaceFileError("path_oversize", "Tree page size is out of bounds");
    const entries = this.#entries(input.workspaceId, input.path);
    const rootRevision = treeRevision(entries);
    if (input.rootRevision && input.rootRevision !== rootRevision) throw new WorkspaceFileError("page_stale", "Workspace tree revision changed");
    const nodes = entries.map((entry): FileNode => {
      const s = statSync(entry.absolute);
      if (entry.kind === "directory") return { path: entry.path, kind: entry.kind, depth: entry.depth, childCount: Math.min(readdirSync(entry.absolute).length, LIMITS.maxTreePageItems), modifiedAt: iso(s.mtimeMs) };
      const loaded = s.size <= LIMITS.maxFileSize ? this.#loadFileAbsolute(this.#root(input.workspaceId), entry.path, entry.absolute) : null;
      return {
        path: entry.path,
        kind: entry.kind,
        depth: entry.depth,
        size: Math.min(s.size, LIMITS.maxFileSize),
        modifiedAt: iso(s.mtimeMs),
        ...(loaded ? { isBinary: loaded.isBinary } : {}),
        ...(language[extname(entry.path).toLowerCase()] ? { languageHint: language[extname(entry.path).toLowerCase()] } : {}),
      };
    });
    return {
      ...this.#page(input.workspaceId, `tree:${input.workspaceId}:${input.path ?? ""}:${input.pageSize}`, rootRevision, nodes, input.pageSize, input.pageToken),
      ...(input.path ? { path: input.path } : {}),
    };
  }

  filenameSearch(input: { workspaceId: string; query: string; path?: string; pageSize?: number; pageToken?: string | null }): Page<FilenameMatch> {
    if (!input.query || input.query.length > 512) throw new WorkspaceFileError("path_invalid", "Search query is out of bounds");
    const size = input.pageSize ?? LIMITS.maxFilenameSearchItems;
    if (size < 1 || size > LIMITS.maxFilenameSearchItems) throw new WorkspaceFileError("path_oversize", "Search page size is out of bounds");
    const entries = this.#entries(input.workspaceId, input.path);
    const rootRevision = treeRevision(entries);
    const needle = input.query.toLocaleLowerCase();
    const matches = entries.filter((e) => e.kind === "file").flatMap((e): FilenameMatch[] => {
      const file = basename(e.path);
      const at = file.toLocaleLowerCase().indexOf(needle);
      return at < 0 ? [] : [{ path: e.path, matchStart: byteIndex(e.path, e.path.length - file.length + at), matchLength: Buffer.byteLength(file.slice(at, at + input.query.length)) }];
    });
    return this.#page(input.workspaceId, `name:${input.workspaceId}:${input.path ?? ""}:${input.query}:${size}`, rootRevision, matches, size, input.pageToken);
  }

  contentSearch(input: { workspaceId: string; query: string; path?: string; pageSize?: number; pageToken?: string | null }): Page<ContentMatch> & { isTruncated: boolean } {
    if (!input.query || input.query.length > 512) throw new WorkspaceFileError("path_invalid", "Search query is out of bounds");
    const size = input.pageSize ?? LIMITS.maxContentSearchLines;
    if (size < 1 || size > LIMITS.maxContentSearchLines) throw new WorkspaceFileError("path_oversize", "Search page size is out of bounds");
    const entries = this.#entries(input.workspaceId, input.path);
    const rootRevision = treeRevision(entries);
    const matches: ContentMatch[] = [];
    let bytes = 0; let truncated = false; let scannedFiles = 0; let scannedBytes = 0;
    const startedAt = this.now();
    outer: for (const entry of entries) {
      if (entry.kind !== "file") continue;
      if (scannedFiles >= MAX_CONTENT_SEARCH_SCAN_FILES || this.now() - startedAt > MAX_CONTENT_SEARCH_ELAPSED_MS) { truncated = true; break; }
      const s = statSync(entry.absolute); if (s.size > LIMITS.maxFileSize) continue;
      if (scannedBytes + s.size > MAX_CONTENT_SEARCH_SCAN_BYTES) { truncated = true; break; }
      scannedFiles += 1;
      scannedBytes += s.size;
      const loaded = this.#loadFileAbsolute(this.#root(input.workspaceId), entry.path, entry.absolute);
      if (loaded.isBinary) continue;
      const text = toText(loaded.raw);
      const lines = splitLines(text);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!.replace(/\r$/, "");
        const at = line.toLocaleLowerCase().indexOf(input.query.toLocaleLowerCase());
        if (at < 0) continue;
        const clipped = clipLineText(line, at, input.query.length);
        const cost = Buffer.byteLength(clipped.lineText);
        if (matches.length >= LIMITS.maxContentSearchLines || bytes + cost > LIMITS.maxContentSearchBytes) { truncated = true; break outer; }
        bytes += cost;
        matches.push({
          path: entry.path,
          line: i + 1,
          column: [...line.slice(0, at)].length + 1,
          matchStart: clipped.matchStart,
          matchLength: Buffer.byteLength(line.slice(at, at + input.query.length)),
          lineText: clipped.lineText,
        });
      }
    }
    return {
      ...this.#page(input.workspaceId, `content:${input.workspaceId}:${input.path ?? ""}:${input.query}:${size}`, rootRevision, matches, size, input.pageToken),
      isTruncated: truncated,
    };
  }

  metadata(input: { workspaceId: string; path: string; expectedRevision?: string }): { workspaceId: string; file: FileMetadata } {
    const loaded = this.#loadFile(input.workspaceId, input.path);
    if (input.expectedRevision && input.expectedRevision !== loaded.revision) throw new WorkspaceFileError("file_stale", "File revision changed");
    return { workspaceId: input.workspaceId, file: { path: input.path, size: loaded.stat.size, sha256: loaded.sha256, isBinary: loaded.isBinary, modifiedAt: loaded.modifiedAt, revision: loaded.revision, lastReadAt: iso(this.now()), ...(loaded.languageHint ? { languageHint: loaded.languageHint } : {}) } };
  }

  /** Revalidates a draft reference immediately before prompt dispatch. */
  validateReference(reference: FileReference): FileMetadata {
    if (!/^[0-9a-f]{64}$/.test(reference.digest)) throw new WorkspaceFileError("path_invalid", "Reference digest is invalid");
    if ((reference.ranges?.length ?? 0) > LIMITS.maxPinnedRanges) throw new WorkspaceFileError("path_oversize", "Too many selected ranges");
    const loaded = this.#loadFile(reference.workspaceId, reference.path);
    if (loaded.revision !== reference.revision) throw new WorkspaceFileError("file_stale", "File revision changed");
    if (loaded.isBinary) throw new WorkspaceFileError("path_binary", "Binary files require the binary attachment flow");
    if (loaded.sha256 !== reference.digest) throw new WorkspaceFileError("file_stale", "File digest changed");
    if (reference.ranges?.length) {
      const totalLines = splitLines(toText(loaded.raw)).length;
      for (const range of reference.ranges) {
        if (!Number.isInteger(range.startLine) || !Number.isInteger(range.endLine) || range.startLine < 1 || range.endLine < range.startLine || range.endLine > totalLines) throw new WorkspaceFileError("path_oversize", "Reference line range is unavailable");
      }
    }
    return { path: reference.path, size: loaded.stat.size, sha256: loaded.sha256, isBinary: loaded.isBinary, modifiedAt: loaded.modifiedAt, revision: loaded.revision, lastReadAt: iso(this.now()), ...(loaded.languageHint ? { languageHint: loaded.languageHint } : {}) };
  }

  read(input: { workspaceId: string; path: string; rangeStart: number; rangeEnd: number; expectedRevision?: string }): { workspaceId: string; result: FileReadResult } {
    if (!Number.isInteger(input.rangeStart) || !Number.isInteger(input.rangeEnd) || input.rangeStart < 1 || input.rangeEnd < input.rangeStart || input.rangeEnd - input.rangeStart + 1 > LIMITS.maxFileReadLines) throw new WorkspaceFileError("path_oversize", "Line range is out of bounds");
    const loaded = this.#loadFile(input.workspaceId, input.path);
    if (input.expectedRevision && input.expectedRevision !== loaded.revision) throw new WorkspaceFileError("file_stale", "File revision changed");
    if (loaded.isBinary) throw new WorkspaceFileError("path_binary", "Binary files cannot be read as text");
    const lines = splitLines(toText(loaded.raw));
    const selected = lines.slice(input.rangeStart - 1, input.rangeEnd);
    const totalSelectedBytes = Buffer.byteLength(selected.join("\n"));
    let content = ""; let retained = 0; let clipped = false;
    for (const line of selected) {
      const candidate = content ? `${content}\n${line}` : line;
      if (Buffer.byteLength(candidate) > LIMITS.maxFileReadBytes) {
        if (!content) {
          const available = LIMITS.maxFileReadBytes;
          let end = 0;
          while (end < line.length && Buffer.byteLength(line.slice(0, end + 1)) <= available) end += 1;
          content = line.slice(0, end);
          retained = Buffer.byteLength(content);
        }
        clipped = true;
        break;
      }
      content = candidate;
      retained = Buffer.byteLength(content);
    }
    const returnedLines = content === "" ? 0 : content.split("\n").length;
    const rangeEnd = returnedLines ? input.rangeStart + returnedLines - 1 : input.rangeStart;
    return { workspaceId: input.workspaceId, result: { path: input.path, revision: loaded.revision, rangeStart: input.rangeStart, rangeEnd, totalLines: lines.length, content, encoding: "utf-8", isTruncated: clipped, ...(clipped ? { truncation: { retainedBytes: retained, totalBytes: totalSelectedBytes, isTruncated: true } } : {}), lastModifiedAt: loaded.modifiedAt } };
  }
}
