/**
 * One-time passcode enrollment binding helper.
 *
 * The bridge stores only a domain-separated SHA-256 hash of the six-digit
 * passcode and the hash of the freshly minted installation credential; the
 * passcode is never persisted.
 * The bind is performed inside a SQLite transaction so two concurrent
 * binds can never both win: only one consumes the passcode.
 *
 * Bind semantics are unknown, already-used, expired, or atomically bound.
 */
import { randomBytes } from "node:crypto";
import type { BridgeStore } from "../core/store";
import { hashCredential, hashPairingPasscode, issuePairingPasscode, PAIRING_PASSCODE_PATTERN } from "./credentials";
void randomBytes;

export type BindOutcome =
  | { readonly kind: "bound"; readonly credential: string; readonly installationId: string }
  | { readonly kind: "already_used" }
  | { readonly kind: "expired" }
  | { readonly kind: "unknown" }
  | { readonly kind: "malformed_passcode" };

export interface BindEnrollmentInput {
  readonly store: BridgeStore;
  readonly installationId: string;
  readonly plainPasscode: string;
  /** Pure credential factory; the bridge default uses crypto.randomBytes(32). */
  readonly issueCredential: () => string;
  /** Clock injection for tests. */
  readonly now?: () => number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function bindEnrollment(input: BindEnrollmentInput): BindOutcome {
  if (!UUID_PATTERN.test(input.installationId)) return { kind: "malformed_passcode" };
  if (typeof input.plainPasscode !== "string" || !PAIRING_PASSCODE_PATTERN.test(input.plainPasscode)) return { kind: "malformed_passcode" };
  const secretHash = hashPairingPasscode(input.plainPasscode);
  if (!secretHash) return { kind: "malformed_passcode" };
  const now = (input.now ?? Date.now)();
  const result = input.store.consumeEnrollmentSecret(secretHash, now, input.installationId);
  if (result.kind === "unknown") return { kind: "unknown" };
  if (result.kind === "expired") return { kind: "expired" };
  if (result.kind === "already_used") return { kind: "already_used" };
  const credentialPlaintext = input.issueCredential();
  const credentialHash = hashCredential(credentialPlaintext);
  if (!credentialHash) return { kind: "malformed_passcode" };
  input.store.upsertInstallationCredential({
    installationId: input.installationId,
    credentialHash,
    enrollmentSecretHash: secretHash,
    enrollmentSource: "manual",
    createdAt: now,
    lastSeenAt: now,
  });
  return { kind: "bound", credential: credentialPlaintext, installationId: input.installationId };
}

/**
 * Mint a pending six-digit pairing passcode and persist only its hash. Used
 * by `pi-mob pair`; the passcode is valid for a short period and one use.
 */
export interface IssuePendingEnrollmentInput {
  readonly store: BridgeStore;
  readonly ttlMs?: number;
  readonly now?: () => number;
  readonly issuePasscode?: () => string;
}

export interface PendingEnrollment {
  readonly plaintext: string;
  readonly expiresAt: number;
  readonly hash: string;
}

export function issuePendingEnrollment(input: IssuePendingEnrollmentInput): PendingEnrollment {
  const clock = input.now ?? (() => Date.now());
  const ttl = Math.min(Math.max(input.ttlMs ?? 5 * 60_000, 30_000), 60 * 60_000);
  const plaintext = (input.issuePasscode ?? issuePairingPasscode)();
  const hash = hashPairingPasscode(plaintext);
  const createdAt = clock();
  const expiresAt = createdAt + ttl;
  input.store.createEnrollmentSecret({ secretHash: hash, createdAt, expiresAt, usedAt: null });
  return { plaintext, expiresAt, hash };
}
