# Pi Mob bridge

The bridge supervises local OMP sessions and connects them to the Android app. See [Project status](../../docs/PROJECT_STATUS.md) for capabilities.

## Build

From the repository root:

```sh
bun install --frozen-lockfile
bun run build
```

The executable is written to `packages/bridge/dist/bridge-daemon`.

## Run

The released target is macOS x64. The `pi-mob` CLI installs and supervises the daemon with `launchd`.

```sh
./bin/pi-mob setup --workspace /path/to/your/projects
./bin/pi-mob pair
```

Setup requires an `omp` executable on `PATH` and stores its absolute path. Pairing prints an HTTPS endpoint, passcode, and expiry for manual entry in the Android app.

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
