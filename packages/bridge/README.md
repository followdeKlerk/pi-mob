# @pi-mob/bridge

Bun/TypeScript host bridge for pi-mob. It owns durable commands and event streams, controller leases, Pi RPC process supervision, host-side state, and the loopback HTTP/WebSocket service used by the Android app.

> **Status:** working private alpha. The durable core and raw RPC path are production-wired. Several optional provider modules exist in source but are not injected by the normal daemon. See [Project status and roadmap](../../docs/PROJECT_STATUS.md).

## Supported host profile

The currently validated preview profile is:

- macOS 13 or newer;
- x86_64 host;
- Bun and Pi versions pinned by the repository and release bundle;
- Pi working for the owner account;
- Tailscale for macOS installed, running, and signed into the same tailnet as the phone;
- an explicit workspace owned or trusted by the host user.

Apple Silicon is not yet validated for release. The host artifacts are unsigned and not notarized.

## Security model

The bridge binds to `127.0.0.1`. Remote access is intended only through a bridge-owned private Tailscale Serve route.

Unsupported:

- public bind addresses;
- Tailscale Funnel;
- multi-user tenancy;
- storing provider credentials on the phone;
- using the bridge as an OS sandbox.

Pi runs with the owner's captured login environment and normal execution model. The bridge does not inject a default policy or read-only extension.

## Production-wired capabilities

The normal daemon provides:

- durable streams and replay;
- durable commands and semantic idempotency;
- controller leases;
- `raw_rpc.v1`;
- multi-session Pi RPC management;
- session lifecycle, prompts, steering, follow-ups, abort, model controls, compaction, clone, and export;
- existing Pi-session discovery and history projection;
- attachments, extension requests, and optional notifications;
- bounded shallow workspace discovery when explicit search roots are supplied.

The source tree also contains optional providers for attention, agent supervision, catalogues, plans, context, file browsing, and process output. The default daemon does not currently inject those providers, so they are not advertised by a normal launch.

Git integration is out of scope and will not be production-wired.

## Install a preview bundle

Download the matching bridge archive and checksum from GitHub Releases, then verify both the archive and extracted contents:

```sh
shasum -a 256 -c pi-mob-bridge-<version>-macos-x64.tar.gz.sha256
tar -xzf pi-mob-bridge-<version>-macos-x64.tar.gz
cd release
shasum -a 256 -c checksums.txt
```

Inspect `manifest.json` for the exact build architecture, minimum macOS version, protocol version, and release limitations.

Because the bundle is not signed or notarized, macOS may quarantine or reject it. Do not bypass platform security controls on a host you do not administer.

## Setup

Run setup with an absolute workspace path:

```sh
./bin/pi-mob setup --workspace /absolute/path/to/repository
```

Setup is intended to:

1. validate the workspace and host prerequisites;
2. locate Pi and Tailscale;
3. capture a sanitized owner login-shell environment;
4. copy the release into owner-only `~/.pi-mob` paths;
5. install the user LaunchAgent;
6. configure the bridge-owned private Tailscale Serve route;
7. start the service;
8. display pairing material derived from the durable host identity.

It does not install Tailscale, sign into a tailnet, run `tailscale up`, install Pi, provision provider credentials, or enable Funnel.

## Lifecycle commands

```sh
~/.pi-mob/release/bin/pi-mob status
~/.pi-mob/release/bin/pi-mob stop
~/.pi-mob/release/bin/pi-mob start
```

- `status` reports service, loopback, Serve, and pairing readiness without printing secrets.
- `stop` stops the installed service and its owned Serve route.
- `start` starts the existing installation using saved configuration.

The low-level `pi-mob-ops` tool remains available for explicit install, pairing, update, rollback, diagnostic, and uninstall operations. It is not the stable everyday interface.

## Pairing

Successful setup displays a QR and the equivalent private HTTPS endpoint. Pairing material includes the durable host identity, display name, protocol version, and Tailscale MagicDNS endpoint.

The phone and host must already be members of the same tailnet. Pairing metadata does not grant network access.

## Readiness and startup

### Current startup order

The daemon currently:

1. opens and migrates the durable store;
2. recovers uncertain commands and session state;
3. resolves the Pi launch environment;
4. discovers external Pi sessions;
5. imports changed external history;
6. starts the primary Pi RPC client;
7. starts the durable runtime;
8. binds the loopback server.

The former full SQLite integrity scan is no longer part of ordinary startup, and the historical recipe projection no longer repeatedly rescans all activities. However, large or malformed external histories can still delay listener availability because import occurs before binding.

The planned beta architecture is bind-first with explicit initialization phases and bounded checkpointed history batches.

### Diagnose host reachability first

```sh
~/.pi-mob/release/bin/pi-mob status
curl --silent --show-error --fail --max-time 2 http://127.0.0.1:8788/healthz
curl --silent --show-error --fail --max-time 2 http://127.0.0.1:8788/readyz
launchctl print "gui/$(id -u)/com.pi-mob.bridge"
tail -n 200 ~/.pi-mob/release/logs/bridge.out
tail -n 200 ~/.pi-mob/release/logs/bridge.err
```

Interpretation:

- `/healthz` proves the loopback listener exists.
- `/readyz` proves the durable runtime currently admits commands.
- A readiness timeout alone does not identify whether startup is slow, the process crashed, or the listener failed to bind.
- Do not begin with Flutter or Tailscale debugging while the loopback listener is absent.

The dated [busy-loop investigation](../../docs/BRIDGE_DAEMON_BUSY_LOOP.md) records the original incident and root-cause work. It is historical evidence, not the current roadmap.

## Optional configuration

### FCM notifications

FCM requires an absolute Google service-account JSON path on the host and matching Firebase configuration in the Android build. Service-account secrets remain host-side and must never be committed.

### Custom Pi extension

A custom extension may be supplied explicitly. The bridge does not install or inject one by default.

### Workspace search roots

The daemon supports explicit `--search-root <absolute-directory>` values. Search is deliberately shallow and bounded; it enumerates only configured roots and their immediate child directories, does not follow symlinks, and applies fixed caps.

## Current limitations

- Private alpha; operational output may change.
- Unsigned and unnotarized host binaries.
- Current validated bundle is macOS x86_64 only.
- Startup still imports external history before binding.
- Production runtime does not yet wire the advanced optional providers listed above.
- Release and internal milestone version metadata are not fully aligned.
- No public-network or multi-user mode.
- No Git feature roadmap.

## Development

```sh
bun install --frozen-lockfile
bun run --filter '@pi-mob/bridge' typecheck
bun run --filter '@pi-mob/bridge' test
bun run build
```

For full repository validation:

```sh
bun run all
```

Build output is assembled under `packages/bridge/dist/release/`.

## Related documentation

- [Project status and roadmap](../../docs/PROJECT_STATUS.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Protocol](../../docs/PROTOCOL.md)
- [Privacy](../../docs/PRIVACY.md)
- [Security policy](../../SECURITY.md)
