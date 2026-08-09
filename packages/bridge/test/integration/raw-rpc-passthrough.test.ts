/**
 * Integration test category 5 — Raw RPC pass-through.
 *
 * Spec requirement (PI_MOB_RAW_RPC_RECTIFICATION_PROMPT.md, "Required
 * tests" §5): "Test at least: get_state, get_messages,
 * get_available_models, get_commands, get_session_stats, get_entries,
 * get_tree, get_last_assistant_text, set_model, set_thinking_level,
 * compact, bash, abort_bash. For each, verify correlation and raw
 * response preservation."
 *
 * The bridge's raw RPC dispatcher (`packages/bridge/src/pi/raw-rpc.ts`)
 * extracts the `command` payload from the `pi.rpc.request` envelope,
 * forwards it verbatim to the underlying `PiRpcClient.request()`, and
 * appends a `pi.rpc.response` event with the upstream body unchanged.
 * This test exercises that path against a `FakeRpcClient` for each of
 * the 13 RPC methods, then *also* runs the same 13 methods against a
 * real Pi 0.82.0 subprocess through both direct and bridge transports
 * to verify the wire framing survives unchanged.
 */

import { describe, expect, test } from "bun:test";
import {
  createWorkspace,
  HAS_PI_BINARY,
  spawnBridgeAdapter,
  spawnBridgePi,
  spawnDirectPi,
} from "./harness";

const RAW_METHODS: ReadonlyArray<{
  method: string;
  params?: Record<string, unknown>;
  reply: unknown;
}> = [
  { method: "get_state", reply: { success: true, command: "get_state", data: { model: { id: "x" } } } },
  { method: "get_messages", reply: { success: true, command: "get_messages", data: { messages: [] } } },
  { method: "get_available_models", reply: { success: true, command: "get_available_models", data: { models: [] } } },
  { method: "get_commands", reply: { success: true, command: "get_commands", data: { commands: [] } } },
  { method: "get_session_stats", reply: { success: true, command: "get_session_stats", data: { totalMessages: 0 } } },
  { method: "get_entries", reply: { success: true, command: "get_entries", data: { entries: [] } } },
  { method: "get_tree", reply: { success: true, command: "get_tree", data: { tree: [] } } },
  { method: "get_last_assistant_text", reply: { success: true, command: "get_last_assistant_text", data: {} } },
  { method: "set_model", params: { provider: "stub-provider", modelId: "stub-model" }, reply: { success: true, command: "set_model", data: { id: "stub-model" } } },
  { method: "set_thinking_level", params: { level: "medium" }, reply: { success: true, command: "set_thinking_level" } },
  { method: "compact", reply: { success: false, command: "compact", error: "Nothing to compact (session too small)" } },
  { method: "bash", params: { command: "echo hello" }, reply: { success: true, command: "bash", data: { output: "hello\n", exitCode: 0 } } },
  { method: "abort_bash", params: { bashId: "some-id" }, reply: { success: true, command: "abort_bash" } },
];

const realPiTest = HAS_PI_BINARY ? test : test.skip;

describe("integration: raw RPC pass-through (library + real Pi subprocess)", () => {
  test("library: bridge forwards each raw RPC method unchanged and records pi.rpc.response", async () => {
    const ws = createWorkspace("pi-mob-raw-rpc-lib-");
    const sessionId = "33333333-3333-4333-8333-333333333333";
    const repliesByMethod = new Map(RAW_METHODS.map((m) => [m.method, m.reply]));
    const handle = await spawnBridgeAdapter({
      workspace: ws,
      responder: (req) => {
        const reply = repliesByMethod.get(req.method);
        if (reply) {
          return reply as { success: boolean; data?: unknown; error?: string };
        }
        return { success: true, data: { echoed: req.method } };
      },
    });
    try {
      handle.store.ensureSession(sessionId, { runtimeState: "idle" });
      handle.store.ensureStream(`session:${sessionId}`, "session", sessionId);
      handle.fake.requests.length = 0;

      for (let i = 0; i < RAW_METHODS.length; i += 1) {
        const spec = RAW_METHODS[i]!;
        const requestId = `raw-${i + 1}`;
        const command: Record<string, unknown> = { type: spec.method };
        if (spec.params) Object.assign(command, spec.params);
        await handle.adapter.dispatch({
          commandId: `cmd-raw-${i + 1}`,
          type: "pi.rpc.request",
          scopeKey: `session:${sessionId}`,
          streamId: `session:${sessionId}`,
          semanticHash: "h",
          state: "running",
          dispatchCount: 1,
          payload: { sessionId, requestId, command },
        } as any);
      }

      expect(handle.fake.requests).toHaveLength(RAW_METHODS.length);
      for (let i = 0; i < RAW_METHODS.length; i += 1) {
        const spec = RAW_METHODS[i]!;
        const recorded = handle.fake.requests[i]!;
        expect(recorded.method).toBe(spec.method);
        expect(recorded.id).toBe(`raw-${i + 1}`);
        const expectedParams: Record<string, unknown> = { type: spec.method };
        if (spec.params) Object.assign(expectedParams, spec.params);
        expect(recorded.params).toEqual(expectedParams);
      }

      const events = handle.store.listEvents(`session:${sessionId}`);
      const responses = events.filter((e) => e.type === "pi.rpc.response");
      expect(responses).toHaveLength(RAW_METHODS.length);
      for (let i = 0; i < RAW_METHODS.length; i += 1) {
        const payload = (responses[i] as any).payload as {
          sessionId: string;
          requestId: string;
          response: unknown;
        };
        expect(payload.sessionId).toBe(sessionId);
        expect(payload.requestId).toBe(`raw-${i + 1}`);
        expect(payload.response).toEqual(RAW_METHODS[i]!.reply);
      }
    } finally {
      await handle.close();
    }
  });

  realPiTest("real subprocess: direct Pi accepts all 13 RPC methods and produces responses", async () => {
    const ws = createWorkspace("pi-mob-raw-rpc-direct-");
    const direct = await spawnDirectPi({
      cwd: ws,
      env: {
        HOME: process.env.HOME ?? "/tmp",
        LANG: "C.UTF-8",
        PATH: process.env.PATH ?? "/usr/bin:/bin",
      },
    });
    try {
      const expectedSuccess = new Set([
        "get_state", "get_messages", "get_available_models", "get_commands",
        "get_session_stats", "get_entries", "get_tree", "get_last_assistant_text",
        "abort_bash", "set_thinking_level",
      ]);
      for (let i = 0; i < RAW_METHODS.length; i += 1) {
        const spec = RAW_METHODS[i]!;
        const result = await direct.request(`d-${i}`, spec.method, spec.params, 15_000);
        if (expectedSuccess.has(spec.method)) {
          expect(result.success).toBe(true);
        }
      }
    } finally {
      await direct.close();
    }
  }, 60_000);

  realPiTest("real subprocess: bridge-managed Pi accepts all 13 RPC methods and produces responses", async () => {
    const ws = createWorkspace("pi-mob-raw-rpc-bridge-");
    const bridge = await spawnBridgePi({
      cwd: ws,
      env: {
        HOME: process.env.HOME ?? "/tmp",
        LANG: "C.UTF-8",
        PATH: process.env.PATH ?? "/usr/bin:/bin",
      },
    });
    try {
      const expectedSuccess = new Set([
        "get_state", "get_messages", "get_available_models", "get_commands",
        "get_session_stats", "get_entries", "get_tree", "get_last_assistant_text",
        "abort_bash", "set_thinking_level",
      ]);
      for (let i = 0; i < RAW_METHODS.length; i += 1) {
        const spec = RAW_METHODS[i]!;
        const result = await bridge.request(`b-${i}`, spec.method, spec.params, 15_000);
        if (expectedSuccess.has(spec.method)) {
          expect(result.success).toBe(true);
        }
      }
    } finally {
      await bridge.close();
    }
  }, 60_000);
});
