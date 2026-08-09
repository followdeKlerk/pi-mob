# Project status

Pi Mob is an unsupported alpha preview. This file is the canonical capability and scope map.

Use these terms precisely:

- **Production-wired** — the normal daemon constructs it, the handshake advertises it, the mobile app exercises it, and a focused integration test covers the construction path.
- **Implemented, not production-wired** — code or UI exists, but the normal daemon does not supply or advertise it.
- **Planned** — accepted future work.
- **Out of scope** — work that is intentionally not planned.

A schema, class, widget, or isolated test does not prove production wiring.

## Normal daemon capability matrix

This is the exact `hello.accepted.capabilities` contract from `runDaemon`.

| Configuration | `hello.accepted.capabilities` |
| --- | --- |
| without-FCM | `commands.v1`, `controller_leases.v1`, `session_events.v2`, `streams.v1` |
| with-FCM | `commands.v1`, `controller_leases.v1`, `notifications.v1`, `session_events.v2`, `streams.v1` |

## Production-wired in `v0.0.3-alpha.1`

- Manual pairing with an HTTPS endpoint and one-time passcode.
- Per-installation authentication for the WebSocket, attachments, exports, and device registration.
- Durable stream replay and live delivery.
- Session list, rename, create, delete, activation, and supervised OMP ownership; inactive catalogue entries older than seven days are hidden while durable state is retained.
- Bounded OMP session references and canonical event replay.
- Session-scoped controller leases.
- Prompt routing to the live OMP session owner.
- Restoration of the recent chat, drafts, and attachments after reconnect.
- Host diagnostics with bounded, sanitized errors.
- Canonical session-event v2 replay, live delivery, reduction, and rendering.
- FCM registration and background notifications when `notifications.v1` is available.

The normal daemon stores canonical session events in `CanonicalSessionStore` before delivery.

Internal raw OMP RPC remains host-internal. The released mobile client does not receive `raw_rpc.v1`.

The normal daemon requires OMP, creates one supervised `OmpSession` per bridge session, and resumes persisted OMP JSONL sessions through a host-private backend reference. Bridge session IDs remain the durable mobile-facing identity. The legacy-named modules under `packages/bridge/src/pi/` are internal adapter and compatibility code; the normal daemon does not construct a Pi subprocess.

Physical-device evidence covers background FCM delivery. Notification tap routing and deduplication remain best-effort.

## Release facts

- The Android application ID is `com.example.pi_mob`.
- Release signing is fail-closed and uses credentials outside the repository.
- Artifact checks verify version `0.0.3-alpha.1` / code `3`, identity, signer type, permissions, and deep links.
- The released bridge target is macOS x64. The bridge is not code-signed or notarized.

## Planned

- Code-signed and notarized macOS bridge distribution.
- iOS distribution.
- Stable release notes after `1.0.0`.
- Biometric unlock.
- A foreground-opt-in background synchronization scheduler.

## Out of scope

- Public listeners, public Internet exposure, and Tailscale Funnel.
- Multi-user tenancy, accounts, billing, and shared workspaces.
- A cloud-hosted bridge.
- Git status, commit, push, CI summaries, and repository actions.
- Voice, video, and behavior outside OMP's normal execution model.
- Server-side chat rendering.
- Third-party analytics, telemetry, and crash reporting.
