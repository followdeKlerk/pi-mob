/**
 * Release artifact manifest.
 *
 * A manifest is the contract the install/update/rollback flows verify against.
 * It pins:
 *
 *   - `schemaVersion` (always `1` for M7),
 *   - `product`, `version`, `architecture`,
 *   - the SHA-256 of every artifact and license file shipped in the release,
 *   - the Bun and macOS floors the release targets.
 *
 * Determinism: {@link formatManifest} emits canonical JSON (sorted keys,
 * no whitespace, UTF-8) so the same logical manifest always hashes to the
 * same digest regardless of input ordering.
 */

import { createHash } from "node:crypto";
import { isAbsolute, resolve, sep } from "node:path";

import type { FileSystemPort } from "./ports";

export type Architecture = "arm64" | "x64";

export type LicenseKind = "spdx" | "notice" | "exception";

export interface ManifestLicense {
  readonly name: string;
  readonly spdxId?: string;
  readonly kind: LicenseKind;
  /** Normalized path relative to the release bundle root. */
  readonly path: string;
  /** Hex SHA-256 of the license file contents. */
  readonly sha256: string;
}

export type ArtifactKind =
  | "daemon-binary"
  | "lifecycle-cli"
  | "extension"
  | "schema"
  | "config-template"
  | "license";

export interface ManifestArtifact {
  readonly name: string;
  readonly kind: ArtifactKind;
  /** Normalized path relative to the release bundle root. */
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface ReleaseManifest {
  readonly schemaVersion: 1;
  readonly product: string;
  readonly version: string;
  readonly architecture: Architecture;
  readonly bun: { readonly minimum: string };
  readonly protocolVersion: string;
  readonly minMacos: string;
  readonly artifacts: readonly ManifestArtifact[];
  readonly licenses: readonly ManifestLicense[];
}

/** Thrown when a manifest fails parsing or structural validation. */
export class ManifestError extends Error {
  override readonly name = "ManifestError";
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** Returns the lowercase hex SHA-256 of a buffer or UTF-8 string. */
export function sha256Of(data: Buffer | string): string {
  const buffer = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return createHash("sha256").update(buffer).digest("hex");
}

/** Canonical JSON: sorted keys, no whitespace, UTF-8. Stable across runtimes. */
export function formatManifest(manifest: ReleaseManifest): string {
  return canonicalJsonStringify(manifest);
}

/** Parses a manifest JSON string and validates its structure. */
export function parseManifest(json: string): ReleaseManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new ManifestError("parse", `manifest is not valid JSON: ${(error as Error).message}`);
  }
  return validateManifest(parsed);
}

/** Validates a parsed object as a manifest. Exposed for tests. */
export function validateManifest(value: unknown): ReleaseManifest {
  if (!isPlainObject(value)) {
    throw new ManifestError("shape", "manifest root must be an object");
  }
  if (value.schemaVersion !== 1) {
    throw new ManifestError("schema_version", `unsupported schemaVersion: ${stringify(value.schemaVersion)}`);
  }
  if (typeof value.product !== "string" || value.product.length === 0) {
    throw new ManifestError("product", "product must be a non-empty string");
  }
  if (typeof value.version !== "string" || value.version.length === 0) {
    throw new ManifestError("version", "version must be a non-empty string");
  }
  if (value.architecture !== "arm64" && value.architecture !== "x64") {
    throw new ManifestError("architecture", `architecture must be 'arm64' or 'x64' (got ${stringify(value.architecture)})`);
  }
  if (!isPlainObject(value.bun) || typeof value.bun.minimum !== "string") {
    throw new ManifestError("bun", "bun.minimum must be a string");
  }
  if (typeof value.protocolVersion !== "string") {
    throw new ManifestError("protocol_version", "protocolVersion must be a string");
  }
  if (typeof value.minMacos !== "string") {
    throw new ManifestError("min_macos", "minMacos must be a string");
  }
  if (!Array.isArray(value.artifacts)) {
    throw new ManifestError("artifacts", "artifacts must be an array");
  }
  if (!Array.isArray(value.licenses)) {
    throw new ManifestError("licenses", "licenses must be an array");
  }
  const artifacts: ManifestArtifact[] = value.artifacts.map((entry, index) => validateArtifact(entry, index));
  const licenses: ManifestLicense[] = value.licenses.map((entry, index) => validateLicense(entry, index));
  return {
    schemaVersion: 1,
    product: value.product,
    version: value.version,
    architecture: value.architecture,
    bun: { minimum: value.bun.minimum },
    protocolVersion: value.protocolVersion,
    minMacos: value.minMacos,
    artifacts,
    licenses,
  };
}

function validateArtifact(value: unknown, index: number): ManifestArtifact {
  if (!isPlainObject(value)) {
    throw new ManifestError("artifact_shape", `artifacts[${index}] must be an object`);
  }
  const kind = value.kind;
  const allowed: readonly ArtifactKind[] = ["daemon-binary", "lifecycle-cli", "extension", "schema", "config-template", "license"];
  if (typeof kind !== "string" || !allowed.includes(kind as ArtifactKind)) {
    throw new ManifestError("artifact_kind", `artifacts[${index}].kind is invalid: ${stringify(kind)}`);
  }
  if (typeof value.name !== "string" || value.name.length === 0) {
    throw new ManifestError("artifact_name", `artifacts[${index}].name must be a non-empty string`);
  }
  if (typeof value.path !== "string" || !isSupportedManifestPath(value.path)) {
    throw new ManifestError(
      "artifact_path",
      `artifacts[${index}].path must be a normalized bundle-relative path: ${stringify(value.path)}`,
    );
  }
  if (typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.sha256)) {
    throw new ManifestError("artifact_sha256", `artifacts[${index}].sha256 must be a 64-char hex string`);
  }
  if (typeof value.size !== "number" || !Number.isInteger(value.size) || value.size < 0) {
    throw new ManifestError("artifact_size", `artifacts[${index}].size must be a non-negative integer`);
  }
  return {
    name: value.name,
    kind: kind as ArtifactKind,
    path: value.path,
    sha256: value.sha256,
    size: value.size,
  };
}

function validateLicense(value: unknown, index: number): ManifestLicense {
  if (!isPlainObject(value)) {
    throw new ManifestError("license_shape", `licenses[${index}] must be an object`);
  }
  const kind = value.kind;
  const allowed: readonly LicenseKind[] = ["spdx", "notice", "exception"];
  if (typeof kind !== "string" || !allowed.includes(kind as LicenseKind)) {
    throw new ManifestError("license_kind", `licenses[${index}].kind is invalid: ${stringify(kind)}`);
  }
  if (typeof value.name !== "string" || value.name.length === 0) {
    throw new ManifestError("license_name", `licenses[${index}].name must be a non-empty string`);
  }
  if (typeof value.path !== "string" || !isSupportedManifestPath(value.path)) {
    throw new ManifestError(
      "license_path",
      `licenses[${index}].path must be a normalized bundle-relative path: ${stringify(value.path)}`,
    );
  }
  if (typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.sha256)) {
    throw new ManifestError("license_sha256", `licenses[${index}].sha256 must be a 64-char hex string`);
  }
  const out: ManifestLicense = {
    name: value.name,
    kind: kind as LicenseKind,
    path: value.path,
    sha256: value.sha256,
  };
  if (typeof value.spdxId === "string" && value.spdxId.length > 0) {
    return { ...out, spdxId: value.spdxId };
  }
  return out;
}

/** Stable JSON stringify with sorted keys. */
function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep(value[key]);
    }
    return out;
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Release manifests now use portable bundle-relative paths. Legacy absolute
 * paths remain parseable only so already-created M7 install/update objects do
 * not break; new producers must never emit them. Both forms reject traversal,
 * dot segments, duplicate separators, backslashes, and NUL bytes.
 */
function isSupportedManifestPath(value: string): boolean {
  return isNormalizedBundleRelativePath(value) || isNormalizedLegacyAbsolutePath(value);
}

function isNormalizedBundleRelativePath(value: string): boolean {
  if (value.length === 0 || isAbsolute(value) || value.includes("\\") || value.includes("\0")) return false;
  return hasOnlyNormalSegments(value.split("/"));
}

function isNormalizedLegacyAbsolutePath(value: string): boolean {
  if (!isAbsolute(value) || !value.startsWith("/") || value.includes("\\") || value.includes("\0")) return false;
  return hasOnlyNormalSegments(value.slice(1).split("/"));
}

function hasOnlyNormalSegments(segments: readonly string[]): boolean {
  return segments.length > 0 && segments.every((segment) =>
    segment.length > 0 && segment !== "." && segment !== ".."
  );
}

function stringify(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Verifies every artifact and license checksum on disk. */
export interface ManifestVerification {
  readonly ok: boolean;
  readonly artifacts: readonly ManifestVerificationEntry[];
  readonly licenses: readonly ManifestVerificationEntry[];
}

export interface ManifestVerificationEntry {
  readonly path: string;
  readonly expectedSha256: string;
  readonly actualSha256: string | null;
  readonly ok: boolean;
  readonly reason?: "missing" | "checksum_mismatch" | "size_mismatch" | "io_error";
  readonly actualSize?: number;
  readonly expectedSize?: number;
}

/**
 * Verifies every artifact checksum against the filesystem.
 *
 * Preferred portable form: `verifyManifest(manifest, bundleRoot, fs)`. The
 * bundle root must be absolute and every manifest path is resolved beneath it.
 * The old `(manifest, fs)` form is retained only for legacy manifests whose
 * paths are absolute. `(manifest, fs, bundleRoot)` is also accepted to avoid a
 * flag-day API change for callers adding the root to the old signature.
 */
export function verifyManifest(
  manifest: ReleaseManifest,
  bundleRoot: string,
  fs: FileSystemPort,
): ManifestVerification;
export function verifyManifest(
  manifest: ReleaseManifest,
  fs: FileSystemPort,
  bundleRoot?: string,
): ManifestVerification;
export function verifyManifest(
  manifest: ReleaseManifest,
  fsOrBundleRoot: FileSystemPort | string,
  bundleRootOrFs?: string | FileSystemPort,
): ManifestVerification {
  const bundleRoot = typeof fsOrBundleRoot === "string"
    ? fsOrBundleRoot
    : typeof bundleRootOrFs === "string" ? bundleRootOrFs : undefined;
  const fs = typeof fsOrBundleRoot === "string" ? bundleRootOrFs : fsOrBundleRoot;
  if (typeof fs !== "object" || fs === null) {
    throw new ManifestError("verification_fs", "verifyManifest requires a filesystem port");
  }
  const artifacts = manifest.artifacts.map((artifact) => {
    const path = resolveVerificationPath(artifact.path, bundleRoot);
    return verifyEntry(fs, path, artifact.sha256, artifact.size);
  });
  const licenses = manifest.licenses.map((license) => {
    const path = resolveVerificationPath(license.path, bundleRoot);
    return verifyEntry(fs, path, license.sha256, undefined);
  });
  const ok = artifacts.every((entry) => entry.ok) && licenses.every((entry) => entry.ok);
  return { ok, artifacts, licenses };
}

function resolveVerificationPath(path: string, bundleRoot: string | undefined): string {
  if (bundleRoot === undefined) {
    if (!isNormalizedLegacyAbsolutePath(path)) {
      throw new ManifestError(
        "bundle_root",
        `bundleRoot is required to verify bundle-relative path: ${stringify(path)}`,
      );
    }
    return path;
  }
  if (!isNormalizedLegacyAbsolutePath(bundleRoot)) {
    throw new ManifestError(
      "bundle_root",
      `bundleRoot must be a normalized absolute path: ${stringify(bundleRoot)}`,
    );
  }
  if (!isNormalizedBundleRelativePath(path)) {
    throw new ManifestError(
      "path_traversal",
      `manifest path must be normalized and bundle-relative: ${stringify(path)}`,
    );
  }
  const resolvedRoot = resolve(bundleRoot);
  const resolvedPath = resolve(resolvedRoot, path);
  if (resolvedPath === resolvedRoot || !resolvedPath.startsWith(`${resolvedRoot}${sep}`)) {
    throw new ManifestError("path_traversal", `manifest path escapes bundle root: ${stringify(path)}`);
  }
  return resolvedPath;
}

function verifyEntry(
  fs: FileSystemPort,
  path: string,
  expectedSha256: string,
  expectedSize: number | undefined,
): ManifestVerificationEntry {
  if (!fs.exists(path)) {
    return { path, expectedSha256, actualSha256: null, ok: false, reason: "missing" };
  }
  let stat;
  try {
    stat = fs.stat(path);
  } catch (error) {
    return {
      path,
      expectedSha256,
      actualSha256: null,
      ok: false,
      reason: "io_error",
    };
  }
  if (!stat.isFile) {
    return { path, expectedSha256, actualSha256: null, ok: false, reason: "io_error" };
  }
  let buffer: Buffer;
  try {
    buffer = fs.readFile(path);
  } catch {
    return { path, expectedSha256, actualSha256: null, ok: false, reason: "io_error" };
  }
  const actual = sha256Of(buffer);
  if (actual !== expectedSha256) {
    return {
      path,
      expectedSha256,
      actualSha256: actual,
      ok: false,
      reason: "checksum_mismatch",
      actualSize: buffer.length,
      ...(expectedSize !== undefined ? { expectedSize } : {}),
    };
  }
  if (expectedSize !== undefined && buffer.length !== expectedSize) {
    return {
      path,
      expectedSha256,
      actualSha256: actual,
      ok: false,
      reason: "size_mismatch",
      actualSize: buffer.length,
      expectedSize,
    };
  }
  return { path, expectedSha256, actualSha256: actual, ok: true };
}
