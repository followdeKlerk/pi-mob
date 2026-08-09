import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runDaemon, type DaemonHandle } from "../packages/bridge/src/daemon";
import { BRIDGE_VERSION } from "../packages/bridge/src/version";

export const CORE = ["streams.v1", "commands.v1", "controller_leases.v1", "session_events.v2"] as const;
export const EXPECTED = { withoutFcm: [...CORE].sort(), withFcm: [...CORE, "notifications.v1"].sort() };
const ROOT = new URL("..", import.meta.url).pathname;
const projectPath = (path: string): string => join(ROOT, path);
const FCM = { projectId: "capability-report-project", serviceAccountEmail: "capability-report@example.invalid", privateKey: "-----BEGIN PRIVATE KEY-----\nplaceholder\n-----END PRIVATE KEY-----" };
export type CapabilityMatrix = { withoutFcm: string[]; withFcm: string[] };
export type Snapshot = { configuration: "with-fcm" | "without-fcm"; capabilities: string[] };

export function parseCapabilityMatrix(text: string): CapabilityMatrix {
  const section = text.match(/## Normal daemon capability matrix[\s\S]*?(?=\n## |$)/)?.[0];
  if (!section) throw new Error("missing Normal daemon capability matrix");
  const rows = section.split("\n").map((line) => line.match(/^\|\s*(without-FCM|with-FCM)\s*\|\s*(.*?)\s*\|\s*$/i)).filter((row): row is RegExpMatchArray => row !== null);
  if (rows.length !== 2) throw new Error("capability matrix must contain exactly without-FCM and with-FCM rows");
  const parsed: Partial<CapabilityMatrix> = {};
  for (const row of rows) {
    const values = row[2]!.split(",").map((value) => value.trim().replace(/^`|`$/g, "")).filter(Boolean);
    if (values.length === 0) throw new Error(`empty capability row: ${row[1]}`);
    parsed[row[1] === "with-FCM" ? "withFcm" : "withoutFcm"] = [...new Set(values)].sort();
  }
  if (!parsed.withFcm || !parsed.withoutFcm) throw new Error("capability matrix rows are incomplete");
  return { withoutFcm: parsed.withoutFcm, withFcm: parsed.withFcm };
}

function same(a: readonly string[], b: readonly string[]): boolean { return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort()); }
export function checkCapabilityDocs(projectStatus: string, live: CapabilityMatrix): void {
  const project = parseCapabilityMatrix(projectStatus);
  for (const [name, actual] of Object.entries(live) as [keyof CapabilityMatrix, string[]][]) {
    if (!same(project[name], actual)) throw new Error(`PROJECT_STATUS ${name} differs from live capabilities`);
  }
}

async function snapshot(configuration: Snapshot["configuration"]): Promise<Snapshot> {
  const root = await mkdtemp(join(tmpdir(), "pi-mob-capabilities-")); const state = join(root, "state"); await mkdir(state);
  let daemon: DaemonHandle | undefined;
  let credentialCleartext: string | null = null;
  try {
    daemon = await runDaemon({ workspace: root, ompExecutable: process.execPath, stateDir: state, ...(configuration === "with-fcm" ? { fcm: FCM } : {}) });
    // Phase 4 — bootstrap a per-installation credential locally so the
    // capability-report handshake can complete. The report's only job
    // is to enumerate the `hello.accepted.capabilities` list; it never
    // exercises any other endpoint and never persists the plaintext.
    const crypto = await import("node:crypto");
    const Plaintext = `pc_${crypto.randomBytes(32).toString("base64url")}`;
    credentialCleartext = Plaintext;
    const CredentialHash = (() => {
      const h = crypto.createHash("sha256");
      h.update(Plaintext);
      return h.digest("hex");
    })();
    const InstallationId = crypto.randomUUID();
    daemon!.store.upsertInstallationCredential({
      installationId: InstallationId,
      credentialHash: CredentialHash,
      enrollmentSecretHash: "f".repeat(64),
      enrollmentSource: "cli",
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    const capabilities = await new Promise<string[]>((resolveSnapshot, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${daemon!.server.port}/v1/ws`, { perMessageDeflate: false });
      const timer = setTimeout(() => { ws.close(); reject(new Error("capability handshake timed out")); }, 5000);
      ws.onerror = () => { clearTimeout(timer); reject(new Error("capability handshake failed")); };
      ws.onopen = () => ws.send(JSON.stringify({ protocol: { major: 1, minor: 0 }, messageId: crypto.randomUUID(), requestId: crypto.randomUUID(), type: "hello", sentAt: new Date().toISOString(), payload: { mobileVersion: BRIDGE_VERSION, platform: "android", installationId: InstallationId, installationCredential: Plaintext, requiredCapabilities: [...CORE], optionalCapabilities: [] } }));
      ws.onmessage = (event) => { const message = JSON.parse(String(event.data)) as any; if (message.type !== "hello.accepted") return; clearTimeout(timer); ws.close(); resolveSnapshot([...message.payload.capabilities].sort()); };
    });
    return { configuration, capabilities };
  } finally {
    if (credentialCleartext !== null) {
      // Drop the plaintext from memory and revoke the row so the test
      // state never leaves a credential behind.
      credentialCleartext = null;
      try { daemon?.store.revokeInstallationCredential(daemon.store.aggregateRetainedInstallationIds()[0] ?? "", "capability_report_teardown", Date.now()); } catch { /* ignore */ }
    }
    await daemon?.close();
    await rm(root, { recursive: true, force: true });
  }
}

const metadata = [
  ["streams.v1", "packages/bridge/src/daemon.ts", "runDaemon", "apps/mobile/lib/src/connection/connection_coordinator.dart", "capability", "packages/bridge/test/capability-report.test.ts"],
  ["commands.v1", "packages/bridge/src/daemon.ts", "runDaemon", "apps/mobile/lib/src/connection/connection_coordinator.dart", "command", "packages/bridge/test/capability-report.test.ts"],
  ["controller_leases.v1", "packages/bridge/src/daemon.ts", "runDaemon", "apps/mobile/lib/src/connection/connection_coordinator.dart", "lease", "packages/bridge/test/capability-report.test.ts"],
  ["session_events.v2", "packages/bridge/src/daemon.ts", "CanonicalEventTransport", "apps/mobile/lib/src/connection/connection_coordinator.dart", "session.events.subscribe", "packages/bridge/test/session-events/canonical-server-runtime.test.ts"],
  ["notifications.v1", "packages/bridge/src/daemon.ts", "BridgeNotificationService", "apps/mobile/lib/src/notifications/notification_controller.dart", "onBridgeReady", "packages/bridge/test/capability-report.test.ts"],
] as const;

export async function buildReport(): Promise<Report> {
  const snapshots = [await snapshot("with-fcm"), await snapshot("without-fcm")];
  const live = { withoutFcm: snapshots.find((s) => s.configuration === "without-fcm")!.capabilities, withFcm: snapshots.find((s) => s.configuration === "with-fcm")!.capabilities };
  if (!same(live.withoutFcm, EXPECTED.withoutFcm) || !same(live.withFcm, EXPECTED.withFcm)) throw new Error("live normal-daemon capability drift");
  checkCapabilityDocs(await Bun.file(projectPath("docs/PROJECT_STATUS.md")).text(), live);
  const capabilities = metadata.map(([capability, sourceFile, sourceSymbol, mobileFile, mobileSymbol, focusedTestPath]) => {
    if (!existsSync(projectPath(sourceFile)) || !readFileSync(projectPath(sourceFile), "utf8").includes(sourceSymbol)) throw new Error(`invalid provider source metadata for ${capability}`);
    if (!existsSync(projectPath(mobileFile)) || !readFileSync(projectPath(mobileFile), "utf8").includes(mobileSymbol)) throw new Error(`invalid mobile metadata for ${capability}`);
    if (!existsSync(projectPath(focusedTestPath))) throw new Error(`missing focused test metadata for ${capability}`);
    return { capability, providerConstructionSource: `${sourceFile}: ${sourceSymbol}`, mobileEntryPoint: `${mobileFile}: ${mobileSymbol}`, focusedTestPath, releaseVersion: BRIDGE_VERSION };
  });
  return { releaseVersion: BRIDGE_VERSION, snapshots, capabilities };
}
type Report = { releaseVersion: string; snapshots: Snapshot[]; capabilities: Array<Record<string, string>> };
if (import.meta.main) { const report = await buildReport(); await mkdir(projectPath("reports"), { recursive: true }); await writeFile(projectPath("reports/capabilities.json"), `${JSON.stringify(report, null, 2)}\n`); console.log(`capability-report ok (${report.snapshots.map((s) => `${s.configuration}:${s.capabilities.join(",")}`).join("; ")})`); }
export { snapshot };
