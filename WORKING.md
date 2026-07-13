# Working

Status: M5 done; M6 activation ready

## Current checkpoint

**M6 — Failure recovery and process supervision**

The complete implementation plan is in [`BACKLOG.md`](BACKLOG.md). Normative documents under `docs/`, current `BACKLOG.md`, and this file override historical planning text.

## Current objective

Harden the real one-session path delivered in M5 across Pi, bridge, host, storage, network, and resource failures. Completed checkpoint evidence is retained in [`M1-SUMMARY.md`](M1-SUMMARY.md), [`M2-SUMMARY.md`](M2-SUMMARY.md), [`M3-SUMMARY.md`](M3-SUMMARY.md), [`M4-SUMMARY.md`](M4-SUMMARY.md), and [`M5-SUMMARY.md`](M5-SUMMARY.md).

## Completed foundation

- **M0:** product/architecture contracts and exact upstream/toolchain freeze.
- **M1:** monorepo scaffold, validation/CI, safe config/logger boundaries, and compiled bridge smoke.
- **M2:** executable protocol schemas, immutable Dart models, shared fixtures/hashes, and drift gates.
- **M3:** exact Pi `0.80.6` JSONL subprocess adapter and deterministic real prompt/tool/session proof.
- **M4:** durable SQLite commands/events/leases, loopback WebSocket synchronization, restart recovery, and lost-receipt one-dispatch proof.
- **M5:** one-session Flutter diagnostic client, Drift cache/drafts, ordered synchronization, real prompt/active abort, reconnect, and app-restart reconciliation.

## Immediate next actions

### 1. Process lifecycle

- Implement the bridge/Pi process state machine and process-group cleanup.
- Add bounded restart windows, crash-loop state, manual retry, active capacity, and eligible idle stop.
- Implement graceful host drain and restoration.

### 2. Deterministic failure controls

- Add test-only faults for receipt, dispatch, output pause, Pi/bridge kill, cursor, provider, database, storage, notifications, and cleanup.
- Prove fault controls are absent from release builds.

### 3. Truthful recovery surfaces

- Materialize crash, indeterminate, crash-loop, provider interruption, and oversized-output states.
- Prove slow-consumer disconnect/replay while Pi continues.

## Do not start yet

Until M6 exits: install/pairing/doctor, trust/read-only UX, polished multi-session transcript control, attachments, notifications, and later product surfaces.

## Blockers

None requiring a product decision.
