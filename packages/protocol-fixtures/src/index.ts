/**
 * Protocol fixtures package placeholder.
 *
 * M2 adds one valid fixture per declared command/event/response/error plus
 * invalid/boundary/unknown-optional/required-capability fixtures. M1 only
 * ships one valid hello fixture and its invalid counterpart, plus the
 * fixture manifest consumed by `fixtures:check`.
 */

import helloValid from "../corpus/hello.valid.json" with { type: "json" };
import helloInvalid from "../corpus/hello.invalid.json" with { type: "json" };

export const PROTOCOL_FIXTURES_VERSION = "1.0" as const;

export interface HelloFixture {
  readonly protocol: "hello";
  readonly protocolVersion: string;
  readonly clientId: string;
  readonly capabilities: readonly string[];
}

export const helloValidFixture = helloValid as HelloFixture;
export const helloInvalidFixture = helloInvalid as unknown as HelloFixture;

export function listFixtures(): readonly string[] {
  return ["hello.valid.json", "hello.invalid.json"];
}
