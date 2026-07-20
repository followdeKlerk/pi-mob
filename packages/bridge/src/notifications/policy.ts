/**
 * M15 — Status policy.
 *
 * Maps raw turn lifecycle events to notification `kind`s and decides
 * whether each kind should actually produce a push. The policy is
 * deliberately conservative:
 *
 *   - `settled` only fires when a turn finishes with a successful
 *     receipt (`agent_settled` mapped to `turn.settled`). Default: emit.
 *   - `failed` only fires on `turn.failed` events that carry a real
 *     error code (not `provider_interrupted`, which is normal shutdown).
 *   - `indeterminate` fires when a turn was running at crash time and
 *     the host marked it indeterminate on recovery.
 *   - `needs_attention` fires when the host pushes a turn that is
 *     waiting on a user dialog or read-only policy escalation. Only
 *     fires once per attention transition.
 *   - `crash_loop` fires when the supervisor enters the crash-loop
 *     state. Repeated crash-loop events for the same session
 *     collapse to a single notification within the rate-limit window.
 *
 * The policy also rejects "duplicate" events: the same source event id
 * can never produce two notifications.
 */

import type { NotificationKind } from "./types";

export interface RawStatusEvent {
  readonly type: string;
  readonly sessionId: string;
  readonly sourceEventId?: string;
  readonly sourceAt?: number;
  readonly errorCode?: string;
  readonly attentionState?: string;
  readonly runtimeState?: string;
}

/** Status kind derived from a raw event. `null` when the event is not interesting. */
export function classifyEvent(event: RawStatusEvent): NotificationKind | null {
  if (event.type === "turn.settled") return "settled";
  if (event.type === "turn.failed") {
    // `provider_interrupted` is normal (mobile app backgrounded, etc.)
    if (event.errorCode === "provider_interrupted") return null;
    return "failed";
  }
  if (event.type === "turn.aborted") return null;
  if (event.type === "turn.indeterminate") return "indeterminate";
  if (event.type === "turn.waiting_for_input") return "needs_attention";
  if (event.type === "session.state") {
    if (event.attentionState === "needs_attention") return "needs_attention";
    if (event.runtimeState === "crash_loop") return "crash_loop";
    return null;
  }
  if (event.type === "host.state" && event.runtimeState === "crash_loop") return "crash_loop";
  return null;
}

/** Deep-link target for a notification. Stable, opaque, free of content. */
export function buildDeepLink(input: { readonly kind: NotificationKind; readonly sessionId: string }): string {
  return `pi-mob://session/${encodeURIComponent(input.sessionId)}?kind=${encodeURIComponent(input.kind)}`;
}

/** Stable notification id (used for dedupe + coalesce). */
export function buildNotificationId(input: { readonly kind: NotificationKind; readonly sessionId: string; readonly sourceEventId?: string; readonly sourceAt?: number }): string {
  const suffix = input.sourceEventId ?? `${input.sourceAt ?? 0}`;
  return `notif:${input.kind}:${input.sessionId}:${suffix}`;
}

/** Decides whether a coalesced key should emit *right now* given last-emitted-at. */
export function shouldEmitAfterCoalesce(input: {
  readonly kind: NotificationKind;
  readonly lastKind: NotificationKind | null;
  readonly count: number;
  readonly now: number;
  readonly firstAt: number;
  readonly minIntervalMs: number;
  readonly sessionCeiling: number;
}): { readonly emit: boolean; readonly reason: "first" | "repeat" | "suppressed" } {
  if (input.count === 0) return { emit: true, reason: "first" };
  if (input.count >= input.sessionCeiling) return { emit: false, reason: "suppressed" };
  if (input.kind === "crash_loop" && input.lastKind === "crash_loop") {
    // Crash-loop repeats collapse inside the rate window; the count
    // still increments so the session ceiling kicks in eventually.
    if (input.now - input.firstAt < input.minIntervalMs * 5) return { emit: false, reason: "suppressed" };
    return { emit: true, reason: "repeat" };
  }
  if (input.kind === "needs_attention" && input.lastKind === "needs_attention" && input.now - input.firstAt < input.minIntervalMs) {
    return { emit: false, reason: "suppressed" };
  }
  return { emit: true, reason: "repeat" };
}
