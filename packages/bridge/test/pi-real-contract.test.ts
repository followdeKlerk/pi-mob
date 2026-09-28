import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { toPiRpcCommand } from "../src/pi/commands";
import { RpcProcess } from "../src/pi/rpc-process";
import { resolvePiLaunchConfig } from "../src/pi/launch-config";

const expectedVersion = "0.82.0";
const expectedCliSha256 = "af302f231437eaf6f37691bce4b34234fcb626bcb5eb3910d4fc3f6519bf78ca";

function realRpc(root: string, extraEnvironment: Record<string, string> = {}): RpcProcess {
  const home = join(root, "home"); const sessions = join(root, "sessions");
  mkdirSync(home, { recursive: true }); mkdirSync(sessions, { recursive: true });
  return new RpcProcess({
    launchConfig: resolvePiLaunchConfig({
      executable: new URL("../node_modules/.bin/pi", import.meta.url).pathname,
      cwd: root,
      env: { HOME: home, LANG: "C.UTF-8", PATH: process.env.PATH ?? "/usr/bin:/bin", ...extraEnvironment },
    }),
    args: ["--mode", "rpc", "--no-extensions", "--extension", new URL("./fixtures/contract-provider.ts", import.meta.url).pathname, "--session-dir", sessions, "--provider", "pi-mob-fixture", "--model", "contract"],
    defaultRequestTimeoutMs: 10_000, closeGracePeriodMs: 1_000,
  });
}

describe("exact real Pi RPC contract", () => {
  test("runs a deterministic prompt, built-in tool, session cycle, and settles", async () => {
    const pi = new URL("../node_modules/.bin/pi", import.meta.url).pathname;
    const cli = new URL("../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url).pathname;
    expect(Bun.spawnSync([pi, "--version"]).stdout.toString().trim()).toBe(expectedVersion);
    expect(new Bun.CryptoHasher("sha256").update(await Bun.file(cli).arrayBuffer()).digest("hex")).toBe(expectedCliSha256);

    const root = mkdtempSync(join(tmpdir(), "pi-mob-real-contract-"));
    writeFileSync(join(root, "contract-input.txt"), "fixture input\n");
    const rpc = realRpc(root);
    const events: Array<Record<string, unknown>> = [];
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => { settle = resolve; });
    rpc.on("notification", (value) => {
      if (value && typeof value === "object") {
        const event = value as Record<string, unknown>; events.push(event);
        if (event.type === "agent_settled") settle();
      }
    });
    try {
      await rpc.start();
      await rpc.request({ id: "prompt", method: "prompt", params: { message: "run deterministic contract" } });
      await Promise.race([settled, Bun.sleep(10_000).then(() => { throw new Error("real Pi did not settle"); })]);
      const state = await rpc.request({ id: "state", method: "get_state" }) as Record<string, unknown>;
      const messages = await rpc.request({ id: "messages", method: "get_messages" }) as Record<string, unknown>;
      const entries = await rpc.request({ id: "entries", method: "get_entries" }) as Record<string, unknown>;
      const tree = await rpc.request({ id: "tree", method: "get_tree" }) as Record<string, unknown>;
      await rpc.request({ id: "name", method: "set_session_name", params: { name: "fixture-session" } });
      expect(state.sessionId).toBeString();
      expect(messages.messages).toBeArray(); expect(entries.entries).toBeArray(); expect(tree).toBeObject();
      expect(events.some((event) => event.type === "tool_execution_start" && event.toolName === "read")).toBe(true);
      expect(events.some((event) => event.type === "tool_execution_end" && event.isError === false)).toBe(true);
      expect(events.filter((event) => event.type === "agent_settled")).toHaveLength(1);
      expect(events.findIndex((event) => event.type === "agent_settled")).toBeGreaterThan(events.findIndex((event) => event.type === "agent_end"));
    } finally {
      await rpc.close();
    }
  }, 20_000);

  test("rejects corrupt sessions and preserves extension cancellation", async () => {
    const corruptRoot = mkdtempSync(join(tmpdir(), "pi-mob-corrupt-contract-"));
    const corrupt = join(corruptRoot, "corrupt.jsonl"); writeFileSync(corrupt, "not-json\n");
    const incompatible = join(corruptRoot, "incompatible.jsonl");
    writeFileSync(incompatible, `${JSON.stringify({ type: "session", version: 999, id: "fixture", timestamp: "2026-07-13T00:00:00.000Z", cwd: corruptRoot })}\n`);
    const corruptRpc = realRpc(corruptRoot);
    try {
      await corruptRpc.start();
      await expect(corruptRpc.request({ id: "corrupt", method: "switch_session", params: { sessionPath: corrupt } })).rejects.toThrow("Pi RPC command failed");
      expect(() => toPiRpcCommand({ type: "switch_session", payload: { sessionPath: incompatible } })).toThrow("compatible Pi session file");
    } finally { await corruptRpc.close(); }

    const cancelRoot = mkdtempSync(join(tmpdir(), "pi-mob-cancel-contract-"));
    const cancelRpc = realRpc(cancelRoot, { PI_MOB_CANCEL_LIFECYCLE: "1" });
    try {
      await cancelRpc.start();
      await expect(cancelRpc.request({ id: "new", method: "new_session" })).resolves.toEqual({ cancelled: true });
      await expect(cancelRpc.request({ id: "clone", method: "clone" })).resolves.toEqual({ cancelled: true });
    } finally { await cancelRpc.close(); }
  }, 20_000);
});
