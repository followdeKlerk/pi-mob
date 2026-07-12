# Working

Status: M1 activation ready

## Current checkpoint

**M1 — Monorepo scaffold and CI foundations**

The complete implementation plan is in [`BACKLOG.md`](BACKLOG.md). Product, architecture, protocol, data, runtime, UX, security, testing, release, toolchain, and decision documents are now normative.

## Current objective

Activate the M1 monorepo scaffold and CI foundation work. M0 evidence is frozen in `docs/compatibility/`.

## M0 completed in the second audit

- Product contract and success criteria.
- System authority and component boundaries.
- One host WebSocket with host/session streams.
- Decimal-string replay cursors.
- Atomic snapshot and post-baseline replay.
- Controller lease concurrency model.
- Durable command identity and indeterminate crash rules.
- Bridge-owned follow-up queue and no offline auto-send.
- Full host/mobile data model, retention, backup, migration, deletion, and repair.
- Complete mobile screen/state/accessibility specification.
- Security/privacy threat model preserving Tailscale-only authentication.
- Release/install/update/rollback/private-distribution specification.
- Decision ledger.
- M0–M17 checkpointed backlog.
- Current upstream Pi repository/package/version identification.
- Flutter `3.44.4` and Bun `1.3.14` selection.
- macOS bridge floor corrected to `13.0+`.
- Compiled Bun release configured to disable automatic `.env` and `bunfig.toml` loading.

## M0 evidence retained

- `docs/compatibility/pi-0.80.6.manifest.json`
- `docs/compatibility/pi-0.80.6.catalogue.json`
- `docs/compatibility/fixtures/pi-0.80.6/rpc-session-contract.json`
- `docs/compatibility/toolchain-evidence-2026-07-12.json`

The real-Pi fixture found two adapter requirements: validate a stored session path before `switch_session` (a missing path may be created) and implement deletion through a separately tested adapter path (there is no `delete_session` RPC command).

## Immediate next actions

### 1. Activate M1

Create:

```text
apps/mobile
packages/bridge
packages/pi-extension
packages/protocol-schema
packages/protocol-fixtures
scripts
```

### 2. Make one root validation command

It must run:

```text
format
lint/analyze
typecheck
unit placeholders
shared fixture validation
Markdown/spec checks
secret/dependency checks
```

### 3. Prove cross-language fixture loading

Before implementing bridge business logic or transcript UI:

- TypeScript validates one generated protocol fixture.
- Dart decodes the same fixture into its immutable model.
- CI proves both agree.

## Do not start yet

Until M1/M2 exit:

- polished transcript UI,
- push notifications,
- session tree UI,
- attachment UI,
- Live Activities,
- general plugin experimentation.

The next engineering risk is schema/build drift, not visual design.

## Blockers

None requiring a new product decision.

The only remaining M0 work is evidence collection and executable contract verification. If a real Pi/toolchain test contradicts a normative assumption, record the contradiction and update the relevant decision before coding around it.
