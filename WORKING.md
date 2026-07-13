# Working

Status: M4 done; M5 activation ready

## Current checkpoint

**M5 — One-session end-to-end diagnostic client**

The complete implementation plan is in [`BACKLOG.md`](BACKLOG.md). Normative documents under `docs/`, current `BACKLOG.md`, and this file override historical planning text.

## Current objective

Build the plain one-session Flutter diagnostic client against the durable bridge proven in M4. Completed checkpoint evidence is retained in [`M1-SUMMARY.md`](M1-SUMMARY.md), [`M2-SUMMARY.md`](M2-SUMMARY.md), [`M3-SUMMARY.md`](M3-SUMMARY.md), and [`M4-SUMMARY.md`](M4-SUMMARY.md).

## Completed foundation

- **M0:** product/architecture contracts and exact upstream/toolchain freeze.
- **M1:** monorepo scaffold, validation/CI, safe config/logger boundaries, and compiled bridge smoke.
- **M2:** executable protocol schemas, immutable Dart models, shared fixtures/hashes, and drift gates.
- **M3:** exact Pi `0.80.6` JSONL subprocess adapter and deterministic real prompt/tool/session proof.
- **M4:** durable SQLite commands/events/leases, loopback WebSocket handshake, replay/current/snapshots, restart recovery, limits/backpressure, and lost-receipt one-dispatch proof.

## Immediate next actions

### 1. Mobile durable connection state

- Drift schema/migrations for host, session, events, cursors, and drafts.
- Hello/subscription synchronization state machine with host-generation reset.
- Ordered reducer with deduplication, gaps, replay, and atomic snapshots.

### 2. One-session diagnostic flow

- Manual endpoint/readiness screen and one configured workspace/session.
- Raw normalized event/transcript list.
- Draft, submit/current receipt reconciliation, error restoration, abort, and disabled offline send.

### 3. End-to-end recovery proof

- Real Pi prompt completion and abort.
- Lost receipt with one dispatch.
- Foreground disconnect/replay and mobile process restart to identical settled state.
- Draft clears only after accepted/current receipt and never auto-sends after reconnect.

## Do not start yet

Until M5 exits: polished transcript/tool UI, broad process-supervisor work, install/pairing, trust/read-only UX, multi-session control, attachments, notifications, and later product surfaces.

## Blockers

None requiring a product decision.
