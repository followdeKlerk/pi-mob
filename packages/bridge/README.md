# Pi Mob bridge

The bridge supervises local Pi sessions and connects them to the Android app. See [Project status](../../docs/PROJECT_STATUS.md) for capabilities.

## Build

From the repository root:

```sh
bun install --frozen-lockfile
bun run build
```

The executable is written to `packages/bridge/dist/bridge-daemon`.

## Run

`bun run build` creates a runnable daemon on Linux x86_64 but only emits a release bundle on macOS x64. Linux installation, pairing, and managed service lifecycle are not supported yet; run the daemon directly with the instructions in [Quick start](../../docs/QUICKSTART.md). It listens on loopback only.

On macOS x64, the `pi-mob` CLI installs and supervises the daemon with `launchd`:

```sh
cd packages/bridge/dist/release
./bin/pi-mob setup --workspace /path/to/your/projects
./bin/pi-mob pair
```

Setup requires Pi on `PATH` and stores its absolute path. Pairing prints an HTTPS endpoint, passcode, and expiry for manual entry in the Android app.
Public listeners, Tailscale Funnel, QR pairing, and JSON import are unsupported.

## Check changes

```sh
bun run typecheck
bun run schema:check
bun run fixtures:check
bun run docs:check
bun test
bun run build
```

Before recovery, stop the bridge and copy the state directory to a protected location.

For mobile changes, also run the Flutter checks in [Contributing](../../CONTRIBUTING.md).
