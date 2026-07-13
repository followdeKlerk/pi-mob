# M4 — Durable bridge core and replay streams

Status: **DONE**

## Outcome

The loopback bridge now durably accepts commands, journals independent host/session streams, synchronizes clients through replay or atomic snapshots, persists controller leases, and fails closed when durable storage is unavailable.

## Delivered

- Checksummed Bun SQLite migration with foreign keys, WAL, synchronous full durability, bounded busy handling, integrity/readiness checks, and stable host identity/generation.
- Durable sessions, stream positions/events, semantic commands, client cursor acknowledgements, controller lease history, and registered backup metadata.
- Canonical arbitrary-precision decimal cursor allocation and replay ordering.
- One-transaction command acceptance plus `command.state`; current duplicate receipt and changed-payload conflict behavior.
- Startup recovery before readiness: accepted work resumes once; dispatched/running work becomes indeterminate and never auto-runs.
- Bounded host/session lanes and bridge-local atomic controller acquire/takeover/release transitions.
- Mandatory host subscription, one full plus five summary sessions, bounded summary filtering, current/replay/snapshot-required synchronization, multipart snapshots, buffered replay/live handoff, cursor repair, and independent stream continuity.
- Loopback `/healthz`, `/readyz`, and `/v1/ws` with protocol/host/capability handshake, text/schema/size checks, synchronization gating, stable errors, token-bucket controls, compression disabled, and 8 MiB slow-consumer closure.
- Registered-checksum online backup and controlled restore with rollback copy, integrity verification, and host-generation increment.

## Checkpoint proof

`packages/bridge/test/m4-demo.test.ts` closes the first client after command submission without consuming its receipt, waits for durable processing, restarts the database/runtime/server, replays ordered command events, resends the same command, receives `duplicate:true`, and proves the adapter dispatch count remains one. It also proves live subscribers receive accepted → dispatched → running → completed in cursor order.

## Failure evidence

`docs/evidence/m4-database-transition-report.json` records the database and transport transition matrix. Focused complex-invariant tests cover locked/full/read-only/corrupt storage, atomic rollback, restart recovery, backup/restore, lease authorization/races, replay/snapshot boundaries, summary filtering, replay/live handoff, malformed cursors, oversized/binary traffic, rate limiting, and a genuinely blocked TCP slow consumer.

## Validation

```text
bun test packages/bridge/test/m4-store.test.ts \
  packages/bridge/test/m4-domain.test.ts \
  packages/bridge/test/m4-server.test.ts \
  packages/bridge/test/m4-demo.test.ts
bun run all
```

## Next checkpoint

M5 builds the one-session Flutter diagnostic client against this durable bridge and proves real prompt/abort/reconnect/app-restart behavior without duplicate execution.
