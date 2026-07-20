/**
 * M15 — Bridge notification core types.
 *
 * The notification subsystem is a *best-effort* side-channel that
 * surfaces durable turn lifecycle events to mobile devices via APNs
 * or FCM. It must never affect Pi: every call here is wrapped in a
 * try/catch, every outbound HTTP call has a strict timeout, and every
 * notification payload is filtered through a strict allowlist so the
 * mobile device never receives transcript, source, path, or tool
 * content.
 *
 * Privacy invariants:
 *
 *   - Default notifications carry only a stable opaque `notificationId`,
 *     a `kind`, and `title`/`body` strings constructed from the status
 *     policy (no model output, no path, no tool name, no session name).
 *   - Hosts may enable a custom title/body via the allowlist, but the
 *     strings are validated against the status-policy catalogue and
 *     bounded so they cannot carry rich content.
 *   - `data` (custom key/value) is restricted to opaque keys whose
 *     values are small strings used to route the tap action; sensitive
 *     keys (e.g. `transcript`, `path`, `tool`) are rejected.
 */

import type { BridgeStore } from "../core/store";

/** Notification platforms the bridge knows how to address. */
export type NotificationPlatform = "apns" | "fcm";

/** Stable notification kinds the policy maps turn events to. */
export type NotificationKind =
  | "settled"
  | "failed"
  | "indeterminate"
  | "needs_attention"
  | "crash_loop";

/**
 * Stable identifiers for the status categories the bridge tracks.
 * These are the only things that may appear in a default notification
 * payload; everything else flows through the strict allowlist in
 * {@link ./payload.ts}.
 */
export interface NotificationStatus {
  readonly kind: NotificationKind;
  /** Session the event belongs to (always the canonical sessionId). */
  readonly sessionId: string;
  /** Stable id mobile uses to dedupe when coalescing rules collapse events. */
  readonly notificationId: string;
  /** Optional deep-link target inside the app (e.g. `session/<id>`). */
  readonly deepLink: string;
  /** Server-side timestamp (epoch ms). */
  readonly createdAt: number;
  /** Optional human-readable alert strings. Always status-only, never content. */
  readonly title?: string;
  readonly body?: string;
  /** Optional, allowlist-restricted opaque metadata for the mobile client. */
  readonly data?: Readonly<Record<string, string>>;
}

/** A registered device install (one per mobile installation per platform). */
export interface StoredDeviceInstall {
  readonly deviceId: string;
  readonly installationId: string;
  readonly platform: NotificationPlatform;
  /** Opaque push token, hex/base64, opaque to the host. */
  readonly pushToken: string;
  /** App build/version reported by the client at registration. */
  readonly appVersion: string;
  /** Bump-count used by mobile to detect stale installations. */
  readonly tokenRevision: number;
  /** Last time this install sent any keep-alive signal. */
  readonly lastSeenAt: number;
  readonly createdAt: number;
  /** Filled when the provider reports the token as permanently rejected. */
  readonly rejectedReason?: string;
  readonly rejectedAt?: number;
}

/** Stored per-device/session coalescing state. */
export interface StoredCoalesceState {
  readonly deviceId: string;
  readonly sessionId: string;
  readonly coalesceKey: string;
  readonly lastKind: NotificationKind;
  readonly lastNotificationId: string;
  readonly count: number;
  readonly firstAt: number;
  readonly lastAt: number;
}

/** Payload that leaves the bridge through a transport. */
export interface TransportNotification {
  readonly platform: NotificationPlatform;
  readonly deviceId: string;
  readonly pushToken: string;
  readonly status: NotificationStatus;
  /** APNs `aps` / FCM `notification` block (string-only, allowlisted). */
  readonly alert: { readonly title: string; readonly body: string };
  /** Allowlisted opaque metadata; transport-specific shape. */
  readonly data: Readonly<Record<string, string>>;
  /** Transport-side collapse id (e.g. APNs `thread-id`). */
  readonly collapseId: string;
  /** Monotonic TTL in seconds; transport drops the notification after this. */
  readonly ttlSeconds: number;
}

/** Result of a single transport dispatch attempt. */
export type TransportResult =
  | { readonly kind: "delivered"; readonly providerMessageId?: string }
  | { readonly kind: "transient_failure"; readonly retryAfterSeconds?: number; readonly reason: string }
  | { readonly kind: "permanent_failure"; readonly reason: string };

/** Transport contract. Adapters swap this out for tests. */
export interface NotificationTransport {
  readonly platform: NotificationPlatform;
  send(notification: TransportNotification): Promise<TransportResult>;
}

/** Per-platform configuration. */
export interface NotificationConfig {
  /** Hard rate limit per (deviceId, sessionId) coalesce key. Default 60s. */
  readonly minIntervalMs?: number;
  /** Per-device ceiling (any coalesce key) per minute. Default 10. */
  readonly perMinuteCeiling?: number;
  /** Hard ceiling per host session lifetime to prevent floods. Default 50. */
  readonly sessionCeiling?: number;
  /** Drop window in ms: ignore stale statuses older than this. Default 5min. */
  readonly staleAfterMs?: number;
}

/** Hooks into the host lifecycle the service needs to observe. */
export interface NotificationEventSource {
  /** Resolves the host display name for status text (e.g. "Pi on Studio"). */
  hostDisplayName(): string;
  /** True when the host process should suppress push entirely. */
  notificationsSuppressed(): boolean;
}

export interface NotificationServiceOptions {
  readonly store: BridgeStore;
  readonly apns: NotificationTransport;
  readonly fcm: NotificationTransport;
  /** Providers configured for this host. Defaults to both transports. */
  readonly supportedPlatforms?: readonly NotificationPlatform[];
  readonly config?: NotificationConfig;
  /** Optional event source; defaults to a no-op source. */
  readonly source?: NotificationEventSource;
  /** Override for `Date.now()` (tests). */
  readonly now?: () => number;
  /** Override for `crypto.randomUUID` (tests). */
  readonly uuid?: () => string;
}

/** Public surface of the NotificationService (consumed by the runtime). */
export interface NotificationService {
  /** Register a new device install (idempotent on `(installationId, platform)`). */
  registerDevice(input: RegisterDeviceInput): StoredDeviceInstall;
  /** Replace a token on an existing install (handles APNs token rotation). */
  replaceToken(input: ReplaceTokenInput): StoredDeviceInstall;
  /** Unregister a device install (logout, lost phone, user opt-out). */
  unregisterDevice(deviceId: string): void;
  /** Unregister every install belonging to an installationId. */
  unregisterInstallation(installationId: string): number;
  /** List currently active installs (used by diagnostics). */
  listDevices(): readonly StoredDeviceInstall[];
  /** Last reason a device was rejected, if any. */
  rejectionReason(deviceId: string): { readonly reason: string; readonly rejectedAt: number } | null;
  /**
   * Publish a turn-status event for delivery to every active install.
   * Failures never propagate; status policy decides whether the event is
   * surfaced, coalesced, or dropped.
   */
  publishStatus(input: PublishStatusInput): { readonly delivered: number; readonly suppressed: number; readonly coalesced: number; readonly stale: number; readonly rejected: number };
  /** Permanently reject a device (called by transports). */
  rejectDevice(deviceId: string, reason: string): void;
  /** Sweep stale tokens / debug counters (called periodically). */
  sweep(): { readonly rejected: number; readonly dropped: number };
  /** Snapshot counters used by tests + diagnostics. */
  counters(): NotificationCounters;
}

export interface RegisterDeviceInput {
  readonly deviceId?: string;
  readonly installationId: string;
  readonly platform: NotificationPlatform;
  readonly pushToken: string;
  readonly appVersion: string;
}

export interface ReplaceTokenInput {
  readonly deviceId: string;
  readonly pushToken: string;
  readonly appVersion: string;
}

export interface PublishStatusInput {
  readonly sessionId: string;
  readonly kind: NotificationKind;
  /** Source event id; used to dedupe. */
  readonly sourceEventId?: string;
  /** Wall-clock time the source event was created. */
  readonly sourceAt?: number;
  /** Optional pre-validated deep-link target. */
  readonly deepLink?: string;
}

/** Counters maintained for diagnostics. */
export interface NotificationCounters {
  readonly delivered: number;
  readonly transientFailures: number;
  readonly permanentFailures: number;
  readonly rejectedDevices: number;
  readonly coalesced: number;
  readonly staleDropped: number;
  readonly suppressed: number;
}
