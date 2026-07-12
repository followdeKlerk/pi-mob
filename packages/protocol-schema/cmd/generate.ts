/**
 * Schema generator placeholder.
 *
 * M2 implements the canonical TypeBox envelope generator, the JSON Schema
 * emitter, and the command/event/error catalogue. M1 only emits the
 * generated-artifact manifest under `packages/protocol-schema/generated/`
 * so that downstream checks have a deterministic target.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Manifest {
  readonly schemaVersion: 1;
  readonly protocolVersion: string;
  readonly generatedAtUtc: string;
  readonly artifacts: readonly string[];
}

export function generateProtocolArtifacts(outDir?: string): Manifest {
  const generatedDir = outDir ?? join(import.meta.dir, "..", "generated");
  mkdirSync(generatedDir, { recursive: true });
  const now =
    process.env.PROTOCOL_SCHEMA_FIXED_TIMESTAMP ?? new Date().toISOString();
  const manifest: Manifest = {
    schemaVersion: 1,
    protocolVersion: "1.0",
    generatedAtUtc: now,
    artifacts: ["schema-manifest.json"],
  };
  writeFileSync(
    join(generatedDir, "schema-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
  return manifest;
}

if (import.meta.main) {
  const dir = process.env.PROTOCOL_SCHEMA_OUT_DIR;
  const m = dir ? generateProtocolArtifacts(dir) : generateProtocolArtifacts();
  process.stdout.write(JSON.stringify(m, null, 2) + "\n");
}
