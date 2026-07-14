/**
 * M15 — Per-device/session coalescing and rate limiting.
 *
 * The coalescer keeps a small in-memory map of `(deviceId, sessionId)`
 * keys. Each entry records the last emitted `kind`, the last emitted
 * `notificationId`, the count, and timestamps. The map is intentionally
 * bounded so a flood of devices cannot exhaust memory.
 *
 * Defaults are conservative (1 notification per (device, session) per
 * 60 seconds, with a 10/min/device ceiling and a 50/session lifetime
 * ceiling). They are configurable through `NotificationConfig`.
 */

import type { NotificationConfig } from "./types";

export interface CoalesceDecision {
  /** True when the notification should be delivered. */
  readonly emit: boolean;
  /** Reason for the decision (test/diagnostics). */
  readonly reason: "first" | "repeat" | "rate_limited" | "session_ceiling" | "per_device_ceiling";
  /** The last emitted notification id when coalescing replaces it. */
  readonly replaceNotificationId?: string;
  /** Updated state after applying the decision. */
  readonly next: CoalesceState;
}

export interface CoalesceState {
  readonly coalesceKey: string;
  readonly lastKind: string | null;
  readonly lastNotificationId: string | null;
  readonly count: number;
  readonly firstAt: number;
  readonly lastAt: number;
}

export interface CoalesceLimits {
  readonly minIntervalMs: number;
  readonly perMinuteCeiling: number;
  readonly sessionCeiling: number;
}

export const DEFAULT_COALESCE_LIMITS: CoalesceLimits = Object.freeze({
  minIntervalMs: 60_000,
  perMinuteCeiling: 10,
  sessionCeiling: 50,
});

const COALESCE_KEY = (deviceId: string, sessionId: string): string => `${deviceId}\u0000${sessionId}`;
const PER_DEVICE_KEY = (deviceId: string, minuteBucket: number): string => `${deviceId}\u0000${minuteBucket}`;

export class Coalescer {
  private readonly perKey = new Map<string, CoalesceState>();
  private readonly perDeviceMinute = new Map<string, number>();
  private readonly limits: CoalesceLimits;

  constructor(config?: Pick<NotificationConfig, "minIntervalMs" | "perMinuteCeiling" | "sessionCeiling">) {
    this.limits = {
      minIntervalMs: config?.minIntervalMs ?? DEFAULT_COALESCE_LIMITS.minIntervalMs,
      perMinuteCeiling: config?.perMinuteCeiling ?? DEFAULT_COALESCE_LIMITS.perMinuteCeiling,
      sessionCeiling: config?.sessionCeiling ?? DEFAULT_COALESCE_LIMITS.sessionCeiling,
    };
  }

  /** Returns the per-device ceiling so callers can introspect. */
  limits_(): CoalesceLimits { return this.limits; }

  /**
   * Apply a coalescing decision. The `previous` value should be the
   * state from the most recent decision for the same coalesce key, or
   * `null` for the first event on that key.
   */
  decide(input: {
    readonly deviceId: string;
    readonly sessionId: string;
    readonly kind: string;
    readonly notificationId: string;
    readonly now: number;
    readonly previous: CoalesceState | null;
  }): CoalesceDecision {
    const key = COALESCE_KEY(input.deviceId, input.sessionId);
    const minuteBucket = Math.floor(input.now / 60_000);
    const perDevice = PER_DEVICE_KEY(input.deviceId, minuteBucket);
    const perDeviceCount = this.perDeviceMinute.get(perDevice) ?? 0;

    if (!input.previous) {
      if (perDeviceCount >= this.limits.perMinuteCeiling) {
        return {
          emit: false,
          reason: "per_device_ceiling",
          next: { coalesceKey: key, lastKind: null, lastNotificationId: null, count: 0, firstAt: input.now, lastAt: input.now },
        };
      }
      const next: CoalesceState = { coalesceKey: key, lastKind: input.kind, lastNotificationId: input.notificationId, count: 1, firstAt: input.now, lastAt: input.now };
      this.perKey.set(key, next);
      this.perDeviceMinute.set(perDevice, perDeviceCount + 1);
      return { emit: true, reason: "first", next };
    }

    if (input.previous.count >= this.limits.sessionCeiling) {
      return { emit: false, reason: "session_ceiling", next: input.previous };
    }
    if (input.previous.lastKind === input.kind && input.now - input.previous.lastAt < this.limits.minIntervalMs) {
      // Coalesce: keep the existing notification, but bump the count so
      // we eventually hit the session ceiling.
      const next: CoalesceState = { ...input.previous, count: input.previous.count + 1, lastAt: input.now };
      this.perKey.set(key, next);
      const replaceNotificationId = input.previous.lastNotificationId;
      return replaceNotificationId !== null
        ? { emit: false, reason: "rate_limited", replaceNotificationId, next }
        : { emit: false, reason: "rate_limited", next };
    }
    if (perDeviceCount >= this.limits.perMinuteCeiling) {
      return { emit: false, reason: "per_device_ceiling", next: input.previous };
    }
    const next: CoalesceState = { coalesceKey: key, lastKind: input.kind, lastNotificationId: input.notificationId, count: input.previous.count + 1, firstAt: input.previous.firstAt, lastAt: input.now };
    this.perKey.set(key, next);
    this.perDeviceMinute.set(perDevice, perDeviceCount + 1);
    return { emit: true, reason: "repeat", next };
  }

  /** Snapshot the current coalesce state for a (device, session) key. */
  snapshot(deviceId: string, sessionId: string): CoalesceState | null {
    return this.perKey.get(COALESCE_KEY(deviceId, sessionId)) ?? null;
  }

  /** Drop a coalesce key (called when a device is unregistered/rejected). */
  drop(deviceId: string, sessionId: string): void {
    this.perKey.delete(COALESCE_KEY(deviceId, sessionId));
  }

  /** Sweep stale buckets and keys to bound memory. */
  sweep(now: number, retentionMs = 5 * 60_000): { readonly dropped: number } {
    const cutoff = Math.floor((now - retentionMs) / 60_000);
    let dropped = 0;
    for (const [key,state] of this.perKey) {
      if(state.lastAt < now-retentionMs){this.perKey.delete(key);dropped+=1;}
    }
    if(this.perKey.size>10_000){
      const oldest=[...this.perKey.entries()].sort((a,b)=>a[1].lastAt-b[1].lastAt).slice(0,this.perKey.size-10_000);
      for(const [key] of oldest){this.perKey.delete(key);dropped+=1;}
    }
    for (const key of [...this.perDeviceMinute.keys()]) {
      const parts = key.split("\u0000");
      const bucket = Number(parts[1] ?? "0");
      if (!Number.isFinite(bucket) || bucket < cutoff) {
        this.perDeviceMinute.delete(key);
        dropped += 1;
      }
    }
    return { dropped };
  }
}
