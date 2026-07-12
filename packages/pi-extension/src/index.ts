/**
 * Pi extension package placeholder.
 *
 * The real extension is wired into the upstream Pi runtime during the M3/M4
 * checkpoints. M1 only reserves the package, pins TypeScript, and declares
 * the public surface that future call sites will consume.
 */

export const EXTENSION_PROTOCOL_VERSION = "1.0" as const;
export const EXTENSION_PACKAGE_NAME = "@pi-mob/pi-extension" as const;

export interface ExtensionManifest {
  readonly name: typeof EXTENSION_PACKAGE_NAME;
  readonly version: string;
  readonly protocolVersion: typeof EXTENSION_PROTOCOL_VERSION;
  readonly capabilities: readonly string[];
}

export function buildExtensionManifest(version: string): ExtensionManifest {
  return {
    name: EXTENSION_PACKAGE_NAME,
    version,
    protocolVersion: EXTENSION_PROTOCOL_VERSION,
    capabilities: [],
  };
}
