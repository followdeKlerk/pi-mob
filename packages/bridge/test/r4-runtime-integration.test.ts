import { validateFixture } from "@pi-mob/protocol-schema";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AdapterPort } from "../src/core/domain";
import { DurableBridgeRuntime, RuntimeProtocolError } from "../src/core/runtime";
import { BridgeStore } from "../src/core/store";
import {
  type ContextSourceService,
  type ContextSourceResult,
  type ContextSnapshot,
  type ContextMutationTarget,
  type ContextUnavailable,
} from "../src/context/source-service";

const connection = {
  connectionId: "55555555-5555-4555-8555-555555555555",
  installationId: "66666666-6666-4666-8666-666666666666",
  subscriptions: new Set<string>(),
};
const adapter: AdapterPort = { async dispatch() {} };

function runtimeFor(contexts?: ContextSourceService): DurableBridgeRuntime {
  const path = join(mkdtempSync(join(tmpdir(), "pi-mob-r4-runtime-")), "bridge.sqlite");
  return new DurableBridgeRuntime({
    store: new BridgeStore(path),
    adapter,
    bridgeVersion: "test",
    piVersion: "0.80.6",
    hostDisplayName: "test",
    ...(contexts ? { contexts } : {}),
  });
}

const sessionId = "11111111-1111-4111-8111-111111111111";

function snapshot(overrides: Partial<ContextSnapshot> = {}): ContextSnapshot {
  return {
    sessionId,
    revision: "ctx-r1",
    source: "session-bridge",
    stale: false,
    capability: { state: "available" },
    model: { provider: "anthropic", modelId: "claude-3" },
    thinkingLevel: "low",
    instructions: "Be terse.",
    pinnedFiles: [
      { path: "README.md", pinnedAt: "2026-07-12T00:00:00.000Z", revision: "file-r1" },
    ],
    tokenUsage: { inputTokens: "100", outputTokens: "42" },
    compacted: false,
    lastRefreshedAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

function unavailable(reason = "no Pi authority installed"): ContextUnavailable {
  return {
    sessionId,
    capability: "contexts.v1",
    status: { state: "unavailable", reason, remediation: "Install a vetted Pi authority that emits context.snapshot events." },
  };
}

class FakeContextSource implements ContextSourceService {
  public calls = 0;
  public aborted = false;
  public mutateCalls = 0;
  constructor(
    private readonly next: () => Promise<ContextSourceResult>,
    private readonly mutateNext: () => Promise<{ accepted: boolean; revision: string | null; rejectionReason?: string }> = async () => ({ accepted: true, revision: "ctx-r2" }),
  ) {}
  async snapshot({ signal }: { sessionId: string; signal?: AbortSignal }): Promise<ContextSourceResult> {
    this.calls += 1;
    if (signal) {
      if (signal.aborted) this.aborted = true;
      else signal.addEventListener("abort", () => { this.aborted = true; }, { once: true });
    }
    return await this.next();
  }
  async mutate(_input: {
    sessionId: string;
    type: "context.pin" | "context.unpin" | "context.exclude" | "context.refresh";
    target: ContextMutationTarget;
    expectedRevision: string;
    signal?: AbortSignal;
  }) {
    this.mutateCalls += 1;
    return await this.mutateNext();
  }
}

function lastEventForSession(
  runtime: DurableBridgeRuntime,
  targetSessionId: string,
): { type: string; payload: unknown } | undefined {
  const store = (runtime as unknown as { options: { store: { listEvents: (streamId: string) => Array<{ streamId: string; type: string; payload: unknown }> } } }).options.store;
  const events = store.listEvents(`session:${targetSessionId}`);
  return events[events.length - 1];
}

describe("R4 runtime integration", () => {
  test("contexts.v1 is advertised only when the source service is installed", () => {
    expect(runtimeFor().optionalCapabilities()).not.toContain("contexts.v1");
    const source = new FakeContextSource(async () => snapshot());
    expect(runtimeFor(source).optionalCapabilities()).toContain("contexts.v1");
  });

  test("context.snapshot.request returns the closed ContextSnapshot schema", async () => {
    const source = new FakeContextSource(async () => snapshot());
    const runtime = runtimeFor(source);
    const response = await runtime.control(connection, "context.snapshot.request", { sessionId, requestId: "req-1" });
    expect(response).toBeDefined();
    if (!response || typeof response !== "object") throw new Error("no payload");
    const event = response as { sessionId: string; revision: string; capability: { state: string } };
    expect(event.sessionId).toBe(sessionId);
    expect(event.revision).toBe("ctx-r1");
    expect(event.capability.state).toBe("available");
    expect(source.calls).toBe(1);
  });

  test("context.snapshot.request rejects missing sessionId/requestId", async () => {
    const source = new FakeContextSource(async () => snapshot());
    const runtime = runtimeFor(source);
    expect(() => runtime.control(connection, "context.snapshot.request", {})).toThrow(RuntimeProtocolError);
    expect(() => runtime.control(connection, "context.snapshot.request", { sessionId })).toThrow(RuntimeProtocolError);
  });

  test("context.snapshot.request without an installed source throws unsupported_capability", async () => {
    const runtime = runtimeFor();
    await expect(
      runtime.control(connection, "context.snapshot.request", { sessionId, requestId: "req-1" }),
    ).rejects.toMatchObject({ code: "unsupported_capability" });
  });

  test("context.snapshot.request surfaces context.unavailable on the session stream and rejects the response", async () => {
    const source = new FakeContextSource(async () => unavailable());
    const runtime = runtimeFor(source);
    await expect(
      runtime.control(connection, "context.snapshot.request", { sessionId, requestId: "req-u" }),
    ).rejects.toMatchObject({ code: "unsupported_capability" });
    const ev = lastEventForSession(runtime, sessionId);
    expect(ev).toBeDefined();
    expect(ev!.type).toBe("context.unavailable");
    const payload = ev!.payload as { sessionId: string; capability: string; status: { state: string } };
    expect(payload.sessionId).toBe(sessionId);
    expect(payload.capability).toBe("contexts.v1");
    expect(payload.status.state).toBe("unavailable");
  });

  test("context.snapshot.result shape validates against the shared protocol fixture", async () => {
    const source = new FakeContextSource(async () => snapshot());
    const runtime = runtimeFor(source);
    const response = await runtime.control(connection, "context.snapshot.request", { sessionId, requestId: "req-validate" });
    // Wrap to the response envelope for the validator: type + payload + requestId.
    const envelope = {
      protocol: { major: 1, minor: 0 },
      messageId: "77777777-7777-4777-8777-777777777777",
      requestId: "req-validate",
      type: "context.snapshot.result",
      sentAt: "2026-07-12T00:00:00.000Z",
      payload: response,
    };
    expect(() =>
      validateFixture({
        name: "r4-runtime-context-snapshot-result",
        kind: "response",
        valid: true,
        message: envelope,
      }),
    ).not.toThrow();
  });

  test("context.pin forwards a normalised mutation to the service and returns the new revision", async () => {
    const source = new FakeContextSource(
      async () => snapshot(),
      async () => ({ accepted: true, revision: "ctx-r2" }),
    );
    const runtime = runtimeFor(source);
    const response = await runtime.control(connection, "context.pin", {
      sessionId,
      expectedRevision: "ctx-r1",
      target: { kind: "file", path: "src/main.ts", revision: "src-r1" },
    }) as { accepted: boolean; revision: string | null };
    expect(response.accepted).toBe(true);
    expect(response.revision).toBe("ctx-r2");
    expect(source.mutateCalls).toBe(1);
  });

  test("context.unpin/exclude/refresh all route through the same mutation path", async () => {
    const source = new FakeContextSource(
      async () => snapshot(),
      async () => ({ accepted: true, revision: "ctx-r3" }),
    );
    const runtime = runtimeFor(source);
    const cases: Array<"context.unpin" | "context.exclude" | "context.refresh"> = ["context.unpin", "context.exclude", "context.refresh"];
    for (const type of cases) {
      const target: ContextMutationTarget = type === "context.refresh"
        ? { kind: "all" }
        : { kind: "source", sourceId: "cmd-out-7" };
      const response = await runtime.control(connection, type, {
        sessionId,
        expectedRevision: "ctx-r2",
        target,
      }) as { accepted: boolean; revision: string | null; type: string };
      expect(response.accepted).toBe(true);
      expect(response.revision).toBe("ctx-r3");
      expect(response.type).toBe(type);
    }
    expect(source.mutateCalls).toBe(3);
  });

  test("context mutation rejects missing sessionId/expectedRevision/target", async () => {
    const source = new FakeContextSource(async () => snapshot());
    const runtime = runtimeFor(source);
    expect(() => runtime.control(connection, "context.pin", {})).toThrow(RuntimeProtocolError);
    expect(() => runtime.control(connection, "context.pin", { sessionId })).toThrow(RuntimeProtocolError);
    expect(() => runtime.control(connection, "context.pin", { sessionId, expectedRevision: "r" })).toThrow(RuntimeProtocolError);
  });

  test("context mutation rejection surfaces as unsupported_capability (no silent state change)", async () => {
    const source = new FakeContextSource(
      async () => snapshot(),
      async () => ({ accepted: false, revision: null, rejectionReason: "stale expectedRevision" }),
    );
    const runtime = runtimeFor(source);
    await expect(
      runtime.control(connection, "context.pin", {
        sessionId,
        expectedRevision: "ctx-stale",
        target: { kind: "all" },
      }),
    ).rejects.toMatchObject({ code: "unsupported_capability" });
  });

  test("context mutation without an installed service throws unsupported_capability", async () => {
    const runtime = runtimeFor();
    await expect(
      runtime.control(connection, "context.pin", {
        sessionId,
        expectedRevision: "ctx-r1",
        target: { kind: "all" },
      }),
    ).rejects.toMatchObject({ code: "unsupported_capability" });
  });
});
