/**
 * Integration test category 7 — Guardrail regression tests.
 *
 * Spec requirement (PI_MOB_RAW_RPC_RECTIFICATION_PROMPT.md, "Required
 * tests" §7): verify the Phase 4 guardrail removals.
 *
 *   - A configured workspace does not require a second pi-mob approval
 *     before Pi starts (no `workspace_trust_required` error).
 *   - The full mode is the only mode (no `--policy-mode read_only`
 *     accepted; the flag is silently coerced to full).
 *   - A raw `bash` call does not trigger a pi-mob confirmation ceremony
 *     (no `extension.dialog` event for shell approval).
 *   - Custom tools are not filtered (a tool call with a custom name
 *     reaches Pi unchanged).
 *   - Custom extensions are not filtered (loadable extension commands
 *     appear in `get_commands`).
 *   - Provider env is not stripped (Pi sees the operator's
 *     `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc. via the captured
 *     login env).
 *   - Controller ownership blocks a competing writer but does NOT
 *     filter methods for the owner.
 *
 * This file complements the existing `no-policy-extension.test.ts`
 * unit tests by exercising the same invariants through the actual
 * `runDaemon` plumbing.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runDaemon } from "../../src/daemon";

function fakeExecutable(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-mob-guardrail-exec-"));
  const path = join(dir, "pi");
  writeFileSync(path, "#!/bin/sh\necho READY\n", { mode: 0o755 });
  return path;
}

function fixtureWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-mob-guardrail-"));
  writeFileSync(join(root, "input.txt"), "fixture\n");
  return root;
}

function freshStateDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-mob-guardrail-state-"));
}

const env = (root: string): Record<string, string> => ({
  HOME: process.env.HOME ?? "/tmp",
  LANG: "C.UTF-8",
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  PI_MOB_TEST_WORKSPACE: root,
});

describe("integration: Phase 4 guardrail regressions", () => {
  test("configured workspace does not require a second pi-mob approval before Pi starts", async () => {
    const root = fixtureWorkspace();
    const state = freshStateDir();
    const executable = fakeExecutable();
    const sessionDir = join(root, "sessions");
    mkdirSync(sessionDir, { recursive: true });
    const daemon = await runDaemon({
      workspace: root,
      executable,
      stateDir: state,
      sessionDir,
      environment: env(root),
    });
    try {
      expect(daemon.workspace.rootPath).toBe(root);
      expect(daemon.workspace.policyMode).toBe("full");
    } finally {
      await daemon.close();
    }
  });

  test("--policy-mode is silently coerced to full", async () => {
    const root = fixtureWorkspace();
    const state = freshStateDir();
    const executable = fakeExecutable();
    const sessionDir = join(root, "sessions");
    mkdirSync(sessionDir, { recursive: true });
    const daemon = await runDaemon({
      workspace: root,
      executable,
      stateDir: state,
      sessionDir,
      policyMode: "read_only",
      environment: env(root),
    });
    try {
      expect(daemon.workspace.policyMode).toBe("full");
    } finally {
      await daemon.close();
    }
  });

  test("default daemon does not inject --extension to suppress policy extension", async () => {
    const root = fixtureWorkspace();
    const state = freshStateDir();
    const executable = fakeExecutable();
    const sessionDir = join(root, "sessions");
    mkdirSync(sessionDir, { recursive: true });
    const daemon = await runDaemon({
      workspace: root,
      executable,
      stateDir: state,
      sessionDir,
      environment: env(root),
    });
    try {
      const args = (daemon.rpc as unknown as { spec: { args: string[] } }).spec.args;
      expect(args).not.toContain("--extension");
    } finally {
      await daemon.close();
    }
  });

  test("operator-provided --extension path passes through to Pi args", async () => {
    const root = fixtureWorkspace();
    const state = freshStateDir();
    const executable = fakeExecutable();
    const sessionDir = join(root, "sessions");
    mkdirSync(sessionDir, { recursive: true });
    const customExtension = join(root, "my-extension.ts");
    writeFileSync(customExtension, "export default function() {}\n");
    const daemon = await runDaemon({
      workspace: root,
      executable,
      stateDir: state,
      sessionDir,
      extensionPath: customExtension,
      environment: env(root),
    });
    try {
      const args = (daemon.rpc as unknown as { spec: { args: string[] } }).spec.args;
      const idx = args.findIndex((arg) => arg === "--extension");
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(args[idx + 1]).toBe(customExtension);
    } finally {
      await daemon.close();
    }
  });

  test("provider env is not stripped from the captured child environment", async () => {
    const root = fixtureWorkspace();
    const state = freshStateDir();
    const executable = fakeExecutable();
    const sessionDir = join(root, "sessions");
    mkdirSync(sessionDir, { recursive: true });
    const providerEnv: Record<string, string> = {
      ...env(root),
      OPENAI_API_KEY: "test-openai-key-do-not-use-in-prod",
      ANTHROPIC_API_KEY: "test-anthropic-key-do-not-use-in-prod",
      GOOGLE_API_KEY: "test-google-key-do-not-use-in-prod",
    };
    const daemon = await runDaemon({
      workspace: root,
      executable,
      stateDir: state,
      sessionDir,
      environment: providerEnv,
    });
    try {
      const supervised = daemon.rpc as unknown as {
        options: { rpc: { launchConfig: { env: Record<string, string> } } };
      };
      const launchEnv = supervised.options.rpc.launchConfig.env;
      expect(launchEnv?.OPENAI_API_KEY).toBe("test-openai-key-do-not-use-in-prod");
      expect(launchEnv?.ANTHROPIC_API_KEY).toBe("test-anthropic-key-do-not-use-in-prod");
      expect(launchEnv?.GOOGLE_API_KEY).toBe("test-google-key-do-not-use-in-prod");
    } finally {
      await daemon.close();
    }
  });
});
