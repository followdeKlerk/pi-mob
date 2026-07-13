# PROJECT_CHECK_V2

## meta

```text
updated_utc: 2026-07-12
root: .
managed_by: regenerate with /check after each scaffold milestone
vcs: git
branch: m1-m2-scaffold
cache_scope: project-orientation
```

## project

```text
name: pi-mob
purpose: private Flutter mobile control surface for Pi coding-agent sessions running on a user-controlled host over Tailscale
status: M0–M3 done; M4 activation ready
shape: monorepo scaffold (M1); workspace, packages, scripts, CI, and compiled bridge smoke executable present
mobile: Flutter 3.44.4 / Dart 3.12.2
bridge: Bun 1.3.14 / TypeScript / SQLite WAL
host_floor: macOS 13.0+
transport: Tailscale Serve HTTPS + one multiplexed WebSocket
agent: @earendil-works/pi-coding-agent 0.80.6 via pi --mode rpc subprocess
protocol: 1.0, host/session streams, decimal-string cursors
```

## active work

Source: [`WORKING.md`](WORKING.md)

```text
checkpoint: M4 — Durable bridge core and replay streams
objective: durably accept commands and recover host/session streams
next_checkpoint: M5 — One-session end-to-end diagnostic client
blockers: none requiring a product decision
```

M0 evidence retained:

- `docs/compatibility/pi-0.80.6.manifest.json`,
- `docs/compatibility/pi-0.80.6.catalogue.json`,
- sanitized real-Pi session/resource fixture inventory,
- Flutter/Bun x64 artifact evidence.

M1 shipped the scaffold (`M1-SUMMARY.md`). M2 shipped executable cross-language protocol contracts (`M2-SUMMARY.md`). M3 shipped the strict exact-Pi JSONL transport, normalized adapter, deterministic real prompt/tool/session harness, and compatibility evidence (`M3-SUMMARY.md`). Full native release toolchain pinning remains deferred to M7.

## read first

1. [`README.md`](README.md)
2. [`docs/PRODUCT.md`](docs/PRODUCT.md)
3. [`docs/IMPLEMENTATION_DEFAULTS.md`](docs/IMPLEMENTATION_DEFAULTS.md)
4. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
5. [`docs/PROTOCOL.md`](docs/PROTOCOL.md)
6. [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)
7. [`docs/RUNTIME.md`](docs/RUNTIME.md)
8. [`docs/UX.md`](docs/UX.md)
9. [`docs/SECURITY.md`](docs/SECURITY.md)
10. [`docs/TESTING.md`](docs/TESTING.md)
11. [`docs/RELEASE.md`](docs/RELEASE.md)
12. [`docs/TOOLCHAIN.md`](docs/TOOLCHAIN.md)
13. [`docs/DECISIONS.md`](docs/DECISIONS.md)
14. [`BACKLOG.md`](BACKLOG.md)
15. [`M2-SUMMARY.md`](M2-SUMMARY.md)
16. [`M3-SUMMARY.md`](M3-SUMMARY.md)
17. [`WORKING.md`](WORKING.md)
18. [`PLANNING.md`](PLANNING.md) — historical research only

Normative documents under `docs/`, `BACKLOG.md`, and current `WORKING.md` override contradictory historical text in `PLANNING.md`.

## architecture

```text
Flutter mobile app
  -> private Tailscale Serve HTTPS origin
  -> one WebSocket per host
       -> mandatory host stream
       -> full foreground session stream
       -> bounded background session summary streams
  -> Bun/TypeScript bridge on loopback
       -> SQLite/WAL durable commands/events/leases/queues/trust
       -> process supervisor
       -> one pi --mode rpc subprocess per active session
```

Authority:

- Host owns repositories, provider credentials, Pi sessions, command state, event journals, attachments, exports, and processes.
- Mobile owns unsent drafts, preferences, and a bounded reconstructible event cache.
- Pi durable session is canonical conversation history.
- Bridge journal is canonical transport/control recovery history.

## key flows

### Pair

```text
host CLI/Pi extension renders non-secret host QR
-> mobile confirms host/endpoint
-> hello/version/capability handshake
-> host stream subscription
-> replay or snapshot
-> host dashboard
```

### Prompt

```text
mobile commandId + leaseId
-> bridge validates
-> command/event acceptance transaction
-> receipt
-> one Pi dispatch
-> normalized session events
-> agent_settled maps to turn.settled
```

### Reconnect

```text
hello with expected host ID/generation
-> subscription.set with cursor map
-> per-stream current/replay/snapshot-required
-> atomic snapshot if required
-> post-baseline replay
-> commands enabled after synchronization
```

### Follow-up

```text
running turn + explicit follow_up
-> durable bridge-owned FIFO queue
-> removable before dispatch
-> dispatch after agent_settled
```

### Crash

```text
accepted but undispatched -> may dispatch once after recovery
running at crash -> indeterminate; never automatic rerun
```

## locked decisions

- Single human owner.
- Tailscale is sole connection-authentication boundary.
- Loopback bridge; no Funnel/public access.
- Flutter/Dart mobile; Material 3 plus project token layer.
- Bun/TypeScript bridge compiled standalone.
- Bun 1.3.14 requires macOS 13+ host floor.
- Compiled bridge disables automatic `.env` and `bunfig.toml` loading.
- Current Pi source/package/version: `earendil-works/pi`, `@earendil-works/pi-coding-agent`, `0.80.6`.
- Pi remains subprocess RPC boundary.
- One WebSocket per host.
- Host and session streams use decimal-string cursors.
- One controller lease per session.
- Durable command ID and semantic payload hash.
- Running-at-crash is indeterminate.
- One Pi process per active session; three active by default.
- Durable bridge-owned follow-up queue; no offline auto-send.
- Configured workspace roots; no general filesystem browser.
- Explicit Pi project-resource trust.
- Full and host-enforced Read-only modes; no sandbox claim.
- HTTPS JPEG/PNG attachments and HTML exports.
- Status-only best-effort push/Live Activity.
- Private TestFlight/signed Android release first.

## commands

Root validation pipeline (`bun run all`, defined by M1):

```text
setup
format
lint/analyze
typecheck
fixtures:check
schema:generate
schema:check
docs:check
security:check
deps:check
test
build
clean
all
```

## target entrypoints after M1

```text
apps/mobile/lib/main.dart
packages/bridge/src/smoke.ts
packages/pi-extension/src/index.ts
packages/protocol-schema/src/index.ts
packages/protocol-fixtures/
```

## guardrails

- Never expose bridge through Funnel or a non-loopback production listener.
- Never store provider or push service credentials on mobile.
- Never source interactive/login shell startup files for Pi RPC.
- Never represent protocol cursors as JSON numbers.
- Never acknowledge a mutating command before durable acceptance commits.
- Never automatically repeat an action that was running during a crash.
- Never auto-send a disconnected draft.
- Never let mobile-only UI enforce Read-only policy.
- Never claim workspace roots/read-only mode are an OS sandbox.
- Never log transcript/source/secret content by default.
- Never put transcript/path/tool content in default notifications.
- Never add an unbounded queue, output, cache, log, or event buffer.
- Never update Pi/Flutter/Bun/native plugins without compatibility review.

## backlog navigation

```text
M0 specification/upstream freeze
M1 scaffold/CI
M2 protocol schemas/fixtures
M3 real Pi adapter
M4 durable bridge streams/idempotency
M5 one-session end-to-end client
M6 failure/process supervision
M7 macOS install/Serve/pairing/doctor
M8 workspace trust/read-only
M9 transcript/tools/composer
M10 models/context/retry/compaction/commands
M11 multi-session/controller leases
M12 tree/fork/clone/delete/restore
M13 attachments/export/share
M14 extension UI/durable queue
M15 notifications/background
M16 accessibility/performance/privacy hardening
M17 signed personal MVP
```

Detailed tasks, demos, dependencies, and exit criteria: [`BACKLOG.md`](BACKLOG.md).

## known issues / intentionally incomplete

- Durable bridge and mobile product behavior begin at M4/M5; the completed M3 adapter intentionally contains no SQLite/WebSocket business logic.
- Exact Xcode/iOS SDK and Android SDK/AGP/Gradle/JDK pin is deferred to the M7 release-build checkpoint.
- No real Xcode/Android release build in CI yet; M1 validates the iOS/Android deployment floors and runs `flutter analyze` plus the Dart fixture parity test.
- Linux/Windows/Termux/public store/multi-user/sandbox/Obsidian are post-MVP.
- `PLANNING.md` contains obsolete research statements and must not be treated as normative.

## next action

Activate M4: implement durable SQLite command/event/lease state and replay/snapshot synchronization. Do not begin M5 mobile behavior or later UI/push work before bridge recovery invariants are proven.
