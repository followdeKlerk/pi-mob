/**
 * Integration test category 6 — Unknown method and event behavior.
 *
 * Spec requirement (PI_MOB_RAW_RPC_RECTIFICATION_PROMPT.md, "Required
 * tests" §6):
 *   - A command with an unrecognized `type` must reach the fake Pi
 *     RPC and return Pi's own error.
 *   - The bridge must not reject it because of a local allowlist.
 *   - An unknown upstream event must reach the mobile/raw protocol
 *     unchanged.
 *   - The normalized UI path may ignore it, but the raw path may not.
 *
 * The bridge's raw RPC dispatcher does not maintain a method
 * allowlist (Phase 4 removed `@pi-mob/pi-extension` and the legacy
 * `commands.ts` allowlist). It forwards the entire `command` payload
 * to the underlying `PiRpcClient.request()` and records whatever the
 * upstream returns. The normalize pipeline emits a `pi.rpc.event`
 * envelope for any unknown upstream event so the raw channel
 * preserves the original shape.
 */

import { describe, expect, test } from "bun:test";
import { createWorkspace, spawnBridgeAdapter, spawnBridgePi, spawnDirectPi } from "./harness";
import { normalizePiEvent } from "../../src/pi/normalize";

describe("integration: unknown method / event behavior", () => {
  test("library: bridge forwards unknown method type and returns Pi's own error", async () => {
    const ws = createWorkspace("pi-mob-unknown-method-");
    const sessionId = "44444444-4444-4444-8444-444444444444";
    const upstreamError = {
      success: false,
      command: "future_pi_method_xyz",
      error: "Unknown command: future_pi_method_xyz",
    };
    const handle = await spawnBridgeAdapter({
      workspace: ws,
      responder: () => upstreamError,
    });
    try {
      handle.store.ensureSession(sessionId, { runtimeState: "idle" });
      handle.store.ensureStream(`session:${sessionId}`, "session", sessionId);
      handle.fake.requests.length = 0;
      await handle.adapter.dispatch({
        commandId: "cmd-unknown-1",
        type: "pi.rpc.request",
        scopeKey: `session:${sessionId}`,
        streamId: `session:${sessionId}`,
        semanticHash: "h",
        state: "running",
        dispatchCount: 1,
        payload: {
          sessionId,
          requestId: "unknown-1",
          command: { type: "future_pi_method_xyz", payload: "anything" },
        },
      } as any);
      expect(handle.fake.requests).toHaveLength(1);
      expect(handle.fake.requests[0]!.method).toBe("future_pi_method_xyz");
      expect(handle.fake.requests[0]!.params).toEqual({
        type: "future_pi_method_xyz",
        payload: "anything",
      });
      const events = handle.store.listEvents(`session:${sessionId}`);
      const response = events.find((e) => e.type === "pi.rpc.response");
      expect(response).toBeDefined();
      expect((response as any).payload.response).toEqual(upstreamError);
    } finally {
      await handle.close();
    }
  });

  test("library: bridge forwards an unknown method that Pi resolves with data", async () => {
    const ws = createWorkspace("pi-mob-unknown-ok-");
    const sessionId = "55555555-5555-4555-8555-555555555555";
    const upstream = {
      success: true,
      command: "future_pi_method_xyz",
      data: { whatever: true },
    };
    const handle = await spawnBridgeAdapter({
      workspace: ws,
      responder: () => upstream,
    });
    try {
      handle.store.ensureSession(sessionId, { runtimeState: "idle" });
      handle.store.ensureStream(`session:${sessionId}`, "session", sessionId);
      await handle.adapter.dispatch({
        commandId: "cmd-unknown-2",
        type: "pi.rpc.request",
        scopeKey: `session:${sessionId}`,
        streamId: `session:${sessionId}`,
        semanticHash: "h",
        state: "running",
        dispatchCount: 1,
        payload: {
          sessionId,
          requestId: "unknown-2",
          command: { type: "future_pi_method_xyz" },
        },
      } as any);
      const events = handle.store.listEvents(`session:${sessionId}`);
      const response = events.find((e) => e.type === "pi.rpc.response");
      expect(response).toBeDefined();
      expect((response as any).payload.response).toEqual(upstream);
    } finally {
      await handle.close();
    }
  });

  test("normalize: unknown upstream event emits a pi.rpc.event envelope verbatim", () => {
    const sessionId = "66666666-6666-4666-8666-666666666666";
    const raw = {
      type: "some_future_event",
      data: { value: 42 },
      nested: { ok: true },
    };
    const normalized = normalizePiEvent(raw, { sessionId });
    expect(normalized).toEqual([
      { type: "pi.rpc.event", payload: { sessionId, event: raw } },
    ]);
  });

  test("real subprocess: direct Pi returns error for unknown command (parity sanity)", async () => {
    const ws = createWorkspace("pi-mob-unknown-real-direct-");
    const direct = await spawnDirectPi({
      cwd: ws,
      env: { HOME: process.env.HOME ?? "/tmp", LANG: "C.UTF-8", PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
    try {
      const result = await direct.request("u-1", "future_pi_method_xyz", undefined, 10_000);
      expect(result.success).toBe(false);
      expect(typeof result.error).toBe("string");
      expect(result.error).toMatch(/Unknown command/i);
    } finally {
      await direct.close();
    }
  }, 30_000);

  test("real subprocess: bridge Pi surfaces failure for unknown command (parity sanity)", async () => {
    const ws = createWorkspace("pi-mob-unknown-real-bridge-");
    const bridge = await spawnBridgePi({
      cwd: ws,
      env: { HOME: process.env.HOME ?? "/tmp", LANG: "C.UTF-8", PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
    try {
      const result = await bridge.request("u-2", "future_pi_method_xyz", undefined, 10_000);
      expect(result.success).toBe(false);
      expect(typeof result.error).toBe("string");
    } finally {
      await bridge.close();
    }
  }, 30_000);
});
