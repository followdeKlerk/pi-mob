/**
 * Integration test category 3 — Tool PATH parity.
 *
 * Spec requirement (PI_MOB_RAW_RPC_RECTIFICATION_PROMPT.md, "Required
 * tests" §3): place a fake executable in a non-system test directory,
 * verify that direct Pi can resolve it via PATH, that bridge-managed
 * Pi can resolve it via PATH, that Pi's LLM-callable bash tool can
 * execute it, and that a raw RPC `bash` request can execute it.
 *
 * The bridge's `buildChildEnvironment` / `captureLoginEnv` plumbing
 * must pass the operator's augmented PATH through to the Pi subprocess
 * without stripping or reordering it. We test this by writing a fake
 * shell script into a temp `bin/` directory and prepending that path
 * to the `PATH` env we hand to both sides.
 */

import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createWorkspace, spawnBridgePi, spawnDirectPi } from "./harness";

const FAKE_TOOL_OUTPUT = "fake-tool-invoked";

function createFakeToolDir(): string {
  const ws = createWorkspace("pi-mob-path-fake-");
  const bin = join(ws, "bin");
  mkdirSync(bin, { recursive: true });
  const toolPath = join(bin, "fake-tool");
  writeFileSync(toolPath, `#!/bin/sh\necho "${FAKE_TOOL_OUTPUT}"\n`);
  chmodSync(toolPath, 0o755);
  return bin;
}

function envWithFakeTool(binDir: string): Record<string, string> {
  const basePath = process.env.PATH ?? "/usr/bin:/bin";
  return {
    HOME: process.env.HOME ?? "/tmp",
    LANG: "C.UTF-8",
    PATH: `${binDir}:${basePath}`,
  };
}

describe("integration: PATH parity (fake executable reachable on both sides)", () => {
  test("direct Pi can resolve the fake tool via raw RPC bash", async () => {
    const bin = createFakeToolDir();
    const ws = createWorkspace("pi-mob-path-direct-");
    const direct = await spawnDirectPi({ cwd: ws, env: envWithFakeTool(bin) });
    try {
      const result = await direct.request("d-fake", "bash", { command: "fake-tool" }, 15_000);
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(typeof data.output).toBe("string");
      expect((data.output as string).trim()).toBe(FAKE_TOOL_OUTPUT);
    } finally {
      await direct.close();
    }
  }, 30_000);

  test("bridge-managed Pi can resolve the fake tool via raw RPC bash", async () => {
    const bin = createFakeToolDir();
    const ws = createWorkspace("pi-mob-path-bridge-");
    const bridge = await spawnBridgePi({ cwd: ws, env: envWithFakeTool(bin) });
    try {
      const result = await bridge.request("b-fake", "bash", { command: "fake-tool" }, 15_000);
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(typeof data.output).toBe("string");
      expect((data.output as string).trim()).toBe(FAKE_TOOL_OUTPUT);
    } finally {
      await bridge.close();
    }
  }, 30_000);

  test("direct and bridge Pi see the same PATH for the fake tool", async () => {
    const bin = createFakeToolDir();
    const ws = createWorkspace("pi-mob-path-comparison-");
    const direct = await spawnDirectPi({ cwd: ws, env: envWithFakeTool(bin) });
    const bridge = await spawnBridgePi({ cwd: ws, env: envWithFakeTool(bin) });
    try {
      const [a, b] = await Promise.all([
        direct.request("d-x", "bash", { command: "fake-tool" }, 15_000),
        bridge.request("b-x", "bash", { command: "fake-tool" }, 15_000),
      ]);
      expect(a.success).toBe(true);
      expect(b.success).toBe(true);
      const aOut = ((a.data as { output?: unknown }).output ?? "") as string;
      const bOut = ((b.data as { output?: unknown }).output ?? "") as string;
      expect(aOut.trim()).toBe(FAKE_TOOL_OUTPUT);
      expect(bOut.trim()).toBe(FAKE_TOOL_OUTPUT);
    } finally {
      await direct.close();
      await bridge.close();
    }
  }, 30_000);

  test("fake tool resolves via absolute path on the bridge side (parity sanity)", async () => {
    const bin = createFakeToolDir();
    const ws = createWorkspace("pi-mob-path-abs-");
    const bridge = await spawnBridgePi({ cwd: ws, env: envWithFakeTool(bin) });
    try {
      const absolutePath = join(bin, "fake-tool");
      const result = await bridge.request("b-abs", "bash", { command: absolutePath }, 15_000);
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect((data.output as string).trim()).toBe(FAKE_TOOL_OUTPUT);
    } finally {
      await bridge.close();
    }
  }, 30_000);
});
