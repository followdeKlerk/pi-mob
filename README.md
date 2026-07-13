# pi-mob

A private Flutter mobile control surface for Pi coding-agent sessions running on a user-controlled host over Tailscale.

## Status

The product and architecture are implemented checkpoint by checkpoint. M1–M6 delivered the protocol, durable bridge, diagnostic client, and supervised recovery. M7 delivered the portable macOS host lifecycle and private pairing; M8 delivered workspace trust and host-enforced Read-only policy.

Current checkpoint: **M9 — production transcript, tools, and composer** (ready to activate).

M0 compatibility evidence is frozen in [`docs/compatibility/`](docs/compatibility/); completed checkpoint evidence is in [`M1-SUMMARY.md`](M1-SUMMARY.md), [`M2-SUMMARY.md`](M2-SUMMARY.md), [`M3-SUMMARY.md`](M3-SUMMARY.md), [`M4-SUMMARY.md`](M4-SUMMARY.md), [`M5-SUMMARY.md`](M5-SUMMARY.md), [`M6-SUMMARY.md`](M6-SUMMARY.md), [`M7-SUMMARY.md`](M7-SUMMARY.md), and [`M8-SUMMARY.md`](M8-SUMMARY.md).

See [`BACKLOG.md`](BACKLOG.md) for the complete checkpoint plan and [`docs/SPEC_AUDIT.md`](docs/SPEC_AUDIT.md) for the final coverage review.

## What it does

`pi-mob` lets one owner use an iPhone or Android phone to:

- pair with a private Mac host,
- select trusted coding workspaces,
- create, resume, and switch Pi sessions,
- submit, steer, queue, and abort work,
- inspect streaming reasoning, tool calls, and answers,
- recover after network, app, Pi, bridge, and host interruptions,
- answer extension dialogs,
- manage session branches and lifecycle,
- upload images and export/share sessions,
- receive privacy-preserving background status.

Repositories, shells, provider credentials, and actual Pi execution stay on the host.

## Core architecture

```text
Flutter mobile app
    |
    | HTTPS / one multiplexed WebSocket
    | over private Tailscale Serve
    v
Bun/TypeScript bridge on macOS 13+
    |
    | strict stdin/stdout JSONL
    v
one pi --mode rpc subprocess per active session
```

The bridge binds to loopback only. Tailscale is the sole connection-authentication boundary for the initial single-user application. Funnel is unsupported.

## Read this first

1. [`docs/PRODUCT.md`](docs/PRODUCT.md) — product job, user journeys, requirements, non-goals, and success criteria.
2. [`docs/IMPLEMENTATION_DEFAULTS.md`](docs/IMPLEMENTATION_DEFAULTS.md) — compact implementation baseline.
3. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components, state ownership, streams, leases, queues, and runtime flows.
4. [`docs/PROTOCOL.md`](docs/PROTOCOL.md) — versioned bridge-mobile wire contract.
5. [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — host/mobile persistence, retention, migration, deletion, and repair.
6. [`docs/RUNTIME.md`](docs/RUNTIME.md) — host process, service, storage, workspace, policy, and recovery behaviour.
7. [`docs/UX.md`](docs/UX.md) — mobile screens, interactions, visible states, and accessibility.
8. [`docs/SECURITY.md`](docs/SECURITY.md) — threat model, controls, accepted risks, and review triggers.
9. [`docs/TESTING.md`](docs/TESTING.md) — contract, fault, device, accessibility, performance, and release gates.
10. [`docs/RELEASE.md`](docs/RELEASE.md) — build, distribution, install, update, rollback, and release evidence.
11. [`docs/TOOLCHAIN.md`](docs/TOOLCHAIN.md) — verified initial versions and platform floors.
12. [`docs/DECISIONS.md`](docs/DECISIONS.md) — architecture decision ledger and revisit conditions.
13. [`docs/SPEC_AUDIT.md`](docs/SPEC_AUDIT.md) — concern-by-concern coverage and remaining executable evidence.
14. [`BACKLOG.md`](BACKLOG.md) — achievable checkpoints M0–M17 and post-MVP work.
15. [`WORKING.md`](WORKING.md) — current objective and immediate next actions.
16. [`PLANNING.md`](PLANNING.md) — research history and earlier exploration.

Normative documents under `docs/`, `BACKLOG.md`, and current `WORKING.md` override contradictory historical text in `PLANNING.md`.

## Locked foundations

- Flutter/Dart mobile app.
- Bun `1.3.14` TypeScript bridge compiled as a standalone executable.
- macOS `13.0+` host floor imposed by the pinned Bun runtime.
- Pi source `earendil-works/pi`, package `@earendil-works/pi-coding-agent`, initial exact version `0.80.6`.
- One WebSocket per host with replayable host and session streams.
- Decimal-string stream cursors; no unsafe JSON 64-bit numbers.
- SQLite/WAL command, event, lease, queue, trust, and lifecycle state.
- Client command IDs and durable duplicate-safe bridge dispatch.
- Running-at-crash work becomes indeterminate and never silently reruns.
- One active controller lease per session; other clients observe.
- One Pi RPC process per active session, three active by default.
- Durable bridge-owned follow-up queue; no automatic offline sends.
- Configured workspace roots and explicit Pi resource trust.
- Trusted Full mode plus host-enforced Read-only mode.
- APNs/FCM/Live Activity as best-effort status, never execution authority.
- Private TestFlight/signed Android distribution first.

## MVP checkpoints

The MVP is not one giant build. It progresses through independently demonstrable checkpoints:

```text
M0  Specification/upstream freeze
M1  Scaffold and CI
M2  Protocol schemas/fixtures
M3  Real Pi adapter
M4  Durable bridge streams/idempotency
M5  One-session end-to-end client
M6  Failure recovery/process supervision
M7  macOS install/Serve/pairing/doctor
M8  Workspace trust/read-only
M9  Transcript/tools/composer
M10 Model/context/retry/compaction/commands
M11 Multi-session/controller leases
M12 Fork/clone/tree/delete/restore
M13 Attachments/export/share
M14 Extension UI/durable queue
M15 Notifications/background
M16 Accessibility/performance/privacy hardening
M17 Signed personal MVP release
```

Each checkpoint has tasks, dependencies, a concrete demo, exit criteria, and required evidence in [`BACKLOG.md`](BACKLOG.md).

## Deliberate MVP constraints

- One human owner.
- Private tailnet only.
- No public Funnel or public share links.
- No application account or biometric gate.
- No provider keys on mobile.
- No full filesystem browser, terminal, code editor, or mobile IDE.
- No claim that workspace roots or Read-only mode are an OS sandbox.
- No automatic bridge updater.
- No Windows host, Termux parity, Obsidian integration, or public store launch in MVP.
