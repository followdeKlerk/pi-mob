/** Test-only deterministic fault injection. This module is never imported by a
 * production entrypoint and deliberately exposes no HTTP/WebSocket surface. */
export const TEST_FAULT_NAMES = [
  "close_after_accept", "close_after_dispatch", "pause_outbound",
  "kill_pi_after_events", "kill_bridge_after_transition", "cursor_invalid",
  "host_generation_change", "oversized_tool_output", "provider_interruption",
  "dialog_expiry", "file_write_failure", "database_full",
  "database_unavailable", "database_locked", "migration_failure",
  "notification_failure", "cleanup_timeout",
] as const;
export type TestFaultName = typeof TEST_FAULT_NAMES[number];

export interface FaultEffect {
  readonly name: TestFaultName;
  readonly context: Readonly<Record<string, unknown>>;
  readonly occurrence: number;
}
export interface FaultPlan { readonly name: TestFaultName; readonly after?: number; readonly times?: number; }

interface ArmedFault { remaining: number; times: number; occurrence: number; }

export class TestFaultInjector {
  private readonly armed = new Map<TestFaultName, ArmedFault>();
  private constructor(readonly buildMode: "test") {}
  static create(buildMode: "test"): TestFaultInjector { return new TestFaultInjector(buildMode); }

  arm(plan: FaultPlan): void {
    if (!TEST_FAULT_NAMES.includes(plan.name)) throw new TypeError("unknown test fault");
    const after = plan.after ?? 0; const times = plan.times ?? 1;
    if (!Number.isInteger(after) || after < 0 || !Number.isInteger(times) || times < 1) throw new RangeError("invalid fault plan");
    this.armed.set(plan.name, { remaining: after, times, occurrence: 0 });
  }
  consume(name: TestFaultName, context: Record<string, unknown> = {}): FaultEffect | null {
    const plan = this.armed.get(name); if (!plan) return null;
    if (plan.remaining > 0) { plan.remaining--; return null; }
    plan.occurrence++; plan.times--;
    if (plan.times === 0) this.armed.delete(name);
    return { name, context: Object.freeze({ ...context }), occurrence: plan.occurrence };
  }
  clear(): void { this.armed.clear(); }
  get active(): readonly TestFaultName[] { return [...this.armed.keys()]; }
}

/** The only fault surface production code may depend on. */
export interface FaultProbe { consume(name: string, context?: Record<string, unknown>): null; }
export const noFaults: FaultProbe = Object.freeze({ consume: () => null });

export function bridgeServerFaultHooks(injector: TestFaultInjector) {
  return {
    afterCommandAccepted(): "drop_receipt" | "close" | void {
      if (injector.consume("close_after_accept")) return "close";
      return;
    },
    beforeOutbound(): "pause" | void {
      if (injector.consume("pause_outbound")) return "pause";
      return;
    },
  };
}
