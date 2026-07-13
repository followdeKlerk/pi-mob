/**
 * Loadable Pi extension entry point.
 *
 * The bridge spawns an exact `@earendil-works/pi-coding-agent@0.80.6`
 * subprocess with `--extension ./src/extension.ts` (or otherwise points
 * the loader at this file). Pi's jiti-based loader expects a default
 * exported factory `function (pi: ExtensionAPI)`. This module exposes:
 *
 *   - a default factory that wires the policy gate against an
 *     environment-supplied host policy (the contract the bridge sets
 *     in the allowlisted env before spawning Pi);
 *   - the underlying {@link registerPiMobExtension} so unit tests and
 *     other in-process hosts can drive the same wiring against an
 *     injected `ExtensionAPI` fake;
 *   - the {@link createEnvPolicySource} helper so the wiring is
 *     observable and replaceable in tests.
 *
 * The gate is the same one the pure policy module exposes
 * (`createHostPolicyToolGate`); this file is the thin adapter that
 * turns the gate's structured decisions into Pi's `tool_call` blocking
 * shape and manages turn boundaries.
 */

import { readFileSync } from "node:fs";
import type {
  AgentEndEvent,
  AgentSettledEvent,
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
  ToolCallEvent,
  ToolCallEventResult,
  TurnEndEvent,
  TurnStartEvent,
} from "@earendil-works/pi-coding-agent";

import {
  createHostPolicyToolGate,
  type HostPolicyState,
  type HostToolCall,
} from "./policy";

/** Stable env-var names the bridge sets in the allowlisted environment. */
export const HOST_POLICY_MODE_ENV_VAR = "PI_MOB_HOST_POLICY_MODE" as const;
export const HOST_POLICY_VERSION_ENV_VAR = "PI_MOB_HOST_POLICY_VERSION" as const;
export const HOST_POLICY_FINGERPRINT_ENV_VAR = "PI_MOB_HOST_POLICY_FINGERPRINT" as const;
export const HOST_POLICY_FILE_ENV_VAR = "PI_MOB_HOST_POLICY_FILE" as const;
export const PAIRING_FILE_ENV_VAR = "PI_MOB_PAIRING_FILE" as const;

/** Mode string the bridge is required to emit. */
export type HostPolicyModeString = "full" | "read_only";

/**
 * Returns the durable host policy the bridge trusts for this Pi
 * subprocess. A return of `undefined` means the gate must fail closed.
 *
 * The supplier is consulted on every `turn_start`, so the bridge can
 * rotate policy without reloading the extension. Suppliers MUST be
 * pure with respect to side effects on the Pi subprocess; reading
 * from the allowlisted env is the standard implementation.
 */
export type HostPolicySource = () => HostPolicyState | undefined;

/** Public shape of an env-backed policy source. */
export interface EnvPolicySourceOptions {
  /**
   * Map to read from. Defaults to `process.env`. The bridge uses
   * defaults; tests inject deterministic maps to avoid global state.
   */
  readonly env?: Record<string, string | undefined>;
}

/**
 * Create a policy source backed by bridge-supplied env vars. Returns
 * `undefined` when any required key is missing or invalid; the gate
 * then refuses every tool call to fail closed.
 */
export function createEnvPolicySource(
  options: EnvPolicySourceOptions = {},
): HostPolicySource {
  const env = options.env ?? (process.env as Record<string, string | undefined>);
  return (): HostPolicyState | undefined => {
    const mode = env[HOST_POLICY_MODE_ENV_VAR];
    const version = env[HOST_POLICY_VERSION_ENV_VAR];
    const fingerprint = env[HOST_POLICY_FINGERPRINT_ENV_VAR];
    if (mode === undefined || version === undefined || fingerprint === undefined) return undefined;
    if (mode !== "full" && mode !== "read_only") return undefined;
    if (version.length === 0 || fingerprint.length === 0) return undefined;
    return Object.freeze({ mode, version, fingerprint });
  };
}

/** What the bridge hands to the extension. */
export interface PiMobExtensionOptions {
  /** Source consulted at every `turn_start`. */
  readonly policySource: HostPolicySource;
}

/** Handles to drive the gate from tests. */
export interface PiMobExtensionRuntime {
  readonly gate: ReturnType<typeof createHostPolicyToolGate>;
  readonly policySource: HostPolicySource;
}

/** Construct an extension runtime tied to a specific policy source. */
export function createPiMobExtension(options: PiMobExtensionOptions): PiMobExtensionRuntime {
  if (options.policySource === undefined || typeof options.policySource !== "function") {
    throw new TypeError("createPiMobExtension: policySource must be a function");
  }
  const gate = createHostPolicyToolGate(() => {
    const policy = options.policySource();
    if (policy === undefined) {
      throw new Error("pi-mob extension: no host policy available at turn start (bridge env not set)");
    }
    return policy;
  });
  return Object.freeze({ gate, policySource: options.policySource });
}

/**
 * Convert a {@link ToolCallEvent} into the gate's input shape. The
 * Pi-side `ToolCallEvent` is a discriminated union over `toolName`;
 * we only need the tool name and the raw `input` object.
 */
function toHostToolCall(event: ToolCallEvent): HostToolCall {
  const input = (event as { input?: unknown }).input;
  return {
    toolName: event.toolName,
    input,
    ...(event.toolCallId !== undefined ? { toolCallId: event.toolCallId } : {}),
  };
}

/**
 * Register every pi-mob hook against the supplied `ExtensionAPI`.
 * Split out from the default factory so tests can drive the same code
 * path against a fake `ExtensionAPI`.
 *
 * The handler set is intentionally narrow:
 *
 *   - `turn_start` → capture an immutable per-turn policy snapshot
 *     from the supplier. This snapshot is the only thing the gate
 *     consults for the rest of the turn; later supplier updates do
 *     not influence it.
 *   - `turn_end` / `agent_end` / `agent_settled` → release the
 *     snapshot so the next `turn_start` rebuilds it from current
 *     policy. Defensive triple-bookkeeping because Pi emits these
 *     events under different error paths.
 *   - `tool_call` → consult the captured snapshot and return
 *     `{ block: true, reason }` to Pi when the gate refuses. If the
 *     supplier is unavailable (no bridge env), the gate throws and
 *     we fail closed by blocking with a stable reason.
 */
export function registerPiMobExtension(
  pi: ExtensionAPI,
  runtime: PiMobExtensionRuntime,
): void {
  const { gate } = runtime;
  let lastBeginTurnError: string | undefined;

  pi.on("turn_start", (_event: TurnStartEvent) => {
    lastBeginTurnError = undefined;
    try {
      gate.beginTurn();
    } catch (error) {
      lastBeginTurnError = error instanceof Error ? error.message : String(error);
    }
  });

  pi.on("turn_end", (_event: TurnEndEvent) => {
    gate.endTurn();
  });

  pi.on("agent_end", (_event: AgentEndEvent) => {
    gate.endTurn();
  });

  pi.on("agent_settled", (_event: AgentSettledEvent) => {
    gate.endTurn();
  });

  pi.registerCommand("mobile", {
    description: "Show the private pi-mob pairing QR code",
    async handler(_args, ctx) {
      const path = process.env[PAIRING_FILE_ENV_VAR];
      if (!path) { ctx.ui.notify("Pairing is not configured. Run pi-mob-ops pair first.", "warning"); return; }
      try {
        const value = JSON.parse(readFileSync(path, "utf8")) as { terminal?: unknown };
        if (typeof value.terminal !== "string") throw new Error("pairing QR is missing");
        ctx.ui.setWidget("pi-mob-pairing", value.terminal.split("\n"), { placement: "aboveEditor" });
        ctx.ui.notify("Scan with pi-mob, or use the manual endpoint recovery flow.", "info");
      } catch (error) {
        ctx.ui.notify(`Pairing unavailable: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.on("tool_call", (event: ToolCallEvent, _ctx: ExtensionContext): ToolCallEventResult => {
    if (lastBeginTurnError !== undefined) {
      return { block: true, reason: `pi-mob policy unavailable: ${lastBeginTurnError}` };
    }
    const call = toHostToolCall(event);
    let decision: ReturnType<typeof gate.toolCall>;
    try {
      decision = gate.toolCall(call);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { block: true, reason: `pi-mob policy unavailable: ${reason}` };
    }
    if ("block" in decision && decision.block === true) {
      return { block: true, reason: decision.reason };
    }
    return {};
  });
}

/** Reads a bridge-owned owner-only JSON file on every turn start so policy
 * changes apply to later turns without changing an active turn snapshot. */
export function createPolicyFileSource(
  path: string,
  read: (path: string) => string = (value) => readFileSync(value, "utf8"),
): HostPolicySource {
  return () => {
    try {
      const value = JSON.parse(read(path)) as Record<string, unknown>;
      const mode = value.mode;
      const version = value.version;
      const fingerprint = value.fingerprint;
      if ((mode !== "full" && mode !== "read_only") || typeof version !== "string" ||
          version.length === 0 || typeof fingerprint !== "string" || fingerprint.length === 0) return undefined;
      return Object.freeze({ mode, version, fingerprint });
    } catch { return undefined; }
  };
}

function createDefaultPolicySource(): HostPolicySource {
  const path = process.env[HOST_POLICY_FILE_ENV_VAR];
  return typeof path === "string" && path.length > 0
    ? createPolicyFileSource(path)
    : createEnvPolicySource();
}

const defaultPolicySource: HostPolicySource = createDefaultPolicySource();

/**
 * Default factory Pi's `--extension` loader calls. Wires the bridge
 * env-backed policy source into a fresh runtime and registers every
 * hook. Exported as the module default so `pi -e ./src/extension.ts`
 * works as documented.
 */
export function defaultExtensionFactory(pi: ExtensionAPI): void {
  const runtime = createPiMobExtension({ policySource: defaultPolicySource });
  registerPiMobExtension(pi, runtime);
}

/** Named re-export of the same factory for typed imports. */
export const extension: ExtensionFactory = defaultExtensionFactory;

/** Default export: the shape Pi's `--extension` loader accepts. */
export default defaultExtensionFactory;
