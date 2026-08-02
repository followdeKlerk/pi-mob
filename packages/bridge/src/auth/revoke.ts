/**
 * Phase 4 — host-side revocation path for installation credentials.
 *
 * Operators can revoke a previously bound installation in two ways:
 *   - via the bridge CLI (`pi-mob revoke-installation <installationId>`).
 *   - via a host diagnostic command from `pi-mob doctor`.
 *
 * Revocation is idempotent and never raises an error when the
 * installation is unknown: the host may forget an installationId
 * without knowing whether it was ever bound.
 */
import type { BridgeStore } from "../core/store";

export interface RevokeInstallationInput {
  readonly store: BridgeStore;
  readonly installationId: string;
  readonly reason: string;
  readonly at?: number;
}

export interface RevokeInstallationOutcome {
  readonly kind: "revoked" | "already_revoked" | "unknown";
  readonly at: number;
}

export function revokeInstallationCredential(input: RevokeInstallationInput): RevokeInstallationOutcome {
  const at = input.at ?? Date.now();
  const existing = input.store.findInstallationCredential(input.installationId);
  if (!existing) return { kind: "unknown", at };
  if (existing.revokedAt !== undefined) return { kind: "already_revoked", at };
  input.store.revokeInstallationCredential(input.installationId, input.reason, at);
  return { kind: "revoked", at };
}

/**
 * Enumerate revoked installs (host-side diagnostic surface).
 */
export function revokedInstallations(store: BridgeStore): readonly { readonly installationId: string; readonly revokedAt: number; readonly revokedReason: string }[] {
  const result: { installationId: string; revokedAt: number; revokedReason: string }[] = [];
  for (const id of store.aggregateRetainedInstallationIds()) {
    const row = store.findInstallationCredential(id);
    if (row && row.revokedAt !== undefined) {
      result.push({ installationId: id, revokedAt: row.revokedAt, revokedReason: row.revokedReason ?? "" });
    }
  }
  return result;
}
