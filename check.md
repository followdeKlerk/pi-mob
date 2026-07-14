# PROJECT_CHECK_V2

## meta

```text
updated_utc: 2026-07-14
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
status: M0–M14 done; M15 activation ready
shape: monorepo with executable protocol, durable multi-session/tree/queue Pi adapter, private attachment/export transport, and Flutter mobile control client
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
checkpoint: M15 — Notifications and background experience
objective: add privacy-preserving best-effort push and authoritative foreground reconciliation
next_checkpoint: M16 — Accessibility, performance, privacy, and operations hardening
blockers: final proof requires push credentials, signing, permission interaction, and physical devices
```

M0 evidence retained:

- `docs/compatibility/pi-0.80.6.manifest.json`,
- `docs/compatibility/pi-0.80.6.catalogue.json`,
- sanitized real-Pi session/resource fixture inventory,
- Flutter/Bun x64 artifact evidence.

M1 shipped the scaffold (`M1-SUMMARY.md`). M2 shipped executable cross-language protocol contracts (`M2-SUMMARY.md`). M3 shipped the exact-Pi adapter (`M3-SUMMARY.md`). M4 shipped durable SQLite commands/events/leases and replay (`M4-SUMMARY.md`). M5 shipped the one-session client (`M5-SUMMARY.md`). M6 shipped supervised failure recovery (`M6-SUMMARY.md`). M7 shipped the portable installed host lifecycle (`M7-SUMMARY.md`). M8 shipped canonical workspace trust and host-enforced Read-only policy (`M8-SUMMARY.md`). M9 shipped the production transcript, tools, history paging, and composer (`M9-SUMMARY.md`).

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
17. [`M4-SUMMARY.md`](M4-SUMMARY.md)
18. [`WORKING.md`](WORKING.md)
19. [`PLANNING.md`](PLANNING.md) — historical research only

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

- M9 physical-device frame traces and complete screen-reader journeys remain part of the broader M16 release hardening gate; deterministic 1,000-turn, 200% text, reduced-motion, and semantics baselines pass.
- Native mobile release signing/toolchain hardening remains scheduled for M16; M7 pins and verifies the x64 host release.
- No real Xcode/Android release build in CI yet; M1 validates the iOS/Android deployment floors and runs `flutter analyze` plus the Dart fixture parity test.
- Linux/Windows/Termux/public store/multi-user/sandbox/Obsidian are post-MVP.
- `PLANNING.md` contains obsolete research statements and must not be treated as normative.

## next action

Activate M15: implement durable device registration, APNs/FCM adapters, status-only policy, coalescing, deep-link reconciliation, and platform background surfaces. Final proof requires signed physical-device testing.
