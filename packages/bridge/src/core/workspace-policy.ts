/**
 * Canonical host-path utilities.
 *
 * The bridge intentionally owns no policy / trust / read-only machinery.
 * Pi's normal execution model is the default. What remains here is the
 * small set of path-canonicalization helpers used by the bridge to
 * resolve workspace roots, reject traversal / symlink escapes, and
 * normalise displayed relative paths. Behavioural policy lives in Pi.
 */

import { lstatSync, opendirSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

export type WorkspacePolicyErrorCode =
  | "not_absolute"
  | "traversal"
  | "outside_root"
  | "symlink_escape"
  | "root_not_found"
  | "root_duplicate"
  | "invalid_label";

export class WorkspacePolicyError extends Error {
  override readonly name = "WorkspacePolicyError";
  constructor(readonly code: WorkspacePolicyErrorCode, message: string) {
    super(message);
  }
}

export type WorkspaceRootId = string;

export type CanonicalPath = string;

export type WorkspaceRootLabel = string;

export interface WorkspaceRoot {
  readonly id: WorkspaceRootId;
  readonly canonicalPath: CanonicalPath;
  readonly label: WorkspaceRootLabel;
}

export interface WorkspaceRootsConfig {
  readonly schemaVersion: 1;
  readonly roots: readonly WorkspaceRoot[];
}

export const MAX_ALLOWED_ROOTS = 32;

export const MAX_ROOT_LABEL_LENGTH = 64;

/**
 * Host policy mode field kept on session state for back-compat with
 * already-persisted databases. The bridge never owns a read-only
 * execution mode; new sessions always start with `"full"`. The legacy
 * `"read_only"` value is no longer produced by the bridge.
 */
export type HostPolicyMode = "full" | "read_only";

function assertAbsoluteRoot(field: string, value: string): void {
  if (!isAbsolute(value)) {
    throw new WorkspacePolicyError("not_absolute", `${field} must be absolute`);
  }
}

function normalizeCanonical(p: string): string {
  return p.length > 1 && p.endsWith(sep) ? p.slice(0, -1) : p;
}

function existsDirectory(path: string): boolean {
  try {
    return require("node:fs").statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function createWorkspaceRootsConfig(
  roots: readonly WorkspaceRoot[] = [],
): WorkspaceRootsConfig {
  if (roots.length > MAX_ALLOWED_ROOTS) {
    throw new WorkspacePolicyError(
      "invalid_label",
      `at most ${MAX_ALLOWED_ROOTS} allowed roots are supported (got ${roots.length})`,
    );
  }
  const seenPaths = new Set<string>();
  const seenIds = new Set<string>();
  const normalized: WorkspaceRoot[] = [];
  for (const root of roots) {
    assertAbsoluteRoot("root.canonicalPath", root.canonicalPath);
    if (containsTraversalSegment(root.canonicalPath)) {
      throw new WorkspacePolicyError(
        "traversal",
        `root.canonicalPath may not contain '..': ${root.canonicalPath}`,
      );
    }
    const canonical = normalizeCanonical(root.canonicalPath);
    if (seenPaths.has(canonical)) {
      throw new WorkspacePolicyError(
        "root_duplicate",
        `duplicate canonical path: ${canonical}`,
      );
    }
    if (seenIds.has(root.id)) {
      throw new WorkspacePolicyError(
        "root_duplicate",
        `duplicate root id: ${root.id}`,
      );
    }
    if (root.label.length === 0 || root.label.length > MAX_ROOT_LABEL_LENGTH) {
      throw new WorkspacePolicyError(
        "invalid_label",
        `root.label must be 1..${MAX_ROOT_LABEL_LENGTH} chars (got ${root.label.length})`,
      );
    }
    seenPaths.add(canonical);
    seenIds.add(root.id);
    normalized.push({
      id: root.id,
      canonicalPath: canonical,
      label: root.label,
    });
  }
  return { schemaVersion: 1, roots: normalized };
}

export function addAllowedRoot(
  config: WorkspaceRootsConfig,
  candidatePath: string,
  label: WorkspaceRootLabel,
): WorkspaceRootsConfig {
  if (label.length === 0 || label.length > MAX_ROOT_LABEL_LENGTH) {
    throw new WorkspacePolicyError(
      "invalid_label",
      `label must be 1..${MAX_ROOT_LABEL_LENGTH} chars (got ${label.length})`,
    );
  }
  const canonical = canonicalizeOrThrow(candidatePath);
  if (!existsDirectory(canonical)) {
    throw new WorkspacePolicyError(
      "root_not_found",
      `root directory does not exist: ${canonical}`,
    );
  }
  const id = deriveRootId(canonical);
  if (config.roots.some((root) => root.id === id)) return config;
  return createWorkspaceRootsConfig([
    ...config.roots,
    { id, canonicalPath: canonical, label },
  ]);
}

export function removeAllowedRoot(
  config: WorkspaceRootsConfig,
  id: WorkspaceRootId,
): WorkspaceRootsConfig {
  const next = config.roots.filter((root) => root.id !== id);
  return createWorkspaceRootsConfig(next);
}

export function canonicalize(path: string): string {
  if (!isAbsolute(path)) {
    throw new WorkspacePolicyError(
      "not_absolute",
      `path must be absolute: ${JSON.stringify(path)}`,
    );
  }
  if (containsTraversalSegment(path)) {
    throw new WorkspacePolicyError(
      "traversal",
      `path contains '..' traversal segment: ${JSON.stringify(path)}`,
    );
  }
  try {
    return require("node:fs").realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export function canonicalizeOrThrow(path: string): CanonicalPath {
  if (!isAbsolute(path)) {
    throw new WorkspacePolicyError(
      "not_absolute",
      `path must be absolute: ${JSON.stringify(path)}`,
    );
  }
  if (containsTraversalSegment(path)) {
    throw new WorkspacePolicyError(
      "traversal",
      `path contains '..' traversal segment: ${JSON.stringify(path)}`,
    );
  }
  return require("node:fs").realpathSync(path);
}

export function isPathWithinRoot(path: CanonicalPath, rootCanonical: CanonicalPath): boolean {
  if (path === rootCanonical) return true;
  const prefix = rootCanonical.endsWith(sep) ? rootCanonical : rootCanonical + sep;
  return path.startsWith(prefix);
}

export interface ResolvedWorkspacePath {
  readonly canonical: CanonicalPath;
  readonly relative: string;
  readonly rootId: WorkspaceRootId;
}

export function resolveWorkspacePath(
  config: WorkspaceRootsConfig,
  candidate: string,
): ResolvedWorkspacePath {
  if (!isAbsolute(candidate)) {
    throw new WorkspacePolicyError(
      "not_absolute",
      `candidate path must be absolute: ${JSON.stringify(candidate)}`,
    );
  }
  if (containsTraversalSegment(candidate)) {
    throw new WorkspacePolicyError(
      "traversal",
      `candidate path contains '..': ${JSON.stringify(candidate)}`,
    );
  }

  const fs = require("node:fs");
  const canonicalRoots: Array<{ id: WorkspaceRootId; canonical: CanonicalPath }> = [];
  for (const root of config.roots) {
    try {
      canonicalRoots.push({
        id: root.id,
        canonical: canonicalizeOrThrow(root.canonicalPath),
      });
    } catch {
      throw new WorkspacePolicyError(
        "root_not_found",
        `allowed root no longer exists: ${root.canonicalPath}`,
      );
    }
  }

  let canonical: CanonicalPath;
  try {
    canonical = fs.realpathSync(candidate);
  } catch {
    throw new WorkspacePolicyError(
      "outside_root",
      `candidate path does not exist: ${candidate}`,
    );
  }

  const matched = canonicalRoots
    .filter((root) => isPathWithinRoot(canonical, root.canonical))
    .sort((a, b) => b.canonical.length - a.canonical.length)[0];

  if (matched) {
    const rel = relative(matched.canonical, canonical);
    return {
      canonical,
      relative: rel.length === 0 ? "." : toPosixRelative(rel),
      rootId: matched.id,
    };
  }

  const lexicalInside = canonicalRoots.find((root) => {
    const rel = relative(root.canonical, candidate);
    return !rel.startsWith("..") && !isAbsolute(rel);
  });
  throw new WorkspacePolicyError(
    lexicalInside ? "symlink_escape" : "outside_root",
    lexicalInside
      ? `candidate path escapes its root via symlink: ${candidate} -> ${canonical}`
      : `candidate path is outside every allowed root: ${canonical}`,
  );
}

function containsTraversalSegment(value: string): boolean {
  for (const segment of value.split(/[\\/]+/)) {
    if (segment === "..") return true;
  }
  return false;
}

function toPosixRelative(value: string): string {
  return value.split(sep).join("/");
}

const WORKSPACE_SEARCH_SKIPPED = new Set(["node_modules", "build", "dist"]);
const MAX_WORKSPACE_SEARCH_ROOTS = 4;
const MAX_WORKSPACE_SEARCH_ENTRIES = 256;
const MAX_WORKSPACE_SEARCH_RESULTS = 20;

export interface WorkspaceDirectoryMatch {
  readonly canonicalPath: CanonicalPath;
  readonly rootCanonicalPath: CanonicalPath;
}

/**
 * Enumerate only each explicit developer root and its immediate children.
 * The walk never recurses, never follows symlinks, and has fixed
 * root/entry/result caps. Both listing and search consume this exact set.
 */
export function enumerateWorkspaceDirectories(
  roots: readonly string[],
): WorkspaceDirectoryMatch[] {
  const matches: WorkspaceDirectoryMatch[] = [];
  const seen = new Set<string>();

  for (const root of roots.slice(0, MAX_WORKSPACE_SEARCH_ROOTS)) {
    if (matches.length >= MAX_WORKSPACE_SEARCH_RESULTS) break;
    let canonicalRoot: string;
    try {
      const metadata = lstatSync(root);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) continue;
      canonicalRoot = realpathSync(root);
    } catch { continue; }

    const add = (canonicalPath: string): void => {
      if (matches.length >= MAX_WORKSPACE_SEARCH_RESULTS || seen.has(canonicalPath)) return;
      seen.add(canonicalPath);
      matches.push({ canonicalPath, rootCanonicalPath: canonicalRoot });
    };
    add(canonicalRoot);

    let directory: ReturnType<typeof opendirSync>;
    try { directory = opendirSync(canonicalRoot); }
    catch { continue; }
    try {
      for (let visited = 0; visited < MAX_WORKSPACE_SEARCH_ENTRIES; visited += 1) {
        const entry = directory.readSync();
        if (!entry || matches.length >= MAX_WORKSPACE_SEARCH_RESULTS) break;
        if (!entry.isDirectory() || entry.isSymbolicLink() ||
            entry.name.startsWith(".") || WORKSPACE_SEARCH_SKIPPED.has(entry.name)) continue;
        const candidate = join(canonicalRoot, entry.name);
        try {
          const metadata = lstatSync(candidate);
          if (!metadata.isDirectory() || metadata.isSymbolicLink()) continue;
          const canonical = realpathSync(candidate);
          if (isPathWithinRoot(canonical, canonicalRoot)) add(canonical);
        } catch { /* entry disappeared or became unsafe */ }
      }
    } catch { /* root became unreadable */ }
    finally { try { directory.closeSync(); } catch { /* already closed */ } }
  }
  return matches;
}

export function searchWorkspaceDirectories(
  roots: readonly string[],
  rawQuery: string,
): WorkspaceDirectoryMatch[] {
  const query = rawQuery.trim().slice(0, 64).toLowerCase();
  if (!query) return [];
  return enumerateWorkspaceDirectories(roots).filter((match) =>
    basename(match.canonicalPath).toLowerCase().includes(query),
  );
}

/**
 * Derives a stable, opaque root id from a canonical host path. The id is
 * SHA-256 of the canonical (post-realpath) path formatted as a
 * UUID-shaped (8-4-4-4-12 lowercase hex) string with the RFC 4122 v4
 * version and variant bits set. The same directory on disk always
 * produces the same id, including when reached via different symlinks
 * that resolve to the same target.
 */
export function deriveRootId(canonicalPath: string): WorkspaceRootId {
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  const hex = createHash("sha256").update(canonicalPath).digest("hex");
  const a = hex.slice(0, 8);
  const b = hex.slice(8, 12);
  const c = "4" + hex.slice(13, 16);
  const dHigh = (parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80;
  const d = dHigh.toString(16).padStart(2, "0") + hex.slice(18, 20);
  const e = hex.slice(20, 32);
  return `${a}-${b}-${c}-${d}-${e}`;
}
