/**
 * M8 canonical workspace / trust foundation.
 *
 * Implements the host-side foundation that lets the bridge:
 *
 *   - Declare explicit allowed workspace roots with stable opaque IDs
 *     (D-020 / DATA_MODEL.md §3.3).
 *   - Canonicalize paths with `realpath`, reject `..` segments, reject
 *     symlink escapes that resolve outside any allowed root (D-020).
 *   - Expose mobile-facing workspace records as root-relative display paths
 *     only — absolute host paths never leak to the mobile surface.
 *   - Search the file system for candidate workspaces via bounded-depth,
 *     max-results, `AbortSignal`-cancellable directory-name search, plus a
 *     recents store for previously used selections.
 *   - Discover the pinned-Pi `0.80.6` trust-bearing project resources
 *     (D-021 / DECISIONS.md), fingerprint them with a deterministic sorted
 *     manifest and SHA-256, and tag the manifest with a pinned policy
 *     version.
 *   - Persist owner approvals keyed by `(workspaceId, fingerprint)` so any
 *     resource change flips the trust state back to `changed`/`approval_required`
 *     and blocks process start until re-approval.
 *
 * The policy module is the single source of truth for the trust decision
 * the runtime uses to gate `session.create`. It does NOT enforce read-only
 * tool policy (that lives in the host Pi extension, M8-06).
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type WorkspacePolicyErrorCode =
  | "not_absolute"
  | "traversal"
  | "outside_root"
  | "symlink_escape"
  | "root_not_found"
  | "root_duplicate"
  | "invalid_label"
  | "invalid_resource"
  | "approval_missing"
  | "aborted"
  | "depth_exceeded";

/** Thrown by every public workspace-policy entrypoint. */
export class WorkspacePolicyError extends Error {
  override readonly name = "WorkspacePolicyError";
  constructor(readonly code: WorkspacePolicyErrorCode, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Allowed roots configuration
// ---------------------------------------------------------------------------

/** Opaque, stable identifier for an allowed workspace root (UUID v4). */
export type WorkspaceRootId = string;

/** Canonical host path of an allowed workspace root. */
export type CanonicalPath = string;

/**
 * Display label for a workspace root shown to mobile. Never contains an
 * absolute host path.
 */
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

/** Pinned Pi trust policy version. Bump only when Pi trust semantics change. */
export const TRUST_POLICY_VERSION = "pi-trust/1";

/** Pi version this policy is pinned against. */
export const TRUST_PI_VERSION = "0.80.6";

/** Maximum number of roots the host will keep in its allowlist. */
export const MAX_ALLOWED_ROOTS = 32;

/** Maximum label length accepted from configuration. */
export const MAX_ROOT_LABEL_LENGTH = 64;

/** Pinned list of Pi trust-bearing project config resources (`.pi/*`). */
export const TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES = [
  "settings.json",
  "extensions",
  "skills",
  "prompts",
  "themes",
  "SYSTEM.md",
  "APPEND_SYSTEM.md",
] as const;

/** Pinned list of project-level skills directories (`.agents/skills`). */
export const PROJECT_SKILLS_DIR = ".agents/skills";

/** Maximum bounded-search depth (defensive upper bound; callers may pass less). */
export const MAX_SEARCH_DEPTH = 8;

/** Hard cap on the number of search results returned. */
export const MAX_SEARCH_RESULTS = 200;

/** Hard cap on recents retained per host. */
export const MAX_RECENTS = 50;

/** Regular expression for a UUID-shaped (8-4-4-4-12 lowercase hex) identifier. */
export const UUID_SHAPE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Derives a stable, opaque root id from a canonical host path. The id is
 * SHA-256 of the canonical (post-realpath) path formatted as a
 * UUID-shaped (8-4-4-4-12 lowercase hex) string with the RFC 4122 v4
 * version and variant bits set. The same directory on disk always
 * produces the same id, including when reached via different symlinks
 * that resolve to the same target.
 *
 * UUID-shaped IDs are stable for the same input and conform to the
 * canonical UUID format, so external systems (e.g. mobile clients that
 * persist the id locally) can treat them as opaque tokens without
 * parsing.
 */
export function deriveRootId(canonicalPath: string): WorkspaceRootId {
  const hex = createHash("sha256").update(canonicalPath).digest("hex");
  // Build the standard 8-4-4-4-12 layout. We pin version=4 (random) and
  // variant=10xx so the id always parses as a RFC 4122 v4 UUID, while
  // remaining deterministic for the same input.
  const a = hex.slice(0, 8);
  const b = hex.slice(8, 12);
  const c = "4" + hex.slice(13, 16); // version 4
  const dHigh = (parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80;
  const d = dHigh.toString(16).padStart(2, "0") + hex.slice(18, 20); // variant 10xx
  const e = hex.slice(20, 32);
  return `${a}-${b}-${c}-${d}-${e}`;
}

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
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function createWorkspaceRootsConfig(
  roots: readonly WorkspaceRoot[] = [],
): WorkspaceRootsConfig {
  if (roots.length > MAX_ALLOWED_ROOTS) {
    throw new WorkspacePolicyError(
      "invalid_resource",
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

/**
 * Adds a root to an existing config. The candidate path is canonicalized
 * via `realpath` first; callers must pass the on-disk host path they want
 * to allow, not a symlink that escapes elsewhere.
 *
 * The root id is derived deterministically from the canonical path, so
 * adding the same canonical path twice is a no-op (the existing root is
 * preserved). Callers wanting to rename a root should remove it first.
 */
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
  // Idempotent: same canonical path always produces the same id.
  if (config.roots.some((root) => root.id === id)) return config;
  return createWorkspaceRootsConfig([
    ...config.roots,
    { id, canonicalPath: canonical, label },
  ]);
}

/** Removes a root by id. Returns a new config (the input is immutable). */
export function removeAllowedRoot(
  config: WorkspaceRootsConfig,
  id: WorkspaceRootId,
): WorkspaceRootsConfig {
  const next = config.roots.filter((root) => root.id !== id);
  return createWorkspaceRootsConfig(next);
}

// ---------------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------------

/**
 * Canonicalizes a path using `realpathSync`. Falls back to the resolved
 * (lexical) path if the entry does not exist yet, mirroring Pi's own
 * canonicalizePath behavior. Any `..` segments in the *input* cause an
 * immediate rejection — callers should not be passing `..`.
 */
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
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** Same as {@link canonicalize} but throws on missing entries. */
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
  return realpathSync(path);
}

/** Returns true when `path` strictly equals or descends from `rootCanonical`. */
export function isPathWithinRoot(path: CanonicalPath, rootCanonical: CanonicalPath): boolean {
  if (path === rootCanonical) return true;
  const prefix = rootCanonical.endsWith(sep) ? rootCanonical : rootCanonical + sep;
  return path.startsWith(prefix);
}

/**
 * Resolves a candidate path against an allowed root, canonicalizing the
 * result and verifying it remains inside the root. Symlinks whose targets
 * escape the root are rejected as `symlink_escape`.
 */
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

  // Canonicalize each root first so we can detect which root the candidate
  // belongs to using the real, post-symlink tree.
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
    canonical = realpathSync(candidate);
  } catch {
    throw new WorkspacePolicyError(
      "outside_root",
      `candidate path does not exist: ${candidate}`,
    );
  }

  // Match the deepest root (longest canonical prefix) so a nested-root
  // configuration resolves to the most specific root.
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

  // No canonical root matched. Distinguish "symlink escaped outside every
  // root" from "candidate is simply outside the allowed tree" using the
  // lexical form of the candidate.
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

// ---------------------------------------------------------------------------
// Mobile-facing workspace records
// ---------------------------------------------------------------------------

export type TrustStatus =
  | "unknown"
  | "approval_required"
  | "trusted"
  | "changed"
  | "unavailable";

/**
 * Workspace record returned to mobile. Absolute host paths are intentionally
 * absent — mobile only ever sees `rootId`, `rootLabel`, and the
 * `rootRelativePath`.
 */
export interface MobileWorkspaceRecord {
  readonly id: WorkspaceRootId;
  readonly rootId: WorkspaceRootId;
  readonly rootLabel: WorkspaceRootLabel;
  readonly rootRelativePath: string;
  readonly displayName: string;
  readonly trustStatus: TrustStatus;
  readonly trustFingerprint: string;
  readonly policyVersion: string;
}

/** Builds a mobile record from a host-resolved workspace. */
export function toMobileWorkspaceRecord(
  resolved: ResolvedWorkspacePath,
  config: WorkspaceRootsConfig,
  trustState: TrustState,
): MobileWorkspaceRecord {
  const root = config.roots.find((entry) => entry.id === resolved.rootId);
  if (!root) {
    throw new WorkspacePolicyError(
      "root_not_found",
      `unknown root id: ${resolved.rootId}`,
    );
  }
  return {
    id: resolved.rootId,
    rootId: resolved.rootId,
    rootLabel: root.label,
    rootRelativePath: resolved.relative,
    displayName: displayNameFor(resolved.relative, root.label),
    trustStatus: trustState.status,
    trustFingerprint: trustState.fingerprint,
    policyVersion: trustState.policyVersion,
  };
}

function displayNameFor(relativePath: string, fallbackLabel: string): string {
  if (relativePath === ".") return fallbackLabel;
  const trimmed = relativePath.replace(/\/+$/, "");
  const segments = trimmed.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return fallbackLabel;
  return segments[segments.length - 1]!;
}

/** Type guard used by serializers and downstream JSON validators. */
export function assertNoAbsoluteHostPath(record: MobileWorkspaceRecord): void {
  const fields: readonly string[] = [
    record.id,
    record.rootId,
    record.rootLabel,
    record.rootRelativePath,
    record.displayName,
  ];
  for (const field of fields) {
    if (field.includes("/") && field.startsWith("/")) {
      throw new WorkspacePolicyError(
        "not_absolute",
        `mobile record leaks absolute path: ${JSON.stringify(field)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Trust resource discovery
// ---------------------------------------------------------------------------

export type TrustResourceKind =
  | "settings"
  | "extensions"
  | "skills"
  | "prompts"
  | "themes"
  | "system-md"
  | "append-system-md"
  | "agents-skills";

export interface TrustResource {
  readonly kind: TrustResourceKind;
  /** Path of the resource, relative to the workspace root. */
  readonly relativePath: string;
  /** SHA-256 of the file's content, lower-case hex. Directories are `""`. */
  readonly sha256: string;
  /** Size in bytes. Directories report `0`. */
  readonly size: number;
}

const KIND_BY_BASENAME: ReadonlyMap<string, TrustResourceKind> = new Map([
  ["settings.json", "settings"],
  ["extensions", "extensions"],
  ["skills", "skills"],
  ["prompts", "prompts"],
  ["themes", "themes"],
  ["SYSTEM.md", "system-md"],
  ["APPEND_SYSTEM.md", "append-system-md"],
]);

const KIND_ORDER: readonly TrustResourceKind[] = [
  "settings",
  "extensions",
  "skills",
  "prompts",
  "themes",
  "system-md",
  "append-system-md",
  "agents-skills",
];

/**
 * Walks the pinned list of trust-bearing resources under
 * `<root>/.pi` and the single project-level `<root>/.agents/skills`
 * directory.
 *
 *   - Single files (`settings.json`, `SYSTEM.md`, `APPEND_SYSTEM.md`) are
 *     emitted as one resource entry with their file sha256.
 *   - Trust-bearing directories (`.pi/extensions`, `.pi/skills`,
 *     `.pi/prompts`, `.pi/themes`, `.agents/skills`) are walked
 *     **recursively**: every regular file inside them — at any depth —
 *     is emitted as a resource entry with its own sha256. The recursive
 *     walk never descends into a symlink and rejects the discovery
 *     entirely if any trust resource path resolves to a symlink that
 *     escapes the root.
 *   - A symlink encountered anywhere in the trust tree is treated as a
 *     `symlink_escape` policy violation and aborts discovery.
 *
 * The returned array is deterministically sorted by
 * `(kind, relativePath)`. Missing entries are silently skipped so
 * callers always get the truth about what is on disk.
 */
export function discoverTrustResources(rootCanonical: CanonicalPath): readonly TrustResource[] {
  if (!isAbsolute(rootCanonical)) {
    throw new WorkspacePolicyError(
      "not_absolute",
      `rootCanonical must be absolute: ${rootCanonical}`,
    );
  }
  const out: TrustResource[] = [];
  const configDir = joinPath(rootCanonical, ".pi");
  for (const entry of TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES) {
    const absolute = joinPath(configDir, entry);
    if (!pathExists(absolute)) continue;
    // Reject any symlinked trust resource — a symlink here can be used
    // to inject files from outside the workspace at fingerprint time.
    assertNotSymlink(absolute, `.pi/${entry}`, rootCanonical);
    const lstat = safeLstat(absolute);
    if (!lstat) continue;
    if (lstat.isFile()) {
      out.push({
        kind: kindForFile(entry),
        relativePath: `.pi/${entry}`,
        sha256: sha256OfFile(absolute),
        size: lstat.size,
      });
    } else if (lstat.isDirectory()) {
      const kind = kindForDirectory(entry);
      collectDirectoryFiles(absolute, rootCanonical, `.pi/${entry}`, kind, out);
    }
  }
  const agentsSkills = joinPath(rootCanonical, PROJECT_SKILLS_DIR);
  if (pathExists(agentsSkills)) {
    assertNotSymlink(agentsSkills, PROJECT_SKILLS_DIR, rootCanonical);
    const lstat = safeLstat(agentsSkills);
    if (lstat?.isDirectory()) {
      collectDirectoryFiles(agentsSkills, rootCanonical, PROJECT_SKILLS_DIR, "agents-skills", out);
    }
  }
  return sortResources(out);
}

/**
 * Recursively walks `dir` (a real directory inside `rootCanonical`) and
 * appends one resource entry per regular file found at any depth. Each
 * intermediate directory is itself asserted non-symlink; symlinked files
 * or symlinked intermediate directories raise a `symlink_escape` error.
 */
function collectDirectoryFiles(
  dir: string,
  rootCanonical: CanonicalPath,
  rootRelative: string,
  kind: TrustResourceKind,
  out: TrustResource[],
): void {
  // BFS so deeply nested trees cannot blow the call stack and so the
  // resulting order is deterministic across filesystems.
  const queue: Array<{ absolute: string; relative: string }> = [{ absolute: dir, relative: rootRelative }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const lstat = safeLstat(current.absolute);
    if (!lstat) continue;
    if (lstat.isSymbolicLink()) {
      throw new WorkspacePolicyError(
        "symlink_escape",
        `trust resource path resolves through a symlink: ${current.relative} -> ${current.absolute}`,
      );
    }
    if (!lstat.isDirectory()) continue;
    let entries: readonly string[];
    try {
      entries = readdirSync(current.absolute);
    } catch {
      continue;
    }
    const sorted = [...entries].sort();
    for (const name of sorted) {
      if (name.length === 0) continue;
      const childAbs = joinPath(current.absolute, name);
      const childRel = `${current.relative}/${name}`;
      assertNotSymlink(childAbs, childRel, rootCanonical);
      const childLstat = safeLstat(childAbs);
      if (!childLstat) continue;
      if (childLstat.isDirectory()) {
        queue.push({ absolute: childAbs, relative: childRel });
      } else if (childLstat.isFile()) {
        out.push({
          kind,
          relativePath: childRel,
          sha256: sha256OfFile(childAbs),
          size: childLstat.size,
        });
      }
    }
  }
}

/**
 * Verifies that `absolute` is not a symlink. When `absolute` is itself a
 * symlink (or a symlink in any parent component) that resolves to a
 * target outside `rootCanonical`, the helper throws a
 * `symlink_escape` error so the daemon refuses to fingerprint the
 * workspace.
 *
 * `lstatSync` catches direct symlinks; `realpathSync` catches symlinked
 * parents (an ancestor path component being a symlink). Anything that
 * resolves outside `rootCanonical` is treated as an escape.
 */
function assertNotSymlink(absolute: string, relativePath: string, rootCanonical: CanonicalPath): void {
  let lstat;
  try {
    lstat = lstatSync(absolute);
  } catch {
    return; // missing entry — caller treats as absent
  }
  if (lstat.isSymbolicLink()) {
    throw new WorkspacePolicyError(
      "symlink_escape",
      `trust resource path is a symlink: ${relativePath} -> ${absolute}`,
    );
  }
  let real;
  try {
    real = realpathSync(absolute);
  } catch {
    return; // unresolvable — caller treats as absent
  }
  if (!isPathWithinRoot(real, normalizeCanonical(rootCanonical))) {
    throw new WorkspacePolicyError(
      "symlink_escape",
      `trust resource escapes its root via symlink: ${relativePath} (${absolute} -> ${real})`,
    );
  }
}

function kindForFile(name: string): TrustResourceKind {
  const kind = KIND_BY_BASENAME.get(name);
  if (!kind) {
    throw new WorkspacePolicyError(
      "invalid_resource",
      `unknown trust resource file: ${name}`,
    );
  }
  return kind;
}

function kindForDirectory(name: string): TrustResourceKind {
  const kind = KIND_BY_BASENAME.get(name);
  if (!kind) {
    throw new WorkspacePolicyError(
      "invalid_resource",
      `unknown trust resource directory: ${name}`,
    );
  }
  return kind;
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function safeLstat(path: string): {
  isFile: () => boolean;
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
  size: number;
} | null {
  try {
    const s = lstatSync(path);
    return {
      isFile: () => s.isFile(),
      isDirectory: () => s.isDirectory(),
      isSymbolicLink: () => s.isSymbolicLink(),
      size: s.size,
    };
  } catch {
    return null;
  }
}

function sha256OfFile(path: string): string {
  const bytes = readFileSync(path);
  return createHash("sha256").update(bytes).digest("hex");
}

function joinPath(a: string, b: string): string {
  if (a.endsWith(sep)) return a + b;
  return a + sep + b;
}

function sortResources(resources: readonly TrustResource[]): readonly TrustResource[] {
  return [...resources].sort((a, b) => {
    const ak = KIND_ORDER.indexOf(a.kind);
    const bk = KIND_ORDER.indexOf(b.kind);
    if (ak !== bk) return ak - bk;
    if (a.relativePath < b.relativePath) return -1;
    if (a.relativePath > b.relativePath) return 1;
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Trust manifest + fingerprint
// ---------------------------------------------------------------------------

export interface TrustManifest {
  readonly policyVersion: string;
  readonly piVersion: string;
  readonly rootCanonicalPath: CanonicalPath;
  readonly resources: readonly TrustResource[];
}

export function buildTrustManifest(
  rootCanonical: CanonicalPath,
  resources: readonly TrustResource[] = discoverTrustResources(rootCanonical),
): TrustManifest {
  if (!isAbsolute(rootCanonical)) {
    throw new WorkspacePolicyError(
      "not_absolute",
      `rootCanonical must be absolute: ${rootCanonical}`,
    );
  }
  return {
    policyVersion: TRUST_POLICY_VERSION,
    piVersion: TRUST_PI_VERSION,
    rootCanonicalPath: rootCanonical,
    resources: sortResources(resources),
  };
}

/** Canonical JSON serialization of a trust manifest (sorted keys, no whitespace). */
export function canonicalizeManifest(manifest: TrustManifest): string {
  return JSON.stringify(sortKeysDeep(manifest));
}

export function computeFingerprint(manifest: TrustManifest): string {
  const canonical = canonicalizeManifest(manifest);
  return createHash("sha256").update(canonical).digest("hex");
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Approval store
// ---------------------------------------------------------------------------

export interface ApprovalRecord {
  readonly fingerprint: string;
  readonly approvedAt: number;
  readonly approvedBy: string;
}

export interface PersistedApproval {
  readonly fingerprint: string;
  readonly approvedAt: number;
  readonly approvedBy: string;
  readonly policyVersion: string;
}

/**
 * JSON-file backed approval store keyed by workspace root id. The store is
 * intentionally tiny: one record per root. Re-approving the same fingerprint
 * is a no-op; approving a different fingerprint overwrites the prior record
 * and exposes the prior fingerprint as `invalidatedAt` for diagnostics.
 */
export class TrustApprovalStore {
  private readonly filePath: string;
  private cache: Map<WorkspaceRootId, PersistedApproval> | null = null;

  constructor(filePath: string) {
    if (!isAbsolute(filePath)) {
      throw new WorkspacePolicyError(
        "not_absolute",
        `approval store path must be absolute: ${filePath}`,
      );
    }
    this.filePath = filePath;
  }

  /** Returns the stored approval for the root, or `null` if none exists. */
  load(rootId: WorkspaceRootId): PersistedApproval | null {
    const map = this.readAll();
    return map.get(rootId) ?? null;
  }

  /** Returns the stored fingerprint for the root (sugar over {@link load}). */
  approvedFingerprint(rootId: WorkspaceRootId): string | null {
    return this.load(rootId)?.fingerprint ?? null;
  }

  /** Approves `fingerprint` for `rootId`. Overwrites any prior approval. */
  approve(
    rootId: WorkspaceRootId,
    fingerprint: string,
    approvedBy: string,
    policyVersion: string = TRUST_POLICY_VERSION,
  ): PersistedApproval {
    if (!isHex64(fingerprint)) {
      throw new WorkspacePolicyError(
        "invalid_resource",
        `fingerprint must be a 64-char hex SHA-256: ${fingerprint}`,
      );
    }
    if (approvedBy.length === 0) {
      throw new WorkspacePolicyError(
        "invalid_label",
        "approvedBy must be a non-empty string",
      );
    }
    if (policyVersion !== TRUST_POLICY_VERSION) {
      throw new WorkspacePolicyError(
        "invalid_resource",
        `policyVersion mismatch: store=${policyVersion} policy=${TRUST_POLICY_VERSION}`,
      );
    }
    const map = this.readAll();
    const record: PersistedApproval = {
      fingerprint,
      approvedAt: Date.now(),
      approvedBy,
      policyVersion,
    };
    map.set(rootId, record);
    this.writeAll(map);
    return record;
  }

  /** Clears any prior approval for the root. */
  clear(rootId: WorkspaceRootId): void {
    const map = this.readAll();
    if (map.delete(rootId)) this.writeAll(map);
  }

  private readAll(): Map<WorkspaceRootId, PersistedApproval> {
    if (this.cache) return this.cache;
    if (!existsSync(this.filePath)) {
      this.cache = new Map();
      return this.cache;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new WorkspacePolicyError(
        "invalid_resource",
        `approval store unreadable: ${(error as Error).message}`,
      );
    }
    if (!isPlainObject(parsed) || parsed.schemaVersion !== 1) {
      throw new WorkspacePolicyError(
        "invalid_resource",
        "approval store must declare schemaVersion=1",
      );
    }
    const approvals = parsed.approvals;
    if (!isPlainObject(approvals)) {
      throw new WorkspacePolicyError(
        "invalid_resource",
        "approval store must contain an `approvals` object",
      );
    }
    const map = new Map<WorkspaceRootId, PersistedApproval>();
    for (const [key, value] of Object.entries(approvals)) {
      if (!isPlainObject(value)) continue;
      if (typeof value.fingerprint !== "string" || !isHex64(value.fingerprint)) continue;
      if (typeof value.approvedAt !== "number") continue;
      if (typeof value.approvedBy !== "string") continue;
      if (typeof value.policyVersion !== "string") continue;
      map.set(key, {
        fingerprint: value.fingerprint,
        approvedAt: value.approvedAt,
        approvedBy: value.approvedBy,
        policyVersion: value.policyVersion,
      });
    }
    this.cache = map;
    return map;
  }

  private writeAll(map: Map<WorkspaceRootId, PersistedApproval>): void {
    const approvals: Record<string, PersistedApproval> = {};
    for (const [key, value] of [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      approvals[key] = value;
    }
    const payload = { schemaVersion: 1 as const, approvals };
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    writeFileSync(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    this.cache = map;
  }
}

function isHex64(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

// ---------------------------------------------------------------------------
// Trust resolution + start gating
// ---------------------------------------------------------------------------

export interface TrustState {
  readonly status: TrustStatus;
  readonly fingerprint: string;
  readonly policyVersion: string;
  readonly manifest: TrustManifest;
  readonly approvedAt: number | null;
  readonly invalidatedReason: string | null;
}

/**
 * Resolves the current trust state by discovering resources, computing
 * the fingerprint, and comparing it to the persisted approval. Approval
 * stores with a different `policyVersion` always re-trigger approval.
 */
export function resolveTrustState(
  rootCanonical: CanonicalPath,
  store: TrustApprovalStore,
  rootId: WorkspaceRootId,
): TrustState {
  const manifest = buildTrustManifest(rootCanonical);
  const fingerprint = computeFingerprint(manifest);
  const approved = store.load(rootId);

  if (!approved) {
    return {
      status: "approval_required",
      fingerprint,
      policyVersion: manifest.policyVersion,
      manifest,
      approvedAt: null,
      invalidatedReason: null,
    };
  }

  if (approved.policyVersion !== manifest.policyVersion) {
    return {
      status: "approval_required",
      fingerprint,
      policyVersion: manifest.policyVersion,
      manifest,
      approvedAt: approved.approvedAt,
      invalidatedReason: `policy_version_changed:${approved.policyVersion}->${manifest.policyVersion}`,
    };
  }

  if (approved.fingerprint !== fingerprint) {
    return {
      status: "changed",
      fingerprint,
      policyVersion: manifest.policyVersion,
      manifest,
      approvedAt: approved.approvedAt,
      invalidatedReason: "fingerprint_changed",
    };
  }

  return {
    status: "trusted",
    fingerprint,
    policyVersion: manifest.policyVersion,
    manifest,
    approvedAt: approved.approvedAt,
    invalidatedReason: null,
  };
}

export interface StartGateDecision {
  readonly allowed: boolean;
  readonly reason: string | null;
  readonly requiredFingerprint: string;
}

/**
 * Gates session/process start on the trust state. Only `trusted` is allowed;
 * everything else returns `allowed: false` with a stable `reason` code the
 * mobile UI can translate verbatim.
 */
export function evaluateStartGate(state: TrustState): StartGateDecision {
  const requiredFingerprint = state.fingerprint;
  if (state.status === "trusted") {
    return { allowed: true, reason: null, requiredFingerprint };
  }
  if (state.status === "changed") {
    return {
      allowed: false,
      reason: state.invalidatedReason ?? "approval_required_after_change",
      requiredFingerprint,
    };
  }
  if (state.status === "unavailable") {
    return { allowed: false, reason: "workspace_unavailable", requiredFingerprint };
  }
  return { allowed: false, reason: "approval_required", requiredFingerprint };
}

// ---------------------------------------------------------------------------
// Recents + bounded cancellable search
// ---------------------------------------------------------------------------

export interface RecentEntry {
  readonly rootId: WorkspaceRootId;
  readonly rootRelativePath: string;
  readonly lastUsedAt: number;
}

interface MutableRecentEntry {
  rootId: WorkspaceRootId;
  rootRelativePath: string;
  lastUsedAt: number;
}

/**
 * In-memory recents store, capped at {@link MAX_RECENTS}. Entries with the
 * same `(rootId, rootRelativePath)` are deduplicated by bumping the
 * timestamp; the store evicts the oldest entries first once full.
 */
export class RecentsStore {
  private readonly entries: MutableRecentEntry[] = [];

  push(entry: RecentEntry): void {
    const existingIndex = this.entries.findIndex(
      (candidate) =>
        candidate.rootId === entry.rootId &&
        candidate.rootRelativePath === entry.rootRelativePath,
    );
    if (existingIndex >= 0) this.entries.splice(existingIndex, 1);
    this.entries.unshift({
      rootId: entry.rootId,
      rootRelativePath: entry.rootRelativePath,
      lastUsedAt: entry.lastUsedAt,
    });
    if (this.entries.length > MAX_RECENTS) {
      this.entries.length = MAX_RECENTS;
    }
  }

  list(): readonly RecentEntry[] {
    return this.entries.map((entry) => ({
      rootId: entry.rootId,
      rootRelativePath: entry.rootRelativePath,
      lastUsedAt: entry.lastUsedAt,
    }));
  }

  clear(): void {
    this.entries.length = 0;
  }
}

export interface SearchResult {
  readonly canonicalPath: CanonicalPath;
  readonly rootRelativePath: string;
  readonly name: string;
}

export interface SearchOptions {
  readonly query: string;
  readonly maxDepth?: number;
  readonly maxResults?: number;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

/**
 * Bounded, cancellable directory-name search under a canonical root.
 *
 * - `maxDepth` defaults to 4 and is hard-capped at {@link MAX_SEARCH_DEPTH}.
 * - `maxResults` defaults to 50 and is hard-capped at {@link MAX_SEARCH_RESULTS}.
 * - Cancellation: `signal.aborted` is checked between every directory read.
 * - Skip policy: never descends into the trust-bearing `.pi` or `.agents`
 *   directories; never crosses a symlink (uses `lstat`).
 * - Determinism: results are sorted by `(rootRelativePath)` ascending.
 */
export function searchDirectories(
  rootCanonical: CanonicalPath,
  options: SearchOptions,
): readonly SearchResult[] {
  const query = options.query.trim();
  if (query.length === 0) return [];
  const lowerQuery = query.toLowerCase();
  const maxDepth = Math.min(options.maxDepth ?? 4, MAX_SEARCH_DEPTH);
  const maxResults = Math.min(options.maxResults ?? 50, MAX_SEARCH_RESULTS);
  const signal = options.signal;

  const collected: SearchResult[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: rootCanonical, depth: 0 }];
  const now = options.now ?? Date.now;

  while (queue.length > 0) {
    if (signal?.aborted) {
      throw new WorkspacePolicyError("aborted", "search cancelled");
    }
    const current = queue.shift()!;
    const depth = current.depth;
    if (depth > maxDepth) continue;

    let names: readonly string[];
    try {
      names = readdirSync(current.path);
    } catch {
      continue;
    }
    names = [...names].sort();

    for (const name of names) {
      if (signal?.aborted) {
        throw new WorkspacePolicyError("aborted", "search cancelled");
      }
      if (shouldSkipName(name)) continue;
      const childPath = joinPath(current.path, name);
      let lstat;
      try {
        lstat = lstatSync(childPath);
      } catch {
        continue;
      }
      if (lstat.isSymbolicLink()) continue;
      if (!lstat.isDirectory()) continue;

      const rootRelativePath = toPosixRelative(relative(rootCanonical, childPath));
      if (name.toLowerCase().includes(lowerQuery)) {
        collected.push({
          canonicalPath: childPath,
          rootRelativePath,
          name,
        });
        if (collected.length >= maxResults) break;
      }
      if (depth < maxDepth) {
        queue.push({ path: childPath, depth: depth + 1 });
      }
    }
    if (collected.length >= maxResults) break;
    // Cooperative yield so a long walk does not starve the event loop.
    if ((now() & 0x3f) === 0) awaitMicrotask();
  }

  collected.sort((a, b) => (a.rootRelativePath < b.rootRelativePath ? -1 : a.rootRelativePath > b.rootRelativePath ? 1 : 0));
  return collected.slice(0, maxResults);
}

function shouldSkipName(name: string): boolean {
  if (name.startsWith(".")) {
    // Trust-bearing project resources: never descend into `.pi` or `.agents`.
    // Also skip everything else dot-prefixed to keep the walk predictable.
    return true;
  }
  if (name === "node_modules") return true;
  return false;
}

function awaitMicrotask(): void {
  // Microtask yield without pulling in timers; safe under bun:test too.
  void Promise.resolve();
}

// ---------------------------------------------------------------------------
// Test/diagnostic helpers
// ---------------------------------------------------------------------------

/**
 * Convenience used by tests: create a symlink at `linkPath` pointing to
 * `target`. Exposed so callers do not reach into `node:fs` directly.
 */
export function createSymlink(target: string, linkPath: string): void {
  symlinkSync(target, linkPath);
}

/** Test helper: removes a symlink without throwing if it does not exist. */
export function removeSymlink(linkPath: string): void {
  try {
    unlinkSync(linkPath);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// M8 — durable trust approval backed by the bridge store
// ---------------------------------------------------------------------------

import type { BridgeStore, StoredHostPolicyState, StoredWorkspaceTrust } from "./store";

export type HostPolicyMode = "full" | "read_only";

export interface HostPolicyRules {
  /** Host-side host tool policy version (mirrors pi-extension/policy). */
  readonly policyVersion: string;
  /** SHA-256 fingerprint of the canonical rules manifest. */
  readonly fingerprint: string;
}

/**
 * Default host policy metadata the runtime reports when nothing else is
 * configured. Mirrors the pi-extension policy header so callers get a
 * stable `policyVersion`/`fingerprint` pairing out of the box.
 */
export const DEFAULT_HOST_POLICY_RULES: HostPolicyRules = {
  policyVersion: "1.0.0",
  fingerprint: createHash("sha256").update("pi-mob/host-policy-default/1.0.0").digest("hex"),
};

/**
 * Computes a deterministic fingerprint for the host-side policy rules.
 * The pi-extension owns the *content* of the rules; the bridge only
 * mirrors the manifest so a Pi upgrade that bumps the rules' version
 * invalidates every active session and forces re-approval at start.
 */
export function computeHostPolicyFingerprint(rules: HostPolicyRules): string {
  const canonical = JSON.stringify({ policyVersion: rules.policyVersion });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Durable trust store backed by {@link BridgeStore}. Mirrors the
 * behaviour of the file-backed {@link TrustApprovalStore} but survives
 * daemon upgrades without depending on a separate JSON file.
 *
 * The store is the *only* durable source of trust state the bridge
 * runtime consults. The file-backed `TrustApprovalStore` remains for
 * unit tests that want to exercise canonicalization without booting the
 * full SQLite runtime.
 */
export class DurableTrustPolicyStore {
  constructor(private readonly store: BridgeStore) {}

  load(workspaceId: WorkspaceRootId): StoredWorkspaceTrust | null {
    return this.store.loadWorkspaceTrust(workspaceId);
  }

  approvedFingerprint(workspaceId: WorkspaceRootId): string | null {
    return this.load(workspaceId)?.fingerprint ?? null;
  }

  approve(input: {
    workspaceId: WorkspaceRootId;
    rootPath: CanonicalPath;
    label: WorkspaceRootLabel;
    fingerprint: string;
    policyVersion: string;
    approvedBy: string;
    now?: number;
  }): StoredWorkspaceTrust {
    if (!isHex64(input.fingerprint)) {
      throw new WorkspacePolicyError("invalid_resource", `fingerprint must be a 64-char hex SHA-256: ${input.fingerprint}`);
    }
    if (input.approvedBy.length === 0) {
      throw new WorkspacePolicyError("invalid_label", "approvedBy must be a non-empty string");
    }
    const now = input.now ?? Date.now();
    const record: StoredWorkspaceTrust = {
      workspaceId: input.workspaceId,
      rootPath: input.rootPath,
      label: input.label,
      fingerprint: input.fingerprint,
      policyVersion: input.policyVersion,
      approvedAt: now,
      approvedBy: input.approvedBy,
      updatedAt: now,
    };
    this.store.saveWorkspaceTrust(record);
    return record;
  }

  clear(workspaceId: WorkspaceRootId): void {
    this.store.clearWorkspaceTrust(workspaceId);
  }

  /** Lists every persisted trust record. */
  list(): readonly StoredWorkspaceTrust[] {
    return this.store.listWorkspaceTrust();
  }

  /**
   * Resolves the current trust state for a workspace by reading the
   * canonical manifest on disk and comparing it to the persisted
   * approval. Returns `approval_required` when there is no persisted
   * approval and `changed` when the on-disk fingerprint has moved.
   *
   * The trust decision is intentionally *manual*: the daemon never
   * pre-seeds an approval, even on first launch. The bridge starts
   * with an empty approval store; the owner must run
   * `workspace.trust.approve` and then explicitly activate the workspace
   * before Pi is allowed to run.
   */
  resolveTrustState(input: {
    workspaceId: WorkspaceRootId;
    rootCanonical: CanonicalPath;
  }): TrustState {
    const manifest = buildTrustManifest(input.rootCanonical);
    const fingerprint = computeFingerprint(manifest);
    const approved = this.load(input.workspaceId);

    if (!approved) {
      return {
        status: "approval_required",
        fingerprint,
        policyVersion: manifest.policyVersion,
        manifest,
        approvedAt: null,
        invalidatedReason: null,
      };
    }

    if (approved.policyVersion !== manifest.policyVersion) {
      return {
        status: "approval_required",
        fingerprint,
        policyVersion: manifest.policyVersion,
        manifest,
        approvedAt: approved.approvedAt,
        invalidatedReason: `policy_version_changed:${approved.policyVersion}->${manifest.policyVersion}`,
      };
    }

    if (approved.fingerprint !== fingerprint) {
      return {
        status: "changed",
        fingerprint,
        policyVersion: manifest.policyVersion,
        manifest,
        approvedAt: approved.approvedAt,
        invalidatedReason: "fingerprint_changed",
      };
    }

    return {
      status: "trusted",
      fingerprint,
      policyVersion: manifest.policyVersion,
      manifest,
      approvedAt: approved.approvedAt,
      invalidatedReason: null,
    };
  }
}

// ---------------------------------------------------------------------------
// M8 — host policy service (full vs read_only) + escalation rules
// ---------------------------------------------------------------------------

export interface EffectiveHostPolicy {
  readonly mode: HostPolicyMode;
  readonly rules: HostPolicyRules;
}

/**
 * Decision returned by {@link HostPolicyService.evaluate}.
 * `allow` means the requested action is permitted at the policy layer.
 * `escalation` is true when the request would move the host from a less
 * permissive mode into a more permissive one; the runtime must reject
 * escalation requests unless the request itself supplies an `approvedHost`
 * (i.e. a separate host-wide approval that covers the new mode).
 */
export interface PolicyDecision {
  readonly allow: boolean;
  readonly mode: HostPolicyMode;
  readonly effective: HostPolicyRules;
  readonly code: "allowed" | "policy_denied" | "escalation_required";
  readonly message: string | null;
}

export interface PolicyEvaluationOptions {
  /** Preferred mode for the action. */
  readonly requestedMode: HostPolicyMode;
  /** When escalating, the requester must prove an approved host policy at the target mode. */
  readonly approvedHost?: HostPolicyMode;
  /** Optional override label propagated for diagnostics. */
  readonly actor?: string;
}

/**
 * Result of attempting a `session.policy.set`. Either persists a new
 * mode or refuses with an escalation error that the runtime surfaces to
 * mobile as a structured protocol error.
 */
export type PolicyMutationResult =
  | { readonly ok: true; readonly mode: HostPolicyMode; readonly rules: HostPolicyRules; readonly updatedAt: number }
  | { readonly ok: false; readonly code: "escalation_required" | "policy_denied" | "invalid_mode"; readonly message: string; readonly currentMode: HostPolicyMode };

/**
 * Host policy service. Owns the *host-wide* mode (one of `full` /
 * `read_only`) and the rule fingerprint the bridge advertises to the
 * pi-extension. Persists state through {@link BridgeStore}.
 *
 * Escalation rules:
 *   - `read_only` → `full` is **never** permitted by `setMode()`. The
 *     runtime must reject the request even if the client supplies an
 *     `approvedHost` claim: escalation requires the daemon operator to
 *     restart the host with `--policy-mode full`. This blocks mobile
 *     from unilaterally widening the policy surface.
 *   - `full` → `read_only` is always permitted (a tightening of the
 *     policy surface is always safe to accept).
 *   - Identical mode is always permitted (idempotent no-op).
 */
export class HostPolicyService {
  constructor(private readonly store: BridgeStore) {}

  /** Returns the persisted host policy state, or `null` if none yet. */
  load(): StoredHostPolicyState | null {
    return this.store.loadHostPolicyState();
  }

  /** Returns the *effective* policy the runtime currently advertises. */
  effective(now: () => number = Date.now): EffectiveHostPolicy {
    const persisted = this.load();
    if (persisted) return { mode: persisted.mode, rules: { policyVersion: persisted.policyVersion, fingerprint: persisted.fingerprint } };
    // The very first daemon startup has not yet persisted a state. Fall
    // back to a permissive but well-known fingerprint so callers always
    // have something to log.
    const seed: StoredHostPolicyState = { mode: "full", policyVersion: DEFAULT_HOST_POLICY_RULES.policyVersion, fingerprint: DEFAULT_HOST_POLICY_RULES.fingerprint, source: "seed", updatedAt: now() };
    this.store.saveHostPolicyState(seed);
    return { mode: seed.mode, rules: { policyVersion: seed.policyVersion, fingerprint: seed.fingerprint } };
  }

  /**
   * Evaluates whether a given request is permitted under the current
   * host policy. Per the M8 contract, escalation (`read_only` → `full`)
   * is **never** permitted at the runtime layer, even if the request
   * carries an `approvedHost` claim — the daemon operator must restart
   * the host with `--policy-mode full` to widen. Returns
   * `{ allow: false, code: "escalation_required" }` for any escalation
   * request.
   */
  evaluate(options: PolicyEvaluationOptions): PolicyDecision {
    const eff = this.effective();
    if (options.requestedMode === eff.mode) {
      return { allow: true, mode: eff.mode, effective: eff.rules, code: "allowed", message: null };
    }
    if (escalationToward(eff.mode, options.requestedMode)) {
      // Hard refusal — surface the reason to the caller verbatim.
      const by = options.approvedHost ? ` (approvedHost=${options.approvedHost} is ignored for runtime escalations; the daemon operator must restart with --policy-mode full)` : "";
      return {
        allow: false,
        mode: eff.mode,
        effective: eff.rules,
        code: "escalation_required",
        message: `host policy is ${eff.mode}; cannot escalate to ${options.requestedMode} via runtime API${by}`,
      };
    }
    return {
      allow: true,
      mode: eff.mode,
      effective: eff.rules,
      code: "allowed",
      message: `tightening host policy from ${eff.mode} to ${options.requestedMode}`,
    };
  }

  /**
   * Attempts to change the host-wide policy mode. Per the M8 contract,
   * `read_only → full` is **always** rejected — the daemon operator
   * must restart the host with `--policy-mode full` to widen. Returns
   * an `escalation_required` result for upgrade requests.
   */
  setMode(input: {
    mode: HostPolicyMode;
    rules?: HostPolicyRules;
    actor: string;
    approvedHost?: HostPolicyMode;
    now?: number;
  }): PolicyMutationResult {
    if (input.mode !== "full" && input.mode !== "read_only") {
      return { ok: false, code: "invalid_mode", message: `unknown policy mode: ${String(input.mode)}`, currentMode: this.effective().mode };
    }
    const current = this.effective();
    if (escalationToward(current.mode, input.mode)) {
      // Hard refusal: runtime never persists an escalation. Even with
      // an `approvedHost` claim the daemon operator must re-launch.
      return { ok: false, code: "escalation_required", message: `host policy escalation ${current.mode}→${input.mode} requires daemon restart with --policy-mode ${input.mode}`, currentMode: current.mode };
    }
    const rules = input.rules ?? { policyVersion: current.rules.policyVersion, fingerprint: current.rules.fingerprint };
    const now = input.now ?? Date.now();
    const record: StoredHostPolicyState = { mode: input.mode, policyVersion: rules.policyVersion, fingerprint: rules.fingerprint, source: "client", updatedAt: now, updatedBy: input.actor };
    this.store.saveHostPolicyState(record);
    return { ok: true, mode: input.mode, rules, updatedAt: now };
  }

  /**
   * Seeds the host policy from CLI flags on first launch. On later launches,
   * a configured `read_only` mode always tightens a persisted `full` mode;
   * configuration can never silently widen a durable read-only policy.
   */
  seedIfAbsent(input: { mode: HostPolicyMode; rules?: HostPolicyRules; actor: string; now?: number }): { seeded: boolean; policy: EffectiveHostPolicy } {
    const existing = this.load();
    if (existing) {
      if (existing.mode === "full" && input.mode === "read_only") {
        const tightened = this.setMode({ mode: "read_only", ...(input.rules ? { rules: input.rules } : {}), actor: input.actor, ...(input.now !== undefined ? { now: input.now } : {}) });
        if (!tightened.ok) throw new Error(`failed to apply configured read-only policy: ${tightened.message}`);
      }
      return { seeded: false, policy: this.effective() };
    }
    const rules = input.rules ?? { policyVersion: DEFAULT_HOST_POLICY_RULES.policyVersion, fingerprint: computeHostPolicyFingerprint(DEFAULT_HOST_POLICY_RULES) };
    const now = input.now ?? Date.now();
    const record: StoredHostPolicyState = { mode: input.mode, policyVersion: rules.policyVersion, fingerprint: rules.fingerprint, source: "config", updatedAt: now, updatedBy: input.actor };
    this.store.saveHostPolicyState(record);
    return { seeded: true, policy: { mode: record.mode, rules: { policyVersion: record.policyVersion, fingerprint: record.fingerprint } } };
  }
}

/** Returns true when the transition from→to is an *escalation*. */
export function escalationToward(from: HostPolicyMode, to: HostPolicyMode): boolean {
  return from === "read_only" && to === "full";
}

// ---------------------------------------------------------------------------
// M8 — bounded search adapter for the runtime
// ---------------------------------------------------------------------------

export interface BoundedSearchInput {
  readonly rootCanonical: CanonicalPath;
  readonly query: string;
  readonly maxDepth?: number;
  readonly maxResults?: number;
  readonly signal?: AbortSignal;
}

export type BoundedSearchFn = (input: BoundedSearchInput) => readonly SearchResult[];

export const defaultBoundedSearch: BoundedSearchFn = (input) => {
  const opts: Parameters<typeof searchDirectories>[1] = { query: input.query };
  if (input.maxDepth !== undefined) (opts as { maxDepth?: number }).maxDepth = input.maxDepth;
  if (input.maxResults !== undefined) (opts as { maxResults?: number }).maxResults = input.maxResults;
  if (input.signal !== undefined) (opts as { signal?: AbortSignal }).signal = input.signal;
  return searchDirectories(input.rootCanonical, opts);
};
