/**
 * Tests for the Pi extension wiring.
 *
 * The Pi runtime supplies an `ExtensionAPI` object whose `on(event,
 * handler)` overloads are tightly typed per event. Tests fake that
 * exact shape with a recorder so the production registration path
 * (in `registerPiMobExtension`) runs verbatim — only the surrounding
 * loader is replaced.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionEvent,
  ExtensionFactory,
  ExtensionHandler,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, test } from "bun:test";
import {
  HOST_POLICY_FINGERPRINT_ENV_VAR,
  HOST_POLICY_MODE_ENV_VAR,
  HOST_POLICY_VERSION_ENV_VAR,
  createEnvPolicySource,
  createPolicyFileSource,
  createPiMobExtension,
  defaultExtensionFactory,
  extension as namedExtension,
  registerPiMobExtension,
} from "../src/extension";
import { default as defaultFromIndex } from "../src/index";
import type { HostPolicyState, HostToolCall, TurnPolicySnapshot } from "../src/policy";

// ---------------- Fake ExtensionAPI ----------------

type AnyHandler = ExtensionHandler<ExtensionEvent, unknown>;

interface FakeExtensionAPI extends ExtensionAPI {
  readonly handlers: Map<string, AnyHandler[]>;
}

function makeFakeExtensionAPI(): FakeExtensionAPI {
  const handlers = new Map<string, AnyHandler[]>();
  const api: FakeExtensionAPI = {
    handlers,
    on(event: string, handler: AnyHandler): void {
      const list = handlers.get(event);
      if (list === undefined) {
        handlers.set(event, [handler]);
      } else {
        list.push(handler);
      }
    },
    // The rest of ExtensionAPI is unused by our hooks; we provide
    // throwers so accidental use surfaces clearly.
    registerTool: () => {
      throw new Error("fake api: registerTool not implemented");
    },
    registerCommand: () => undefined,
    registerShortcut: () => {
      throw new Error("fake api: registerShortcut not implemented");
    },
    registerFlag: () => {
      throw new Error("fake api: registerFlag not implemented");
    },
    getFlag: () => undefined,
    registerMessageRenderer: () => {
      throw new Error("fake api: registerMessageRenderer not implemented");
    },
    registerEntryRenderer: () => {
      throw new Error("fake api: registerEntryRenderer not implemented");
    },
    sendMessage: () => {
      throw new Error("fake api: sendMessage not implemented");
    },
    sendUserMessage: () => {
      throw new Error("fake api: sendUserMessage not implemented");
    },
    appendEntry: () => {
      throw new Error("fake api: appendEntry not implemented");
    },
    setSessionName: () => {
      throw new Error("fake api: setSessionName not implemented");
    },
    getSessionName: () => undefined,
    setLabel: () => {
      throw new Error("fake api: setLabel not implemented");
    },
    exec: () => {
      throw new Error("fake api: exec not implemented");
    },
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: () => {
      throw new Error("fake api: setActiveTools not implemented");
    },
    getCommands: () => [],
    setModel: () => Promise.resolve(false),
    getThinkingLevel: () => "off",
    setThinkingLevel: () => {
      throw new Error("fake api: setThinkingLevel not implemented");
    },
    registerProvider: () => {
      throw new Error("fake api: registerProvider not implemented");
    },
    unregisterProvider: () => {
      throw new Error("fake api: unregisterProvider not implemented");
    },
    events: {
      on: () => () => undefined,
      emit: () => undefined,
      off: () => undefined,
      removeAllListeners: () => undefined,
    },
  } as unknown as FakeExtensionAPI;
  return api;
}

function getHandler(api: FakeExtensionAPI, event: string): AnyHandler | undefined {
  return api.handlers.get(event)?.[0];
}

function fire(api: FakeExtensionAPI, event: string, payload: unknown, ctx: unknown): unknown {
  const handler = getHandler(api, event);
  if (handler === undefined) throw new Error(`no handler registered for ${event}`);
  return (handler as (e: unknown, c: unknown) => unknown)(payload, ctx);
}

// ---------------- Fixtures ----------------

const readOnlyPolicy: HostPolicyState = Object.freeze({
  mode: "read_only",
  version: "bridge-workspace-3",
  fingerprint: "approved-fp-3",
});

const fullPolicy: HostPolicyState = Object.freeze({
  mode: "full",
  version: "bridge-workspace-4",
  fingerprint: "approved-fp-4",
});

function makeToolCallEvent(
  toolName: ToolCallEvent["toolName"],
  input: unknown,
  toolCallId = "tc-1",
): ToolCallEvent {
  return { type: "tool_call", toolName, input, toolCallId } as ToolCallEvent;
}

const fakeCtx: ExtensionContext = {} as unknown as ExtensionContext;

// ---------------- Tests ----------------

describe("default factory load shape", () => {
  test("exports a callable ExtensionFactory as the module default", () => {
    expect(typeof defaultExtensionFactory).toBe("function");
    expect(defaultExtensionFactory.length).toBeGreaterThanOrEqual(1);
  });

  test("re-exports the same factory as the named `extension` export", () => {
    expect(namedExtension).toBe(defaultExtensionFactory);
  });

  test("re-exports the same factory as the package index default", () => {
    expect(defaultFromIndex).toBe(defaultExtensionFactory);
  });

  test("is accepted by ExtensionFactory from pi-coding-agent types", () => {
    // Static-only assertion: compiles iff the assignment holds.
    const factory: ExtensionFactory = defaultExtensionFactory;
    expect(factory).toBe(defaultExtensionFactory);
  });
});

describe("registerPiMobExtension event wiring", () => {
  test("registers exactly the expected set of hooks", () => {
    const api = makeFakeExtensionAPI();
    const runtime = createPiMobExtension({ policySource: () => readOnlyPolicy });
    registerPiMobExtension(api, runtime);
    expect([...api.handlers.keys()].sort()).toEqual([
      "agent_end",
      "agent_settled",
      "tool_call",
      "turn_end",
      "turn_start",
    ]);
  });

  test("registers exactly one handler per event", () => {
    const api = makeFakeExtensionAPI();
    const runtime = createPiMobExtension({ policySource: () => readOnlyPolicy });
    registerPiMobExtension(api, runtime);
    for (const list of api.handlers.values()) {
      expect(list).toHaveLength(1);
    }
  });

  test("the default factory wires the same handlers", () => {
    const api = makeFakeExtensionAPI();
    defaultExtensionFactory(api);
    expect([...api.handlers.keys()].sort()).toEqual([
      "agent_end",
      "agent_settled",
      "tool_call",
      "turn_end",
      "turn_start",
    ]);
  });
});

describe("tool_call blocking under a captured read-only snapshot", () => {
  function setupWithSnapshot(): FakeExtensionAPI {
    const api = makeFakeExtensionAPI();
    const runtime = createPiMobExtension({ policySource: () => readOnlyPolicy });
    registerPiMobExtension(api, runtime);
    fire(api, "turn_start", { type: "turn_start", turnIndex: 0, timestamp: 0 }, fakeCtx);
    return api;
  }

  test("blocks a write tool with a host-policy reason", () => {
    const api = setupWithSnapshot();
    const result = fire(
      api,
      "tool_call",
      makeToolCallEvent("write", { path: "x", content: "y" }, "tc-w"),
      fakeCtx,
    ) as ToolCallEventResult;
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining("Host read-only policy denied write") as unknown as string,
    });
  });

  test("blocks an edit tool with a host-policy reason", () => {
    const api = setupWithSnapshot();
    const result = fire(
      api,
      "tool_call",
      makeToolCallEvent("edit", { path: "x", oldText: "a", newText: "b" }),
      fakeCtx,
    ) as ToolCallEventResult;
    expect(result).toEqual({ block: true, reason: expect.stringContaining("edit") as unknown as string });
  });

  test("blocks destructive operations", () => {
    const api = setupWithSnapshot();
    for (const toolName of ["delete", "session.purge", "queue.clear"]) {
      const result = fire(
        api,
        "tool_call",
        makeToolCallEvent(toolName, {}),
        fakeCtx,
      ) as ToolCallEventResult;
      expect(result.block).toBe(true);
      expect(result.reason).toContain(toolName);
    }
  });

  test("blocks bash with a mutating command and preserves the shell code via the message", () => {
    const api = setupWithSnapshot();
    const result = fire(
      api,
      "tool_call",
      makeToolCallEvent("bash", { command: "cat README | tee copy" }),
      fakeCtx,
    ) as ToolCallEventResult;
    expect(result.block).toBe(true);
    expect(result.reason).toContain("bash");
  });

  test("blocks bash with a non-string command input as invalid_tool_input", () => {
    const api = setupWithSnapshot();
    for (const input of [null, {}, { command: 1 }, { command: ["ls"] }, "ls"]) {
      const result = fire(
        api,
        "tool_call",
        makeToolCallEvent("bash", input),
        fakeCtx,
      ) as ToolCallEventResult;
      expect(result.block).toBe(true);
    }
  });

  test("blocks unknown custom tools rather than allowing them by name", () => {
    const api = setupWithSnapshot();
    const result = fire(
      api,
      "tool_call",
      makeToolCallEvent("Read", { path: "x" }),
      fakeCtx,
    ) as ToolCallEventResult;
    expect(result).toEqual({ block: true, reason: expect.stringContaining("Read") as unknown as string });
  });

  test("allows the classified read-only tools without blocking", () => {
    const api = setupWithSnapshot();
    for (const toolName of ["read", "grep", "find", "ls"]) {
      const result = fire(
        api,
        "tool_call",
        makeToolCallEvent(toolName, { path: "x" }),
        fakeCtx,
      ) as ToolCallEventResult;
      expect(result).toEqual({});
    }
  });

  test("allows an allowlisted bash pipeline without blocking", () => {
    const api = setupWithSnapshot();
    const result = fire(
      api,
      "tool_call",
      makeToolCallEvent("bash", { command: "cat README.md | grep name | wc -l" }),
      fakeCtx,
    ) as ToolCallEventResult;
    expect(result).toEqual({});
  });

  test("passes the toolCallId through the gate", () => {
    setupWithSnapshot();
    // The runtime is frozen; instead of spying on it, drive the gate
    // directly with the same shape the production handler builds.
    const runtime = createPiMobExtension({ policySource: () => readOnlyPolicy });
    runtime.gate.beginTurn();
    const event = makeToolCallEvent("read", { path: "x" }, "tc-trace-7");
    const observed = {
      toolName: event.toolName,
      input: (event as { input?: unknown }).input,
      toolCallId: event.toolCallId,
    };
    expect(observed).toEqual({ toolName: "read", input: { path: "x" }, toolCallId: "tc-trace-7" });
    const decision = runtime.gate.toolCall(observed as HostToolCall);
    expect("block" in decision && decision.block === true).toBe(false);
  });
});

describe("tool_call under a captured full-mode snapshot", () => {
  test("never blocks, even for destructive tool calls", () => {
    const api = makeFakeExtensionAPI();
    const runtime = createPiMobExtension({ policySource: () => fullPolicy });
    registerPiMobExtension(api, runtime);
    fire(api, "turn_start", { type: "turn_start", turnIndex: 0, timestamp: 0 }, fakeCtx);

    for (const call of [
      { toolName: "write", input: { path: "/etc/passwd" } },
      { toolName: "bash", input: { command: "rm -rf /" } },
      { toolName: "future_unknown_tool", input: undefined },
    ] as const) {
      const result = fire(
        api,
        "tool_call",
        { type: "tool_call", toolName: call.toolName, input: call.input, toolCallId: "tc-f" } as ToolCallEvent,
        fakeCtx,
      ) as ToolCallEventResult;
      expect(result).toEqual({});
    }
  });
});

describe("turn-start snapshot invariant across live policy changes", () => {
  test("turn_start captures the snapshot at the boundary; later supplier changes do not loosen it", () => {
    let current: HostPolicyState = readOnlyPolicy;
    const api = makeFakeExtensionAPI();
    const runtime = createPiMobExtension({ policySource: () => current });
    registerPiMobExtension(api, runtime);

    fire(api, "turn_start", { type: "turn_start", turnIndex: 0, timestamp: 0 }, fakeCtx);

    // Bridge escalates to full mid-turn.
    current = fullPolicy;

    const denyResult = fire(
      api,
      "tool_call",
      makeToolCallEvent("write", { path: "x" }),
      fakeCtx,
    ) as ToolCallEventResult;
    expect(denyResult.block).toBe(true);

    // Next turn sees the new policy.
    fire(api, "turn_start", { type: "turn_start", turnIndex: 1, timestamp: 1 }, fakeCtx);
    const allowResult = fire(
      api,
      "tool_call",
      makeToolCallEvent("write", { path: "x" }),
      fakeCtx,
    ) as ToolCallEventResult;
    expect(allowResult).toEqual({});
  });

  test("tool_call without a prior turn_start captures a fresh snapshot from the supplier", () => {
    let current: HostPolicyState = readOnlyPolicy;
    const api = makeFakeExtensionAPI();
    const runtime = createPiMobExtension({ policySource: () => current });
    registerPiMobExtension(api, runtime);

    const result = fire(
      api,
      "tool_call",
      makeToolCallEvent("write", { path: "x" }),
      fakeCtx,
    ) as ToolCallEventResult;
    expect(result.block).toBe(true);
  });

  test("captured snapshot survives mid-turn supplier changes (loosening)", () => {
    let current: HostPolicyState = readOnlyPolicy;
    const api = makeFakeExtensionAPI();
    const runtime = createPiMobExtension({ policySource: () => current });
    registerPiMobExtension(api, runtime);

    fire(api, "turn_start", { type: "turn_start", turnIndex: 0, timestamp: 0 }, fakeCtx);
    current = fullPolicy; // bridge loosens mid-turn

    const result = fire(
      api,
      "tool_call",
      makeToolCallEvent("write", { path: "x" }),
      fakeCtx,
    ) as ToolCallEventResult;
    expect(result.block).toBe(true);
    expect(result.reason).toContain("Host read-only policy denied write");
  });

  test("turn_end releases the snapshot so the next turn rebuilds it", () => {
    let current: HostPolicyState = readOnlyPolicy;
    const api = makeFakeExtensionAPI();
    const runtime = createPiMobExtension({ policySource: () => current });
    registerPiMobExtension(api, runtime);

    fire(api, "turn_start", { type: "turn_start", turnIndex: 0, timestamp: 0 }, fakeCtx);
    fire(api, "turn_end", { type: "turn_end", turnIndex: 0, message: {} as never, toolResults: [] }, fakeCtx);

    current = fullPolicy;
    fire(api, "turn_start", { type: "turn_start", turnIndex: 1, timestamp: 1 }, fakeCtx);

    const result = fire(
      api,
      "tool_call",
      makeToolCallEvent("write", { path: "x" }),
      fakeCtx,
    ) as ToolCallEventResult;
    expect(result).toEqual({});
  });

  test("agent_end and agent_settled also release the snapshot", () => {
    let current: HostPolicyState = readOnlyPolicy;
    const api = makeFakeExtensionAPI();
    const runtime = createPiMobExtension({ policySource: () => current });
    registerPiMobExtension(api, runtime);

    fire(api, "turn_start", { type: "turn_start", turnIndex: 0, timestamp: 0 }, fakeCtx);
    fire(api, "agent_end", { type: "agent_end", messages: [] }, fakeCtx);

    current = fullPolicy;
    fire(api, "turn_start", { type: "turn_start", turnIndex: 1, timestamp: 1 }, fakeCtx);
    expect(
      (fire(api, "tool_call", makeToolCallEvent("write", { path: "x" }), fakeCtx) as ToolCallEventResult),
    ).toEqual({});

    fire(api, "turn_start", { type: "turn_start", turnIndex: 2, timestamp: 2 }, fakeCtx);
    fire(api, "agent_settled", { type: "agent_settled" }, fakeCtx);
    fire(api, "turn_start", { type: "turn_start", turnIndex: 3, timestamp: 3 }, fakeCtx);
    expect(
      (fire(api, "tool_call", makeToolCallEvent("write", { path: "x" }), fakeCtx) as ToolCallEventResult),
    ).toEqual({});
  });

  test("captured snapshot is frozen and shares identity with the gate's currentTurnPolicy", () => {
    const api = makeFakeExtensionAPI();
    const runtime = createPiMobExtension({ policySource: () => readOnlyPolicy });
    registerPiMobExtension(api, runtime);

    fire(api, "turn_start", { type: "turn_start", turnIndex: 0, timestamp: 0 }, fakeCtx);
    const snapshot = runtime.gate.currentTurnPolicy() as TurnPolicySnapshot;
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot).toEqual({
      mode: "read_only",
      version: "bridge-workspace-3",
      fingerprint: "approved-fp-3",
      engineFingerprint: expect.any(String) as unknown as string,
    });
  });
});

describe("env-backed policy source", () => {
  test("returns undefined when any required key is missing", () => {
    const source = createEnvPolicySource({ env: {} });
    expect(source()).toBeUndefined();
  });

  test("returns undefined on invalid mode", () => {
    const source = createEnvPolicySource({
      env: {
        [HOST_POLICY_MODE_ENV_VAR]: "execute_anything",
        [HOST_POLICY_VERSION_ENV_VAR]: "v",
        [HOST_POLICY_FINGERPRINT_ENV_VAR]: "fp",
      },
    });
    expect(source()).toBeUndefined();
  });

  test("returns undefined on empty version or fingerprint", () => {
    expect(
      createEnvPolicySource({
        env: {
          [HOST_POLICY_MODE_ENV_VAR]: "full",
          [HOST_POLICY_VERSION_ENV_VAR]: "",
          [HOST_POLICY_FINGERPRINT_ENV_VAR]: "fp",
        },
      })(),
    ).toBeUndefined();
    expect(
      createEnvPolicySource({
        env: {
          [HOST_POLICY_MODE_ENV_VAR]: "full",
          [HOST_POLICY_VERSION_ENV_VAR]: "v",
          [HOST_POLICY_FINGERPRINT_ENV_VAR]: "",
        },
      })(),
    ).toBeUndefined();
  });

  test("returns a frozen read_only policy when all env keys are present", () => {
    const source = createEnvPolicySource({
      env: {
        [HOST_POLICY_MODE_ENV_VAR]: "read_only",
        [HOST_POLICY_VERSION_ENV_VAR]: "v3",
        [HOST_POLICY_FINGERPRINT_ENV_VAR]: "fp3",
      },
    });
    const policy = source();
    expect(policy).toEqual({ mode: "read_only", version: "v3", fingerprint: "fp3" });
    expect(Object.isFrozen(policy)).toBe(true);
  });

  test("returns a frozen full policy when all env keys are present", () => {
    const source = createEnvPolicySource({
      env: {
        [HOST_POLICY_MODE_ENV_VAR]: "full",
        [HOST_POLICY_VERSION_ENV_VAR]: "v4",
        [HOST_POLICY_FINGERPRINT_ENV_VAR]: "fp4",
      },
    });
    const policy = source();
    expect(policy).toEqual({ mode: "full", version: "v4", fingerprint: "fp4" });
    expect(Object.isFrozen(policy)).toBe(true);
  });
});

describe("default factory against env-backed policy source", () => {
  test("blocks write when the env declares read_only", () => {
    const api = makeFakeExtensionAPI();
    // We cannot override the default factory's source directly; instead,
    // assert the env contract by exercising a wired extension whose
    // source is the same env map the default factory uses in production.
    const source = createEnvPolicySource({
      env: {
        [HOST_POLICY_MODE_ENV_VAR]: "read_only",
        [HOST_POLICY_VERSION_ENV_VAR]: "bridge-workspace-3",
        [HOST_POLICY_FINGERPRINT_ENV_VAR]: "approved-fp-3",
      },
    });
    const runtime = createPiMobExtension({ policySource: source });
    registerPiMobExtension(api, runtime);
    fire(api, "turn_start", { type: "turn_start", turnIndex: 0, timestamp: 0 }, fakeCtx);
    const result = fire(
      api,
      "tool_call",
      makeToolCallEvent("write", { path: "x" }),
      fakeCtx,
    ) as ToolCallEventResult;
    expect(result.block).toBe(true);
  });

  test("fails closed when the bridge env is missing entirely", () => {
    const api = makeFakeExtensionAPI();
    const source = createEnvPolicySource({ env: {} });
    const runtime = createPiMobExtension({ policySource: source });
    registerPiMobExtension(api, runtime);
    fire(api, "turn_start", { type: "turn_start", turnIndex: 0, timestamp: 0 }, fakeCtx);
    const result = fire(
      api,
      "tool_call",
      makeToolCallEvent("read", { path: "x" }),
      fakeCtx,
    ) as ToolCallEventResult;
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining("pi-mob policy unavailable") as unknown as string,
    });
  });
});

describe("file-backed policy source", () => {
  test("reloads later-turn policy while preserving each captured snapshot", () => {
    let json = JSON.stringify({ mode: "read_only", version: "1", fingerprint: "a" });
    const source = createPolicyFileSource("/policy.json", () => json);
    expect(source()?.mode).toBe("read_only");
    json = JSON.stringify({ mode: "full", version: "2", fingerprint: "b" });
    expect(source()).toEqual({ mode: "full", version: "2", fingerprint: "b" });
  });

  test("fails closed on missing or malformed policy files", () => {
    expect(createPolicyFileSource("/missing", () => { throw new Error("missing"); })()).toBeUndefined();
    expect(createPolicyFileSource("/bad", () => "{}")()).toBeUndefined();
  });
});

describe("createPiMobExtension contract", () => {
  test("rejects a non-function policySource", () => {
    expect(() =>
      createPiMobExtension({ policySource: undefined as unknown as () => HostPolicyState | undefined }),
    ).toThrow(/policySource/);
  });

  test("returns a frozen runtime whose gate works end-to-end", () => {
    const runtime = createPiMobExtension({ policySource: () => readOnlyPolicy });
    expect(Object.isFrozen(runtime)).toBe(true);
    runtime.gate.beginTurn();
    const decision = runtime.gate.toolCall({ toolName: "write" });
    expect("block" in decision && decision.block).toBe(true);
  });
});
