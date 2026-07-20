#!/usr/bin/env bun
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { buildInstallPaths } from "./ops/install-paths";
import { createNodeFileSystemPort, systemClock } from "./ops/ports";
import { runCli, type LifecycleDriver } from "./ops/cli";
import { BunCommandRunner, LaunchAgentDriver, MacLifecycleDriver, TailscaleCliServeDriver } from "./ops/macos-system";

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

export async function main(argv: readonly string[]): Promise<number> {
  const runner = new BunCommandRunner();
  const installRoot = flag(argv, "install-root");
  const targetBundle = flag(argv, "target-bundle") ?? flag(argv, "target-root");
  const launchAgentsRoot = flag(argv, "launch-agents-root");
  const paths = installRoot ? buildInstallPaths({
    installRoot: resolve(installRoot),
    ...(launchAgentsRoot ? { launchAgentsRoot: resolve(launchAgentsRoot) } : {}),
  }) : undefined;
  const serve = new TailscaleCliServeDriver(
    runner,
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    paths ? join(paths.stateRoot, "serve-owner.json") : undefined,
  );
  let lifecycle: LifecycleDriver | undefined;
  if (paths && targetBundle && typeof process.getuid === "function") {
    const launchAgent = new LaunchAgentDriver(runner, process.getuid());
    lifecycle = new MacLifecycleDriver({
      launchAgent,
      serve,
      label: paths.launchAgentLabel,
      plistPath: paths.plistPath,
      installPaths: paths,
      targetBundleRoot: resolve(targetBundle),
      readyEndpoint: new URL("http://127.0.0.1:8788/readyz"),
    });
  }
  const result = await runCli({
    fs: createNodeFileSystemPort(),
    clock: systemClock(),
    serveDriver: serve,
    stdout: (chunk) => process.stdout.write(chunk),
    stderr: (chunk) => process.stderr.write(chunk),
    argv,
    env: () => process.env,
    ...(paths ? {
      databaseIntegrity: (path: string) => {
        try {
          const db = new Database(path, { readonly: true, strict: true });
          const result = db.query("PRAGMA integrity_check").get() as Record<string, unknown> | null;
          db.close();
          return { ok: result !== null && Object.values(result).includes("ok") };
        } catch (error) { return { ok: false, detail: error instanceof Error ? error.message : String(error) }; }
      },
      processProbe: () => {
        const uid = typeof process.getuid === "function" ? process.getuid() : -1;
        const service = Bun.spawnSync(["/bin/launchctl", "print", `gui/${uid}/${paths.launchAgentLabel}`]);
        const listener = Bun.spawnSync(["/usr/bin/curl", "--silent", "--fail", "--max-time", "2", "http://127.0.0.1:8788/readyz"]);
        return { loaded: service.exitCode === 0, listenerReady: listener.exitCode === 0 };
      },
    } : {}),
    ...(lifecycle ? { lifecycle } : {}),
  });
  return result.exitCode;
}

if (import.meta.main) main(process.argv.slice(2)).then((code) => process.exit(code));
