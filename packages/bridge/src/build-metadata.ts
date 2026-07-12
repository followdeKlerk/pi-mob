/**
 * Build metadata generator placeholder.
 *
 * The bridge reports only version, revision, source commit, protocol/schema
 * versions, architecture, and artifact checksum. No environment values or
 * credentials ever appear in build metadata.
 */

import { readFileSync, statSync } from "node:fs";

export interface BuildMetadata {
  readonly schemaVersion: 1;
  readonly product: string;
  readonly version: string;
  readonly bun: { readonly version: string; readonly revision: string };
  readonly protocolVersion: string;
  readonly architecture: string;
  readonly artifact: { readonly kind: "source" | "compiled"; readonly sha256?: string };
}

function bunRuntimeVersion(): string {
  if (typeof Bun !== "undefined" && typeof Bun.version === "string") {
    return Bun.version;
  }
  return "unknown";
}

function bunRuntimeRevision(): string {
  if (typeof Bun !== "undefined" && typeof Bun.revision === "string") {
    return Bun.revision;
  }
  return "unknown";
}

function runtimeArchitecture(): string {
  if (typeof process !== "undefined" && typeof process.arch === "string") {
    return process.arch;
  }
  return "unknown";
}

function sha256File(path: string): string | undefined {
  try {
    if (!statSync(path).isFile()) return undefined;
    const buffer = readFileSync(path);
    if (typeof Bun !== "undefined" && typeof Bun.CryptoHasher === "function") {
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(buffer);
      return hasher.digest("hex");
    }
    return sha256Node(buffer);
  } catch {
    return undefined;
  }
}

function sha256Node(buffer: Uint8Array): string {
  // Node has `crypto` but Bun types resolve first under the workspace. The
  // bridge is Bun-only; this branch exists for tooling that typechecks the
  // package under Node. M7 will drop it once the runtime floor is enforced.
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(buffer).digest("hex");
}

export function collectBuildMetadata(args: {
  version: string;
  protocolVersion: string;
  artifactKind: "source" | "compiled";
  artifactPath?: string;
}): BuildMetadata {
  const sha256 = args.artifactPath ? sha256File(args.artifactPath) : undefined;
  const artifact: BuildMetadata["artifact"] = sha256
    ? { kind: args.artifactKind, sha256 }
    : { kind: args.artifactKind };
  return {
    schemaVersion: 1,
    product: "pi-mob-bridge",
    version: args.version,
    bun: { version: bunRuntimeVersion(), revision: bunRuntimeRevision() },
    protocolVersion: args.protocolVersion,
    architecture: runtimeArchitecture(),
    artifact,
  };
}
