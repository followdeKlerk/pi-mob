# Quick start

This guide covers `0.0.3-alpha.1`. The released bridge target is macOS x64. The mobile release is an Android APK.

## Set up the host

1. Install OMP and ensure `omp` is available on the host's `PATH`.
2. Install Tailscale on the host and phone. Sign in to the same tailnet and enable MagicDNS.
3. Download and unpack the bridge release.
4. Configure the bridge:

   ```sh
   ./bin/pi-mob setup --workspace /absolute/path/to/your/projects
   ```

   To enable notifications, provide the owner-only Firebase service-account file:

   ```sh
   ./bin/pi-mob setup \
     --workspace /absolute/path/to/your/projects \
     --fcm-service-account /absolute/path/to/service-account.json
   ```

   The configuration stores the file path. Keep the service-account file outside the repository.

5. Start the bridge and check its status:

   ```sh
   ./bin/pi-mob start
   ./bin/pi-mob status
   ```

6. Create an expiring pairing passcode:

   ```sh
   ./bin/pi-mob pair
   ```

## Pair the phone

1. Install the APK from the GitHub release.
2. Open Pi Mob and tap **Pair**.
3. Enter the HTTPS endpoint and six-digit passcode from `./bin/pi-mob pair`.
4. Grant notification permission if the bridge supports notifications.

Pairing is manual. QR and JSON pairing flows are unsupported.

## Use and diagnose

The phone talks only to the bridge. OMP sessions, provider credentials, raw RPC, and persisted backend references remain on the host.
Open a chat and send a prompt. Use `/model` for the host-driven model picker. The `/commands` catalogue is not available from the normal daemon.

If the phone cannot connect, make sure that both devices use the same tailnet. Then run `./bin/pi-mob pair` again.
If the listener is not ready, run `./bin/pi-mob start`. Then inspect `./bin/pi-mob status`, its OMP probe, and the LaunchAgent logs.

If notifications are unavailable, check the service-account path and Android notification permission.
