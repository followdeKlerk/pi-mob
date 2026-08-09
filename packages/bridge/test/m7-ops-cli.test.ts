import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createNodeFileSystemPort, type ClockPort } from "../src/ops/ports";
import { handleInstall, handlePair, handleSetup, handleStart, handleStatus, handleStop, handleUninstall, parseArgs, runCli, type CliDeps, type LifecycleDriver, type SetupDefaults } from "../src/ops/cli";
import type { ServeDriver } from "../src/ops/tailscale-serve";

const clock: ClockPort = { now: () => 1, iso: () => "2026-07-13T00:00:00.000Z" };
const serve: ServeDriver = { async listRoutes() { return []; }, async setRoutes() {} };
function deps(argv: readonly string[], lifecycle?: LifecycleDriver): CliDeps {
  return { fs: createNodeFileSystemPort(), clock, serveDriver: serve, stdout() {}, stderr() {}, argv, captureLoginEnv: async () => ({ HOME: "/Users/fixture", PATH: "/usr/bin:/bin" }), ...(lifecycle ? { lifecycle } : {}) };
}
function fakeLifecycle(calls: string[] = [], state = { launchAgentLoaded: true, listenerReady: true }): LifecycleDriver {
  return {
    installAndVerify() { calls.push("install"); },
    async startConfigured() { calls.push("start-configured"); return { alreadyRunning: state.listenerReady }; },
    async stopConfigured() { calls.push("stop-configured"); return { alreadyStopped: !state.launchAgentLoaded }; },
    async lifecycleState() { return state; },
    preflight() {}, verifyTarget() {}, backup() { return "b"; }, stop() {}, swap() {}, migrate() {}, start() {}, verifyRunning() {}, verifyBackup() {}, restore() {}, generationReset() {},
    stopAndRemoveService() { calls.push("service"); }, removeOwnedServe() { calls.push("serve"); },
  };
}

function setupDefaults(root: string): SetupDefaults {
  return {
    installRoot: join(root, "install"), launchAgentsRoot: join(root, "LaunchAgents"),
    ompExecutable: join(root, "omp"), sourceCliExecutable: join(root, "pi-mob"),
    sourceBridgeExecutable: join(root, "bridge"),
    ompSessionDir: join(root, "sessions"),
    bridgeVersion: "0.1.0", protocolVersion: "1.0", port: 9443,
  };
}

describe("M7 operations CLI", () => {
  test("install writes a no-shell LaunchAgent with OMP config, workspace, and sessions", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-m7-cli-"));
    const files = ["omp", "bridge"];
    for (const file of files) writeFileSync(join(root, file), "fixture");
    const workspace = join(root, "workspace"); const sessions = join(root, "omp-sessions");
    mkdirSync(workspace); mkdirSync(sessions);
    const args = parseArgs(["install", "--install-root", join(root, "install"), "--launch-agents-root", join(root, "LaunchAgents"), "--omp-executable", join(root, "omp"), "--bridge-executable", join(root, "bridge"), "--workspace", workspace, "--omp-session-dir", sessions, "--bridge-version", "0.1.0", "--protocol-version", "1.0", "--port", "8788", "--hostname", "127.0.0.1", "--environment", "release", "--path-dir", "/usr/bin"]);
    const lifecycleCalls: string[] = [];
    const result = await handleInstall(args, deps([], fakeLifecycle(lifecycleCalls)));
    expect(lifecycleCalls).toEqual(["install"]);
    const plist = createNodeFileSystemPort().readFile(result.plistPath).toString("utf8");
    expect(plist).toContain("--config"); expect(plist).toContain("--workspace");
    expect(plist).toContain("--omp-session-dir");
    // Phase 4: no policy extension is injected.
    expect(plist).not.toContain("--extension");
    expect(plist).not.toMatch(/(?:bash|sh)<\/string>\s*<string>-c/);
  });

  test("install persists the FCM service-account path and passes it to launchd", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-m7-fcm-install-"));
    const workspace = join(root, "workspace"); const sessions = join(root, "sessions");
    mkdirSync(workspace); mkdirSync(sessions);
    const serviceAccount = join(root, "service-account.json");
    writeFileSync(serviceAccount, "{\"type\":\"service_account\"}"); chmodSync(serviceAccount, 0o600);
    writeFileSync(join(root, "omp"), "fixture"); writeFileSync(join(root, "bridge"), "fixture");
    const result = await handleInstall(parseArgs(["install", "--install-root", join(root, "install"), "--launch-agents-root", join(root, "LaunchAgents"), "--omp-executable", join(root, "omp"), "--bridge-executable", join(root, "bridge"), "--workspace", workspace, "--omp-session-dir", sessions, "--bridge-version", "0.1.0", "--protocol-version", "1.0", "--port", "8788", "--hostname", "127.0.0.1", "--environment", "release", "--fcm-service-account", serviceAccount]), deps([], fakeLifecycle()));
    expect(result.config.fcmServiceAccount).toBe(serviceAccount);
    const config = createNodeFileSystemPort().readFile(result.paths.configFile).toString();
    const plist = createNodeFileSystemPort().readFile(result.plistPath).toString();
    expect(config).toContain(`fcm_service_account = "${serviceAccount}"`);
    expect(plist).toContain("--fcm-service-account"); expect(plist).toContain(serviceAccount);
    expect(config).not.toContain("service_account.json\":");
  });

  test("setup detects and guides missing Tailscale without installing or running tailscale up", async () => {
    const calls: string[] = [];
    const result = await handleSetup(parseArgs(["setup", "--workspace", "/tmp/workspace"]), {
      ...deps([], fakeLifecycle(calls)),
      tailscaleProbe: async () => ({ installed: false, loggedIn: false, magicDnsName: null }),
    });
    expect(result.ready).toBe(false);
    expect(result.installed).toBe(false);
    expect(result.manualEndpoint).toBeNull();
    expect(result.nextActions.join(" ")).toContain("tailscale.com/download/mac");
    expect(calls).toEqual([]);
  });

  test("setup installs with workspace-centered defaults only after Tailscale and MagicDNS are ready", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-m7-setup-"));
    const defaults = setupDefaults(root); const calls: string[] = [];
    for (const file of [defaults.ompExecutable!, defaults.sourceCliExecutable, defaults.sourceBridgeExecutable]) writeFileSync(file, "fixture");
    mkdirSync("/tmp/pi-mob-m7-workspace", { recursive: true });
    mkdirSync(defaults.ompSessionDir);
    const result = await handleSetup(parseArgs(["setup", "--workspace", "/tmp/pi-mob-m7-workspace"]), {
      ...deps([], fakeLifecycle(calls)), setupDefaults: defaults,
      tailscaleProbe: async () => ({ installed: true, loggedIn: true, magicDnsName: "studio.tail.ts.net" }),
      hostIdentity: (databasePath) => {
        expect(databasePath).toBe(join(defaults.installRoot, "release", "state", "bridge.sqlite"));
        return { hostId: "6a7c0845-069f-4fe3-bf67-a9fccf43e754" };
      },
    });
    expect(result.ready).toBe(true);
    expect(result.install?.config.port).toBe(9443);
    expect(result.install?.config.bridgeExecutable).toBe(join(defaults.installRoot, "release", "bin", "bridge-daemon"));
    expect(createNodeFileSystemPort().readFile(result.install!.config.bridgeExecutable).toString()).toBe("fixture");
    expect(createNodeFileSystemPort().stat(result.install!.config.bridgeExecutable).mode & 0o777).toBe(0o700);
    for (const cliName of ["pi-mob", "pi-mob-ops"]) {
      const installedCli = join(defaults.installRoot, "release", "bin", cliName);
      expect(createNodeFileSystemPort().readFile(installedCli).toString()).toBe("fixture");
      expect(createNodeFileSystemPort().stat(installedCli).mode & 0o777).toBe(0o700);
    }
    // Phase 4: the policy extension is no longer installed.
    const installedExtension = join(defaults.installRoot, "release", "extensions", "pi-mob-extension.js");
    expect(createNodeFileSystemPort().exists(installedExtension)).toBe(false);
    const installedPlist = createNodeFileSystemPort().readFile(result.install!.plistPath).toString("utf8");
    expect(installedPlist).toContain(result.install!.config.bridgeExecutable);
    expect(installedPlist).not.toContain(defaults.sourceBridgeExecutable);
    expect(installedPlist).not.toContain("--extension");
    expect(result.manualEndpoint).toBe("https://studio.tail.ts.net:9443");
    expect(result.nextActions.join(" ")).toContain("pi-mob pair");
    expect(result.nextActions.join(" ")).toContain("Manual endpoint");
    expect(calls).toEqual(["install"]);
  });

  test("start and stop are idempotent lifecycle commands using the configured port", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-m7-life-")); const calls: string[] = [];
    const defaults = setupDefaults(root);
    for (const file of [defaults.ompExecutable!, defaults.sourceBridgeExecutable]) writeFileSync(file, "fixture");
    mkdirSync(join(root, "workspace")); mkdirSync(defaults.ompSessionDir);
    const lifecycle = fakeLifecycle(calls);
    await handleInstall(parseArgs(["install", "--install-root", defaults.installRoot, "--launch-agents-root", defaults.launchAgentsRoot, "--omp-executable", defaults.ompExecutable!, "--bridge-executable", defaults.sourceBridgeExecutable, "--workspace", join(root, "workspace"), "--omp-session-dir", defaults.ompSessionDir, "--bridge-version", "0.1.0", "--protocol-version", "1.0", "--port", "9443", "--hostname", "127.0.0.1", "--environment", "release", "--path-dir", "/usr/bin"]), deps([], lifecycle));
    const started = await handleStart(parseArgs(["start", "--install-root", defaults.installRoot, "--launch-agents-root", defaults.launchAgentsRoot]), deps([], lifecycle));
    const stopped = await handleStop(parseArgs(["stop", "--install-root", defaults.installRoot, "--launch-agents-root", defaults.launchAgentsRoot]), deps([], lifecycle));
    expect(started.port).toBe(9443); expect(started.alreadyRunning).toBe(true);
    expect(stopped.alreadyStopped).toBe(false);
    expect(calls).toEqual(["install", "start-configured", "stop-configured"]);
  });

  test("status is compact and does not claim pairing without canonical payload", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-m7-status-"));
    const result = await handleStatus(parseArgs(["status", "--install-root", root]), deps([], fakeLifecycle([])));
    expect(result).toMatchObject({ installed: false, launchAgentLoaded: false, listenerReady: false, pairingAvailable: false });
    expect(result.remediation.join(" ")).toContain("pi-mob setup");
  });

  test("status reports configured port, owned Serve, and only canonical pairing", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-m7-status-ready-")); const defaults = setupDefaults(root);
    for (const file of [defaults.ompExecutable!, defaults.sourceBridgeExecutable]) writeFileSync(file, "fixture");
    mkdirSync(join(root, "workspace")); mkdirSync(defaults.ompSessionDir);
    const lifecycle = fakeLifecycle([]);
    await handleInstall(parseArgs(["install", "--install-root", defaults.installRoot, "--launch-agents-root", defaults.launchAgentsRoot, "--omp-executable", defaults.ompExecutable!, "--bridge-executable", defaults.sourceBridgeExecutable, "--workspace", join(root, "workspace"), "--omp-session-dir", defaults.ompSessionDir, "--bridge-version", "0.1.0", "--protocol-version", "1.0", "--port", "9443", "--hostname", "127.0.0.1", "--environment", "release", "--path-dir", "/usr/bin"]), deps([], lifecycle));
    const ownedServe: ServeDriver = { async listRoutes() { return [{ source: { tcp: { port: 9443 } }, handlers: [{ kind: "forward", address: "http://127.0.0.1:9443" }], annotations: { "pi-mob.bridge/owner": "pi-mob-bridge" } }]; }, async setRoutes() {} };
    const result = await handleStatus(parseArgs(["status", "--install-root", defaults.installRoot, "--launch-agents-root", defaults.launchAgentsRoot]), { ...deps([], lifecycle), serveDriver: ownedServe });
    expect(result).toMatchObject({ installed: true, launchAgentLoaded: true, listenerReady: true, ownedServePresent: true, ownedServePort: 9443, pairingAvailable: false, pairingEndpoint: null });
  });

  test("public command parsing and help expose setup/start/stop/status", async () => {
    for (const command of ["setup", "start", "stop", "status"] as const) expect(parseArgs([command]).command).toBe(command);
    let output = "";
    const result = await runCli({ ...deps(["--help"]), stdout(chunk) { output += chunk; } });
    expect(result.exitCode).toBe(0);
    for (const command of ["setup", "start", "stop", "status"]) expect(output).toContain(command);
  });

  test("pair uses the installed config, live Serve route, identity, and fresh enrollment challenge", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-pair-cli-"));
    const defaults = setupDefaults(root);
    for (const file of [defaults.ompExecutable!, defaults.sourceBridgeExecutable]) writeFileSync(file, "fixture");
    mkdirSync(join(root, "workspace")); mkdirSync(defaults.ompSessionDir);
    await handleInstall(parseArgs(["install", "--install-root", defaults.installRoot, "--launch-agents-root", defaults.launchAgentsRoot, "--omp-executable", defaults.ompExecutable!, "--bridge-executable", defaults.sourceBridgeExecutable, "--workspace", join(root, "workspace"), "--omp-session-dir", defaults.ompSessionDir, "--bridge-version", "0.1.0", "--protocol-version", "1.0", "--port", "9443", "--hostname", "127.0.0.1", "--environment", "release", "--path-dir", "/usr/bin"]), deps([], fakeLifecycle()));
    const passcode = "123456";
    const result = await handlePair(parseArgs(["pair", "--install-root", defaults.installRoot, "--launch-agents-root", defaults.launchAgentsRoot]), {
      ...deps([]),
      tailscaleProbe: async () => ({ installed: true, loggedIn: true, magicDnsName: "studio.tail.ts.net" }),
      processProbe: () => ({ loaded: true, listenerReady: true }),
      serveDriver: { async listRoutes() { return [{ source: { tcp: { port: 9443 } }, handlers: [{ kind: "https", address: "http://127.0.0.1:9443" }], annotations: { "pi-mob.bridge/owner": "pi-mob-bridge" } }]; }, async setRoutes() {} },
      enrollmentChallenge: () => ({ passcode, expiresAt: Date.now() + 300_000 }),
    });
    expect(result).toMatchObject({ endpoint: "https://studio.tail.ts.net:9443", passcode });
    expect(result.expiresAt).toContain("T");
  });

  test("pair emits only endpoint, passcode, and expiry on an interactive terminal", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-pair-human-"));
    const defaults = setupDefaults(root);
    for (const file of [defaults.ompExecutable!, defaults.sourceBridgeExecutable]) writeFileSync(file, "fixture");
    mkdirSync(join(root, "workspace")); mkdirSync(defaults.ompSessionDir);
    await handleInstall(parseArgs(["install", "--install-root", defaults.installRoot, "--launch-agents-root", defaults.launchAgentsRoot, "--omp-executable", defaults.ompExecutable!, "--bridge-executable", defaults.sourceBridgeExecutable, "--workspace", join(root, "workspace"), "--omp-session-dir", defaults.ompSessionDir, "--bridge-version", "0.1.0", "--protocol-version", "1.0", "--port", "9443", "--hostname", "127.0.0.1", "--environment", "release", "--path-dir", "/usr/bin"]), deps([], fakeLifecycle()));
    const result = await runCli({
      ...deps(["pair", "--install-root", defaults.installRoot]),
      interactive: true,
      tailscaleProbe: async () => ({ installed: true, loggedIn: true, magicDnsName: "studio.tail.ts.net" }),
      processProbe: () => ({ loaded: true, listenerReady: true }),
      serveDriver: { async listRoutes() { return [{ source: { tcp: { port: 9443 } }, handlers: [{ kind: "https", address: "http://127.0.0.1:9443" }], annotations: { "pi-mob.bridge/owner": "pi-mob-bridge" } }]; }, async setRoutes() {} },
      hostIdentity: () => ({ hostId: "6a7c0845-069f-4fe3-bf67-a9fccf43e754" }),
      enrollmentChallenge: () => ({ passcode: "123456", expiresAt: Date.now() + 300_000 }),
    } as CliDeps & { interactive: boolean });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("https://studio.tail.ts.net:9443");
    expect(result.stdout).toContain("Passcode: 123456");
    expect(result.stdout).toContain("Expires:");
    expect(result.stdout).not.toContain("\u001b");
    expect(result.stdout).not.toContain("enrollmentSecret");
    expect(result.stdout).not.toContain("pairing.json");
  });

  test("pair keeps structured JSON output when stdout is not a TTY or --json is used", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-pair-json-"));
    const defaults = setupDefaults(root);
    for (const file of [defaults.ompExecutable!, defaults.sourceBridgeExecutable]) writeFileSync(file, "fixture");
    mkdirSync(join(root, "workspace")); mkdirSync(defaults.ompSessionDir);
    await handleInstall(parseArgs(["install", "--install-root", defaults.installRoot, "--launch-agents-root", defaults.launchAgentsRoot, "--omp-executable", defaults.ompExecutable!, "--bridge-executable", defaults.sourceBridgeExecutable, "--workspace", join(root, "workspace"), "--omp-session-dir", defaults.ompSessionDir, "--bridge-version", "0.1.0", "--protocol-version", "1.0", "--port", "9443", "--hostname", "127.0.0.1", "--environment", "release", "--path-dir", "/usr/bin"]), deps([], fakeLifecycle()));
    const base = {
      ...deps(["pair", "--install-root", defaults.installRoot, "--json"]),
      tailscaleProbe: async () => ({ installed: true, loggedIn: true, magicDnsName: "studio.tail.ts.net" }),
      processProbe: () => ({ loaded: true, listenerReady: true }),
      serveDriver: { async listRoutes() { return [{ source: { tcp: { port: 9443 } }, handlers: [{ kind: "https", address: "http://127.0.0.1:9443" }], annotations: { "pi-mob.bridge/owner": "pi-mob-bridge" } }]; }, async setRoutes() {} },
      hostIdentity: () => ({ hostId: "6a7c0845-069f-4fe3-bf67-a9fccf43e754" }),
      enrollmentChallenge: () => ({ passcode: "654321", expiresAt: Date.now() + 300_000 }),
    } as CliDeps;
    const result = await runCli(base);
    expect(result.exitCode).toBe(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    const json = JSON.parse(result.stdout) as { data: { endpoint: string; passcode: string } };
    expect(json.data.endpoint).toBe("https://studio.tail.ts.net:9443");
    expect(json.data.passcode).toBe("654321");
    expect(result.stdout).not.toContain("enrollmentSecret");
  });

  test("pair refuses without a ready listener and owned Serve route", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-pair-unready-"));
    const defaults = setupDefaults(root);
    for (const file of [defaults.ompExecutable!, defaults.sourceBridgeExecutable]) writeFileSync(file, "fixture");
    mkdirSync(join(root, "workspace")); mkdirSync(defaults.ompSessionDir);
    await handleInstall(parseArgs(["install", "--install-root", defaults.installRoot, "--launch-agents-root", defaults.launchAgentsRoot, "--omp-executable", defaults.ompExecutable!, "--bridge-executable", defaults.sourceBridgeExecutable, "--workspace", join(root, "workspace"), "--omp-session-dir", defaults.ompSessionDir, "--bridge-version", "0.1.0", "--protocol-version", "1.0", "--port", "9443", "--hostname", "127.0.0.1", "--environment", "release", "--path-dir", "/usr/bin"]), deps([], fakeLifecycle()));
    let issued = false;
    await expect(handlePair(parseArgs(["pair", "--install-root", defaults.installRoot]), {
      ...deps([]),
      tailscaleProbe: async () => ({ installed: true, loggedIn: true, magicDnsName: "studio.tail.ts.net" }),
      processProbe: () => ({ loaded: true, listenerReady: false }),
      serveDriver: serve,
      hostIdentity: () => ({ hostId: "6a7c0845-069f-4fe3-bf67-a9fccf43e754" }),
      enrollmentChallenge: () => { issued = true; return { passcode: "111111", expiresAt: Date.now() + 300_000 }; },
    })).rejects.toThrow(/listener|Serve/i);
    expect(issued).toBe(false);
  });

  test("destructive lifecycle commands fail closed without a production driver", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-m7-uninstall-"));
    const args = parseArgs(["uninstall", "--install-root", root, "--omp-session-dir", join(root, "sessions"), "--mode", "retain_data", "--confirm"]);
    await expect(handleUninstall(args, deps([]))).rejects.toThrow(/lifecycle driver/);
  });

  test("uninstall stops service and removes only owned Serve before preserving OMP sessions", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-m7-uninstall-")); const calls: string[] = [];
    const lifecycle = fakeLifecycle(calls);
    const args = parseArgs(["uninstall", "--install-root", root, "--omp-session-dir", join(root, "sessions"), "--mode", "retain_data", "--confirm"]);
    const result = await handleUninstall(args, deps([], lifecycle));
    expect(calls).toEqual(["service", "serve"]); expect(result.ompSessionDirRemoved).toBe(false);
  });
});
