# Working

Status: M0–M9 done; M10 activation ready

## Current checkpoint

**M10 — Models, context, retry, compaction, and commands**

The complete implementation plan is in [`BACKLOG.md`](BACKLOG.md). Normative documents under `docs/`, current `BACKLOG.md`, and this file override historical planning text.

## Current objective

Expose useful configured Pi model, thinking, context, retry, compaction, steering/follow-up, skill, template, and extension-command controls without moving provider-account management to mobile. Completed evidence is retained in [`M1-SUMMARY.md`](M1-SUMMARY.md) through [`M9-SUMMARY.md`](M9-SUMMARY.md).

## Completed foundation

- **M0–M2:** frozen contracts, scaffold, executable protocol schemas, and cross-language fixtures.
- **M3–M4:** exact Pi `0.80.6` RPC adapter and durable SQLite command/event/replay core.
- **M5–M6:** one-session mobile path and supervised truthful failure recovery.
- **M7–M8:** installed private host lifecycle, pairing, canonical workspaces, trust, and host-enforced Read-only policy.
- **M9:** production transcript domain, reasoning/Markdown/tool surfaces, durable history paging, 1,000-turn lazy rendering, reliable delivery-aware composer, and accessibility baseline.

## Immediate next actions

1. Implement configured model/thinking state and runtime-safe mutation.
2. Surface advisory context/tokens/cost plus retry and compaction lifecycle controls.
3. Discover and invoke supported skills, templates, and extension commands while excluding unsupported TUI-only commands.

## Do not start yet

Until M10 exits: multi-session control, attachments, extension dialog production UI, push notifications, and later product surfaces.

## Blockers

None requiring a product decision.
