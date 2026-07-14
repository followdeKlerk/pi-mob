/**
 * M15 — NotificationService.
 *
 * Orchestrates the full lifecycle: device install management, status
 * policy evaluation, payload sanitization, coalescing/rate limiting,
 * transport dispatch, and permanent-rejection cleanup. Failures at any
 * stage are caught and counted; nothing here can ever block Pi.
 *
 * The service is intentionally a plain object (no inheritance, no DI
 * framework): the runtime instantiates it once with explicit
 * collaborators, and the bridge store provides the durability. Tests
 * pass the noop transport or a custom fake.
 */

import type { BridgeStore } from "../core/store";
import { Coalescer, DEFAULT_COALESCE_LIMITS } from "./coalesce";
import {
  buildDeepLink,
  buildNotificationId,
} from "./policy";
import {
  buildNotificationCopy,
  NotificationPayloadError,
  sanitizeData,
  sanitizeNotificationString,
} from "./payload";
import type {
  NotificationCounters,
  NotificationEventSource,
  NotificationService,
  NotificationServiceOptions,
  NotificationStatus,
  PublishStatusInput,
  RegisterDeviceInput,
  ReplaceTokenInput,
  StoredDeviceInstall,
  TransportNotification,
} from "./types";

/** Default source used when the runtime does not supply one. */
class DefaultSource implements NotificationEventSource {
  hostDisplayName(): string { return "Pi"; }
  notificationsSuppressed(): boolean { return false; }
}

const STATUS_ONLY_DATA_KEYS = ["sessionId", "notificationId", "kind", "deepLink", "hostDisplayName"] as const;

export class BridgeNotificationService implements NotificationService {
  private readonly store: BridgeStore;
  private readonly apns: NotificationServiceOptions["apns"];
  private readonly fcm: NotificationServiceOptions["fcm"];
  private readonly supportedPlatforms: ReadonlySet<StoredDeviceInstall["platform"]>;
  private readonly coalescer: Coalescer;
  private readonly now: () => number;
  private readonly uuid: () => string;
  private readonly source: NotificationEventSource;
  private readonly staleAfterMs: number;
  private readonly countersInternal: { -readonly [K in keyof NotificationCounters]: number } = {
    delivered: 0,
    transientFailures: 0,
    permanentFailures: 0,
    rejectedDevices: 0,
    coalesced: 0,
    staleDropped: 0,
    suppressed: 0,
  };
  /** Hosts may temporarily suspend all pushes (e.g. user disabled). */
  private suspended = false;

  constructor(options: NotificationServiceOptions) {
    this.store = options.store;
    this.apns = options.apns;
    this.fcm = options.fcm;
    this.supportedPlatforms = new Set(options.supportedPlatforms ?? ["apns", "fcm"]);
    this.coalescer = new Coalescer(options.config);
    this.now = options.now ?? Date.now;
    this.uuid = options.uuid ?? (() => crypto.randomUUID().toLowerCase());
    this.source = options.source ?? new DefaultSource();
    this.staleAfterMs=options.config?.staleAfterMs ?? 5*60_000;
  }

  /** Public for tests: exposes the live coalescer. */
  coalescer_(): Coalescer { return this.coalescer; }

  /** Override for tests + the runtime "suspend pushes" toggle. */
  setSuspended(value: boolean): void { this.suspended = value; }
  isSuspended(): boolean { return this.suspended || this.source.notificationsSuppressed(); }

  registerDevice(input: RegisterDeviceInput): StoredDeviceInstall {
    if(!this.supportedPlatforms.has(input.platform)) throw new Error("notification provider is not configured");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.installationId)) throw new Error("invalid installation id");
    if(input.deviceId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.deviceId)) throw new Error("invalid device id");
    if(input.pushToken.length<1||input.pushToken.length>4096||/[\u0000-\u001f]/.test(input.pushToken)) throw new Error("invalid push token");
    if(input.appVersion.length<1||input.appVersion.length>128) throw new Error("invalid app version");
    const result = this.store.registerDeviceInstall({
      deviceId: input.deviceId ?? this.uuid(),
      installationId: input.installationId,
      platform: input.platform,
      pushToken: input.pushToken,
      appVersion: input.appVersion,
    });
    return result.device;
  }

  replaceToken(input: ReplaceTokenInput): StoredDeviceInstall {
    const existing = this.store.findDeviceInstallById(input.deviceId);
    if(existing && !this.supportedPlatforms.has(existing.platform)) throw new Error("notification provider is not configured");
    const updated = this.store.replaceDeviceToken(input);
    if (!updated) throw new Error(`device_not_found:${input.deviceId}`);
    return updated;
  }

  unregisterDevice(deviceId: string): void {
    this.store.unregisterDeviceInstall(deviceId);
    // Sweep coalescer state for the device across every known session.
    for (const session of this.store.sessionStates()) {
      if (typeof session.sessionId === "string") this.coalescer.drop(deviceId, session.sessionId);
    }
  }

  unregisterInstallation(installationId: string): number {
    const removed = this.store.unregisterInstallation(installationId);
    return removed;
  }

  listDevices(): readonly StoredDeviceInstall[] {
    return this.store.listActiveDeviceInstalls().filter((device) =>
      this.supportedPlatforms.has(device.platform),
    );
  }

  rejectionReason(deviceId: string): { readonly reason: string; readonly rejectedAt: number } | null {
    const install = this.store.findDeviceInstallById(deviceId);
    if (!install || !install.rejectedReason || install.rejectedAt === undefined) return null;
    return { reason: install.rejectedReason, rejectedAt: install.rejectedAt };
  }

  rejectDevice(deviceId: string, reason: string): void {
    this.store.markDeviceRejected(deviceId, reason);
    this.countersInternal.rejectedDevices += 1;
    // Drop the device permanently on the next sweep.
    setTimeout(() => {
      try { this.store.unregisterDeviceInstall(deviceId); } catch { /* best effort */ }
    }, 0).unref?.();
  }

  publishStatus(input: PublishStatusInput): { readonly delivered: number; readonly suppressed: number; readonly coalesced: number; readonly stale: number; readonly rejected: number } {
    const result = { delivered: 0, suppressed: 0, coalesced: 0, stale: 0, rejected: 0 };
    if (this.isSuspended()) { this.countersInternal.suppressed += 1; return { ...result, suppressed: 1 }; }
    const kind = input.kind;
    const sessionId = input.sessionId;

    // Dedupe: never publish the same source event twice.
    if (input.sourceEventId) {
      if (this.store.hasNotificationDedup(input.sourceEventId)) { this.countersInternal.coalesced += 1; return { ...result, coalesced: 1 }; }
      this.store.recordNotificationDedup({ sourceEventId: input.sourceEventId, kind, sessionId });
    }

    const now = this.now();
    // Stale: ignore statuses older than the configured drop window.
    if (input.sourceAt !== undefined && now - input.sourceAt > this.staleAfterMs) {
      this.countersInternal.staleDropped += 1;
      return { ...result, stale: 1 };
    }

    const notificationId = buildNotificationId({ kind, sessionId, ...(input.sourceEventId !== undefined ? { sourceEventId: input.sourceEventId } : {}), ...(input.sourceAt !== undefined ? { sourceAt: input.sourceAt } : {}) });
    const deepLink = input.deepLink ?? buildDeepLink({ kind, sessionId });
    const copy = buildNotificationCopy({ kind, hostDisplayName: this.source.hostDisplayName() });

    // Strict data block — only the closed allowlist of opaque keys.
    let data: Readonly<Record<string, string>>;
    try {
      data = sanitizeData({
        sessionId,
        notificationId,
        kind,
        deepLink,
        hostDisplayName: this.source.hostDisplayName(),
      } as unknown as Record<string, unknown>);
    } catch (error) {
      if (error instanceof NotificationPayloadError) {
        this.countersInternal.suppressed += 1;
        return { ...result, suppressed: 1 };
      }
      throw error;
    }

    for (const device of this.store.listActiveDeviceInstalls()) {
      if (!this.supportedPlatforms.has(device.platform)) continue;
      const previous = this.coalescer.snapshot(device.deviceId, input.sessionId);
      const decision = this.coalescer.decide({ deviceId: device.deviceId, sessionId: input.sessionId, kind, notificationId, now, previous });
      if (!decision.emit) {
        this.countersInternal.coalesced += 1;
        result.coalesced += 1;
        continue;
      }
      try {
        const status: NotificationStatus = {
          kind,
          sessionId: input.sessionId,
          notificationId,
          deepLink,
          createdAt: now,
          ...(copy.title ? { title: copy.title } : {}),
          ...(copy.body ? { body: copy.body } : {}),
        };
        const transport = device.platform === "apns" ? this.apns : this.fcm;
        const payload: TransportNotification = {
          platform: device.platform,
          deviceId: device.deviceId,
          pushToken: device.pushToken,
          status,
          alert: { title: copy.title, body: copy.body },
          data,
          collapseId: `${kind}:${input.sessionId}`,
          ttlSeconds: 60 * 60,
        };
        // Fire-and-forget with isolated error handling.
        Promise.resolve()
          .then(() => transport.send(payload))
          .then((tr) => {
            if (tr.kind === "delivered") {
              this.countersInternal.delivered += 1;
              this.store.touchDeviceInstall(device.deviceId);
            } else if (tr.kind === "transient_failure") {
              this.countersInternal.transientFailures += 1;
            } else {
              this.countersInternal.permanentFailures += 1;
              this.rejectDevice(device.deviceId, tr.reason);
            }
          })
          .catch((error: unknown) => {
            // Push/network failures NEVER block Pi.
            this.countersInternal.transientFailures += 1;
            void error;
          });
        result.delivered += 1;
      } catch (error) {
        // Same isolation guarantee: a malformed notification cannot
        // break the runtime.
        if (error instanceof NotificationPayloadError) {
          this.countersInternal.suppressed += 1;
          result.suppressed += 1;
          continue;
        }
        this.countersInternal.transientFailures += 1;
      }
    }
    return result;
  }

  sweep(): { readonly rejected: number; readonly dropped: number } {
    let rejected = 0;
    for (const device of this.store.listActiveDeviceInstalls()) {
      if (device.rejectedReason && device.rejectedAt !== undefined) {
        this.store.unregisterDeviceInstall(device.deviceId);
        rejected += 1;
      }
    }
    this.store.sweepNotificationDedup(24 * 60 * 60_000, this.now());
    const { dropped } = this.coalescer.sweep(this.now());
    return { rejected, dropped };
  }

  counters(): NotificationCounters { return { ...this.countersInternal }; }
}

/** Sanity-check helper used by tests. */
export function _DEFAULT_COALESCE_LIMITS(): typeof DEFAULT_COALESCE_LIMITS { return DEFAULT_COALESCE_LIMITS; }

/** Visible for the runtime — the only function it needs to call to
 * publish a status. Wraps {@link BridgeNotificationService.publishStatus}
 * so a missing service is a no-op (e.g. when the daemon is started
 * without push credentials). */
export function safePublishStatus(service: NotificationService | null | undefined, input: PublishStatusInput): ReturnType<NotificationService["publishStatus"]> {
  if (!service) return { delivered: 0, suppressed: 0, coalesced: 0, stale: 0, rejected: 0 };
  try { return service.publishStatus(input); }
  catch { return { delivered: 0, suppressed: 0, coalesced: 0, stale: 0, rejected: 0 }; }
}

/** Tiny helper that picks a host display name from arbitrary metadata. */
export function deriveHostDisplayName(source: NotificationEventSource | undefined): string {
  if (!source) return "Pi";
  try { return sanitizeNotificationString(source.hostDisplayName()) ?? "Pi"; }
  catch { return "Pi"; }
}

/** Re-export the constants used by `payload.ts`. */
export { STATUS_ONLY_DATA_KEYS };
