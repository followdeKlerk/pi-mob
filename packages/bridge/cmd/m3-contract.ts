#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RpcProcess } from "../src/pi/rpc-process";
import { resolvePiLaunchConfig } from "../src/pi/launch-config";

const root = mkdtempSync(join(tmpdir(), "pi-mob-m3-contract-"));
const home = join(root, "home"); const sessions = join(root, "sessions");
mkdirSync(home); mkdirSync(sessions); writeFileSync(join(root, "contract-input.txt"), "fixture input\n");
const pi = new URL("../node_modules/.bin/pi", import.meta.url).pathname;
const cli = new URL("../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url).pathname;
const rpc = new RpcProcess({
  launchConfig: resolvePiLaunchConfig({ executable: pi, cwd: root, env: { HOME: home, LANG: "C.UTF-8", PATH: process.env.PATH ?? "/usr/bin:/bin" } }),
  args: ["--mode", "rpc", "--no-extensions", "--extension", new URL("../test/fixtures/contract-provider.ts", import.meta.url).pathname, "--session-dir", sessions, "--provider", "pi-mob-fixture", "--model", "contract"],
  defaultRequestTimeoutMs: 10_000,
});
const eventTypes: string[] = [];
let settle!: () => void;
const settled = new Promise<void>((resolve) => { settle = resolve; });
rpc.on("notification", (value) => {
  if (value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string") {
    const type = (value as { type: string }).type; eventTypes.push(type); if (type === "agent_settled") settle();
  }
});
try {
  await rpc.start();
  await rpc.request({ id: "contract", method: "prompt", params: { message: "run deterministic contract" } });
  await Promise.race([settled, Bun.sleep(10_000).then(() => { throw new Error("Pi contract did not settle"); })]);
  const state = await rpc.request({ id: "state", method: "get_state" }) as Record<string, unknown>;
  const version = Bun.spawnSync([pi, "--version"]).stdout.toString().trim();
  const sha256 = new Bun.CryptoHasher("sha256").update(await Bun.file(cli).arrayBuffer()).digest("hex");
  const report = {
    schemaVersion: 1, piVersion: version, executableSha256: sha256,
    promptAccepted: true, toolCycle: eventTypes.includes("tool_execution_start") && eventTypes.includes("tool_execution_end"),
    agentSettled: eventTypes.includes("agent_settled"), agentSettledAfterAgentEnd: eventTypes.indexOf("agent_settled") > eventTypes.indexOf("agent_end"),
    durableSession: typeof state.sessionId === "string" && typeof state.sessionFile === "string",
    eventTypes: [...new Set(eventTypes)], sanitization: "No prompts, tool contents, provider credentials, or paths emitted.",
  };
  if (!report.toolCycle || !report.agentSettled || !report.agentSettledAfterAgentEnd || !report.durableSession) throw new Error("M3 contract invariant failed");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally { await rpc.close(); }
