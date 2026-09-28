## Why

The current branch preserves the bridge and mobile work but production-wires OMP as the execution backend. The project previously ran through Pi directly, and restoring Pi is needed to retain the current product behavior while returning execution to the established Pi runtime and session format.

## What Changes

- Restore Pi subprocess supervision and session operations as the normal daemon's production execution path.
- Preserve the current mobile-facing protocol, durable bridge state, leases, replay/live delivery, canonical events, attachments, exports, notifications, and reconnect behavior.
- Reuse the surviving Pi RPC, adapter, normalization, history, and process-supervision implementation where it covers the required behavior.
- Replace OMP-specific daemon, install, lifecycle, backend-reference, and diagnostics wiring with Pi equivalents.
- Keep bridge session IDs stable and keep backend-private session details out of the mobile protocol.
- Define bounded behavior for capabilities or lifecycle operations that differ between the current OMP path and Pi.
- Update tests, fixtures, documentation, and capability reporting to prove the Pi production construction path.
- Do not add concurrent Pi/OMP runtime selection; the normal daemon will construct Pi only.

## Capabilities

### New Capabilities

- `pi-runtime`: Production daemon execution through supervised Pi subprocesses while preserving the existing bridge/mobile contract.

### Modified Capabilities

<!-- No existing main capability specs are present; the new capability captures the restored runtime contract. -->

## Impact

- Bridge composition root: `packages/bridge/src/daemon.ts`.
- Pi and OMP backend/session contracts, process supervision, normalization, history, and durable store references.
- Operations/install configuration and CLI flags currently named for OMP.
- Bridge integration tests, fixtures, capability reports, and project documentation.
- Mobile code should remain protocol-compatible; only behavior exposed by backend differences may require bounded handling.
- Existing uncommitted working-tree changes must be preserved and must not be overwritten by this change.
