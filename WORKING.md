# Working

Status: M0–M12 done; M13 activation ready

## Current checkpoint

**M13 — Attachments, export, and native sharing**

The complete implementation plan is in [`BACKLOG.md`](BACKLOG.md). Normative documents under `docs/`, current `BACKLOG.md`, and this file override historical planning text.

## Current objective

Add bounded, durable attachment upload and safe session export/share flows without transferring provider credentials or exposing host filesystem paths. Completed evidence is retained in [`M1-SUMMARY.md`](M1-SUMMARY.md) through [`M12-SUMMARY.md`](M12-SUMMARY.md).

## Completed foundation

- **M0–M9:** protocol, durable bridge, installed private host, trust/read-only policy, production transcript/tools/composer.
- **M10:** configured Pi controls, context, retry/compaction, and safe command discovery.
- **M11:** multiplexed multi-session summaries, subscriptions, controller leases, capacity, and switcher/observer UX.
- **M12:** durable lineage/tree, fork/clone/rename, seven-day soft delete/restore, repair, and irreversible non-reusable purge.

## Immediate next actions

1. Implement resumable bounded attachment staging and durable attachment references.
2. Add attachment chips, previews, retries, expiry, and offline-safe draft integration.
3. Implement HTML export through opaque IDs and native share-sheet presentation.

## Do not start yet

Until M13 exits: extension dialog production UI, notifications, and later product surfaces.

## Blockers

None requiring a product decision.
