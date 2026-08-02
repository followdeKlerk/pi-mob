# Pi Mob — Bridge

The bridge is the host-side daemon that mediates durable streams, controller leases, command routing, and notification delivery between a local Pi installation and the connected Android phone.

## What is production-wired

- Stream subscription with durable cursor, replay, and live delivery.
- Command journal with idempotency, terminal-state projection, and bounded retries.
- Controller leases that survive navigation and reopen quickly.
- Session activation and Pi process ownership tied to a stable `--session-id`.
- Per-session history import with bounded batches, durable checkpoints, and restart coverage.
- FCM notification dispatch using a host-supplied service account, with deduplication by `notificationId`. The host advertises `notifications.v1` only when the operator supplied a valid Firebase service account at startup; until then the truthful state is "Notifications unavailable".
- Workspace discovery and bounded search under the configured search root.
- Host diagnostic surface with explicit phases, sanitized errors, and retry actions.

> Note: the catalogue module is implemented in `packages/bridge/src/pi/mobile-catalogue-service.ts` (direct module only; it is not part of the package root export) but the normal daemon does not construct a catalogue provider, so `hello.accepted` does not advertise `catalogue.v1` and the mobile UI exposes no catalogue entry point. Tracking lives in `docs/PROJECT_STATUS.md`.

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

The released bridge is macOS x64 only. The public CLI is the `pi-mob` installer (see `scripts/release.ts` and `packages/bridge/src/ops/cli.ts`); the daemon itself is supervised by `launchd` once installed. Run `pi-mob pair` after setup to issue a fresh, expiring endpoint and six-digit passcode from the installed config and owned Tailscale Serve route.

```sh
./pi-mob setup --workspace /path/to/your/projects
./pi-mob pair
```

`pair` prints only the HTTPS endpoint, six-digit passcode, and expiry in human mode. It refuses when the configured listener or owned Serve route is unavailable. Enter these values manually in the **Pair** action in the Android app. QR generation, QR scanning, and JSON pairing-payload entry are removed and unsupported.

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
- **Listener-binding order is a known gap.** Today `runDaemon` calls `runtime.start()` (which runs `commands.recover()` and bulk external-history reconciliation) before `createBridgeServer()` invokes `Bun.serve()`. The loopback listener is therefore bound after the bulk reconciliation work, not before. This remains planned operational hardening.
- The notification service account is read once at startup. The bridge never logs the credential contents.
- The companion HTTP API exposes a bounded pair of endpoints — `POST /v1/attachments` for image uploads and `GET /v1/exports/<id>` for generated HTML exports. Both endpoints require the per-installation `X-Installation-Id` and `X-Installation-Credential` headers; the multipart `installationId` field is downgraded to a hint. Per-installation rate / quota and aggregate byte ceiling are checked before allocation.
- The bridge is not a public listener. It does not advertise on the public internet.
