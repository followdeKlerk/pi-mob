/**
 * Bridge package public surface (M1 placeholder).
 *
 * Exports the strict TS bridge entrypoints. The M2 protocol schemas and the M3
 * real Pi adapter live in sibling packages and are imported here only when the
 * bridge starts consuming them.
 */

export {
  parseConfig,
  loadConfig,
  buildDevPaths,
  buildReleasePaths,
  ConfigParseError,
  type BridgeConfig,
  type BridgeConfigPaths,
  type ConfigLoadResult,
  type Environment,
} from "./config";

export {
  createRedactingLogger,
  type LogFields,
  type LogRecord,
  type RedactingLogger,
  type RedactionClass,
} from "./logger";

export { collectBuildMetadata, type BuildMetadata } from "./build-metadata";

export * from "./pi/types";
export * from "./pi/commands";
export * from "./pi/command-catalogue";
export * from "./pi/normalize";
export * from "./pi/jsonl";
export * from "./pi/rpc-process";
export * from "./pi/one-session-adapter";
export * from "./pi/export-registry";
export * from "./pi/supervised-rpc-client";
export * from "./core/store";
export * from "./core/attachments";
export * from "./core/binary-http";
export * from "./core/domain";
export * from "./core/runtime";
export * from "./core/process-projection";
export * from "./core/server";
export * from "./core/workspace-policy";
export * from "./notifications";
export * from "./ops";
