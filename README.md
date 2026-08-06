# Pi Mob

> [!WARNING]
> This application was built with an AI coding agent. Expect some slop, dead code, and rough edges. It is in working condition and under active development. Contributions are welcome in all forms, including bug reports, testing, documentation, design, cleanup, and code.

Pi Mob is the mobile control surface for a local Pi coding host. A small bridge daemon runs on your computer and exposes it to a connected Android phone over a private Tailscale network. The phone becomes a fast, low-friction way to supervise running Pi sessions, including while the phone is locked or the app is backgrounded.

This repository hosts:

- `packages/bridge/` — the host-side bridge daemon (TypeScript, Bun distributable + source). The released bridge is built and packaged for macOS x64 only.
- `apps/mobile/` — the Flutter Android client.
- `docs/` — architecture, protocol, privacy, and project status.

## Documentation

| Document | Description |
| --- | --- |
| [docs/README.md](docs/README.md) | Documentation index. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the bridge, host, and mobile client fit together. |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | The wire protocol between the bridge and the mobile client. |
| [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) | Production-wired, planned, and out-of-scope capabilities. |
| [docs/PRIVACY.md](docs/PRIVACY.md) | What data Pi Mob handles, where it lives, and how it is exposed. |
| [docs/QUICKSTART.md](docs/QUICKSTART.md) | End-to-end host and phone setup. |
| [docs/RELEASE.md](docs/RELEASE.md) | How releases are cut, signed, and published. |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Per-version summaries of shipped work. |
| [apps/mobile/README.md](apps/mobile/README.md) | Flutter Android client. |
| [packages/bridge/README.md](packages/bridge/README.md) | Bridge daemon. |

The Android app uses the stable preview identity `com.example.pi_mob` and is published as a pre-release `v0.0.1-alpha.1` APK. Release builds use an external non-debug signer. The bridge is published as a macOS binary tarball. iOS is not distributed in this preview.

## What Pi Mob is

Pi Mob is a thin, durable, reconnectable phone surface for one local Pi host. It is not a SaaS, not a multi-tenant product, and not a public relay. It does not see or proxy your repositories.

The bridge:

- runs on your Mac where Pi itself runs;
- exposes a single private HTTPS endpoint on your tailnet;
- mediates durable streams, controller leases, command routing, and notification delivery between Pi and the phone;
- supervises one Pi process per mobile session and persists session paths so reconnects resume immediately.

The Android app:

- pairs once with the bridge using a manually entered HTTPS endpoint and one-time passcode; QR generation, QR scanning, and JSON pairing-payload entry are removed and unsupported;
- downloads only the chat history you can see;
- mirrors the Pi sessions as native chat surfaces;
- fires system notifications when replies arrive while the app is backgrounded;
- preserves drafts, attachments, and selection across reconnects.

## What is production-wired in `v0.0.1-alpha.1`

Verified end-to-end on a real phone and a real host:

- **Application-layer authentication** — every install binds a 256-bit credential during enrollment; `hello`, `POST /v1/attachments`, `GET /v1/exports/<id>`, and `device.register` all enforce it with constant-time hash verification and host-side revocation.
- **Streams** — durable `host:` and `session:*` streams with cursor persistence and live replay.
- **Commands** — typed commands with controller leases, idempotency, and terminal-state projection.
- **Controller leases** — session-scoped leases that survive navigation and reopen quickly.
- **Raw RPC** — per-session dev surface for inspecting Pi conversation traffic.
- **Sessions** — paginated session list, rename, create, delete, and runtime attention state.
- **History sync** — full chat history imported on first connect and on each reconnect, with bounded batches, durable checkpoints, and restart coverage.
- **Synchronization UI** — a splash card immediately on cold launch, then a per-chat progress card with current chat, remaining count, elapsed time, ETA, and throughput.
- **Notifications** — after the user grants OS permission, FCM token registration and rotation are automatic when the host advertises `notifications.v1`; background delivery works on a real phone. Foreground alerts are suppressed while the app is visible. Tap routing and dedupe remain best-effort until proven on a physical device.
- **Model control** — use the normal `/model` command in the composer; no separate model picker control is shown.
- **Search** — per-chat transcript search and global cross-chat search.
- **Workspace search** — bounded workspace discovery, list, and search rooted under the host defaults (`~/GitHub`/`~/github`, home, and the configured workspace) or explicit search roots.
- **Reconnectable shell** — restores the most recent chat, the in-flight draft, and attachments after reconnect or relaunch.

## What is explicitly out of scope

The following are intentionally not part of Pi Mob in this preview:

- Public Tailscale Funnel, public listeners, or any non-private exposure.
- Multi-user tenancy, accounts, or billing.
- iOS distribution (the app is Android-only for this release).
- Cloud-hosted bridge. The bridge runs on your hardware.
- Git status, commit, push, or other repository actions.
- Biometric unlock, device-side encryption, or secret-management on the phone.
- Code-signed, notarized, or App Store distribution. Android preview release APKs use an operator-supplied non-debug keystore outside the repository.
- Non-macOS install paths. The released bridge is macOS x64 only; the build pipeline produces no other host artefact today.

## Quick start

A printable quick-start ships in `docs/QUICKSTART.md`. The short version:

1. Install the bridge on your macOS host and start it under `launchd` (the released bridge is macOS x64 only).
2. Run `pi-mob pair` after setup to print a fresh HTTPS endpoint, six-digit passcode, and expiry. Enter those values in the Android app.
3. Send a prompt, lock the phone, and verify a notification appears with the reply.

## Repository layout

```
apps/mobile/        Flutter Android client
packages/bridge/    TypeScript bridge daemon (Bun source + distributable)
docs/               Architecture, protocol, privacy, status
```

## Privacy

Pi Mob is local-first. The bridge exposes its API only on a private Tailscale tailnet. No data leaves your host other than Apple/Google push tokens required for notifications. See `docs/PRIVACY.md` for the full data-handling description.

## Status

This is a `0.0.1-alpha.1` preview. Android release builds are signed with an external non-debug keystore and fail closed without it. The bridge tarball is not code-signed or notarized. See `docs/PROJECT_STATUS.md` for the accurate picture of production-wired, planned, and out-of-scope work.
