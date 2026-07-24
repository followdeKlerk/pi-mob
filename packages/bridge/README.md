# @pi-mob/bridge

Bun/TypeScript bridge between the mobile client and Pi. It owns protocol validation, durable commands and events, controller leases, and the loopback WebSocket service.

> **Preview:** this is a first-pass, pre-release host distribution. It is not signed or notarized and does not yet provide a polished installer.

> **Active branch incident:** on `debug/bridge-daemon-busy-loop`, the daemon can become CPU-bound in synchronous SQLite/history initialization before it binds the loopback listener. When this occurs, mobile connection failures are downstream symptoms. Read [`docs/BRIDGE_DAEMON_BUSY_LOOP.md`](../../docs/BRIDGE_DAEMON_BUSY_LOOP.md) before diagnosing pairing, Tailscale, or Flutter.

## Host prerequisites

The current release bundle is for:

- macOS 13 or newer on **x86_64**; other architectures are not currently validated
- a working, supported [Pi](https://github.com/earendil-works/pi) installation on the host
- [Tailscale for macOS](https://tailscale.com/download/mac) installed, running, and signed in to the same tailnet as the phone
- a workspace directory that the host user is allowed to expose to pi-mob, started with the owner's captured login environment so provider credentials and PATH match the user's normal Pi session

The bridge listens on loopback. Remote access is intended to be through private Tailscale Serve HTTPS, never Tailscale Funnel or a public listener.

## Download and verify the release bundle

1. Open [GitHub Releases](https://github.com/followdeKlerk/pi-mob/releases).
2. Download `pi-mob-bridge-<version>-macos-x64.tar.gz` and its adjacent `.sha256` file.
3. Verify and extract it:

   ```sh
   shasum -a 256 -c pi-mob-bridge-<version>-macos-x64.tar.gz.sha256
   tar -xzf pi-mob-bridge-<version>-macos-x64.tar.gz
   cd release
   shasum -a 256 -c checksums.txt
   ```

`checksums.txt` verifies the files inside the extracted bundle. Inspect `manifest.json` for the exact architecture, minimum macOS version, protocol version, capabilities, and limitations shipped by that release.

Because the binaries are not code-signed or notarized, macOS may quarantine or refuse them. This preview does not recommend bypassing macOS security controls on a host you do not administer.

## Intended host commands

The friendly public contract for the first-pass CLI is:

```sh
pi-mob setup
pi-mob start
pi-mob stop
pi-mob status
```

- `setup` validates the workspace and safe install defaults, detects Pi and Tailscale readiness, installs the user LaunchAgent configuration, creates canonical pairing metadata from the running bridge identity, and displays a scannable terminal QR.
- `start` and `stop` idempotently control that service and its owned private Tailscale Serve route without controlling Pi sessions directly.
- `status` reports service, loopback readiness, owned Serve route, and pairing readiness without exposing secrets.

The release bundle includes `bin/pi-mob` for these day-to-day commands. Run setup from the extracted bundle with an absolute workspace path; later start, stop, and status commands use the saved install defaults:

```sh
./bin/pi-mob setup --workspace /absolute/path/to/repository
~/.pi-mob/release/bin/pi-mob status
```

Setup copies the friendly CLI and daemon into the owner-only `~/.pi-mob/release` installation before creating the LaunchAgent, so the extracted download is not a runtime or lifecycle-management dependency after setup succeeds. The bridge does not inject a policy extension into Pi; Pi runs with its normal execution model. Output is structured and remains pre-release; do not treat it as a stable automation API yet.

### Advanced operations

The existing bundle includes `bin/pi-mob-ops`, a low-level, explicit-flag operations CLI for install, Serve, pairing, diagnostics, update, rollback, and uninstall workflows. It is intended for advanced operators and for the friendly wrapper, not as the stable day-to-day interface. Run it without arguments to see its current command list and required flags:

```sh
~/.pi-mob/release/bin/pi-mob-ops
```

The advanced CLI detects the Tailscale CLI in the standard macOS app, common Homebrew locations, or `PATH`. It reports guidance when Tailscale is absent, logged out, or has no MagicDNS name; it does not install Tailscale, sign you in, run `tailscale up`, or enable Funnel.

## Troubleshooting startup and mobile connectivity

Use this order. Do not begin with the phone when the host listener is absent.

1. Check lifecycle state:

   ```sh
   ~/.pi-mob/release/bin/pi-mob status
   ```

2. Check the local readiness endpoint directly:

   ```sh
   curl --silent --show-error --fail --max-time 2 http://127.0.0.1:8788/readyz
   ```

3. Inspect the LaunchAgent without exposing environment values:

   ```sh
   launchctl print "gui/$(id -u)/com.pi-mob.bridge"
   ```

4. Inspect the owner-only bridge logs:

   ```sh
   tail -n 200 ~/.pi-mob/release/logs/bridge.out
   tail -n 200 ~/.pi-mob/release/logs/bridge.err
   ```

If the daemon consumes CPU, the readiness endpoint is unreachable, no Pi subprocess exists, and logs remain empty, treat it as the documented pre-listener startup incident. Do not repeatedly reinstall, regenerate pairing data, or modify Tailscale routes. Work from the [incident runbook](../../docs/BRIDGE_DAEMON_BUSY_LOOP.md).

A `bridge readiness timeout` currently means only that the loopback health check did not succeed within the lifecycle driver's bounded wait. It does not identify whether the daemon is still initializing, blocked in SQLite, crashed, or failed to bind. Capture process and startup-stage evidence before changing connection code.

Once the loopback readiness endpoint succeeds, then verify the bridge-owned Tailscale Serve route and mobile pairing. Until then, Flutter and remote-network debugging cannot establish the root cause.

## Pair the mobile app

Once the bridge is running and its private HTTPS Serve endpoint is ready, pairing material contains the host ID, display name, protocol version, and Tailscale MagicDNS URL. Scan its QR in the mobile app and verify the displayed identity before confirming.

A successful interactive `setup` displays a scannable terminal QR and stores its canonical payload in the owner-only install secrets directory. The host ID comes from the same durable bridge database used by the running daemon; setup does not invent a second identity. If QR presentation is unavailable, setup reports the complete MagicDNS HTTPS endpoint as a manual fallback. Pairing metadata is not a substitute for tailnet access: the phone and host must still be signed in to the same tailnet. The app reuses a successfully saved endpoint on later reconnects.

For advanced recovery or alternate presentation, `pi-mob-ops pair` still accepts explicit `--host-id`, `--display-name`, `--endpoint`, and `--terminal` flags.

## Current release limitations

- Pre-release only; setup and CLI output may change.
- The generated host bundle is x86_64-only today.
- No code signing, notarization, or `.pkg` installer.
- The bundle manifest currently describes a single-workspace / one-session adapter.
- Tailscale and Pi installation/login are operator prerequisites; the bridge does not provision them.
- Release metadata currently carries an internal milestone version independently of the Git tag.
- The active debug branch has a known pre-listener startup scalability incident with large durable histories.

## Developer commands

These commands validate the source package and build the existing host release bundle; they are not the end-user install flow:

```sh
bun install --frozen-lockfile
bun run --filter '@pi-mob/bridge' typecheck
bun run --filter '@pi-mob/bridge' test
bun run build
```

The build output is assembled under `packages/bridge/dist/release/`.

See the [documentation map](../../docs/README.md), [public architecture](../../docs/ARCHITECTURE.md), [protocol](../../docs/PROTOCOL.md), and [security policy](../../SECURITY.md).
