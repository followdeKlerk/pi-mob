# PROJECT_CHECK_V2

## meta

```text
updated_utc: 2026-07-12
root: .
managed_by: manual specification refresh; regenerate with /check after M1 scaffold
vcs: git
branch: main
cache_scope: project-orientation
```

## project

```text
name: pi-mob
purpose: private Flutter mobile control surface for Pi coding-agent sessions running on a user-controlled host over Tailscale
status: specification closeout
shape: docs-only
mobile: Flutter 3.44.4 / Dart 3.12.2
bridge: Bun 1.3.14 / TypeScript / SQLite WAL
host_floor: macOS 13.0+
transport: Tailscale Serve HTTPS + one multiplexed WebSocket
agent: @earendil-works/pi-coding-agent 0.80.6 via pi --mode rpc subprocess
protocol: 1.0, host/session streams, decimal-string cursors
```

No application scaffold, manifests, executable code, CI, or tests exist yet.

## active work

Source: [`WORKING.md`](WORKING.md)

```text
checkpoint: M0 — Specification and upstream contract freeze
objective: close executable/toolchain evidence, then activate M1 scaffold
next_checkpoint: M1 — Monorepo scaffold and CI foundations
blockers: none requiring a product decision
```

Remaining M0 evidence:

- pinned Pi compatibility manifest and real executable hashes,
- final upstream command/event/resource-discovery mapping,
- Flutter archive checksum for the actual development architecture,
- actual Xcode/iOS and Android build-tool pins during M1,
- automated documentation/schema consistency checks.

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
15. [`WORKING.md`](WORKING.md)
16. [`PLANNING.md`](PLANNING.md) — historical research only

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

No commands exist yet. M1 must define at least:

```text
setup
format
lint/analyze
typecheck
unit test
protocol fixture check
all checks
bridge dev/build
mobile dev/build
clean
```

## target entrypoints after M1

```text
apps/mobile/lib/main.dart
packages/bridge/src/main.ts
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

- Docs-only repository; no executable validation yet.
- Exact Flutter platform archive checksum not recorded yet.
- Exact Xcode/iOS SDK and Android build toolchain not frozen until scaffold builds.
- Real Pi compatibility manifest and sanitized session fixtures not yet committed.
- Linux/Windows/Termux/public store/multi-user/sandbox/Obsidian are post-MVP.
- `PLANNING.md` contains obsolete research statements and must not be treated as normative.

## next action

Close remaining M0 evidence, then scaffold M1. Do not begin polished UI or push work before shared protocol fixtures and the real Pi adapter are proven.
