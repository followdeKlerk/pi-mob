# Quick start

This is a printable end-to-end guide for the `v0.0.1-alpha.1` preview. The exact files referenced here are linked from the GitHub release assets.

## One-time host setup

1. Install Tailscale on the host computer and on the Android phone. Sign in to the same tailnet.
2. Download the bridge tarball from the GitHub release and unpack it into a stable location.
3. Create the bridge’s state directory. The default location is `~/.pi-mob/release/`.
4. Configure the bridge by editing `config.toml`. Use the bundled defaults as a starting point.
5. Start the bridge under `launchd` (macOS) or `systemd` (Linux). The bridge prints a pairing URL and a QR code on first start.
6. If you want notifications, drop a Firebase service-account JSON into the bridge state directory and add the absolute path to the bridge launch arguments.

## One-time phone setup

1. Install the APK from the GitHub release on the Android phone.
2. Open Pi Mob. Tap **Pair**, then scan the QR code shown by the bridge.
3. Accept the notification permission prompt. The phone stays quiet until a reply arrives while the app is backgrounded.

## Daily use

- Open the app. The most recent chat loads with the in-flight draft restored.
- Send a prompt. The bridge dispatches it to the correct Pi session.
- Lock the phone. A notification appears when the reply arrives. Tap it to open the chat.
- Open the burger menu to switch chats, search every chat, or change the bridge address.

## Verifying the install

- The bridge exposes `/readyz` and responds with `{"status":"ready"}` once started.
- The mobile app shows the bridge address and the current connection phase in the connection panel.
- A locked-phone prompt/notification/tap round-trip is the canonical end-to-end test.

## What to do if something goes wrong

- The mobile app never leaves the splash card: the bridge is unreachable. Check `launchctl list | grep pi-mob` and Tailscale status.
- Notifications never arrive: the bridge was not started with a valid service account, or the app permission was revoked. The burger menu surfaces the current state.
- The bridge reports a connection issue: the connection panel shows the sanitized error and a retry action.
