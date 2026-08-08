# Quick start

This guide covers `0.0.3-alpha.1`. The released bridge target is macOS x64. The mobile release is an Android APK.

## Set up the host

1. Install Tailscale on the host and phone. Sign in to the same tailnet and enable MagicDNS.
2. Download and unpack the bridge release.
3. Configure the bridge:

   ```sh
   ./pi-mob setup --workspace /absolute/path/to/your/projects
   ```

   To enable notifications, provide the owner-only Firebase service-account file:

   ```sh
   ./pi-mob setup \
     --workspace /absolute/path/to/your/projects \
     --fcm-service-account /absolute/path/to/service-account.json
   ```

   The configuration stores the file path. Keep the service-account file outside the repository.

4. Start the bridge and check its status:

   ```sh
   ./pi-mob start
   ./pi-mob status
   ```

5. Create an expiring pairing passcode:

   ```sh
   ./pi-mob pair
   ```

## Pair the phone

1. Install the APK from the GitHub release.
2. Open Pi Mob and tap **Pair**.
3. Enter the HTTPS endpoint and six-digit passcode from `pi-mob pair`.
4. Grant notification permission if the bridge supports notifications.

Pairing is manual. QR and JSON pairing flows are unsupported.

## Use and diagnose

Open a chat and send a prompt. Use `/model` or `/commands` for host-backed controls.

If the phone cannot connect, make sure that both devices use the same tailnet. Then run `pi-mob pair` again.

If the listener is not ready, run `pi-mob start`. Then inspect `pi-mob status` and the LaunchAgent logs.

If notifications are unavailable, check the service-account path and Android notification permission.
