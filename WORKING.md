# Working

Status: specification closeout

## Current checkpoint

**M0 — Specification and upstream contract freeze**

The complete implementation plan is in [`BACKLOG.md`](BACKLOG.md). Product, architecture, protocol, data, runtime, UX, security, testing, release, toolchain, and decision documents are now normative.

## Current objective

Close the remaining evidence tasks in M0, then activate **M1 — Monorepo scaffold and CI foundations**.

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

## Remaining M0 evidence

These do not require more broad architecture design:

1. Create an upstream compatibility manifest with Pi commit/package/executable/doc hashes.
2. Enumerate final Pi command/event mapping from the pinned executable into schema metadata.
3. Verify Pi durable session listing/deletion/trust-resource discovery against real fixtures.
4. Capture official Flutter platform archive checksum/ref for the actual development architecture.
5. During M1 scaffold, freeze actual Xcode/iOS SDK and Android SDK/AGP/Gradle/JDK combinations after both release builds compile.
6. Add automated Markdown link, backlog-ID, normative-index, and protocol-catalogue consistency checks.

## Immediate next actions

### 1. Close M0 compatibility evidence

Create a machine-readable or Markdown manifest containing:

```text
Pi repository and commit
Pi package/version/integrity
Pi executable SHA-256
RPC/session/extension documentation hashes
Flutter archive/ref/checksum
Bun version/revision
supported macOS architecture target
```

### 2. Activate M1

Create:

```text
apps/mobile
packages/bridge
packages/pi-extension
packages/protocol-schema
packages/protocol-fixtures
scripts
```

### 3. Make one root validation command

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

### 4. Prove cross-language fixture loading

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
