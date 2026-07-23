import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RpcProcess } from "../src/pi/rpc-process";

async function run(mode: "full" | "read_only") {
  const root = mkdtempSync(join(tmpdir(), `pi-mob-m8-real-${mode}-`));
  const home = join(root, "home"); const sessions = join(root, "sessions");
  mkdirSync(home); mkdirSync(sessions);
  const policyFile = join(root, "policy.json");
  writeFileSync(policyFile, JSON.stringify({ mode, version: "pi-trust/1", fingerprint: "a".repeat(64) }), { mode: 0o600 });
  const rpc = new RpcProcess({
    executable: new URL("../node_modules/.bin/pi", import.meta.url).pathname,
    args: ["--mode", "rpc", "--no-extensions", "--extension", new URL("../../pi-extension/src/extension.ts", import.meta.url).pathname, "--extension", new URL("./fixtures/readonly-provider.ts", import.meta.url).pathname, "--session-dir", sessions, "--provider", "pi-mob-readonly-fixture", "--model", "contract"],
    cwd: root, environment: { HOME: home, LANG: "C.UTF-8", PI_MOB_HOST_POLICY_FILE: policyFile },
    pathDirs: ["/usr/local/bin", "/usr/bin", "/bin"], defaultRequestTimeoutMs: 10_000, closeGracePeriodMs: 1_000,
  });
  const events: Array<Record<string, unknown>> = [];
  let settle!: () => void; const settled = new Promise<void>((resolve) => { settle = resolve; });
  rpc.on("notification", (value) => { if (value && typeof value === "object") { const event = value as Record<string, unknown>; events.push(event); if (event.type === "agent_settled") settle(); } });
  try {
    await rpc.start(); await rpc.request({ id: `prompt-${mode}`, method: "prompt", params: { message: "attempt fixture write" } });
    await Promise.race([settled, Bun.sleep(10_000).then(() => { throw new Error("real Pi did not settle"); })]);
    return { root, events, outputExists: existsSync(join(root, "policy-output.txt")) };
  } finally { await rpc.close(); }
}

describe("M8 real Pi host policy extension", () => {
  test("read-only blocks write before execution while full mode permits it", async () => {
    const blocked = await run("read_only");
    expect(blocked.outputExists).toBe(false);
    expect(blocked.events.some((event) => event.type === "tool_execution_end" && event.isError === true)).toBe(true);
    expect(JSON.stringify(blocked.events)).toContain("guardrail");

    const allowed = await run("full");
    expect(allowed.outputExists).toBe(true);
    expect(allowed.events.some((event) => event.type === "tool_execution_end" && event.isError === false)).toBe(true);
  }, 30_000);
});
