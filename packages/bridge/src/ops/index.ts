/**
 * Bridge install/lifecycle ops (M7) — barrel export.
 *
 * Every module under `packages/bridge/src/ops/` is part of the M7
 * release/install/service/lifecycle foundation. Public consumers import
 * from `../ops` (or via `src/index.ts` once the bridge exposes them).
 */

export * from "./ports";
export * from "./release-manifest";
export * from "./install-paths";
export * from "./install-config";
export * from "./install-environment";
export * from "./login-env";
export * from "./launch-agent";
export * from "./update";
export * from "./rollback";
export * from "./uninstall";
export * from "./endpoint-guard";
export * from "./tailscale-serve";
export * from "./doctor";
export * from "./macos-system";
export * from "./cli";
