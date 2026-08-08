import { describe, expect, test } from "bun:test";
import { checkCapabilityDocs, parseCapabilityMatrix } from "../../scripts/capability-report";

const good = `## Normal daemon capability matrix\n\n| Configuration | hello.accepted.capabilities |\n| --- | --- |\n| without-FCM | commands.v1, controller_leases.v1, raw_rpc.v1, streams.v1 |\n| with-FCM | commands.v1, controller_leases.v1, notifications.v1, raw_rpc.v1, streams.v1 |\n`;
const live = {
  withoutFcm: ["commands.v1", "controller_leases.v1", "raw_rpc.v1", "streams.v1"],
  withFcm: ["commands.v1", "controller_leases.v1", "notifications.v1", "raw_rpc.v1", "streams.v1"],
};

describe("capability matrix checker", () => {
  test("missing or extra baseline capability fails", () => {
    expect(() => checkCapabilityDocs(good.replace("raw_rpc.v1, ", ""), live)).toThrow();
    expect(() => checkCapabilityDocs(good.replace("streams.v1 |", "streams.v1, extra.v1 |"), live)).toThrow();
  });

  test("missing or extra FCM capability fails", () => {
    expect(() => checkCapabilityDocs(good.replace("notifications.v1, ", ""), live)).toThrow();
    expect(() => checkCapabilityDocs(good.replace("notifications.v1, raw_rpc", "notifications.v1, extra.v1, raw_rpc"), live)).toThrow();
  });

  test("catalogue in either production set fails", () => {
    expect(() => checkCapabilityDocs(good.replace("commands.v1, ", "catalogue.v1, commands.v1, "), live)).toThrow();
  });

  test("valid matrix parses exactly", () => {
    expect(parseCapabilityMatrix(good)).toEqual(live);
  });
});
