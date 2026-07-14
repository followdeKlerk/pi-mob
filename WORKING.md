# Working

Status: M0–M11 done; M12 activation ready

## Current checkpoint

**M12 — Session tree, fork, clone, rename, delete, and restore**

The complete implementation plan is in [`BACKLOG.md`](BACKLOG.md). Normative documents under `docs/`, current `BACKLOG.md`, and this file override historical planning text.

## Current objective

Add safe tree navigation and lifecycle operations for Pi sessions without confusing fork/clone semantics or losing recoverable data. Completed evidence is retained in [`M1-SUMMARY.md`](M1-SUMMARY.md) through [`M11-SUMMARY.md`](M11-SUMMARY.md).

## Completed foundation

- **M0–M9:** protocol, durable bridge, installed private host, trust/read-only policy, production transcript/tools/composer.
- **M10:** configured model/thinking controls, advisory context state, retry/compaction controls, and safe command discovery.
- **M11:** multiplexed multi-session summaries, bounded subscriptions, durable controller leases, process capacity/restore, and mobile switcher/observer UX.

## Immediate next actions

1. Implement durable tree projection and paginated child loading.
2. Map fork, clone, rename, soft-delete, undo, restore, and permanent-delete commands safely.
3. Prove lineage correctness, restart durability, idempotency, and mobile tree accessibility.

## Do not start yet

Until M12 exits: attachments, extension dialog production UI, notifications, and later product surfaces.

## Blockers

None requiring a product decision.
