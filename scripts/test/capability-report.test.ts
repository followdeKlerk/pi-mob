import { describe, expect, test } from "bun:test";
import { checkCapabilityDocs, parseCapabilityMatrix } from "../../scripts/capability-report";

const good = `## Normal daemon capability matrix\n\n| Configuration | hello.accepted.capabilities |\n| --- | --- |\n| without-FCM | commands.v1, controller_leases.v1, raw_rpc.v1, streams.v1 |\n| with-FCM | commands.v1, controller_leases.v1, notifications.v1, raw_rpc.v1, streams.v1 |\n`;
const protocol = good;

describe("capability matrix checker", () => {
  test("missing or extra baseline capability fails", () => {
    expect(() => checkCapabilityDocs(good.replace("raw_rpc.v1, ", ""), protocol, { withoutFcm: ["commands.v1", "controller_leases.v1", "raw_rpc.v1", "streams.v1"], withFcm: ["commands.v1", "controller_leases.v1", "notifications.v1", "raw_rpc.v1", "streams.v1"] })).toThrow();
    expect(() => checkCapabilityDocs(good.replace("streams.v1 |", "streams.v1, extra.v1 |"), protocol, { withoutFcm: ["commands.v1", "controller_leases.v1", "raw_rpc.v1", "streams.v1"], withFcm: ["commands.v1", "controller_leases.v1", "notifications.v1", "raw_rpc.v1", "streams.v1"] })).toThrow();
  });
  test("missing or extra FCM capability fails", () => {
    expect(() => checkCapabilityDocs(good.replace("notifications.v1, ", ""), protocol, { withoutFcm: ["commands.v1", "controller_leases.v1", "raw_rpc.v1", "streams.v1"], withFcm: ["commands.v1", "controller_leases.v1", "notifications.v1", "raw_rpc.v1", "streams.v1"] })).toThrow();
    expect(() => checkCapabilityDocs(good.replace("notifications.v1, raw_rpc", "notifications.v1, extra.v1, raw_rpc"), protocol, { withoutFcm: ["commands.v1", "controller_leases.v1", "raw_rpc.v1", "streams.v1"], withFcm: ["commands.v1", "controller_leases.v1", "notifications.v1", "raw_rpc.v1", "streams.v1"] })).toThrow();
  });
  test("catalogue in either production set fails", () => {
    expect(() => checkCapabilityDocs(good.replace("commands.v1, ", "catalogue.v1, commands.v1, "), protocol, { withoutFcm: ["commands.v1", "controller_leases.v1", "raw_rpc.v1", "streams.v1"], withFcm: ["commands.v1", "controller_leases.v1", "notifications.v1", "raw_rpc.v1", "streams.v1"] })).toThrow();
  });
  test("PROJECT_STATUS and PROTOCOL disagreement fails", () => {
    expect(() => checkCapabilityDocs(good, protocol.replace("raw_rpc.v1", "wrong.v1"), { withoutFcm: ["commands.v1", "controller_leases.v1", "raw_rpc.v1", "streams.v1"], withFcm: ["commands.v1", "controller_leases.v1", "notifications.v1", "raw_rpc.v1", "streams.v1"] })).toThrow();
  });
  test("valid matrix parses exactly", () => {
    expect(parseCapabilityMatrix(good)).toEqual({ withoutFcm: ["commands.v1", "controller_leases.v1", "raw_rpc.v1", "streams.v1"], withFcm: ["commands.v1", "controller_leases.v1", "notifications.v1", "raw_rpc.v1", "streams.v1"] });
  });
});
