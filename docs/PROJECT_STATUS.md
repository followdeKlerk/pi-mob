# Project status

This document is the canonical capability map for Pi Mob. It uses three terms precisely:

- **Production-wired** — the normal daemon constructs it, the bridge handshake advertises it, the mobile app exercises it, and a focused integration test covers the actual construction path.
- **Planned** — accepted as future work.
- **Out of scope** — intentionally not planned.

A library, a class, or an isolated test never proves a production feature. Capability discipline is enforced.

## Production-wired in `v0.0.1-alpha.1`

| Capability | Verified end-to-end |
| --- | --- |
| Pairing via QR code over a private Tailscale address | Yes |
| Cold-launch splash card and per-chat sync progress with current chat, remaining count, elapsed time, ETA, and throughput | Yes |
| Stream subscription with durable cursor, replay, and live delivery | Yes |
| Session list, rename, create, and delete | Yes |
| Per-session history import with bounded batches, durable checkpoints, and restart coverage | Yes |
| Controller leases that survive navigation and reopen quickly | Yes |
| Session activation and PI process ownership tied to a stable `--session-id` | Yes |
| Prompt dispatch through the correct session owner with safe rejection when no live owner exists | Yes |
| Reconnectable shell that restores the most recent chat, drafts, and attachments | Yes |
| Catalogue authority with explicit unavailable states | Yes |
| Model picker with host-supplied models | Yes |
| Per-chat transcript search and global cross-chat search | Yes |
| Bounded workspace search under the configured search root | Yes |
| FCM notifications with capability-gated automatic enrollment, foreground and background delivery, and tap routing | Yes |
| Host diagnostic surface with explicit phases, sanitized errors, and retry actions | Yes |

## Planned

- Code-signed bridge distributable for macOS and Linux.
- Notarized macOS bundle.
- iOS distribution.
- Public release notes after `1.0.0`.
- Biometric unlock for the mobile app.
- Background sync scheduler that opts in only when the app is foregrounded (no silent background work).
- Tailwind UI for the workspace catalogue.

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
