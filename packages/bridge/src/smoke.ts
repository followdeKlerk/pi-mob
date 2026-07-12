/**
 * Bridge source/compiled smoke entrypoint.
 *
 * M1 placeholder: prints redacted build metadata and exercises the config
 * parser against an explicit path. The release smoke executable accepts
 * only an explicit `--config <path>` flag and ignores any adjacent `.env`
 * or `bunfig.toml`. No daemon, no listener, no network endpoint exists yet.
 */

import { parseConfig, loadConfig, ConfigParseError } from "./config";
import { createRedactingLogger } from "./logger";
import { collectBuildMetadata } from "./build-metadata";
import { existsSync } from "node:fs";

const PROTOCOL_VERSION = "1.0";
const BRIDGE_VERSION = "0.0.0-m1";

interface Args {
  configPath: string | null;
  artifactPath: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  let configPath: string | null = null;
  let artifactPath: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") {
      const value = argv[i + 1];
      if (!value) throw new Error("--config requires a path");
      configPath = value;
      i += 1;
    } else if (arg === "--artifact") {
      const value = argv[i + 1];
      if (!value) throw new Error("--artifact requires a path");
      artifactPath = value;
      i += 1;
    }
  }
  return { configPath, artifactPath };
}

export interface SmokeResult {
  readonly exitCode: number;
  readonly environment: string;
  readonly adjacentFiles: readonly string[];
}

export function runSmoke(args: {
  configPath: string;
  artifactPath?: string;
  cwd?: string;
}): SmokeResult {
  const logger = createRedactingLogger();
  let config;
  try {
    config = loadConfig(args.configPath).config;
  } catch (err) {
    if (err instanceof ConfigParseError) {
      return { exitCode: 4, environment: "unknown", adjacentFiles: [] };
    }
    throw err;
  }
  const metadata = collectBuildMetadata({
    version: BRIDGE_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    artifactKind: "compiled",
    ...(args.artifactPath ? { artifactPath: args.artifactPath } : {}),
  });
  const cwd = args.cwd ?? process.cwd();
  const adjacent = [".env", "bunfig.toml"]
    .filter((name) => existsSync(`${cwd}/${name}`));
  logger.log({
    class: "build-metadata",
    event: "bridge-smoke-ok",
    fields: {
      environment: config.environment,
      schema: String(config.schemaVersion),
      protocol: config.protocolVersion,
      adjacentFiles: adjacent.join(","),
      metadata: JSON.stringify(metadata),
    },
  });
  return { exitCode: 0, environment: config.environment, adjacentFiles: adjacent };
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (!args.configPath) {
    process.stderr.write("bridge-smoke: --config <path> is required\n");
    return 2;
  }
  return runSmoke({ configPath: args.configPath, ...(args.artifactPath ? { artifactPath: args.artifactPath } : {}) }).exitCode;
}

const exit = main();
export { main, parseConfig, loadConfig };

if (import.meta.main) {
  process.exit(exit);
}
