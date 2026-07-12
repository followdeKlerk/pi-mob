import { describe, expect, test } from "bun:test";
import {
  helloValidFixture,
  helloInvalidFixture,
  listFixtures,
  PROTOCOL_FIXTURES_VERSION,
} from "../src/index";

describe("protocol fixtures placeholder", () => {
  test("hello.valid has the canonical envelope shape", () => {
    expect(helloValidFixture.protocol).toBe("hello");
    expect(helloValidFixture.protocolVersion).toBe(PROTOCOL_FIXTURES_VERSION);
    expect(helloValidFixture.clientId.length).toBeGreaterThan(0);
  });

  test("hello.invalid deviates from the canonical envelope shape", () => {
    // The TypeBox decoder (M2) will reject this file. M1 only confirms
    // the file deviates on at least one required field type so that the
    // fixtures:check and Dart parity tests have something negative to
    // round-trip against.
    expect(helloInvalidFixture.protocol).not.toBe("hello");
  });

  test("listFixtures lists both M1 fixtures", () => {
    expect(listFixtures()).toContain("hello.valid.json");
    expect(listFixtures()).toContain("hello.invalid.json");
  });
});
