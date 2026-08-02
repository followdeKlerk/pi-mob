/**
 * Phase 4 — credential helpers.
 *
 * The bridge does not own a per-user account system. It owns a
 * per-installation bearer credential which is generated once during
 * enrollment, stored as a SHA-256 hash, and verified with
 * `crypto.timingSafeEqual`. No plaintext credential may be logged.
 *
 * Entropy: 32 bytes (256 bits) of `crypto.randomBytes` per credential.
 * Encoding: URL-safe Base64 (`base64url`) with a short prefix (`pc_`)
 * so a leaked log line can be grep-filtered while the secret itself
 * stays opaque to humans reading the line.
 *
 * The helpers in this file are the only call sites for
 * `crypto.timingSafeEqual`. The audit grep rule lives in
 * `scripts/security-check.ts`.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** Installation credential prefix (Base64URL of 32 random bytes = 43 chars). */
export const CREDENTIAL_PREFIX = "pc_" as const;
/** Legacy enrollment-secret prefix retained only for stored credential metadata. */
export const ENROLLMENT_PREFIX = "es_" as const;
/** Human pairing passcodes are six decimal digits. */
export const PAIRING_PASSCODE_PATTERN = /^\d{6}$/;

const ALPHABET = /^[A-Za-z0-9_-]+$/;

export interface CredentialMaterial {
  readonly plaintext: string;
  readonly hash: string;
}

/** Generates a fresh 256-bit installation credential. */
export function generateInstallationCredential(now: () => number = Date.now): string {
  void now;
  return `${CREDENTIAL_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Generates a fresh one-time six-digit pairing passcode. */
export function issuePairingPasscode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** Legacy generator retained for migration/test fixtures only. */
export function issueEnrollmentSecret(now: () => number = Date.now): string {
  void now;
  return `${ENROLLMENT_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Returns the SHA-256 hex hash of a plaintext credential or enrollment secret. */
export function hashCredential(plaintext: string): string;
export function hashCredential(plaintext: string, kind: "credential" | "enrollment"): string;
export function hashCredential(plaintext: string, kind: "credential" | "enrollment" = "credential"): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) return "";
  const prefix = kind === "enrollment" ? ENROLLMENT_PREFIX : CREDENTIAL_PREFIX;
  // Avoid leaking hashes of completely unrelated strings; only the canonical
  // shape (prefix + base64url payload) is hashed. Empty strings hash to empty
  // so a wrongly-shaped value cannot accidentally match a stored hash.
  if (!plaintext.startsWith(prefix)) return "";
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/** Convenience alias used by legacy enrollment fixtures. */
export const hashEnrollmentSecret = (plaintext: string): string => hashCredential(plaintext, "enrollment");

/** Hashes a pairing passcode with a domain separator before persistence. */
export function hashPairingPasscode(passcode: string): string {
  if (!PAIRING_PASSCODE_PATTERN.test(passcode)) return "";
  return createHash("sha256").update(`pi-mob-pairing-passcode:${passcode}`, "utf8").digest("hex");
}

/**
 * Verifies a plaintext against a stored hash with a constant-time
 * comparison. The plaintext is hashed first so the comparison runs on
 * equal-length buffers even when the supplied plaintext is malformed.
 */
export function verifyCredential(plaintext: string, storedHash: string): boolean {
  if (typeof plaintext !== "string" || typeof storedHash !== "string") return false;
  if (!ALPHABET.test(storedHash) || storedHash.length !== 64) return false;
  const candidate = hashCredential(plaintext);
  if (candidate.length !== 64) return false;
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Format check for a credential string. Used by callers to fail fast. */
export function isPlausibleCredential(plaintext: string): boolean {
  if (typeof plaintext !== "string") return false;
  if (!plaintext.startsWith(CREDENTIAL_PREFIX)) return false;
  const tail = plaintext.slice(CREDENTIAL_PREFIX.length);
  return tail.length === 43 && ALPHABET.test(tail);
}

/** Format check for a pairing passcode. */
export function isPlausiblePairingPasscode(value: string): boolean {
  return typeof value === "string" && PAIRING_PASSCODE_PATTERN.test(value);
}

/** Format check for a legacy enrollment secret. */
export function isPlausibleEnrollmentSecret(plaintext: string): boolean {
  if (typeof plaintext !== "string") return false;
  if (!plaintext.startsWith(ENROLLMENT_PREFIX)) return false;
  const tail = plaintext.slice(ENROLLMENT_PREFIX.length);
  return tail.length === 43 && ALPHABET.test(tail);
}

/** Bundles a freshly generated credential with its hash for atomic persistence. */
export function issueCredentialBundle(now: () => number = Date.now): CredentialMaterial {
  const plaintext = generateInstallationCredential(now);
  return { plaintext, hash: hashCredential(plaintext) };
}
