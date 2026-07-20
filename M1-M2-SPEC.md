# M1–M2 scaffold and protocol schema specification

Status: proposed; implementation awaits approval.

## 1. Non-goals

- No bridge business logic, Pi process adapter, network listener, SQLite schema, or mobile product UI.
- No new architecture decision, plugin selection, provider credential, platform signing configuration, or toolchain upgrade.
- No implementation of M3+ lifecycle, replay, queue, attachment, extension-dialog persistence, notifications, or session-tree UI.

## 2. File inventory

New root files: exact Bun workspace manifest/lockfile, tool-version declaration, CI workflows, root validation scripts, generated-artifact manifest, and ignore rules for local agent artifacts.

New packages:

- `apps/mobile/`: Flutter skeleton pinned to iOS 16.1 and Android minSdk 29; immutable protocol fixture decoder test only.
- `packages/bridge/`: strict Bun/TypeScript executable smoke entrypoint, config parser placeholder, dev/release state separation, redaction-first logger interface.
- `packages/pi-extension/`: extension package placeholder.
- `packages/protocol-schema/`: TypeBox canonical protocol v1 envelopes, minimum command/event/error schemas, JSON Schema/catalogue generator.
- `packages/protocol-fixtures/`: valid/invalid fixture corpus and generated-artifact manifest.
- `scripts/`: cross-language fixture, specification, secret/dependency/license, and build metadata checks.

Changed documentation: `BACKLOG.md`, `WORKING.md`, `check.md`, `README.md`, `docs/TOOLCHAIN.md`, and a reproducible setup/validation guide as required by M1 evidence.

## 3. State files and wire format

- Protocol fixture JSON uses the normative v1 envelope, decimal-string cursors, lowercase UUID fixtures, and no real host paths/content.
- TypeBox is canonical; JSON Schema and catalogue are generated deterministically.
- Dart decodes the same JSON fixture into immutable models; TypeScript validates the same file.
- Build metadata contains only version/revision/architecture/checksum fields; no environment values or credentials.
- Dev and release config/state roots remain distinct. The release smoke executable accepts only explicit config and must ignore adjacent `.env` and `bunfig.toml`.

## 4. Per-component behavior

- Root `all` command runs format, lint/analyze, typecheck, unit tests, fixture/schema drift, Markdown/spec checks, secret scan, dependency/license check, and Bun executable smoke.
- Bridge source and compiled smoke report redacted build metadata only.
- Schema generator emits stable sorted JSON and fails when checked-in outputs drift.
- Fixture package exposes one valid hello fixture and one invalid counterpart in M1, then M2 expands to every declared command/event/response/error plus boundaries/replay/lease/idempotency/queue/attachment/export/dialog cases.
- Flutter and TypeScript tests load the identical fixture file, not copied representations.

## 5. Edge cases and failure modes

- Missing Flutter/Xcode/Android tools: report an explicit unavailable check; do not fabricate build success.
- Bun compile/autoload test failure blocks M1.
- Generated output differs after regeneration: fail CI with a reproducible diff.
- Unknown optional protocol fields decode safely; unknown required capability rejects.
- Any numeric cursor fixture is invalid; values above JavaScript safe integer remain strings.
- Fixture, logs, CI artifacts, and generated metadata reject secrets, private prompts, absolute personal paths, and provider data.
- Local `.neuralmemory/` and equivalent agent artifacts remain untracked/ignored.

## 6. CLI surface

Root scripts: `setup`, `format`, `lint`, `typecheck`, `test`, `schema:generate`, `schema:check`, `fixtures:check`, `docs:check`, `security:check`, `build`, `clean`, `all`.

Bridge placeholders: source smoke and compiled smoke only; no daemon command or network endpoint in M1/M2.

## 7. Tests

- TypeScript TypeBox valid/invalid envelope validation and generated catalogue drift.
- Dart immutable decoding of the same valid/invalid fixtures.
- Decimal cursor comparison above `9007199254740991`.
- Semantic canonicalization/hash golden inputs.
- Every M2 command/event/response/error fixture, unknown optional/required capability, snapshot/replay, lease, duplicate/indeterminate, queue, attachment/export/dialog pagination boundaries.
- Bun source/compiled/autoload smoke.
- Markdown links, backlog/decision IDs, normative index, secret/dependency/license checks in CI.

## 8. Migration

This is a docs-only-to-scaffold transition: no existing application state, protocol consumer, database, or release artifact migrates. Generated schema version begins at protocol 1.0. Existing M0 compatibility evidence remains immutable input to M3. A future incompatible protocol change requires a protocol-major migration, not edits to M2 fixtures in place.
