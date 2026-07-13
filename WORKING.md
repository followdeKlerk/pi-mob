# Working

Status: M6 done; M7 activation ready

## Current checkpoint

**M7 — macOS install, Serve pairing, and doctor**

The complete implementation plan is in [`BACKLOG.md`](BACKLOG.md). Normative documents under `docs/`, current `BACKLOG.md`, and this file override historical planning text.

## Current objective

Turn the supervised M6 bridge into an installable owner-only macOS service with persistent private Tailscale Serve, pairing, diagnosis, update/rollback, and uninstall flows. Completed evidence is retained in [`M1-SUMMARY.md`](M1-SUMMARY.md) through [`M6-SUMMARY.md`](M6-SUMMARY.md).

## Completed foundation

- **M0–M2:** frozen contracts, scaffold, executable protocol schemas, and cross-language fixtures.
- **M3:** exact Pi `0.80.6` RPC adapter and real deterministic provider proof.
- **M4:** durable SQLite commands/events/leases, synchronization, snapshots, and one-dispatch recovery.
- **M5:** one-session Flutter diagnostic client with durable drafts, reconnect, and app-restart reconciliation.
- **M6:** supervised Pi lifecycle, crash loops, capacity/idle/drain/reboot recovery, deterministic fault controls, bounded output, visible failure states, and slow-consumer replay.

## Immediate next actions

### 1. Installable release

- Produce the supported compiled daemon artifact, manifest, checksums, and licenses.
- Install owner-only state/config/log directories, absolute Pi path, allowlisted environment, and user LaunchAgent.

### 2. Private connectivity and diagnosis

- Configure persistent Tailscale Serve without disturbing unrelated routes.
- Reject Funnel/public/wildcard/plain-LAN exposure.
- Add pairing QR/manual recovery, doctor checks, and a redacted report.

### 3. Lifecycle operations

- Implement explicit backup/migrate/update/verify/rollback flows.
- Implement retain-data, remove-state, and full uninstall variants while preserving Pi sessions by default.

## Do not start yet

Until M7 exits: workspace trust/read-only UX, polished transcript/tools, broader multi-session control, attachments, extension dialogs, and notifications.

## Blockers

None requiring a product decision.
