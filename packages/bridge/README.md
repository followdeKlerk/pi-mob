# Pi Mob — Bridge

The bridge is the host-side daemon that mediates durable streams, controller leases, command routing, and notification delivery between a local Pi installation and the connected Android phone.

## What is production-wired

- Stream subscription with durable cursor, replay, and live delivery.
- Command journal with idempotency, terminal-state projection, and bounded retries.
- Controller leases that survive navigation and reopen quickly.
- Session activation and Pi process ownership tied to a stable `--session-id`.
- Per-session history import with bounded batches, durable checkpoints, and restart coverage.
- FCM notification dispatch using a host-supplied service account, with deduplication by `notificationId`.
- Catalogue authority with explicit unavailable states.
- Workspace discovery and bounded search under the configured search root.
- Host diagnostic surface with explicit phases, sanitized errors, and retry actions.

## Layout

```
src/
  core/        runtime, server, store, journal
  pi/          supervised Pi RPC client and one-session adapter
  notifications/  FCM adapter and outbox
  daemon.ts    CLI entry point
test/
  ...
```

## Building

The bridge is distributed as a Bun standalone executable. To build from source:

```sh
bun install --frozen-lockfile
bun run build
```

The distributable is produced at `dist/bridge-daemon`.

## Running

```sh
./bridge-daemon \
  --workspace /path/to/your/projects \
  --session-dir /path/to/sessions \
  --state-dir /path/to/state \
  --fcm-service-account /path/to/service-account.json \
  --port 8788
```

The bridge prints a pairing URL and a QR code on first start. Use the **Pair** action in the Android app to scan it.

## Configuration

The bridge accepts a TOML config file via `--config`. The CLI flags take precedence over the config file. The bundled `config.toml` documents the supported keys.

## Verification

Before submitting changes:

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `bun run schema:check`
- `bun test`
- `bun run build`

Focus on the targeted tests covering the path you changed. Broad bridge suites are not part of the preview workflow.

## Operational notes

- The bridge listens on the loopback interface. It is exposed to the phone only through Tailscale Serve.
- The bridge binds the loopback listener before any bulk external history synchronization.
- The notification service account is read once at startup. The bridge never logs the credential contents.
- The bridge never proxies file uploads. Attachments are referenced by URL.
- The bridge is not a public listener. It does not advertise on the public internet.
