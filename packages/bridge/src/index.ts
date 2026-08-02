/**
 * Bridge package public surface.
 *
 * The normal daemon owns the production wiring. Optional provider modules that
 * are not constructed by `runDaemon` are intentionally kept on their direct
 * module paths and are not re-exported here.
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
export * from "./pi/catalogue-service";
export * from "./pi/normalize";
export * from "./pi/raw-rpc";
export * from "./pi/jsonl";
export * from "./pi/rpc-process";
export * from "./pi/launch-config";
export * from "./pi/one-session-adapter";
export * from "./pi/export-registry";
export * from "./pi/supervised-rpc-client";
export * from "./core/store";
export * from "./core/attachments";
export * from "./core/attention-projection";
export * from "./core/binary-http";
export * from "./core/domain";
export * from "./core/runtime";
export * from "./core/process-supervisor";
export {
  AuthoritativeProcessRegistry,
  type CapabilityState,
  type CapabilityStatus,
  type ProcessAction,
  type ProcessOutput,
  type ProcessOutputPageRequest,
  type ProcessProjection,
  type ProcessProjectionRegistry,
  type ProcessSnapshot,
  type ProcessSnapshotResult,
  type ProcessStatus,
  type ProcessStream,
  type ProcessTruncation,
  type ProcessUnavailable,
} from "./core/process-projection";
export * from "./core/server";
export * from "./core/workspace-policy";
export * from "./core/workspace-files";
export * from "./notifications";
export * from "./git/summary-service";
export * from "./ops";
export * from "./auth/credentials";
export * from "./auth/enrollment";
export * from "./auth/rate-quota";
export * from "./auth/revoke";
