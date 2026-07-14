# Working

Status: M0–M13 done; M14 activation ready

## Current checkpoint

**M14 — Extension UI and durable follow-up queue**

The complete implementation plan is in [`BACKLOG.md`](BACKLOG.md). Normative documents under `docs/`, current `BACKLOG.md`, and this file override historical planning text.

## Current objective

Add a bounded durable FIFO follow-up queue and persisted extension-dialog requests with deterministic recovery, expiry, and accessible mobile interaction. Completed evidence is retained in [`M1-SUMMARY.md`](M1-SUMMARY.md) through [`M13-SUMMARY.md`](M13-SUMMARY.md).

## Completed foundation

- **M0–M9:** protocol, durable bridge, installed private host, trust/read-only policy, production transcript/tools/composer.
- **M10:** configured Pi controls, context, retry/compaction, and safe command discovery.
- **M11:** multiplexed multi-session summaries, subscriptions, controller leases, capacity, and switcher/observer UX.
- **M12:** durable lineage/tree, fork/clone/rename, seven-day soft delete/restore, repair, and irreversible non-reusable purge.
- **M13:** bounded private image attachments, dispatch-boundary Pi mapping, opaque HTML export, and explicit native sharing.

## Immediate next actions

1. Implement bounded durable FIFO follow-up queue state, transitions, and restart recovery.
2. Persist extension select/confirm/input/editor requests and deterministic response/expiry handling.
3. Add accessible mobile queue controls and native extension-dialog sheets.

## Do not start yet

Until M14 exits: notifications, background delivery, and later product surfaces.

## Blockers

None requiring a product decision.
