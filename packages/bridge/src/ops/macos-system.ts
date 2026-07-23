import { renameSync, copyFileSync, openSync, fsyncSync, closeSync, mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ServeDriver, ServeRoute } from "./tailscale-serve";
import { applyServeRoute, removeOwnedServeRoute, BRIDGE_ROUTE_ANNOTATION_KEY, BRIDGE_ROUTE_OWNER } from "./tailscale-serve";
import { verifyManifest, type ReleaseManifest } from "./release-manifest";
import { createNodeFileSystemPort } from "./ports";
import type { InstallPaths } from "./install-paths";
import type { MigrationClass } from "./update";
import { BridgeStore } from "../core/store";
import { parseInstallConfig } from "./install-config";

export interface CommandResult { readonly exitCode: number; readonly stdout: string; readonly stderr: string }
export interface CommandRunner { run(executable: string, args: readonly string[]): Promise<CommandResult> }

export class BunCommandRunner implements CommandRunner {
  async run(executable: string, args: readonly string[]): Promise<CommandResult> {
    if (!executable.startsWith("/")) throw new Error("system executable must be absolute");
    const env = Object.fromEntries(
      ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR"].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []),
    );
    env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin";
    const proc = Bun.spawn([executable, ...args], { stdout: "pipe", stderr: "pipe", env });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
  }
}

async function checked(runner: CommandRunner, executable: string, args: readonly string[]): Promise<CommandResult> {
  const result = await runner.run(executable, args);
  if (result.exitCode !== 0) throw new Error(`command failed (${result.exitCode}): ${executable} ${args[0] ?? ""}`);
  return result;
}

export class LaunchAgentDriver {
  constructor(
    private readonly runner: CommandRunner,
    private readonly uid: number,
    private readonly launchctl = "/bin/launchctl",
  ) {
    if (!Number.isInteger(uid) || uid <= 0) throw new Error("owner uid is required");
  }
  private get domain(): string { return `gui/${this.uid}`; }
  bootstrap(plist: string): Promise<CommandResult> { return checked(this.runner, this.launchctl, ["bootstrap", this.domain, plist]); }
  bootout(label: string): Promise<CommandResult> { return checked(this.runner, this.launchctl, ["bootout", `${this.domain}/${label}`]); }
  enable(label: string): Promise<CommandResult> { return checked(this.runner, this.launchctl, ["enable", `${this.domain}/${label}`]); }
  kickstart(label: string): Promise<CommandResult> { return checked(this.runner, this.launchctl, ["kickstart", "-k", `${this.domain}/${label}`]); }
  print(label: string): Promise<CommandResult> { return checked(this.runner, this.launchctl, ["print", `${this.domain}/${label}`]); }
  async isLoaded(label: string): Promise<boolean> {
    try { await this.print(label); return true; } catch { return false; }
  }
}

/** Real persistent Serve driver. It round-trips the complete Serve JSON so
 * callers can alter only the bridge-owned route and preserve every other route. */
export interface DetectedTailscaleState {
  readonly installed: boolean;
  readonly loggedIn: boolean;
  readonly magicDnsName: string | null;
  readonly detail?: string;
}

/** Read-only Tailscale readiness detection. Never installs software or invokes `tailscale up`. */
export class TailscaleStatusDriver {
  constructor(
    private readonly runner: CommandRunner,
    private readonly executable: string | null,
  ) {}

  async probe(): Promise<DetectedTailscaleState> {
    if (!this.executable) return { installed: false, loggedIn: false, magicDnsName: null, detail: "Tailscale CLI/app not found" };
    const result = await this.runner.run(this.executable, ["status", "--json"]);
    if (result.exitCode !== 0) {
      return { installed: true, loggedIn: false, magicDnsName: null, detail: "Tailscale is installed but not logged in" };
    }
    try {
      const value = JSON.parse(result.stdout) as { BackendState?: unknown; Self?: { DNSName?: unknown } };
      const dns = typeof value.Self?.DNSName === "string" ? value.Self.DNSName.replace(/\.$/, "") : null;
      const loggedIn = value.BackendState === "Running";
      return { installed: true, loggedIn, magicDnsName: loggedIn && dns?.endsWith(".ts.net") ? dns : null };
    } catch {
      return { installed: true, loggedIn: false, magicDnsName: null, detail: "Tailscale status returned invalid JSON" };
    }
  }
}

export class TailscaleCliServeDriver implements ServeDriver {
  constructor(
    private readonly runner: CommandRunner,
    private readonly tailscale = "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    private readonly ownershipFile?: string,
  ) {}
  async listRoutes(): Promise<readonly ServeRoute[]> {
    const result = await checked(this.runner, this.tailscale, ["serve", "status", "--json"]);
    const value = JSON.parse(result.stdout) as { routes?: ServeRoute[]; Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>; AllowFunnel?: Record<string, boolean> } | ServeRoute[];
    if (Array.isArray(value)) return value;
    if (Array.isArray(value.routes)) return value.routes;
    const routes: ServeRoute[] = [];
    let marker: { port: number; address: string } | null = null;
    if (this.ownershipFile && existsSync(this.ownershipFile)) {
      try { marker = JSON.parse(readFileSync(this.ownershipFile, "utf8")) as { port: number; address: string }; } catch { marker = null; }
    }
    for (const [hostPort, web] of Object.entries(value.Web ?? {})) {
      const port = Number.parseInt(hostPort.split(":").at(-1) ?? "443", 10);
      for (const handler of Object.values(web.Handlers ?? {})) {
        if (!handler.Proxy) continue;
        const owned = marker?.port === port && marker.address === handler.Proxy;
        routes.push({
          source: { tcp: { port } }, handlers: [{ kind: "https", address: handler.Proxy }],
          ...(owned ? { annotations: { [BRIDGE_ROUTE_ANNOTATION_KEY]: BRIDGE_ROUTE_OWNER } } : {}),
        });
      }
    }
    return routes;
  }
  async setRoutes(routes: readonly ServeRoute[]): Promise<void> {
    if (routes.some((route) => route.handlers.some((handler) => handler.kind === "funnel"))) throw new Error("Funnel routes are forbidden");
    const owned = routes.find((route) => route.annotations?.[BRIDGE_ROUTE_ANNOTATION_KEY] === BRIDGE_ROUTE_OWNER);
    if (!owned) {
      const current = await this.listRoutes();
      const currentOwned = current.find(
        (route) => route.annotations?.[BRIDGE_ROUTE_ANNOTATION_KEY] === BRIDGE_ROUTE_OWNER,
      );
      if (!currentOwned) return;
      const currentPort = currentOwned.source.tcp?.port;
      if (!currentPort) throw new Error("owned Serve route has no HTTPS port");
      if (current.some((route) => route !== currentOwned && route.source.tcp?.port === currentPort)) {
        throw new Error("refusing to remove a shared Serve HTTPS port");
      }
      await checked(this.runner, this.tailscale, ["serve", `--https=${currentPort}`, "off"]);
      if (this.ownershipFile && existsSync(this.ownershipFile)) unlinkSync(this.ownershipFile);
      return;
    }
    const handler = owned.handlers.find((entry) => entry.kind === "https" || entry.kind === "forward");
    const port = owned.source.tcp?.port ?? 443;
    if (!handler || !("address" in handler)) throw new Error("owned Serve route has no target");
    await checked(this.runner, this.tailscale, ["serve", "--bg", `--https=${port}`, handler.address]);
    if (this.ownershipFile) {
      mkdirSync(dirname(this.ownershipFile), { recursive: true, mode: 0o700 });
      writeFileSync(this.ownershipFile, JSON.stringify({ port, address: handler.address }), { mode: 0o600 });
    }
  }
}

export async function waitForReady(
  endpoint: URL,
  fetcher: (url: URL) => Promise<{ ok: boolean }> = async (url) => fetch(url).then((r) => ({ ok: r.ok })),
  attempts = 30,
): Promise<void> {
  if (endpoint.hostname !== "127.0.0.1" && endpoint.hostname !== "localhost" && endpoint.hostname !== "::1") throw new Error("readiness endpoint must be loopback");
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { if ((await fetcher(endpoint)).ok) return; } catch { /* retry */ }
    await Bun.sleep(100);
  }
  throw new Error("bridge readiness timeout");
}

export function atomicReplace(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.next-${process.pid}`;
  copyFileSync(source, temporary);
  const file = openSync(temporary, "r");
  try { fsyncSync(file); } finally { closeSync(file); }
  renameSync(temporary, destination);
  const directory = openSync(dirname(destination), "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

/** Production implementation of the ops CLI lifecycle contract. */
export class MacLifecycleDriver {
  private lastBackupId: string | null = null;
  constructor(private readonly options: {
    launchAgent: LaunchAgentDriver;
    serve: ServeDriver;
    label: string;
    plistPath: string;
    installPaths: InstallPaths;
    targetBundleRoot?: string;
    readyEndpoint?: URL;
  }) {}
  async installAndVerify(paths: InstallPaths, port: number): Promise<void> {
    await this.options.launchAgent.bootstrap(paths.plistPath);
    await this.options.launchAgent.enable(paths.launchAgentLabel);
    await this.options.launchAgent.kickstart(paths.launchAgentLabel);
    await waitForReady(new URL(`http://127.0.0.1:${port}/readyz`));
    await applyServeRoute({ driver: this.options.serve, tcpPort: port });
  }
  async lifecycleState(port: number): Promise<{ launchAgentLoaded: boolean; listenerReady: boolean }> {
    const launchAgentLoaded = await this.options.launchAgent.isLoaded(this.options.label);
    let listenerReady = false;
    if (launchAgentLoaded) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(2_000) });
        listenerReady = response.ok;
      } catch { listenerReady = false; }
    }
    return { launchAgentLoaded, listenerReady };
  }
  async startConfigured(port: number): Promise<{ alreadyRunning: boolean }> {
    const before = await this.lifecycleState(port);
    if (!before.listenerReady) {
      if (!before.launchAgentLoaded) {
        await this.options.launchAgent.bootstrap(this.options.plistPath);
        await this.options.launchAgent.enable(this.options.label);
      }
      await this.options.launchAgent.kickstart(this.options.label);
      await waitForReady(new URL(`http://127.0.0.1:${port}/readyz`));
    }
    await applyServeRoute({ driver: this.options.serve, tcpPort: port });
    return { alreadyRunning: before.listenerReady };
  }
  async stopConfigured(): Promise<{ alreadyStopped: boolean }> {
    const loaded = await this.options.launchAgent.isLoaded(this.options.label);
    if (loaded) await this.options.launchAgent.bootout(this.options.label);
    await removeOwnedServeRoute({ driver: this.options.serve });
    return { alreadyStopped: !loaded };
  }
  preflight(): void {
    if (!this.options.targetBundleRoot || !existsSync(this.options.targetBundleRoot)) throw new Error("target release bundle is missing; pass --target-bundle for update/swap");
  }
  verifyTarget(manifest: ReleaseManifest): void {
    if (!this.options.targetBundleRoot) throw new Error("target release bundle is required for update/swap");
    const result = verifyManifest(manifest, this.options.targetBundleRoot, createNodeFileSystemPort());
    if (!result.ok) throw new Error("target release checksum verification failed");
  }
  backup(paths: InstallPaths, manifest: ReleaseManifest): string {
    const id = `backup-${manifest.version}-${Date.now()}`; const root = join(paths.backupRoot, id);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    for (const [source, name] of [
      [paths.configFile, "config.toml"], [paths.plistPath, "launch-agent.plist"], [paths.envFile, "env"],
      [join(paths.binRoot, "bridge-daemon"), "bridge-daemon"],
      [join(paths.installRoot, "release", "extensions", "pi-mob-extension.js"), "pi-mob-extension.js"],
      [join(paths.stateRoot, "bridge.sqlite"), "bridge.sqlite"],
    ] as const) {
      if (existsSync(source)) copyFileSync(source, join(root, name));
    }
    this.lastBackupId = id; return id;
  }
  async stop(): Promise<void> { try { await this.options.launchAgent.bootout(this.options.label); } catch { /* not loaded */ } }
  swap(paths: InstallPaths, manifest: ReleaseManifest): void {
    if (!this.options.targetBundleRoot) throw new Error("target release bundle is required for update/swap");
    const daemon = manifest.artifacts.find((entry) => entry.name === "bridge-daemon");
    const extension = manifest.artifacts.find((entry) => entry.kind === "extension");
    if (!daemon) throw new Error("release daemon artifact is missing");
    atomicReplace(join(this.options.targetBundleRoot, daemon.path), join(paths.binRoot, "bridge-daemon"));
    if (extension) atomicReplace(join(this.options.targetBundleRoot, extension.path), join(paths.installRoot, "release", "extensions", "pi-mob-extension.js"));
  }
  migrate(_migrationClass: MigrationClass): void { const store = new BridgeStore(join(this.currentPaths().stateRoot, "bridge.sqlite")); store.close(); }
  async start(): Promise<void> {
    if (!(await this.options.launchAgent.isLoaded(this.options.label))) {
      await this.options.launchAgent.bootstrap(this.options.plistPath);
      await this.options.launchAgent.enable(this.options.label);
    }
    await this.options.launchAgent.kickstart(this.options.label);
  }
  verifyRunning(): Promise<void> {
    if (existsSync(this.options.installPaths.configFile)) {
      const config = parseInstallConfig(readFileSync(this.options.installPaths.configFile, "utf8"));
      return waitForReady(new URL(`http://127.0.0.1:${config.port}/readyz`));
    }
    if (this.options.readyEndpoint) return waitForReady(this.options.readyEndpoint);
    throw new Error("install config is required to determine the readiness port");
  }
  verifyBackup(backupId: string): void {
    const selected = this.resolveBackupId(this.currentPaths(), backupId);
    if (!existsSync(join(this.currentPaths().backupRoot, selected))) throw new Error("backup is missing");
  }
  restore(paths: InstallPaths, backupId: string): void {
    const selected = this.resolveBackupId(paths, backupId);
    const root = join(paths.backupRoot, selected);
    for (const [name, destination] of [
      ["config.toml", paths.configFile], ["launch-agent.plist", paths.plistPath], ["env", paths.envFile],
      ["bridge-daemon", join(paths.binRoot, "bridge-daemon")],
      ["pi-mob-extension.js", join(paths.installRoot, "release", "extensions", "pi-mob-extension.js")],
    ] as const) {
      const source = join(root, name); if (existsSync(source)) atomicReplace(source, destination);
    }
    const database = join(root, "bridge.sqlite"); if (existsSync(database)) atomicReplace(database, join(paths.stateRoot, "bridge.sqlite"));
  }
  generationReset(): void { const store = new BridgeStore(join(this.currentPaths().stateRoot, "bridge.sqlite")); store.incrementHostGeneration(); store.close(); }
  async stopAndRemoveService(): Promise<void> { await this.stop(); }
  async removeOwnedServe(): Promise<void> { await removeOwnedServeRoute({ driver: this.options.serve }); }
  private resolveBackupId(paths: InstallPaths, backupId: string): string {
    this.assertBackupId(backupId, true);
    const selected = backupId === "latest"
      ? this.lastBackupId ?? readdirSync(paths.backupRoot).filter((name) => /^backup-.+-\d+$/.test(name)).sort((left, right) => Number(left.split("-").at(-1)) - Number(right.split("-").at(-1))).at(-1)
      : backupId;
    if (!selected) throw new Error("no rollback backup is available");
    this.assertBackupId(selected, false);
    return selected;
  }
  private assertBackupId(backupId: string, allowLatest: boolean): void {
    if (allowLatest && backupId === "latest") return;
    if (!/^backup-[A-Za-z0-9][A-Za-z0-9._+-]{0,127}-\d{1,20}$/.test(backupId)) throw new Error("invalid backup id");
  }
  private currentPaths(): InstallPaths { return this.options.installPaths; }
}
