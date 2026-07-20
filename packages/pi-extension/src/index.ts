/**
 * Public surface for the host-side Pi extension and its policy gate.
 */

export * from "./policy";
export * from "./extension";
export { default } from "./extension";

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
