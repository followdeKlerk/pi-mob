# Pi Mob bridge

The bridge supervises local Pi sessions and connects them to the Android app. See [Project status](../../docs/PROJECT_STATUS.md) for current capabilities.

## Layout

```text
src/
  core/           runtime, server, store, journal
  pi/             supervised Pi RPC client
  notifications/  FCM adapter and outbox
  daemon.ts       CLI entry point
test/              bridge tests
```

## Build

```sh
bun install --frozen-lockfile
bun run build
```

The Bun standalone executable is written to `dist/bridge-daemon`.

## Run

The released target is macOS x64. The `pi-mob` CLI installs and supervises the daemon with `launchd`.

```sh
./pi-mob setup --workspace /path/to/your/projects
./pi-mob pair
```

`pair` prints an HTTPS endpoint, six-digit passcode, and expiry. Enter them in the Android app. Public listeners, Tailscale Funnel, QR pairing, and JSON pairing are unsupported.

The bridge accepts TOML configuration through `--config`. CLI flags override file values. See the bundled `config.toml` for supported keys.

## Check changes

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
