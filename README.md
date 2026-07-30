<p align="center">
  <img src="docs/assets/pi-mob-hero.svg" alt="pi-mob — your coding agents, your host, anywhere" width="100%">
</p>

<h1 align="center">pi-mob</h1>

<p align="center">
  <strong>Run Pi on your Mac. Control it from your Android phone. Keep your code, credentials, and durable session state at home.</strong>
</p>

<p align="center">
  Private by design · Reconnect-safe · Raw Pi RPC · Mobile-first
</p>

---

pi-mob is a private mobile control surface for [Pi](https://github.com/earendil-works/pi) coding-agent sessions. The Android app talks to a loopback-only bridge through your Tailscale network; the bridge owns durable delivery and process supervision; Pi continues to run against repositories and credentials on your Mac.

It is **not a remote terminal** and it does not move your development environment into the cloud.

> [!IMPORTANT]
> **Current status: working private alpha.** The durable core, raw RPC path, multi-session host adapter, pairing flow, and mobile chat experience are implemented. Several advanced provider modules exist in the repository but are not yet wired into the normal daemon. See [Project status and roadmap](docs/PROJECT_STATUS.md) for the exact boundary.

## Why pi-mob exists

Coding agents often run for longer than you want to sit at a desk. pi-mob gives you a focused way to:

- start or reopen a Pi session from your phone;
- watch durable transcript and tool activity arrive live;
- send a prompt, steer active work, queue a follow-up, or abort safely;
- reconnect after the phone, network, bridge, or app disappears;
- see uncertain execution as **indeterminate** instead of silently running it twice;
- leave repositories, provider credentials, tools, and Pi state on the host you control.

## What works today

### Mobile workflow

- Pair by QR or private `.ts.net` endpoint.
- Create and switch between durable sessions.
- View live and replayed transcripts.
- Prompt, steer, follow up, abort, compact, clone, export, and change models.
- Search the current transcript or all saved chats.
- Review inline tool and subagent activity.
- Recover controller ownership and handle uncertain command completion explicitly.
- Keep drafts and selected local state across reconnects.

### Durable host core

- Versioned WebSocket protocol with schema validation.
- Persist-before-execute commands with semantic idempotency.
- Replayable host and session streams with canonical cursors.
- Per-session controller leases.
- Generic `raw_rpc.v1` transport with no Pi method allowlist.
- Multi-session Pi RPC processes with bounded host capacity.
- Existing Pi-history import, attachments, exports, follow-up queues, and extension requests.
- Loopback-only bridge intended for private Tailscale Serve exposure.

### Optional today

- FCM status notifications when both host and Android build are configured.
- Explicit custom Pi extensions.
- Shallow workspace discovery from explicitly configured search roots.

## Honest feature boundary

The repository also contains implementations for attention, agent supervision, command catalogues, structured plans, context inspection, file browsing, and process output. Those providers are **not currently injected by the default daemon**, so a normal host launch does not advertise them.

Inline subagent activity is available; a complete first-class agent-supervision surface is not yet production-wired.

**Git integration is intentionally out of scope.** pi-mob will not add Git status, commit, push, CI summaries, or repository-action controls. Any experimental Git-related code is not part of the product roadmap.

## Architecture

```text
┌─────────────────────┐       private HTTPS / WebSocket       ┌──────────────────────┐
│ Android app         │  ◀──────────────────────────────────▶  │ Loopback Bun bridge  │
│                     │             via Tailscale              │                      │
│ chat + controls     │                                         │ durable SQLite       │
│ local drafts/cache  │                                         │ leases + supervision │
└─────────────────────┘                                         └──────────┬───────────┘
                                                                           │ Pi RPC
                                                                           ▼
                                                                ┌──────────────────────┐
                                                                │ Pi + host workspace  │
                                                                │ repos + credentials  │
                                                                │ tools + session data │
                                                                └──────────────────────┘
```

The Mac is authoritative. The phone is reconnectable presentation and control.

## Get started

### Requirements

- Android 10 / API 29 or newer.
- macOS 13 or newer on an x86_64 host for the currently validated bridge build.
- Pi installed and working for the host user.
- Tailscale installed on the phone and Mac, signed into the same tailnet.

### 1. Install the Android preview

Download the latest Android preview APK and adjacent checksum from GitHub Releases, then verify it before sideloading:

```sh
sha256sum -c pi-mob-android-preview-*.apk.sha256
```

On macOS:

```sh
shasum -a 256 -c pi-mob-android-preview-*.apk.sha256
```

See the [mobile guide](apps/mobile/README.md) for signing warnings and pairing details.

### 2. Install the bridge

Download the matching macOS bridge archive and checksum, then:

```sh
shasum -a 256 -c pi-mob-bridge-*-macos-x64.tar.gz.sha256
tar -xzf pi-mob-bridge-*-macos-x64.tar.gz
./release/bin/pi-mob setup --workspace /absolute/path/to/your/repository
```

Setup captures a sanitized login-shell environment, installs the owner LaunchAgent, configures the bridge-owned private Tailscale Serve route, and displays pairing material.

Useful lifecycle commands:

```sh
~/.pi-mob/release/bin/pi-mob status
~/.pi-mob/release/bin/pi-mob stop
~/.pi-mob/release/bin/pi-mob start
```

See the [host bridge guide](packages/bridge/README.md) for verification and recovery.

### 3. Pair the phone

Scan the QR displayed by setup and verify the host identity before confirming. Manual entry accepts the displayed private Tailscale HTTPS endpoint.

## Reliability model

pi-mob treats remote agent control as a distributed-systems problem:

1. A state-changing command receives a client-generated durable command ID.
2. The bridge commits acceptance before dispatching to Pi.
3. Reusing the same ID with the same semantic payload returns the existing state.
4. Reusing the ID with different semantics is rejected.
5. If execution after interruption cannot be proven, pi-mob marks the command `indeterminate` and does not run it again automatically.
6. Event streams replay after reconnect from acknowledged cursors.

This does not make failures impossible. It makes failures visible and avoids pretending an uncertain operation definitely failed.

## Current limitations

- Preview-only Android identity and signing.
- Unsigned and unnotarized macOS distribution.
- Current validated host release is macOS x86_64 only.
- Apple Silicon is not yet release-validated.
- iOS is not distributed.
- Startup still performs external-history work before binding the listener; large histories can delay reachability.
- Several advanced modules are implemented but not production-wired.
- Version metadata still contains internal milestone values in parts of the repository.

The ordered work required for beta is maintained in [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md).

## Development

Use the pinned Bun and Flutter toolchains documented by CI.

```sh
bun install --frozen-lockfile
bun run all
```

Focused commands:

```sh
bun run typecheck
bun run schema:check
bun run fixtures:check
bun test
cd apps/mobile && flutter analyze --no-fatal-infos && flutter test
```

## Documentation

- [Project status and roadmap](docs/PROJECT_STATUS.md)
- [Documentation map](docs/README.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Protocol](docs/PROTOCOL.md)
- [Privacy](docs/PRIVACY.md)
- [Host installation and operations](packages/bridge/README.md)
- [Android installation and development](apps/mobile/README.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE)
