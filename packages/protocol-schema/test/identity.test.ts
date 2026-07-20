import { describe, expect, test } from "bun:test";
import {
  PROTOCOL_MAJOR,
  PROTOCOL_MINOR,
  PROTOCOL_VERSION,
  getProtocolIdentity,
} from "../src/index";

describe("protocol identity", () => {
  test("reports the frozen protocol version", () => {
    expect(PROTOCOL_MAJOR).toBe(1);
    expect(PROTOCOL_MINOR).toBe(0);
    expect(PROTOCOL_VERSION).toBe("1.0");
  });

  test("getProtocolIdentity is stable", () => {
    expect(getProtocolIdentity().version).toBe("1.0");
  });
});
