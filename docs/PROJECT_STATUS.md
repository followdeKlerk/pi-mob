# Project status

Pi Mob is an unsupported alpha preview. This file is the capability and scope map.

## Terms

- **Production-wired**: the daemon constructs it, the handshake advertises it, the app uses it, and an integration test covers the path.
- **Implemented, not production-wired**: code exists, but the normal daemon does not provide or advertise it.
- **Planned**: accepted future work.
- **Out of scope**: intentionally unsupported work.

A schema, class, widget, or isolated test does not prove production wiring.

## Normal daemon capabilities

| Configuration | `hello.accepted.capabilities` |
| --- | --- |
| without-FCM | `commands.v1`, `controller_leases.v1`, `session_events.v2`, `streams.v1` |
| with-FCM | `commands.v1`, `controller_leases.v1`, `notifications.v1`, `session_events.v2`, `streams.v1` |

## Production-wired in `v0.0.3-alpha.1`

- Manual pairing with an HTTPS endpoint and one-time passcode.
- Per-installation authentication for WebSocket, attachments, exports, and device registration.
- Durable replay and live delivery for streams and canonical session events.
- Session list, rename, create, delete, activation, and supervised OMP ownership.
- Session-scoped controller leases and prompt routing.
- Restoration of recent chat, drafts, and attachments after reconnect.
- Bounded host diagnostics and background FCM notifications when available.

The normal daemon stores canonical session events before delivery. Raw OMP RPC remains host-internal, and the released client does not receive `raw_rpc.v1`.

## Release facts

- Android application ID: `com.example.pi_mob`.
- Release signing fails closed and uses credentials outside the repository.
- version `0.0.3-alpha.1` / code `3`.
- Released bridge target: macOS x64. The bridge is unsigned and not notarized.

## Planned

- Code-signed and notarized macOS distribution.
- iOS distribution.
- Stable release notes after `1.0.0`.
- Biometric unlock.
- Foreground-opt-in background synchronization.

## Out of scope

Public listeners, Tailscale Funnel, multi-user tenancy, cloud hosting, Git product actions, voice, video, server-side chat rendering, analytics, telemetry, and crash reporting.
