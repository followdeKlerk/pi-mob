# Working

Status: M3 done; M4 activation ready

## Current checkpoint

**M4 — Durable bridge core and replay streams**

The complete implementation plan is in [`BACKLOG.md`](BACKLOG.md). Normative documents under `docs/`, current `BACKLOG.md`, and this file override historical planning text.

## Current objective

Build the durable loopback bridge core against the normalized exact-Pi adapter proven in M3. Completed checkpoint evidence is retained in [`M1-SUMMARY.md`](M1-SUMMARY.md), [`M2-SUMMARY.md`](M2-SUMMARY.md), and [`M3-SUMMARY.md`](M3-SUMMARY.md).

## Completed foundation

- **M0:** specification, product/architecture decisions, and exact upstream/toolchain freeze.
- **M1:** monorepo scaffold, root validation, CI, config/logger boundaries, and compiled bridge smoke.
- **M2:** executable protocol schemas, immutable Dart models, shared fixtures/hashes, and drift gates.
- **M3:** strict Pi `0.80.6` JSONL subprocess transport, normalized command/event adapter, real deterministic prompt/tool/session harness, and compatibility evidence.

## Immediate next actions

### 1. Durable SQLite foundation

- Schema/migrations with foreign keys, WAL, busy handling, integrity checks, stable host identity/generation, sessions, streams/events, commands, cursors, and leases.
- Atomic decimal-string stream cursor allocation and replay ordering.
- Database unavailable/full/read-only/locked/corrupt and backup/restore behavior.

### 2. Stream synchronization

- Loopback `/healthz`, `/readyz`, and `/v1/ws` handshake.
- Host/session subscriptions, replay/current/snapshot-required modes, multipart atomic snapshots, cursor acknowledgements, and independent stream repair.
- Bounded messages, rate limits, backpressure, and slow-consumer handling.

### 3. Durable command semantics

- One transaction for accepted command plus `command.state` event before receipt.
- Semantic-hash duplicate/current receipt and conflict rejection.
- Accepted-before-dispatch recovery, dispatched/running-to-indeterminate recovery, host/session lanes, and persisted controller lease primitives.

## M4 checkpoint proof

A client loses an accepted-command receipt, reconnects, resends, and observes one adapter dispatch plus ordered replay. Restart preserves host/session streams; expired cursors use an atomic snapshot baseline; unavailable/full storage rejects before acceptance.

## Do not start yet

Until M4 exits: mobile connection/persistence work (M5), polished transcript UI, failure supervisor expansion, install/pairing, push notifications, and later product surfaces.

## Blockers

None requiring a product decision.
