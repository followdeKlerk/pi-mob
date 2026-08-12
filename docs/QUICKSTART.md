# Quick start

This guide covers `0.0.3-alpha.1`. The preview supports a macOS x64 bridge and an Android APK.

## Host

1. Install OMP and make sure `omp` is on `PATH`.
2. Install Tailscale on the host and phone. Sign in to the same tailnet.
3. Download and unpack the bridge release.
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

1. Install the APK from the GitHub release.
2. Open Pi Mob and tap **Pair**.
3. Enter the HTTPS endpoint and six-digit passcode.
4. Grant notification permission when notifications are enabled.

Pairing is manual. QR and JSON import are unsupported.

## Troubleshoot

Both devices must use the same tailnet. Run `./bin/pi-mob pair` again when the passcode expires.

If the phone cannot connect, run `./bin/pi-mob status` and inspect the OMP probe and LaunchAgent logs. Check the service-account path and Android permission when notifications fail.
