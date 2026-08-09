#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { buildInstallPaths } from "./ops/install-paths";
import { captureLoginEnv } from "./ops/login-env";
import { createNodeFileSystemPort, systemClock } from "./ops/ports";
import { runCli, type LifecycleDriver, type SetupDefaults } from "./ops/cli";
import { BridgeStore } from "./core/store";
import { issuePendingEnrollment } from "./auth/enrollment";
import { BunCommandRunner, LaunchAgentDriver, MacLifecycleDriver, TailscaleCliServeDriver, TailscaleStatusDriver } from "./ops/macos-system";
import { BRIDGE_VERSION } from "./version";

function flag(argv: readonly string[], name: string): string | undefined {
  const exact = `--${name}`;
  const index = argv.indexOf(exact);
  if (index >= 0) return argv[index + 1];
  const prefix = `${exact}=`;
  const inline = argv.find((entry) => entry.startsWith(prefix));
  return inline?.slice(prefix.length);
}

function withPublicPathDefaults(
  argv: readonly string[],
  installRoot: string | undefined,
  launchAgentsRoot: string | undefined,
): readonly string[] {
  if (!publicCommand(argv[0])) return argv;
  const additions: string[] = [];
  if (!flag(argv, "install-root") && installRoot) additions.push("--install-root", resolve(installRoot));
  if (!flag(argv, "launch-agents-root") && launchAgentsRoot) additions.push("--launch-agents-root", resolve(launchAgentsRoot));
  return [argv[0]!, ...additions, ...argv.slice(1)];
}

function tailscaleExecutable(): string | null {
  const candidates = [
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    "/opt/homebrew/bin/tailscale",
    "/usr/local/bin/tailscale",
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? Bun.which("tailscale") ?? null;
}

function publicCommand(command: string | undefined): boolean {
  return command === "setup" || command === "start" || command === "stop" || command === "status" || command === "pair";
}

export async function main(argv: readonly string[]): Promise<number> {
  const runner = new BunCommandRunner();
  const home = process.env.HOME;
  const defaultInstallRoot = home ? join(home, ".pi-mob") : undefined;
  const explicitInstallRoot = flag(argv, "install-root");
  const installRoot = explicitInstallRoot ?? (publicCommand(argv[0]) ? defaultInstallRoot : undefined);
  const targetBundle = flag(argv, "target-bundle") ?? flag(argv, "target-root");
  const explicitLaunchAgentsRoot = flag(argv, "launch-agents-root");
  const launchAgentsRoot = explicitLaunchAgentsRoot ?? (home ? join(home, "Library", "LaunchAgents") : undefined);
  const paths = installRoot ? buildInstallPaths({
    installRoot: resolve(installRoot),
    ...(launchAgentsRoot ? { launchAgentsRoot: resolve(launchAgentsRoot) } : {}),
  }) : undefined;
  const tailscalePath = tailscaleExecutable();
  const serve = new TailscaleCliServeDriver(
    runner,
    tailscalePath ?? "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    paths ? join(paths.stateRoot, "serve-owner.json") : undefined,
  );
  let lifecycle: LifecycleDriver | undefined;
  if (paths && typeof process.getuid === "function") {
    const launchAgent = new LaunchAgentDriver(runner, process.getuid());
    lifecycle = new MacLifecycleDriver({
      launchAgent,
      serve,
      label: paths.launchAgentLabel,
      plistPath: paths.plistPath,
      installPaths: paths,
      ...(targetBundle ? { targetBundleRoot: resolve(targetBundle) } : {}),
    });
  }

  let setupDefaults: SetupDefaults | undefined;
  if (paths && home) {
    const executableDir = dirname(process.execPath);
    setupDefaults = {
      installRoot: paths.installRoot,
      launchAgentsRoot: paths.launchAgentsRoot,
      ompExecutable: Bun.which("omp"),
      sourceCliExecutable: process.execPath,
      sourceBridgeExecutable: join(executableDir, "bridge-daemon"),
      ompSessionDir: join(paths.installRoot, "release", "sessions"),
      bridgeVersion: process.env.PI_MOB_BRIDGE_VERSION ?? BRIDGE_VERSION,
      protocolVersion: "1.0",
      port: 8788,
    };
  }

  const result = await runCli({
    fs: createNodeFileSystemPort(),
    clock: systemClock(),
    serveDriver: serve,
    interactive: process.stdout.isTTY === true,
    stdout: (chunk) => process.stdout.write(chunk),
    stderr: (chunk) => process.stderr.write(chunk),
    argv: withPublicPathDefaults(argv, installRoot, launchAgentsRoot),
    captureLoginEnv,
    tailscaleProbe: () => new TailscaleStatusDriver(runner, tailscalePath).probe(),
    hostIdentity: (databasePath: string) => {
      const store = new BridgeStore(databasePath);
      try { return store.identity(); } finally { store.close(); }
    },
    enrollmentChallenge: (databasePath: string) => {
      const store = new BridgeStore(databasePath);
      try {
        const challenge = issuePendingEnrollment({ store });
        return { passcode: challenge.plaintext, expiresAt: challenge.expiresAt };
      } finally { store.close(); }
    },
    ...(setupDefaults ? { setupDefaults } : {}),
    ...(paths ? {
      databaseIntegrity: (path: string) => {
        try {
          const db = new Database(path, { readonly: true, strict: true });
          const result = db.query("PRAGMA integrity_check").get() as Record<string, unknown> | null;
          db.close();
          return { ok: result !== null && Object.values(result).includes("ok") };
        } catch (error) { return { ok: false, detail: error instanceof Error ? error.message : String(error) }; }
      },
      processProbe: (port: number) => {
        const uid = typeof process.getuid === "function" ? process.getuid() : -1;
        const service = Bun.spawnSync(["/bin/launchctl", "print", `gui/${uid}/${paths.launchAgentLabel}`]);
        const listener = Bun.spawnSync(["/usr/bin/curl", "--silent", "--fail", "--max-time", "2", `http://127.0.0.1:${port}/readyz`]);
        return { loaded: service.exitCode === 0, listenerReady: listener.exitCode === 0 };
      },
    } : {}),
    ...(lifecycle ? { lifecycle } : {}),
  });
  return result.exitCode;
}

if (import.meta.main) main(process.argv.slice(2)).then((code) => process.exit(code));
