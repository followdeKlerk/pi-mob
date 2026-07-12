import { describe, expect, test } from "bun:test";
import {
  EXTENSION_PACKAGE_NAME,
  EXTENSION_PROTOCOL_VERSION,
  buildExtensionManifest,
} from "../src/index";

describe("buildExtensionManifest", () => {
  test("produces a stable identity", () => {
    const m = buildExtensionManifest("0.0.0-m1");
    expect(m.name).toBe(EXTENSION_PACKAGE_NAME);
    expect(m.protocolVersion).toBe(EXTENSION_PROTOCOL_VERSION);
    expect(m.capabilities).toEqual([]);
  });
});
