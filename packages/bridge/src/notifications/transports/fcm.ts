/**
 * M15 — FCM HTTP v1 adapter.
 *
 * Implements Google's Firebase Cloud Messaging HTTP v1 API
 * (`POST https://fcm.googleapis.com/v1/projects/<project>/messages:send`).
 *
 * Authentication uses a Google service account. The adapter obtains a
 * short-lived OAuth 2.0 access token via the standard service-account
 * JWT exchange (signed with RS256). Tests override the hooks to skip
 * the network round-trip.
 *
 * Wire format:
 *
 *   POST /v1/projects/<projectId>/messages:send
 *   authorization: Bearer <oauth token>
 *   content-type: application/json
 *
 *   {
 *     "message": {
 *       "token": "<device token>",
 *       "notification": { "title": "...", "body": "..." },
 *       "data": { "sessionId": "...", "notificationId": "...", ... },
 *       "android": {
 *         "priority": "HIGH",
 *         "collapse_key": "<key>",
 *         "ttl": "<ttl>s"
 *       }
 *     }
 *   }
 *
 * Permanent rejections: `UNREGISTERED`, `INVALID_ARGUMENT` (for token
 * shape errors), and `SENDER_ID_MISMATCH`.
 */

import type {
  NotificationPlatform,
  NotificationTransport,
  TransportNotification,
  TransportResult,
} from "../types";
import { sanitizeData } from "../payload";

export interface FcmConfig {
  readonly projectId: string;
  readonly serviceAccountEmail: string;
  /** PEM-encoded RSA private key for the service account. */
  readonly privateKey: string;
  /** Override API host (tests use `http://localhost:port`). */
  readonly apiHost?: string;
  /** Default TTL when the notification doesn't set one. */
  readonly defaultTtlSeconds?: number;
  /** Hard request timeout. Default 5s. */
  readonly requestTimeoutMs?: number;
  /** Override the access-token TTL. Default 55 minutes. */
  readonly accessTokenTtlSeconds?: number;
}

export interface FcmTransportHooks {
  /** Issue the OAuth 2.0 access token (production uses {@link fetchFcmAccessToken}). */
  fetchAccessToken(input: { readonly now: number }): Promise<{ readonly token: string; readonly expiresAt: number }>;
  /** Issue the HTTP request (production uses {@link fetchFcm}). */
  send(input: {
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Uint8Array;
    readonly timeoutMs: number;
  }): Promise<FcmHttpResponse>;
}

export interface FcmHttpResponse {
  readonly status: number;
  readonly body: string;
  /** `name` field from the response body (provider message id). */
  readonly providerMessageId?: string;
}

const FCM_PERMANENT_REASONS: ReadonlySet<string> = new Set([
  "UNREGISTERED",
  "SENDER_ID_MISMATCH",
]);

/** Parse an error code from an FCM error body. */
function parseFcmErrorCode(body: string): { readonly code: string; readonly status: number } | null {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; status?: unknown; message?: unknown; details?: unknown } };
    if (!parsed.error) return null;
    const code = typeof parsed.error.code === "number" ? parsed.error.code : 0;
    const status = typeof parsed.error.status === "string" ? parsed.error.status : "";
    return { code: status || String(code), status: code };
  } catch { return null; }
}

function parseFcmMessageId(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { name?: unknown };
    if (typeof parsed.name === "string") return parsed.name;
  } catch { /* not JSON */ }
  return undefined;
}

/**
 * Sign a service-account JWT for the OAuth 2.0 token exchange.
 * Uses WebCrypto RS256 (SHA-256 + RSA-PKCS1-v1_5).
 */
export async function signServiceAccountJwt(input: {
  readonly serviceAccountEmail: string;
  readonly privateKey: string;
  readonly now: number;
  readonly ttlSeconds: number;
}): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: input.serviceAccountEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: input.now,
    exp: input.now + input.ttlSeconds,
  };
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
  const key = await importServiceAccountKey(input.privateKey);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, signingInput);
  return `${headerEncoded}.${claimsEncoded}.${base64UrlEncode(signature)}`;
}

async function importServiceAccountKey(pem: string): Promise<CryptoKey> {
  const begin=`-----BEGIN ${"PRIVATE"} KEY-----`; const end=`-----END ${"PRIVATE"} KEY-----`;
  const start=pem.indexOf(begin); const finish=pem.indexOf(end,start+begin.length);
  if (start<0||finish<0) throw new Error("fcm private key must be a PEM-encoded RSA private key");
  const encoded=pem.slice(start+begin.length,finish);
  const der = Uint8Array.from(atob(encoded.replace(/\s+/g, "")), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

/** Exchange a service-account JWT for an OAuth 2.0 access token. */
export async function fetchFcmAccessToken(input: {
  readonly serviceAccountEmail: string;
  readonly privateKey: string;
  readonly now: number;
  readonly ttlSeconds: number;
  readonly timeoutMs: number;
}): Promise<{ readonly token: string; readonly expiresAt: number }> {
  const assertion = await signServiceAccountJwt({
    serviceAccountEmail: input.serviceAccountEmail,
    privateKey: input.privateKey,
    now: input.now,
    ttlSeconds: input.ttlSeconds,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion });
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`fcm token exchange failed: ${response.status} ${text}`);
    const parsed = JSON.parse(text) as { access_token?: unknown; expires_in?: unknown };
    if (typeof parsed.access_token !== "string") throw new Error("fcm token exchange returned no access_token");
    const expiresIn = typeof parsed.expires_in === "number" ? parsed.expires_in : input.ttlSeconds;
    return { token: parsed.access_token, expiresAt: input.now + Math.min(expiresIn, input.ttlSeconds) };
  } finally {
    clearTimeout(timer);
  }
}

/** Production HTTP send. Tests override. */
export async function fetchFcm(input: { readonly url: string; readonly headers: Readonly<Record<string, string>>; readonly body: Uint8Array; readonly timeoutMs: number }): Promise<FcmHttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(input.url, { method: "POST", headers: input.headers, body: input.body, signal: controller.signal });
    const body = await response.text();
    let providerMessageId: string | undefined;
    if (response.ok) providerMessageId = parseFcmMessageId(body);
    return { status: response.status, body, ...(providerMessageId ? { providerMessageId } : {}) };
  } finally {
    clearTimeout(timer);
  }
}

export class FcmAdapter implements NotificationTransport {
  readonly platform: NotificationPlatform = "fcm";
  private readonly projectId: string;
  private readonly apiHost: string;
  private readonly defaultTtl: number;
  private readonly requestTimeoutMs: number;
  private readonly accessTokenTtlSeconds: number;
  private readonly hooks: FcmTransportHooks;
  private readonly config: FcmConfig;
  private cachedAccessToken: { token: string; expiresAt: number } | null = null;

  constructor(config: FcmConfig, hooks?: Partial<FcmTransportHooks>) {
    this.config = config;
    this.projectId = config.projectId;
    this.apiHost = config.apiHost ?? "https://fcm.googleapis.com";
    this.defaultTtl = config.defaultTtlSeconds ?? 60 * 60;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 5_000;
    this.accessTokenTtlSeconds = config.accessTokenTtlSeconds ?? 55 * 60;
    this.hooks = {
      fetchAccessToken: hooks?.fetchAccessToken ?? ((input) => fetchFcmAccessToken({ serviceAccountEmail: config.serviceAccountEmail, privateKey: config.privateKey, now: input.now, ttlSeconds: this.accessTokenTtlSeconds, timeoutMs: this.requestTimeoutMs })),
      send: hooks?.send ?? fetchFcm,
    };
  }

  /** Visible for tests. */
  config_(): FcmConfig { return this.config; }

  private async accessToken(now: number): Promise<string> {
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAt - 60 > now) return this.cachedAccessToken.token;
    const token = await this.hooks.fetchAccessToken({ now });
    this.cachedAccessToken = token;
    return token.token;
  }

  async send(notification: TransportNotification): Promise<TransportResult> {
    const now = Math.floor(Date.now() / 1000);
    const token = await this.accessToken(now);
    const ttlSeconds = notification.ttlSeconds > 0 ? notification.ttlSeconds : this.defaultTtl;
    const payload = {
      message: {
        token: notification.pushToken,
        notification: { title: notification.alert.title, body: notification.alert.body },
        data: sanitizeData(notification.data as unknown as Record<string, unknown>),
        android: {
          priority: "HIGH",
          collapse_key: notification.collapseId.slice(0, 64),
          ttl: `${ttlSeconds}s`,
          notification: { click_action: "FLUTTER_NOTIFICATION_CLICK", channel_id: "pi_mob_status" },
        },
      },
    };
    const body = new TextEncoder().encode(JSON.stringify(payload));
    const url = `${this.apiHost}/v1/projects/${encodeURIComponent(this.projectId)}/messages:send`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    try {
      const response = await this.hooks.send({ url, headers, body, timeoutMs: this.requestTimeoutMs });
      if (response.status >= 200 && response.status < 300) return { kind: "delivered", ...(response.providerMessageId ? { providerMessageId: response.providerMessageId } : {}) };
      const error = parseFcmErrorCode(response.body);
      const reason = error?.code ?? `http_${response.status}`;
      if (error && FCM_PERMANENT_REASONS.has(reason)) return { kind: "permanent_failure", reason };
      const retryAfterSeconds = response.status === 429 ? 60 : undefined;
      return { kind: "transient_failure", ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}), reason };
    } catch (error) {
      return { kind: "transient_failure", reason: error instanceof Error ? error.message : String(error) };
    }
  }
}
