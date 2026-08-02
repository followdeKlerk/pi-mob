/**
 * Phase 4 RED — credential helpers and constant-time hash compare.
 *
 * The credential helpers MUST be the only API call sites for
 * `crypto.timingSafeEqual` so the audit can grep for the canonical
 * constant-time path. No plaintext or hash is allowed to leak to
 * the redaction logger.
 */

import { describe, expect, test } from "bun:test";
import {
  generateInstallationCredential,
  hashCredential,
  verifyCredential,
  issueEnrollmentSecret,
  hashEnrollmentSecret,
} from "../src/auth/credentials";

describe("Phase 4 credential helpers", () => {
  test("issues a base64url-encoded 256-bit secret", () => {
    const value = generateInstallationCredential();
    expect(value).toMatch(/^pc_[A-Za-z0-9_-]{43}$/);
  });

  test("hashCredential is deterministic and SHA-256 hex", () => {
    const a = hashCredential("pc_abc");
    const b = hashCredential("pc_abc");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test("verifyCredential returns true on exact match and false otherwise", () => {
    const stored = hashCredential("pc_xyz");
    expect(verifyCredential("pc_xyz", stored)).toBe(true);
    expect(verifyCredential("pc_zzz", stored)).toBe(false);
    expect(verifyCredential("", stored)).toBe(false);
  });

  test("enrollment secret entropy matches installation credential entropy", () => {
    const secret = issueEnrollmentSecret();
    expect(secret).toMatch(/^es_[A-Za-z0-9_-]{43}$/);
    expect(hashEnrollmentSecret(secret).length).toBe(64);
  });
});
