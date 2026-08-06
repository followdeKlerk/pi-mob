/**
 * Generated bridge version module.
 *
 * This file is produced by `scripts/sync-version.ts` from the root
 * `VERSION` file and must not be edited by hand. The bridge daemon,
 * smoke executable, ops entrypoint, and build script all import
 * `BRIDGE_VERSION` from here so the canonical release identifier
 * travels with the compiled binary without depending on a
 * repository-relative file at runtime.
 *
 * The fallback constant is intentionally forbidden: callers must
 * fail clearly when the source-of-truth build artefact is missing
 * rather than ship a "0.0.0-m<n>" stub. The `version:check` script
 * fails the CI gate whenever this string drifts from `VERSION`.
 */

export const BRIDGE_VERSION = "0.0.2-alpha.1";
