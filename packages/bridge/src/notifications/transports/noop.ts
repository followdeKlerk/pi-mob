/**
 * M15 — no-op transport used for tests and the "no push configured" path.
 *
 * It always reports `delivered` and records every notification for
 * later inspection. The bridge still coalesces and applies the rate
 * limiter through this transport, so behaviour against the noop is the
 * same as against the real APNs/FCM adapters minus network effects.
 */

import type {
  NotificationPlatform,
  NotificationTransport,
  TransportNotification,
  TransportResult,
} from "../types";

export interface NoopTransportOptions {
  readonly platform: NotificationPlatform;
}

export class NoopTransport implements NotificationTransport {
  readonly platform: NotificationPlatform;
  readonly sent: TransportNotification[] = [];
  private transientCount = 0;
  private permanentCount = 0;

  constructor(options: NoopTransportOptions) {
    this.platform = options.platform;
  }

  /** Test helper: force the next N sends to fail transiently. */
  forceTransient(count: number): void { this.transientCount = count; }
  /** Test helper: force the next N sends to fail permanently. */
  forcePermanent(count: number): void { this.permanentCount = count; }

  async send(notification: TransportNotification): Promise<TransportResult> {
    this.sent.push(notification);
    if (this.transientCount > 0) {
      this.transientCount -= 1;
      return { kind: "transient_failure", reason: "forced_transient" };
    }
    if (this.permanentCount > 0) {
      this.permanentCount -= 1;
      return { kind: "permanent_failure", reason: "forced_permanent" };
    }
    return { kind: "delivered", providerMessageId: `noop-${notification.platform}-${this.sent.length}` };
  }
}
