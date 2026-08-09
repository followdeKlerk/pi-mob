## Why

The normal daemon now constructs supervised OMP sessions as its sole execution backend while preserving the bridge-owned durable command, replay, lease, and canonical transcript contracts. Remaining change work is explicit rather than hidden: Pi-session migration acceptance, backend-neutral cleanup, real OMP recovery proof, and removal or renaming of Pi-shaped compatibility code are not complete.

## What Changes

- **BREAKING** Replace Pi process launch, RPC transport, session lifecycle, event normalization, model discovery, and history reconciliation with OMP-backed implementations.
- Define a backend-neutral execution contract between the bridge runtime and the supervised agent backend.
- Preserve the mobile-facing pairing, authentication, command, lease, stream, attachment, export, notification, and canonical session-event contracts wherever their observable behavior remains valid.
- Map OMP turns, assistant output, tool activity, approvals, retries, compaction, cancellation, failures, and indeterminate outcomes into the canonical session-event model.
- Make session identity and persisted backend references explicit so bridge sessions can resume OMP sessions after reconnect and daemon restart.
- Provide an explicit, durable migration path for existing Pi-owned session history and bridge session metadata before production cutover.
- Define truthful OMP capability advertisement for model selection, command catalogue, notifications, and other optional surfaces.
- Make OMP the only production backend in the normal daemon; do not retain a Pi fallback, dual-runtime feature flag, or Pi compatibility path after cutover.
- Remove Pi runtime dependencies, launch flags, Pi-specific production modules, fixtures, tests, and documentation after migration acceptance.

## Capabilities

### New Capabilities

- `omp-execution-backend`: OMP process or service supervision, session lifecycle, command dispatch, event normalization, recovery, and capability reporting behind the bridge runtime.
- `backend-neutral-sessions`: Stable bridge session identity, OMP references, durable lifecycle state, reconnect behavior, and restart recovery independent of Pi-specific session files.
- `pi-session-migration`: Explicit migration of existing Pi sessions and bridge metadata into the OMP-backed session model, including bounded failure reporting and recovery requirements.

### Modified Capabilities

None. The repository has no existing OpenSpec capability specifications; the new capabilities define the replacement contract. Existing protocol behavior should only be modified where OMP cannot preserve an observable guarantee, and such changes require an explicit spec delta during the specs phase.

## Impact

- Affects `packages/bridge/src/daemon.ts`, the current `packages/bridge/src/pi/` transport, adapter, normalization, launch, and history modules, and their production-wiring tests.
- Adds OMP integration code and replaces the current Pi-specific backend boundary.
- Requires bridge-store schema or persisted-state changes for backend-neutral session references and migration markers.
- May require protocol capability and error updates, but the existing mobile WebSocket contract is the compatibility target rather than the migration driver.
- Requires real OMP integration fixtures, fault/recovery tests, migration tests, and mobile end-to-end verification.
- Removes Pi-specific runtime dependencies and the Pi executable assumption from setup, daemon configuration, release checks, and documentation after the cutover is proven.
- Grounds the implemented transport and session behavior in installed OMP help, disposable runtime probes, and upstream OMP RPC source; final acceptance still requires real-subprocess recovery and migration proof.
