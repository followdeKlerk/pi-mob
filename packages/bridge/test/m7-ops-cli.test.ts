import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createNodeFileSystemPort, type ClockPort } from "../src/ops/ports";
import { handleInstall, handleUninstall, parseArgs, type CliDeps, type LifecycleDriver } from "../src/ops/cli";
import type { ServeDriver } from "../src/ops/tailscale-serve";

const clock: ClockPort = { now: () => 1, iso: () => "2026-07-13T00:00:00.000Z" };
const serve: ServeDriver = { async listRoutes() { return []; }, async setRoutes() {} };
function deps(argv: readonly string[], lifecycle?: LifecycleDriver): CliDeps {
  return { fs: createNodeFileSystemPort(), clock, serveDriver: serve, stdout() {}, stderr() {}, argv, ...(lifecycle ? { lifecycle } : {}) };
}
function fakeLifecycle(calls: string[] = []): LifecycleDriver {
  return {
    installAndVerify() { calls.push("install"); }, preflight() {}, verifyTarget() {}, backup() { return "b"; }, stop() {}, swap() {}, migrate() {}, start() {}, verifyRunning() {}, verifyBackup() {}, restore() {}, generationReset() {},
    stopAndRemoveService() { calls.push("service"); }, removeOwnedServe() { calls.push("serve"); },
  };
}

describe("M7 operations CLI", () => {
  test("install writes a no-shell LaunchAgent with config, workspace, sessions, and policy extension", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-m7-cli-"));
    const files = ["pi", "bridge", "extension.ts"];
    for (const file of files) writeFileSync(join(root, file), "fixture");
    const workspace = join(root, "workspace"); const sessions = join(root, "pi-sessions");
    mkdirSync(workspace); mkdirSync(sessions);
    const args = parseArgs(["install", "--install-root", join(root, "install"), "--launch-agents-root", join(root, "LaunchAgents"), "--pi-executable", join(root, "pi"), "--bridge-executable", join(root, "bridge"), "--workspace", workspace, "--pi-session-dir", sessions, "--extension", join(root, "extension.ts"), "--bridge-version", "0.1.0", "--protocol-version", "1.0", "--port", "8788", "--hostname", "127.0.0.1", "--environment", "release", "--path-dir", "/usr/bin"]);
    const lifecycleCalls: string[] = [];
    const result = await handleInstall(args, deps([], fakeLifecycle(lifecycleCalls)));
    expect(lifecycleCalls).toEqual(["install"]);
    const plist = createNodeFileSystemPort().readFile(result.plistPath).toString("utf8");
    expect(plist).toContain("--config"); expect(plist).toContain("--workspace");
    expect(plist).toContain("--session-dir"); expect(plist).toContain("--extension");
    expect(plist).not.toMatch(/(?:bash|sh)<\/string>\s*<string>-c/);
  });

  test("destructive lifecycle commands fail closed without a production driver", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-m7-uninstall-"));
    const args = parseArgs(["uninstall", "--install-root", root, "--pi-session-dir", join(root, "sessions"), "--mode", "retain_data", "--confirm"]);
    await expect(handleUninstall(args, deps([]))).rejects.toThrow(/lifecycle driver/);
  });

  test("uninstall stops service and removes only owned Serve before preserving Pi sessions", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-m7-uninstall-")); const calls: string[] = [];
    const lifecycle = fakeLifecycle(calls);
    const args = parseArgs(["uninstall", "--install-root", root, "--pi-session-dir", join(root, "sessions"), "--mode", "retain_data", "--confirm"]);
    const result = await handleUninstall(args, deps([], lifecycle));
    expect(calls).toEqual(["service", "serve"]); expect(result.piSessionDirRemoved).toBe(false);
  });
});
