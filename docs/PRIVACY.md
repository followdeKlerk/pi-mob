# Privacy

Pi Mob is local-first. The bridge runs on your hardware and is reachable only through your private Tailscale network. The mobile app does not talk to any third-party service other than the push providers required to deliver notifications.

## What data Pi Mob handles

On the host:

- Your Pi conversation history, persisted by Pi itself.
- A durable stream journal produced by the bridge, including event envelopes, command journal entries, controller-lease state, and registered device rows.
- A Firebase Cloud Messaging service account used solely to send notifications to devices you have registered through the app. The credential is read once at startup and never logged.
- A bounded attachment store rooted under the bridge state directory. Image uploads land in `<state-dir>/attachments` with a 10 MiB per-upload cap, JPEG/PNG-only decode, and a periodic sweep that bounds retention. The store is local-only; uploads are never forwarded to a third party.
- Generated HTML session exports rooted under `<state-dir>/exports`. The bridge serves each export on demand via `GET /v1/exports/<id>` only after installation credential authentication and expiry checks. The export id is a UUID.

On the mobile device:

- A local cache of the streams the user has subscribed to.
- The most recent draft and any attachments in flight.
- The FCM device token, registered with the host behind the bridge handshake.
- A temporary export file the OS writes while the user saves an export to disk. The mobile app deletes the temporary file once the share/save flow finishes.
- No analytics, no crash reporting, no tracking identifiers.

## What leaves your host

This section lists the traffic the bridge itself emits. The bridge runs on the user's hardware and is supervised by the host user's launchd or by a process manager; the host's own outbound traffic (macOS, Tailscale, package updates, anything else the host machine does) is out of scope for this document.

- **FCM requests.** When the host decides a notification is needed, the bridge exchanges a short-lived OAuth 2.0 access token with Google's `https://oauth2.googleapis.com/token` endpoint using the Google service account, then issues one `POST https://fcm.googleapis.com/v1/projects/<id>/messages:send` request for the targeted device. The body is a status-only FCM payload:
  - `data` keys are limited to `sessionId`, `notificationId`, `kind`, `deepLink`, and `hostDisplayName`. Other keys are rejected by the bridge payload sanitizer.
  - `notification.title` / `notification.body` default to bounded status copy (`"Turn finished"`, `"Turn failed"`, `"Status uncertain — check Pi"`, `"Pi needs your attention"`, `"Pi is in a crash loop"`). The bridge does not transmit any user-authored chat content to FCM; the chat UI renders the full reply and the notification surfaces only its outcome.
  - The host display name is the only field that may identify the user's workspace; nothing else user-authored is sent to FCM.
- **Bridge API traffic.** WebSocket envelopes and the companion HTTP API traffic between the bridge and the connected mobile client are routed over the user's private Tailscale tailnet. The bridge does not initiate any connection to the public internet for this path; the tailnet is the only carrier between the bridge and the connected phone.
- **Specific things the bridge does not emit.** The bridge does not send analytics, telemetry, or crash reports. The bridge does not log the FCM service account, the device token, or the pairing payload. Logs written to the host filesystem are local-only.

## What reaches the mobile device

- Stream events for chats the user is subscribed to.
- Notifications from the bridge only.
- App updates are distributed as APK files through GitHub Releases in this preview.
## What is not collected

- Crash reports.
- Analytics events.
- Diagnostic telemetry other than the host-side logs that the bridge writes to your local filesystem.
- Account identifiers. Pi Mob has no accounts.
- Location, contacts, or any other platform permission not strictly required for notifications.

## Access model

- The bridge listens on the loopback interface and is exposed only through Tailscale. The bridge is not accessible from the public internet.
- The mobile app stores the bridge address in its local database. You can wipe it from the app's burger menu.
- The bridge validates the installation identifier, the bearer credential, and the requested protocol version on every connection. Mismatches result in a closed socket and a clear `error` reply (`invalid_auth` for unknown / wrong / revoked / expired / not-bound credentials; `re_pair_required` for never-bound installs).
- **Pairing pins the endpoint; the bearer credential authorises the phone.** Each phone receives a one-time enrollment secret during a fresh pair. The first bind mints a 256-bit installation credential. The credential is stored only as a SHA-256 hash on the bridge, and only in Android Keystore-backed secure storage on the phone. It never lives in SQLite, logs, crash text, fixtures, or generated reports. Forgetting a host wipes the credential from the phone; the host operator may additionally revoke the credential via `pi-mob revoke-installation`.

## Notifications

- The mobile app requests notification permission once per process. The user can revoke it at any time through the OS settings; the app surfaces a control that opens Android's app notification settings.
- The FCM token is registered with the host bridge after the WebSocket `hello` is accepted. The `hello` validates protocol version, the per-installation bearer credential, and the capability list. Token rotation is the same path: a new FCM token is sent as a `device.register` command after the same handshake. The `device.register` payload may only register the authenticated connection's `installationId`; the runtime rejects any cross-installation claim before it reaches the durable device table. The bridge never logs the token.
- The bridge deduplicates notifications by their source event id (`(sourceEventId, kind, sessionId)`); the bridge drops a duplicate status before sending. The mobile app relies on the Android `PendingIntent` request code derived from `notificationId` (or `deepLink` fallback) to make FCM re-deliveries no-op on the device. Whether Android deduplicates fully on a real device is not yet proven in this preview.
- Foreground notification alerts are suppressed while the main activity is visible. Background posting and tap routing are implemented; notification dedupe is not yet proven on a physical device.

## Deletion

- Forgetting a host from the app removes the local cache and the bridge address.
- Removing Pi Mob from the device removes every local cache row the app owns (including the temporary export files) and the locally cached FCM token. The Android uninstall path does not reliably notify the bridge, so the host-side device row may remain until the next FCM failure or until the host operator removes the bridge state directory. Removing the device row remains planned host-side cleanup.
- Removing the bridge from your host machine uses the public `pi-mob uninstall` CLI, which requires an explicit `--mode` flag. The default mode (`retain_data`) does not remove the state directory, the attachment store, or the export directory — only the LaunchAgent, the binary, and the install config. `--mode=remove_state` or `--mode=full` deletes the state directory; `--mode=full` additionally removes the configuration. The Pi session directory is **always preserved** unless `--remove-pi-session-dir=true` is explicitly passed. Deleting the state directory directly with `rm -rf` is the only way to guarantee the durable rows, attachment store, and export directory are removed regardless of mode.

## Reporting a concern

File a private issue using GitHub Security Advisories rather than opening a public tracker item. See [SECURITY.md](../SECURITY.md) for reporting instructions.
