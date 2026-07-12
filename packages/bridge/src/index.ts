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
