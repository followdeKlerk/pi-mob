# Quick start

This guide covers the `0.0.3-alpha.1` preview. The released bridge target is macOS x64 and the Android app is distributed as an APK through GitHub Releases.

## One-time host setup

1. Install Tailscale on the host and Android phone. Sign in to the same tailnet and enable MagicDNS.
2. Download and unpack the macOS bridge release. The release contains the `pi-mob` CLI, bridge daemon, and install assets.
3. Run the installer. `pi-mob setup` is the only first-time configuration authority; it creates the install layout, config, LaunchAgent, and state directories:

   ```sh
   ./pi-mob setup --workspace /absolute/path/to/your/projects
   ```

   To enable notifications, pass the owner-only Firebase service-account file during setup:

   ```sh
   ./pi-mob setup \
     --workspace /absolute/path/to/your/projects \
     --fcm-service-account /absolute/path/to/service-account.json
   ```

   The installer persists only that absolute path in the owner-only install config and generated LaunchAgent. It never copies or logs the credential contents. Omit the option when notifications are not wanted; the bridge will truthfully advertise notifications as unavailable.
4. Start or verify the installation if setup did not leave it running:

   ```sh
   ./pi-mob start
   ./pi-mob status
   ```

5. Generate a fresh, expiring pairing passcode:

   ```sh
   ./pi-mob pair
   ```

   `pair` checks the listener and owned Tailscale Serve route before issuing the challenge. Enter the HTTPS endpoint and six-digit passcode manually in the Android app. QR and JSON pairing-payload flows are unsupported.

## One-time phone setup

1. Install the APK from the GitHub release.
2. Open Pi Mob, tap **Pair**, and enter the endpoint and passcode.
3. Complete enrollment. The per-installation credential is stored in Android Keystore-backed secure storage.
4. Accept the notification permission prompt when notifications are configured.

## Daily use

- Open the app; the most recent chat and draft restore after reconnect.
- Send prompts to the selected Pi session.
- Enter `/model` or `/commands` in the composer for the host-backed controls.
- Lock the phone to verify background notification delivery when FCM is configured.
- Use the burger menu to switch chats, search chats, or change the bridge address.

## Verifying the install

- `./pi-mob status` reports lifecycle and listener readiness.
- The bridge `/readyz` endpoint returns `{"status":"ready"}` once startup is complete.
- The phone connection panel shows the current connection phase.
- A locked-phone prompt/notification/tap round-trip is the canonical notification check.

## What to do if something goes wrong

- Setup reports Tailscale is unavailable: install/open Tailscale, sign in, enable MagicDNS, and rerun setup.
- Status reports the listener is not ready: run `pi-mob start`, then inspect `pi-mob status` and the LaunchAgent logs.
- Notifications are unavailable: confirm setup used an absolute owner-only service-account path and that Android notification permission is granted.
- The phone cannot connect: confirm both devices are on the same tailnet and rerun `pi-mob pair`.
