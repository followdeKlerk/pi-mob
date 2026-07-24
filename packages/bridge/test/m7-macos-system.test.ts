import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LaunchAgentDriver, MacLifecycleDriver, TailscaleCliServeDriver, TailscaleStatusDriver, atomicReplace, waitForReady, type CommandRunner } from "../src/ops/macos-system";
import { buildInstallPaths } from "../src/ops/install-paths";

class FakeRunner implements CommandRunner {
  calls: Array<[string, readonly string[]]> = [];
  result = { exitCode: 0, stdout: "{}", stderr: "" };
  async run(file: string, args: readonly string[]) { this.calls.push([file, args]); return this.result; }
}

describe("M7 macOS production drivers", () => {
  test("launchd uses argv-only owner GUI lifecycle commands", async () => {
    const runner = new FakeRunner(); const launchd = new LaunchAgentDriver(runner, 501);
    await launchd.bootstrap("/tmp/com.pi-mob.bridge.plist"); await launchd.enable("com.pi-mob.bridge");
    await launchd.kickstart("com.pi-mob.bridge"); await launchd.print("com.pi-mob.bridge"); await launchd.bootout("com.pi-mob.bridge");
    expect(runner.calls.map(([, args]) => args)).toEqual([
      ["bootstrap", "gui/501", "/tmp/com.pi-mob.bridge.plist"],
      ["enable", "gui/501/com.pi-mob.bridge"],
      ["kickstart", "-k", "gui/501/com.pi-mob.bridge"],
      ["print", "gui/501/com.pi-mob.bridge"],
      ["bootout", "gui/501/com.pi-mob.bridge"],
    ]);
  });

  test("lifecycle can be constructed without an update target and stop is idempotent", async () => {
    const runner = new FakeRunner(); runner.result = { exitCode: 1, stdout: "", stderr: "not loaded" };
    const paths = buildInstallPaths({ installRoot: "/tmp/pi-mob-no-update-target" });
    const lifecycle = new MacLifecycleDriver({
      launchAgent: new LaunchAgentDriver(runner, 501),
      serve: { async listRoutes() { return []; }, async setRoutes() {} },
      label: paths.launchAgentLabel, plistPath: paths.plistPath, installPaths: paths,
    });
    expect(await lifecycle.stopConfigured()).toEqual({ alreadyStopped: true });
    expect(runner.calls.map(([, args]) => args)).toEqual([["print", "gui/501/com.pi-mob.bridge"]]);
  });

  test("Tailscale detection is read-only and reports login plus MagicDNS truthfully", async () => {
    const runner = new FakeRunner();
    runner.result = { exitCode: 0, stdout: JSON.stringify({ BackendState: "Running", Self: { DNSName: "studio.tail.ts.net." } }), stderr: "" };
    const detected = await new TailscaleStatusDriver(runner, "/usr/local/bin/tailscale").probe();
    expect(detected).toEqual({ installed: true, loggedIn: true, magicDnsName: "studio.tail.ts.net" });
    expect(runner.calls).toEqual([["/usr/local/bin/tailscale", ["status", "--json"]]]);
    expect(await new TailscaleStatusDriver(runner, null).probe()).toMatchObject({ installed: false, loggedIn: false, magicDnsName: null });
  });

  test("Tailscale detection guides an installed but logged-out node", async () => {
    const runner = new FakeRunner();
    runner.result = { exitCode: 1, stdout: "", stderr: "not logged in" };
    expect(await new TailscaleStatusDriver(runner, "/Applications/Tailscale.app/Contents/MacOS/Tailscale").probe()).toMatchObject({ installed: true, loggedIn: false, magicDnsName: null });
    expect(runner.calls[0]?.[1]).not.toContain("up");
  });

  test("Serve driver round-trips all routes and rejects Funnel", async () => {
    const runner = new FakeRunner();
    runner.result = { exitCode: 0, stdout: JSON.stringify({ routes: [{ source: { tcp: { port: 443 } }, handlers: [{ kind: "https", address: "http://127.0.0.1:8788" }], annotations: { "pi-mob.bridge/owner": "pi-mob-bridge" } }] }), stderr: "" };
    const serve = new TailscaleCliServeDriver(runner, "/usr/local/bin/tailscale");
    const routes = await serve.listRoutes(); expect(routes).toHaveLength(1);
    await serve.setRoutes(routes); expect(runner.calls.at(-1)?.[1]).toEqual(["serve", "--bg", "--https=443", "http://127.0.0.1:8788"]);
    await serve.setRoutes([]); expect(runner.calls.at(-1)?.[1]).toEqual(["serve", "--https=443", "off"]);
    await expect(serve.setRoutes([{ source: {}, handlers: [{ kind: "funnel", path: "/", address: "http://127.0.0.1:1" }] }])).rejects.toThrow(/Funnel/);
  });

  test("readiness is loopback-only and bounded", async () => {
    let count = 0;
    await waitForReady(new URL("http://127.0.0.1:8788/readyz"), async () => ({ ok: ++count === 2 }), 3);
    expect(count).toBe(2);
    await expect(waitForReady(new URL("https://public.example/readyz"), async () => ({ ok: true }))).rejects.toThrow(/loopback/);
  });

  test("atomic replacement persists the selected artifact", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-m7-atomic-"));
    const source = join(root, "next"); const destination = join(root, "release", "bridge");
    writeFileSync(source, "new"); atomicReplace(source, destination);
    expect(readFileSync(destination, "utf8")).toBe("new");
  });
});
