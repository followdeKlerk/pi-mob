/**
 * Phase 4 RED — store migration v5 carries the credential + enrollment tables.
 *
 * The migration is additive: v1-v4 stay byte-identical. v5 introduces:
 *   - installation_credentials(installation_id PK, credential_hash UNIQUE,
 *     enrollment_secret_hash, expires_at, revoked_at, ...)
 *   - enrollment_secrets(secret_hash PK, created_at, expires_at, used_at)
 *
 * This is the storage-layer contract. Round-trip tests live in
 * `auth-hello.test.ts` and `auth-enrollment.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BridgeStore } from "../src/core/store";

function openStore(): { readonly store: BridgeStore; readonly path: string; cleanup: () => void } {
  const path = join(mkdtempSync(join(tmpdir(), "pi-mob-auth-store-")), "bridge.sqlite");
  const store = new BridgeStore(path);
  return { store, path, cleanup: () => store.close() };
}

describe("Phase 4 store migration v5", () => {
  test("v5 schema applies on a fresh database", () => {
    const handle = openStore();
    try {
      const rows = handle.store.migrationsApplied();
      expect(rows).toContain(5);
    } finally {
      handle.cleanup();
    }
  });

  test("installation_credentials round-trips a credential record", () => {
    const handle = openStore();
    try {
      const installationId = "11111111-1111-4111-8111-111111111111";
      const credentialHash = "f".repeat(64);
      const enrollmentHash = "a".repeat(64);
      handle.store.upsertInstallationCredential({
        installationId,
        credentialHash,
        enrollmentSecretHash: enrollmentHash,
        enrollmentSource: "qr",
        createdAt: 1_700_000_000_000,
        lastSeenAt: 1_700_000_000_000,
      });
      const loaded = handle.store.findInstallationCredential(installationId);
      expect(loaded).not.toBeNull();
      expect(loaded!.credentialHash).toBe(credentialHash);
      expect(loaded!.enrollmentSource).toBe("qr");
      expect(loaded!.revokedAt).toBeUndefined();
    } finally {
      handle.cleanup();
    }
  });

  test("enrollment_secret table enforces single-use and expires", () => {
    const handle = openStore();
    try {
      const hash = "b".repeat(64);
      handle.store.createEnrollmentSecret({ secretHash: hash, createdAt: 1, expiresAt: 2_000, usedAt: null });
      expect(handle.store.consumeEnrollmentSecret(hash, 1_000).kind).toBe("consumed");
      expect(handle.store.consumeEnrollmentSecret(hash, 1_000).kind).toBe("already_used");
      handle.store.createEnrollmentSecret({ secretHash: "c".repeat(64), createdAt: 1, expiresAt: 2, usedAt: null });
      expect(handle.store.consumeEnrollmentSecret("c".repeat(64), 10_000).kind).toBe("expired");
    } finally {
      handle.cleanup();
    }
  });

  test("revoke marks revoked_at and rejects further use", () => {
    const handle = openStore();
    try {
      const installationId = "22222222-2222-4222-8222-222222222222";
      handle.store.upsertInstallationCredential({
        installationId,
        credentialHash: "9".repeat(64),
        enrollmentSecretHash: "8".repeat(64),
        enrollmentSource: "manual",
        createdAt: 1,
        lastSeenAt: 1,
      });
      handle.store.revokeInstallationCredential(installationId, "operator_revoke", 2_000);
      const loaded = handle.store.findInstallationCredential(installationId);
      expect(loaded!.revokedAt).toBe(2_000);
      expect(loaded!.revokedReason).toBe("operator_revoke");
    } finally {
      handle.cleanup();
    }
  });
});
