/**
 * M15 — strict status-only/default-generic payload allowlist.
 *
 * The bridge never serializes transcripts, source content, file paths,
 * tool names, session names, model output, or any other private content
 * into a push notification. Every field that leaves the host must be:
 *
 *   1. present in the static allowlist below, AND
 *   2. a plain string under the documented length cap, AND
 *   3. pass the regex sanitizer (no control chars, no embedded binary).
 *
 * `data` keys are restricted to a closed set so providers can never
 * receive opaque payloads that bypass the allowlist. The default body
 * copy is generated from the status policy so it cannot leak content
 * even when the host omits an explicit body string.
 */

import type { NotificationKind, NotificationStatus } from "./types";

/** Max length of any single string that may appear in a notification. */
export const MAX_NOTIFICATION_STRING = 140;
/** Max bytes the JSON `data` block may occupy. */
export const MAX_DATA_BYTES = 2 * 1024;
/** Max keys in the `data` block. */
export const MAX_DATA_KEYS = 8;

/** Allowed keys in the `data` block. */
export const ALLOWED_DATA_KEYS = new Set([
  "sessionId",
  "notificationId",
  "deepLink",
  "kind",
  "hostDisplayName",
]);

/** Forbidden key fragments. Any `data` key matching these is rejected. */
const FORBIDDEN_KEY_PATTERNS = [
  /transcript/i,
  /message/i,
  /content/i,
  /path/i,
  /file/i,
  /tool/i,
  /secret/i,
  /credential/i,
  /token/i,
  /output/i,
  /prompt/i,
  /body/i,
  /payload/i,
  /preview/i,
  /snippet/i,
];

const SAFE_STRING = /^[\P{Cc}\P{Cn}\p{Extended_Pictographic}]*$/u;

export class NotificationPayloadError extends Error {
  override readonly name = "NotificationPayloadError";
  constructor(readonly code: "too_long" | "forbidden_key" | "invalid_string" | "too_many_keys" | "oversize", message: string) { super(message); }
}

/**
 * Coerce a caller-supplied title/body into a safe notification string.
 * Returns `null` if the caller-supplied string is unsafe (caller should
 * fall back to the default body).
 */
export function sanitizeNotificationString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0) return null;
  if (value.length > MAX_NOTIFICATION_STRING) return null;
  if (!SAFE_STRING.test(value)) return null;
  // Reject anything that smells like a URL/path/email to avoid leaking
  // personal identifiers even by accident.
  if (/(\/\/|\/|@|\.git\b|\.com\b|\.io\b|\.net\b|\bfile:)/i.test(value)) return null;
  return value;
}

/** Validate the opaque `data` block. Throws on any disallowed key. */
export function sanitizeData(input: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> {
  const keys = Object.keys(input);
  if (keys.length > MAX_DATA_KEYS) throw new NotificationPayloadError("too_many_keys", `data has ${keys.length} keys, max ${MAX_DATA_KEYS}`);
  const out: Record<string, string> = {};
  let bytes = 2; // braces
  for (const key of keys) {
    if (!ALLOWED_DATA_KEYS.has(key)) {
      for (const pattern of FORBIDDEN_KEY_PATTERNS) if (pattern.test(key)) throw new NotificationPayloadError("forbidden_key", `data key '${key}' is not allowed`);
      throw new NotificationPayloadError("forbidden_key", `data key '${key}' is not in the allowlist`);
    }
    const raw=input[key];
    const value = key === "deepLink" && typeof raw === "string" && /^pi-mob:\/\/session\/[0-9a-f-]{36}\?kind=(settled|failed|indeterminate|needs_attention|crash_loop)$/.test(raw)
      ? raw
      : sanitizeNotificationString(raw);
    if (value === null) throw new NotificationPayloadError("invalid_string", `data value for '${key}' is not a safe notification string`);
    bytes += Buffer.byteLength(key) + value.length + 6;
    if (bytes > MAX_DATA_BYTES) throw new NotificationPayloadError("oversize", `data block exceeds ${MAX_DATA_BYTES} bytes`);
    out[key] = value;
  }
  return out;
}

/**
 * Default title/body catalogue. The mapping is a *pure function* of
 * the kind — there is no way for the host to inject session-specific
 * content here, so default notifications cannot leak private data.
 */
const DEFAULT_COPY: Readonly<Record<NotificationKind, { readonly title: string; readonly body: string }>> = Object.freeze({
  settled: { title: "Pi", body: "Turn finished" },
  failed: { title: "Pi", body: "Turn failed" },
  indeterminate: { title: "Pi", body: "Status uncertain — check Pi" },
  needs_attention: { title: "Pi", body: "Pi needs your attention" },
  crash_loop: { title: "Pi", body: "Pi is in a crash loop" },
});

export interface BuiltNotificationCopy {
  readonly title: string;
  readonly body: string;
}

/** Build safe title/body for a status. Uses defaults when override is unsafe. */
export function buildNotificationCopy(input: { readonly kind: NotificationKind; readonly title?: unknown; readonly body?: unknown; readonly hostDisplayName?: string }): BuiltNotificationCopy {
  const defaults = DEFAULT_COPY[input.kind];
  const safeHost = sanitizeNotificationString(input.hostDisplayName);
  const titleOverride = sanitizeNotificationString(input.title);
  const bodyOverride = sanitizeNotificationString(input.body);
  const title = titleOverride ?? (safeHost ? `${safeHost} · Pi` : defaults.title);
  const body = bodyOverride ?? defaults.body;
  return { title, body };
}

/** Validate a status block end-to-end. Throws on any disallowed field. */
export function assertStatusPayloadAllowed(status: NotificationStatus): void {
  if (status.title !== undefined) {
    const safe = sanitizeNotificationString(status.title);
    if (safe === null) throw new NotificationPayloadError("invalid_string", "status.title failed sanitization");
  }
  if (status.body !== undefined) {
    const safe = sanitizeNotificationString(status.body);
    if (safe === null) throw new NotificationPayloadError("invalid_string", "status.body failed sanitization");
  }
  if (status.data) sanitizeData(status.data as Readonly<Record<string, unknown>>);
}
