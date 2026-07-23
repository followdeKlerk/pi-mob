import { describe, expect, test } from "bun:test";
import { parseConfig, ConfigParseError } from "../src/config";

const baseToml = `\
schema_version = 1
environment = "dev"
protocol_version = "1.0"
config_file = "/tmp/pi-mob/dev/config.toml"
state_root = "/tmp/pi-mob/dev/state"
log_root = "/tmp/pi-mob/dev/logs"
`;

describe("parseConfig", () => {
  test("accepts a minimal dev config", () => {
    const cfg = parseConfig(baseToml);
    expect(cfg.schemaVersion).toBe(1);
    expect(cfg.environment).toBe("dev");
    expect(cfg.protocolVersion).toBe("1.0");
    expect(cfg.paths.stateRoot).toBe("/tmp/pi-mob/dev/state");
  });

  test("rejects unknown schema version", () => {
    expect(() => parseConfig(baseToml.replace("schema_version = 1", "schema_version = 2"))).toThrow(
      ConfigParseError,
    );
  });

  test("rejects unrecognised environment", () => {
    const t = baseToml.replace('environment = "dev"', 'environment = "staging"');
    expect(() => parseConfig(t)).toThrow(/environment/);
  });

  test("rejects path traversal", () => {
    const t = baseToml.replace("/tmp/pi-mob/dev/state", "/tmp/../etc/state");
    expect(() => parseConfig(t)).toThrow(/traversal/);
  });
});
