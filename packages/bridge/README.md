# Pi Mob bridge

The bridge supervises local OMP sessions and connects them to the Android app. See [Project status](../../docs/PROJECT_STATUS.md) for current capabilities.

## Layout

```text
src/
  core/           runtime, server, store, journal
  omp/            OMP RPC client and session lifecycle
  backend/        backend-neutral contracts and process transport
  pi/             legacy-named adapter and normalization compatibility
  notifications/  FCM adapter and outbox
test/              bridge tests
```

The normal daemon constructs `OmpSession` instances only. The `src/pi/` directory retains legacy internal names while shared adapter code is cut over; it is not a production Pi backend.

## Build

From the repository root:

```sh
bun install --frozen-lockfile
bun run build
```

The Bun standalone executable is written to `packages/bridge/dist/bridge-daemon`.

## Run

The released target is macOS x64. The `pi-mob` CLI installs and supervises the daemon with `launchd`.

```sh
./bin/pi-mob setup --workspace /path/to/your/projects
./bin/pi-mob pair
```

The bridge accepts install TOML through `--config`; overlapping explicit daemon flags take precedence. The release bundle includes `config.sample.toml`, and `pi-mob setup` writes the installed `release/config.toml`. Setup requires an absolute OMP executable path and fails when `omp` is unavailable.

In an interactive terminal, `pair` prints an HTTPS endpoint, six-digit passcode, and expiry for manual entry in the Android app. `--json` is diagnostic CLI output, not a mobile pairing-import flow. Public listeners, Tailscale Funnel, QR pairing, and JSON-import pairing are unsupported.

## Check changes

From the repository root:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run schema:check
bun run fixtures:check
bun run docs:check
bun test
bun run build
```

For mobile changes, also run:

```sh
cd apps/mobile
flutter analyze --no-fatal-infos
flutter test
```

## Operations and recovery

The bridge binds to loopback. Private Tailscale Serve is the supported phone route.

Before recovery, stop the bridge and copy the complete state directory to a protected location. Do not put credentials, endpoints, transcripts, or raw payloads in tickets.

There is no supported operator command for direct database repair. Restore a known backup or report the problem before you change SQLite rows.
