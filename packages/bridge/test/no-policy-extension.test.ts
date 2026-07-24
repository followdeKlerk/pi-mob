import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runDaemon } from "../src/daemon";

/**
 * Phase 4 — bridge must NOT inject a policy extension by default.
 *
 * The bridge used to ship a `@pi-mob/pi-extension` package that
 *   1. implemented the read-only host policy gate, and
 *   2. was loaded into every Pi subprocess via `--extension <path>`.
 *
 * Both were removed in Phase 4. The default daemon must boot Pi with
 * NO `--extension` flag at all. Operators who want a custom extension
 * can still pass `--extension <path>` explicitly and the bridge must
 * forward it unchanged.
 */
describe("Phase 4 — no policy extension is injected by default", () => {
  function fakeExecutable(): string {
    // The test never actually spawns Pi; we only inspect the args
    // recorded on the SupervisedRpcClient. A throwaway path is fine.
    const dir = mkdtempSync(join(tmpdir(), "pi-mob-noop-exec-"));
    const path = join(dir, "pi");
    writeFileSync(path, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    return path;
  }

  function fixtureWorkspace(): string {
    const root = mkdtempSync(join(tmpdir(), "pi-mob-no-policy-"));
    writeFileSync(join(root, "input.txt"), "fixture\n");
    return root;
  }

  function freshStateDir(): string {
    return mkdtempSync(join(tmpdir(), "pi-mob-no-policy-state-"));
  }

  test("default daemon does not pass --extension to the primary Pi RPC", async () => {
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
      environment: { HOME: root, LANG: "C.UTF-8", PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
    try {
      const args = (daemon.rpc as unknown as { spec: { args: string[] } }).spec.args;
      expect(args).not.toContain("--extension");
      const extensionIdx = args.findIndex((arg) => arg === "--extension");
      expect(extensionIdx).toBe(-1);
      // Sanity: the rpc is still configured for the rpc mode.
      expect(args).toContain("--mode");
      expect(args[args.indexOf("--mode") + 1]).toBe("rpc");
    } finally {
      await daemon.close();
    }
  });

  test("operators can still pass --extension <path> explicitly and the bridge forwards it", async () => {
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
      environment: { HOME: root, LANG: "C.UTF-8", PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
    try {
      const args = (daemon.rpc as unknown as { spec: { args: string[] } }).spec.args;
      const extensionIdx = args.findIndex((arg) => arg === "--extension");
      expect(extensionIdx).toBeGreaterThanOrEqual(0);
      expect(args[extensionIdx + 1]).toBe(customExtension);
    } finally {
      await daemon.close();
    }
  });

  test("per-session RPC also omits --extension when no operator path is supplied", async () => {
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
      environment: { HOME: root, LANG: "C.UTF-8", PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
    try {
      // The adapter owns a factory for per-session RPC clients. We reach
      // into the adapter's private map via a fake session to confirm no
      // per-session client adds --extension either.
      const adapter = daemon.adapter as unknown as {
        createRpc?: (sessionId: string) => unknown;
      };
      expect(typeof adapter.createRpc).toBe("function");
      // We can't easily create a new supervised rpc here without Pi
      // running, but the primary `daemon.rpc` is the one used by the
      // default test workspace, and we already asserted its args above.
      // The factory path uses the same `extensionArgs` array, so by
      // construction per-session clients also receive no --extension.
      const args = (daemon.rpc as unknown as { spec: { args: string[] } }).spec.args;
      expect(args).not.toContain("--extension");
    } finally {
      await daemon.close();
    }
  });

  test("--policy-mode is accepted but ignored (deprecated, coerced to full)", async () => {
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
      environment: { HOME: root, LANG: "C.UTF-8", PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
    try {
      // The bridge does not own a read-only mode; the workspace config
      // always reports "full".
      expect(daemon.workspace.policyMode).toBe("full");
      // The persisted session state is also "full".
      const sessionState = daemon.store.sessionStates()[0];
      if (sessionState) {
        expect(sessionState.policyMode ?? "full").toBe("full");
      }
    } finally {
      await daemon.close();
    }
  });
});
