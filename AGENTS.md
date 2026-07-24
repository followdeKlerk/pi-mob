# Agent instructions

## Read this first

This repository branch is an active integration and incident-debugging branch, not a small patch over `main`.

Before changing code, read in this order:

1. `docs/BRIDGE_DAEMON_BUSY_LOOP.md`
2. `packages/bridge/README.md`
3. `docs/ARCHITECTURE.md`
4. `docs/PROTOCOL.md`
5. the implementation files named in the incident document

## Current branch objective

`debug/bridge-daemon-busy-loop` contains substantial control-oriented work intended to expose and supervise Pi from the mobile application while preserving Pi's normal execution model.

The intended host contract on this branch is:

- setup captures a sanitized owner login environment;
- Pi receives the owner's usable PATH and provider configuration;
- the bridge does not inject the previous host-policy extension by default;
- the mobile app remains a reconnectable control surface rather than the authority for repositories, credentials, or durable sessions.

Do not revert these goals as a shortcut around the current failure.

## Active blocker

The installed bridge daemon can enter a CPU-bound SQLite startup path before it binds `127.0.0.1`. In the recorded reproduction, no Pi subprocess or loopback listener appears and `pi-mob start` reports `bridge readiness timeout`.

The strongest current diagnosis is pathological historical-session import/projection complexity, potentially compounded by a synchronous full SQLite integrity check. This diagnosis must be measured with startup-stage instrumentation before broad refactoring.

The mobile connection failure is downstream of the missing listener. Prove local listener and WebSocket readiness before debugging Flutter or Tailscale.

## Required working method

1. Inspect the branch and existing changes before editing.
2. Preserve unrelated R7/R8/R9/R12 work.
3. Reproduce against a copy of the affected database; never destroy the original diagnostic state.
4. Add bounded, redacted stage timings first.
5. Keep confirmed evidence, inference, and proposed design clearly separated.
6. Prefer small commits: instrumentation, behavioural fix, regression tests, documentation.
7. Run focused tests after each change, then the full bridge checks.

## Definition of done for the incident

A longer timeout is insufficient. Completion requires:

- prompt loopback listener availability on a 45k-event-class database;
- truthful initialization state while background history synchronization runs;
- bounded, checkpointed, interruption-safe history import;
- idempotent source and derived event projection;
- mobile host connectivity after local readiness is established;
- preservation of the owner-captured Pi launch contract;
- regression coverage for approximately 20 sessions and 50,000 events.

## Verification commands

Use the pinned toolchain documented by the repository. At minimum:

```sh
bun install --frozen-lockfile
bun run --filter '@pi-mob/bridge' typecheck
bun run --filter '@pi-mob/bridge' test
bun run build
```

For mobile-facing protocol or connection changes:

```sh
cd apps/mobile
flutter analyze --no-fatal-infos
flutter test
```

Record any unavailable toolchain or host-only validation explicitly; do not invent successful output.
