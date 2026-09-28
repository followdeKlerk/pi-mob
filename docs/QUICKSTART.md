# Quick start

This guide covers the `0.0.3-alpha.1` main-branch source build on macOS x64. No matching bridge/APK release has been published; older preview binaries predate the current Pi runtime.

## Host

1. Install Pi and make sure `pi` is on `PATH`.
2. Install Tailscale on the host and phone. Sign in to the same tailnet.
3. On a macOS x64 host, run `bun install --frozen-lockfile && bun run build` from the repository root, then `cd packages/bridge/dist/release` to use the bundle (see [bridge build instructions](../packages/bridge/README.md)).
4. Configure the bridge:

   ```sh
   ./bin/pi-mob setup --workspace /absolute/path/to/your/projects
   ```

   Add `--fcm-service-account /absolute/path/to/service-account.json` to enable notifications. Keep this file outside the repository.

5. Start the bridge:

   ```sh
   ./bin/pi-mob start
   ./bin/pi-mob status
   ```

6. Create a pairing passcode:

   ```sh
   ./bin/pi-mob pair
   ```

## Phone

1. Build and install the matching Android app from this checkout using the [Android build instructions](../apps/mobile/README.md); the older GitHub release APKs do not match this main-branch backend.
2. Open Pi Mob and tap **Pair**.
3. Enter the HTTPS endpoint and six-digit passcode.
4. Grant notification permission when notifications are enabled.

Pairing is manual. QR and JSON import are unsupported.

## Troubleshoot

Both devices must use the same tailnet. Run `./bin/pi-mob pair` again when the passcode expires.

If the phone cannot connect, run `./bin/pi-mob status` and inspect the Pi probe and LaunchAgent logs. Check the service-account path and Android permission when notifications fail.
