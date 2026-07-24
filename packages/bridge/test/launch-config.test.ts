import { describe, expect, test } from "bun:test";
import { resolvePiLaunchConfig } from "../src/pi/launch-config";
import { RpcProcess } from "../src/pi/rpc-process";

describe("PiLaunchConfig", () => {
  test("resolves an immutable copy of the launch contract", () => {
    const config = resolvePiLaunchConfig({
      executable: "/opt/homebrew/bin/pi",
      cwd: "/Users/owner/workspace",
      args: ["--mode", "rpc"],
      env: { HOME: "/Users/owner", PATH: "/opt/homebrew/bin:/usr/bin" },
    });

    expect(config).toEqual({
      executable: "/opt/homebrew/bin/pi",
      cwd: "/Users/owner/workspace",
      args: ["--mode", "rpc"],
      env: { HOME: "/Users/owner", PATH: "/opt/homebrew/bin:/usr/bin" },
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.args)).toBe(true);
    expect(Object.isFrozen(config.env)).toBe(true);
  });

  test("shares the launch config across RPC process overlays", () => {
    const config = resolvePiLaunchConfig({
      executable: "/usr/bin/true",
      cwd: "/tmp",
      env: { HOME: "/tmp", PATH: "/usr/bin:/bin" },
    });
    const primary = new RpcProcess({ launchConfig: config, args: ["--mode", "rpc"] });
    const session = new RpcProcess({ launchConfig: config, cwd: "/tmp", args: ["--mode", "rpc", "--session", "/tmp/session.jsonl"] });

    expect(primary.launchConfig).toBe(config);
    expect(session.launchConfig).toBe(config);
  });
});
