# Working

Status: M0–M10 done; M11 activation ready

## Current checkpoint

**M11 — Multi-session control and controller leases**

The complete implementation plan is in [`BACKLOG.md`](BACKLOG.md). Normative documents under `docs/`, current `BACKLOG.md`, and this file override historical planning text.

## Current objective

Run, summarize, switch, stop, and restore multiple independent Pi sessions through one socket while preserving one explicit controller per session. Completed evidence is retained in [`M1-SUMMARY.md`](M1-SUMMARY.md) through [`M10-SUMMARY.md`](M10-SUMMARY.md).

## Completed foundation

- **M0–M9:** protocol, durable bridge, installed private host, trust/read-only policy, production transcript/tools/composer.
- **M10:** configured model/thinking controls, advisory context state, retry/compaction controls, and safe command discovery.

## Immediate next actions

1. Complete host summary pagination and full-plus-bounded-summary subscriptions.
2. Prove multi-client lease exclusion and three-session process capacity/eviction.
3. Ship session switcher, observer/take-control, badges, idle stop, and lazy restore UX.

## Do not start yet

Until M11 exits: attachments, extension dialog production UI, notifications, and later product surfaces.

## Blockers

None requiring a product decision.
