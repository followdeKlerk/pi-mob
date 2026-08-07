# Project status

This document is the canonical capability map for Pi Mob. It uses three terms precisely:

- **Production-wired** — the normal daemon constructs it, the bridge handshake advertises it, the mobile app exercises it, and a focused integration test covers the actual construction path.
- **Planned** — accepted as future work.
- **Out of scope** — intentionally not planned.

A library, a class, or an isolated test never proves a production feature. Capability discipline is enforced.

## Normal daemon capability matrix

This is the exact `hello.accepted.capabilities` contract produced by `runDaemon`.

| Configuration | hello.accepted.capabilities |
| --- | --- |
| without-FCM | `catalogue.v1`, `commands.v1`, `controller_leases.v1`, `session_events.v2`, `streams.v1` |
| with-FCM | `catalogue.v1`, `commands.v1`, `controller_leases.v1`, `notifications.v1`, `session_events.v2`, `streams.v1` |

## Production-wired in `v0.0.2-alpha.1`

| Capability | Verified end-to-end |
| --- | --- |
| Manual pairing via HTTPS MagicDNS endpoint and one-time six-digit passcode (passcode mints the per-installation bearer credential); QR and JSON pairing-payload flows are removed and unsupported | Yes |
| Per-installation bearer credential on `hello`, `POST /v1/attachments`, `GET /v1/exports/<id>`, and `device.register` with constant-time hash verification and host-side revocation | Yes |
| Cold-launch splash card and per-chat sync progress with current chat, remaining count, elapsed time, ETA, and throughput | Yes |
| Stream subscription with durable cursor, replay, and live delivery | Yes |
| Session list, rename, create, and delete | Yes |
| Per-session history import with bounded batches, durable checkpoints, and restart coverage | Yes |
| Controller leases that survive navigation and reopen quickly | Yes |
| Session activation and PI process ownership tied to a stable `--session-id` | Yes |
| Prompt dispatch through the correct session owner with safe rejection when no live owner exists | Yes |
| Reconnectable shell that restores the most recent chat, drafts, and attachments | Yes |
| Model changes through the host-driven picker opened by `/model`, backed by `model.list` and `model.set` | Yes |
| Per-chat transcript search and global cross-chat search | Yes |
| Bounded workspace discovery and search under the normal host roots (`~/GitHub`/`~/github`, home, and the configured workspace), or explicit `--search-root` paths | Yes |
| FCM notifications: after the user grants OS permission, token registration and rotation are automatic when the host advertises `notifications.v1`; background delivery on a real phone | Yes |
| Host diagnostic surface with explicit phases, sanitized errors, and retry actions | Yes |
| Canonical session-event v2 transport, replay, live delivery, coordinator ingestion, canonical reducer, and chat rendering | Yes. The normal daemon writes transcript events only to `CanonicalSessionStore`. It compacts acknowledged legacy events in bounded batches. |
| Selected-session Pi command catalogue and `/commands` mobile palette | Yes. The normal daemon calls that session's Pi `get_commands` RPC, strips private source metadata, and bounds the result. |

The bridge may still accept internal raw Pi RPC commands for compatibility, but `raw_rpc.v1` is not advertised to the released mobile client because the mobile raw-RPC surface was removed.

### Simplification rewrite status

The canonical transcript path is production-wired. The normal daemon does not write or load the recipe projection. History reconciliation imports only canonical events. Legacy mobile caches and the isolated recipe projection remain for older-host compatibility.

> Note on focus: foreground FCM alerts are suppressed while the main activity is visible. Background delivery is wired on a real phone. Tap routing and notification dedupe remain best-effort until physical-device runtime proof exists.

## Implemented in isolation, not production-wired
The items below have code or UI in the repository, but the normal daemon does not construct the provider required to advertise them. They are not part of the released preview.

## Android release hygiene

- Stable preview identity is `com.example.pi_mob` across Gradle, Kotlin packages, Firebase wiring, services, and deep links.
- Release signing is fail-closed and requires credentials supplied outside the repository. Artifact checks verify identity, version `0.0.2-alpha.1` / code `2`, signer type, permissions, and deep-link declarations.

## Planned

- Code-signed bridge distributable for macOS. (Non-macOS hosts are not a released target; see "Out of scope".)
- Notarized macOS bundle.
- iOS distribution.
- Public release notes after `1.0.0`.
- Biometric unlock for the mobile app.
- Background sync scheduler that opts in only when the app is foregrounded (no silent background work).

## Out of scope

- Public internet exposure. The bridge always runs on a private Tailscale tailnet.
- Multi-user tenancy, accounts, billing, or shared workspaces.
- Cloud-hosted bridge. The bridge runs on hardware you control.
- Git status, commit, push, or any other repository action.
- Voice calls, video, or anything outside Pi’s normal execution model.
- Server-side rendering of chat content. The phone renders the projections.
- Analytics, telemetry, or crash reporting to third-party services.

## Capability discipline

Before claiming a feature is shipped, the change must satisfy:

1. The normal daemon constructs the provider.
2. The `hello.accepted` handshake advertises the capability.
3. The mobile app exercises the capability on the released path.
4. A focused integration test covers the actual construction path.
5. Documentation and release metadata claim no more than the test proves.

If any of these is missing, the capability is at best “implemented, not production-wired” and must be reported as such.
