# Quick start

This guide covers the `0.0.3-alpha.1` main-branch source build. No matching bridge/APK release has been published; older preview binaries predate the current Pi runtime.

## Build

From the repository root:

```sh
bun install --frozen-lockfile
bun run build
```

## Linux x86_64: run locally

The build creates `packages/bridge/dist/bridge-daemon`. Linux release installation, pairing, and managed service startup are not supported yet. Run the daemon directly on loopback:

```sh
mkdir -p /tmp/pi-mob-state /tmp/pi-mob-sessions
./packages/bridge/dist/bridge-daemon \
  --workspace /absolute/path/to/your/projects \
  --executable "$(command -v pi)" \
  --port 8788 \
  --state-dir /tmp/pi-mob-state \
  --session-dir /tmp/pi-mob-sessions
```

Stop with `Ctrl-C`. The listener is loopback-only; do not expose it publicly. `/tmp` state is temporary—choose private persistent directories if you need to retain sessions.

## macOS x64: install and pair

1. Install Pi and ensure `pi` is on `PATH`.
2. Install Tailscale on the host and phone; sign in to the same tailnet.
3. Build as above, then enter the release bundle:

   ```sh
   cd packages/bridge/dist/release
   ```

4. Configure and start the bridge:

   ```sh
   ./bin/pi-mob setup --workspace /absolute/path/to/your/projects
   ./bin/pi-mob start
   ./bin/pi-mob status
   ```

   Add `--fcm-service-account /absolute/path/to/service-account.json` to setup to enable notifications. Keep this file outside the repository.

5. Create a pairing passcode:

   ```sh
   ./bin/pi-mob pair
   ```

6. Build and install the matching Android app from this checkout using the [Android build instructions](../apps/mobile/README.md), tap **Pair**, then enter the HTTPS endpoint and six-digit passcode.

Pairing is manual. QR and JSON import are unsupported. Both devices must use the same tailnet; run `./bin/pi-mob pair` again when the passcode expires.
