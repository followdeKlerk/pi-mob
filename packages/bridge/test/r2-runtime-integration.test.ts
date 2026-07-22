import { validateFixture } from "@pi-mob/protocol-schema";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AdapterPort } from "../src/core/domain";
import { DurableBridgeRuntime, RuntimeProtocolError } from "../src/core/runtime";
import { BridgeStore } from "../src/core/store";
import { type PlanSourceService, type PlanSnapshot, type PlanStep } from "../src/plans/source-service";

const connection = {
  connectionId: "33333333-3333-4333-8333-333333333333",
  installationId: "44444444-4444-4444-8444-444444444444",
  subscriptions: new Set<string>(),
};
const adapter: AdapterPort = { async dispatch() {} };

function runtimeFor(plans?: PlanSourceService): DurableBridgeRuntime {
  const path = join(mkdtempSync(join(tmpdir(), "pi-mob-r2-runtime-")), "bridge.sqlite");
  return new DurableBridgeRuntime({
    store: new BridgeStore(path),
    adapter,
    bridgeVersion: "test",
    piVersion: "0.80.6",
    hostDisplayName: "test",
    ...(plans ? { plans } : {}),
  });
}

const sessionId = "11111111-1111-4111-8111-111111111111";
const turnId = "turn-1";

function step(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    stepId: "step-1",
    title: "Read file",
    status: "pending",
    ...overrides,
  };
}

function snapshot(overrides: Partial<PlanSnapshot> = {}): PlanSnapshot {
  return {
    planId: "plan-1",
    revision: "plan-r1",
    sessionId,
    turnId,
    source: "session-bridge",
    stale: false,
    capability: { state: "available" },
    steps: [step()],
    ...overrides,
  };
}

/** On-demand plan source. */
class FakePlanSource implements PlanSourceService {
  public calls = 0;
  public aborted = false;
  constructor(private readonly next: () => Promise<PlanSnapshot | "unavailable">) {}
  async snapshot({ signal }: { sessionId: string; turnId: string; signal?: AbortSignal }): Promise<PlanSnapshot> {
    this.calls += 1;
    if (signal) {
      if (signal.aborted) this.aborted = true;
      else signal.addEventListener("abort", () => { this.aborted = true; }, { once: true });
    }
    const value = await this.next();
    if (value === "unavailable") {
      return {
        planId: "unused",
        revision: "unused",
        sessionId,
        turnId,
        source: "unused",
        stale: false,
        capability: { state: "available" },
        steps: [],
      };
    }
    return value;
  }
}

describe("R2 runtime integration", () => {
  test("plans.v1 is advertised only when the source service is installed", () => {
    expect(runtimeFor().optionalCapabilities()).toEqual([]);
    const source = new FakePlanSource(async () => snapshot());
    expect(runtimeFor(source).optionalCapabilities()).toEqual(["plans.v1"]);
  });

  test("plan.summary.request returns the closed PlanSnapshot schema", async () => {
    const source = new FakePlanSource(async () => snapshot({ steps: [step({ status: "completed" }), step({ stepId: "step-2", title: "Patch", status: "running" })] }));
    const runtime = runtimeFor(source);
    const response = await runtime.control(connection, "plan.summary.request", { sessionId, turnId, requestId: "req-1" });
    expect(response).toBeDefined();
    if (!response || typeof response !== "object") throw new Error("plan.summary.request returned no payload");
    expect(response.planId).toBe("plan-1");
    expect(response.steps).toHaveLength(2);
    expect((response.steps as PlanStep[])[1]?.status).toBe("running");
    expect(source.calls).toBe(1);
  });

  test("plan.summary.request rejects missing sessionId/turnId/requestId", async () => {
    const source = new FakePlanSource(async () => snapshot());
    const runtime = runtimeFor(source);
    expect(() => runtime.control(connection, "plan.summary.request", {})).toThrow(RuntimeProtocolError);
    expect(() => runtime.control(connection, "plan.summary.request", { sessionId })).toThrow(RuntimeProtocolError);
    expect(() => runtime.control(connection, "plan.summary.request", { sessionId, turnId })).toThrow(RuntimeProtocolError);
  });

  test("plan.summary.request without an installed source throws unsupported_capability", async () => {
    const runtime = runtimeFor();
    await expect(
      runtime.control(connection, "plan.summary.request", { sessionId, turnId, requestId: "req-1" }),
    ).rejects.toBeInstanceOf(RuntimeProtocolError);
    await expect(
      runtime.control(connection, "plan.summary.request", { sessionId, turnId, requestId: "req-1" }),
    ).rejects.toMatchObject({ code: "unsupported_capability" });
  });

  test("plan.summary.cancel aborts an in-flight request by requestId", async () => {
    let resolveSource!: (value: PlanSnapshot) => void;
    const source = new FakePlanSource(() => new Promise<PlanSnapshot>((res) => { resolveSource = res; }));
    const runtime = runtimeFor(source);
    const pending = runtime.control(connection, "plan.summary.request", { sessionId, turnId, requestId: "req-cancel" });

    const cancel = runtime.control(connection, "plan.summary.cancel", { targetRequestId: "req-cancel" }) as { cancelled: boolean };
    expect(cancel.cancelled).toBe(true);
    expect(source.aborted).toBe(true);

    // Resolve the aborted call so the pending promise settles without throwing.
    resolveSource(snapshot());
    await pending;
  });

  test("plan.summary.cancel with unknown targetRequestId is a no-op, not an error", () => {
    const source = new FakePlanSource(async () => snapshot());
    const runtime = runtimeFor(source);
    const cancel = runtime.control(connection, "plan.summary.cancel", { targetRequestId: "missing" }) as { cancelled: boolean };
    expect(cancel.cancelled).toBe(false);
  });

  test("plan.unavailable event lands on the host stream and the closed schema validates", async () => {
    const source: PlanSourceService = {
      async snapshot() {
        return {
          capability: "plans.v1",
          status: {
            state: "unavailable",
            reason: "No plan source installed",
            remediation: "Install a vetted PlanSourceService to surface structured plans.",
          },
        };
      },
    };
    const runtime = runtimeFor(source);
    const hostStream = `host:${runtime.identity().hostId}`;

    const captured: Array<{ type: string; streamId: string; payload: Record<string, unknown> }> = [];
    const detach = runtime.options.store.onEvent((event) => {
      captured.push({ type: event.type, streamId: event.streamId, payload: event.payload as Record<string, unknown> });
    });

    await expect(
      runtime.control(connection, "plan.summary.request", { sessionId, turnId, requestId: "req-unavail" }),
    ).rejects.toThrow(/plan source/i);

    detach();

    const unavailableEvent = captured.find((e) => e.type === "plan.unavailable");
    expect(unavailableEvent).toBeDefined();
    expect(unavailableEvent?.streamId).toBe(hostStream);
    expect(unavailableEvent?.payload).toEqual({
      capability: "plans.v1",
      status: {
        state: "unavailable",
        reason: "No plan source installed",
        remediation: "Install a vetted PlanSourceService to surface structured plans.",
      },
    });

    // The emitted event must validate against the closed plan.unavailable
    // protocol envelope so a future schema change breaks the bridge loudly.
    if (!unavailableEvent) throw new Error("plan.unavailable event is missing");
    expect(
      validateFixture({
        name: "r2-runtime-plan-unavailable",
        kind: "event",
        valid: true,
        message: {
          protocol: { major: 1, minor: 0 },
          messageId: "11111111-1111-4111-8111-111111111111",
          sentAt: "2026-01-02T00:00:00.000Z",
          eventId: "33333333-3333-4333-8333-333333333333",
          streamId: hostStream,
          cursor: "1",
          type: "plan.unavailable",
          payload: unavailableEvent.payload,
        },
      }),
    ).toBe(true);
  });

  test("plan.unavailable event is NOT emitted on the success path", async () => {
    const source = new FakePlanSource(async () => snapshot());
    const runtime = runtimeFor(source);

    const captured: string[] = [];
    const detach = runtime.options.store.onEvent((event) => {
      if (event.type === "plan.unavailable") captured.push(event.streamId);
    });

    await runtime.control(connection, "plan.summary.request", { sessionId, turnId, requestId: "req-ok" });
    detach();
    expect(captured).toEqual([]);
  });
});
