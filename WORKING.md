# Working

Status: M2 done; M3 activation ready

## Current checkpoint

**M3 — Real Pi RPC adapter proven**

The complete implementation plan is in [`BACKLOG.md`](BACKLOG.md). Product, architecture, protocol, data, runtime, UX, security, testing, release, toolchain, and decision documents remain normative.

## Current objective

Activate the M3 exact-Pi adapter work on top of the completed M2 protocol contract. M0 compatibility evidence is frozen in `docs/compatibility/`; completed checkpoint evidence is in [`M1-SUMMARY.md`](M1-SUMMARY.md) and [`M2-SUMMARY.md`](M2-SUMMARY.md).

## Completed foundation

### M0 — specification and upstream freeze

- Product/system authority, architecture, transport, durability, recovery, controller, queue, security, UX, testing, and release contracts.
- Exact Pi source/package/version (`earendil-works/pi`, `@earendil-works/pi-coding-agent`, `0.80.6`).
- Flutter `3.44.4`, Dart `3.12.2`, Bun `1.3.14`, and macOS `13.0+` bridge floor.
- Real-Pi compatibility inventory and sanitized evidence in `docs/compatibility/`.

### M1 — scaffold and CI

- Bun/TypeScript workspace and Flutter mobile scaffold.
- Root validation pipeline and CI.
- Compiled bridge smoke executable with automatic `.env`/`bunfig.toml` loading disabled.

### M2 — protocol schemas and fixtures

- Executable TypeBox/JSON schemas for protocol `1.0` and generated command/event/error catalogues.
- Immutable Dart discriminated union and runtime validators.
- Arbitrary-precision decimal cursors and cross-language canonical semantic-command hashes.
- Generated shared corpus covering every command/event/response/error plus invalid and recovery/boundary scenarios.
- Schema/catalogue/fixture drift detection in `bun run all` and CI.

## Immediate next actions

### 1. Build the strict Pi JSONL boundary

- Incremental bounded LF JSONL splitter with UTF-8/chunk/property/fuzz coverage.
- Response-ID correlation, stdin backpressure, timeout, and cancellation.
- Direct spawn using an absolute executable, explicit cwd/PATH/environment allowlist, process groups, and separated stdout/stderr.

### 2. Map exact Pi `0.80.6` behavior

- Prompt/steer/follow-up/abort and lifecycle events, with `agent_settled` as the only idle boundary.
- State/messages/entries/tree/model/thinking/modes/stats/commands.
- Retry/compaction/session operations, tools, parallel calls, and extension UI.
- Normalized adapter-domain types only; no upstream Pi shapes in the mobile protocol.

### 3. Prove the real binary contract

- Sanitized real-session fixture corpus.
- Missing/corrupt/incompatible session and extension-cancellation cases.
- Exact executable/upstream integrity evidence and a CLI prompt/tool/session demo reaching `agent_settled`.

## Do not start yet

Until M3 exits:

- durable bridge streams/idempotency and SQLite core (M4),
- polished transcript/UI work,
- push notifications,
- session tree UI,
- attachment UI,
- Live Activities,
- general plugin experimentation.

## Blockers

None requiring a new product decision.

The M0 real-Pi evidence identified two mandatory adapter rules: validate a stored session path before `switch_session` because Pi may create a missing path, and implement deletion through a separately tested adapter path because Pi has no `delete_session` RPC command.
