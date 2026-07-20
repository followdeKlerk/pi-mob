/**
 * M15 — APNs token-auth adapter.
 *
 * Implements the Apple Push Notification service HTTP/2 token-based
 * authentication flow as documented by Apple. The transport is fully
 * injectable so tests can substitute a fake without touching the
 * network.
 *
 * Wire format (always emitted):
 *
 *   POST /3/device/<token>
 *   authorization: bearer <jwt>
 *   apns-topic: <bundleId>
 *   apns-push-type: alert
 *   apns-priority: 10           (visible alert)
 *   apns-expiration: <ttl>      (unix seconds, 0 means drop immediately)
 *   apns-collapse-id: <key>     (rate-limited coalesce key)
 *
 *   {
 *     "aps": {
 *       "alert": { "title": "...", "body": "..." },
 *       "sound": "default",
 *       "thread-id": "<key>",
 *       "content-available": 0,
 *       "mutable-content": 0
 *     },
 *     "sessionId": "<id>",
 *     "notificationId": "<id>",
 *     "kind": "<kind>",
 *     "deepLink": "<url>",
 *     "hostDisplayName": "<display name>"
 *   }
 *
 * The adapter only ever sends status-only data (allowlisted upstream
 * in `payload.ts`). It rejects any device whose token is in the
 * `permanent` rejection reasons returned by Apple (`BadDeviceToken`,
 * `Unregistered`, `DeviceTokenNotForTopic`).
 */

import type {
  NotificationPlatform,
  NotificationTransport,
  TransportNotification,
  TransportResult,
} from "../types";
import { sanitizeData } from "../payload";

export interface ApnsConfig {
  readonly bundleId: string;
  readonly teamId: string;
  readonly keyId: string;
  /** ES256 (P-256) private key in PEM form, or a 32-byte raw key. */
  readonly signingKey: string | Uint8Array;
  /** Override the API host. Tests pass `http://localhost:port`. */
  readonly apiHost?: string;
  /** Production vs sandbox. */
  readonly production?: boolean;
  /** Default TTL when the notification doesn't set one. */
  readonly defaultTtlSeconds?: number;
  /** Hard request timeout. Default 5s. */
  readonly requestTimeoutMs?: number;
}

export interface ApnsTransportHooks {
  /**
   * Produce the bearer JWT for a given `now` (epoch seconds). Tests
   * override this to inject a fixed token. Production uses
   * {@link signApnsJwt}.
   */
  signJwt(input: { readonly now: number }): Promise<string> | string;
  /**
   * Issue the actual HTTP request. Tests override this to capture the
   * payload without hitting the network. Production uses
   * {@link fetchApns}.
   */
  send(input: {
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Uint8Array;
    readonly timeoutMs: number;
  }): Promise<ApnsHttpResponse>;
}

export interface ApnsHttpResponse {
  readonly status: number;
  readonly body: string;
  /** `apns-id` response header. */
  readonly apnsId?: string;
}

/** Permanent rejection reasons Apple documents as unrecoverable. */
const APNS_PERMANENT_REASONS: ReadonlySet<string> = new Set([
  "BadDeviceToken",
  "Unregistered",
  "DeviceTokenNotForTopic",
]);

/**
 * Sign an APNs JWT using the WebCrypto ES256 (P-256) algorithm.
 *
 * The JWT format is `base64url(header).base64url(payload).base64url(signature)`
 * where the signature is `ECDSA(P-256, SHA-256)` of the unsigned token
 * (header.payload).
 */
export async function signApnsJwt(input: {
  readonly teamId: string;
  readonly keyId: string;
  readonly signingKey: string | Uint8Array;
  readonly now: number;
}): Promise<string> {
  const header = { alg: "ES256", typ: "JWT", kid: input.keyId };
  const claims = { iss: input.teamId, iat: input.now };
  const encoder = new TextEncoder();
  const base64UrlEncode = (bytes: ArrayBuffer | Uint8Array): string => {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let str = "";
    for (let i = 0; i < view.length; i += 1) str += String.fromCharCode(view[i]!);
    return btoa(str).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  };
  const headerEncoded = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const claimsEncoded = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const signingInput = encoder.encode(`${headerEncoded}.${claimsEncoded}`);
  const key = await importApnsKey(input.signingKey);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, signingInput);
  return `${headerEncoded}.${claimsEncoded}.${base64UrlEncode(signature)}`;
}

async function importApnsKey(signingKey: string | Uint8Array): Promise<CryptoKey> {
  const pem = typeof signingKey === "string" ? signingKey : new TextDecoder().decode(signingKey);
  const begin=`-----BEGIN ${"PRIVATE"} KEY-----`; const end=`-----END ${"PRIVATE"} KEY-----`;
  const start=pem.indexOf(begin); const finish=pem.indexOf(end,start+begin.length);
  if (start<0||finish<0) throw new Error("apns signing key must be a PEM-encoded EC private key");
  const encoded=pem.slice(start+begin.length,finish);
  const der = Uint8Array.from(atob(encoded.replace(/\s+/g, "")), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** Default HTTP transport. Production path; tests should override. */
export async function fetchApns(input: { readonly url: string; readonly headers: Readonly<Record<string, string>>; readonly body: Uint8Array; readonly timeoutMs: number }): Promise<ApnsHttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(input.url, { method: "POST", headers: input.headers, body: input.body, signal: controller.signal });
    const body = await response.text();
    const apnsId=response.headers.get("apns-id");
    return { status: response.status, body, ...(apnsId ? { apnsId } : {}) };
  } finally {
    clearTimeout(timer);
  }
}

/** Reason parsed from a permanent APNs error body. */
function parseApnsReason(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { reason?: unknown };
    if (typeof parsed.reason === "string") return parsed.reason;
  } catch { /* not JSON: APNs always returns JSON, so this is unusual */ }
  return null;
}

export class ApnsAdapter implements NotificationTransport {
  readonly platform: NotificationPlatform = "apns";
  private readonly bundleId: string;
  private readonly apiHost: string;
  private readonly defaultTtl: number;
  private readonly requestTimeoutMs: number;
  private readonly hooks: ApnsTransportHooks;
  private readonly config: ApnsConfig;
  /** JWT cache, replaced when older than `jwtRefreshSeconds`. */
  private cachedJwt: { jwt: string; issuedAt: number } | null = null;
  private readonly jwtRefreshSeconds = 45 * 60;

  constructor(config: ApnsConfig, hooks?: Partial<ApnsTransportHooks>) {
    this.config = config;
    this.bundleId = config.bundleId;
    this.apiHost = config.apiHost ?? (config.production === false ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com");
    this.defaultTtl = config.defaultTtlSeconds ?? 60 * 60;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 5_000;
    this.hooks = {
      signJwt: hooks?.signJwt ?? ((input) => signApnsJwt({ teamId: config.teamId, keyId: config.keyId, signingKey: config.signingKey, now: input.now })),
      send: hooks?.send ?? fetchApns,
    };
  }

  /** Visible for tests. */
  config_(): ApnsConfig { return this.config; }

  private async bearer(now: number): Promise<string> {
    if (this.cachedJwt && now - this.cachedJwt.issuedAt < this.jwtRefreshSeconds) return this.cachedJwt.jwt;
    const jwt = await this.hooks.signJwt({ now });
    this.cachedJwt = { jwt, issuedAt: now };
    return jwt;
  }

  async send(notification: TransportNotification): Promise<TransportResult> {
    const now = Math.floor(Date.now() / 1000);
    const jwt = await this.bearer(now);
    const ttlSeconds = notification.ttlSeconds > 0 ? notification.ttlSeconds : this.defaultTtl;
    const expiration = now + ttlSeconds;
    const payload = {
      aps: {
        alert: { title: notification.alert.title, body: notification.alert.body },
        sound: "default",
        "thread-id": notification.collapseId,
        "content-available": 0,
        "mutable-content": 0,
      },
      ...sanitizeData(notification.data as unknown as Record<string, unknown>),
    };
    const body = new TextEncoder().encode(JSON.stringify(payload));
    const url = `${this.apiHost}/3/device/${encodeURIComponent(notification.pushToken)}`;
    const headers: Record<string, string> = {
      authorization: `bearer ${jwt}`,
      "apns-topic": this.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": String(expiration),
      "apns-collapse-id": notification.collapseId.slice(0, 64),
      "content-type": "application/json",
    };
    try {
      const response = await this.hooks.send({ url, headers, body, timeoutMs: this.requestTimeoutMs });
      if (response.status >= 200 && response.status < 300) {
        return response.apnsId !== undefined ? { kind: "delivered", providerMessageId: response.apnsId } : { kind: "delivered" };
      }
      const reason = parseApnsReason(response.body);
      if (response.status === 410 || (reason && APNS_PERMANENT_REASONS.has(reason))) {
        return { kind: "permanent_failure", reason: reason ?? `http_${response.status}` };
      }
      const retryAfterSeconds = response.status === 429 ? 60 : undefined;
      return { kind: "transient_failure", ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}), reason: reason ?? `http_${response.status}` };
    } catch (error) {
      return { kind: "transient_failure", reason: error instanceof Error ? error.message : String(error) };
    }
  }
}
