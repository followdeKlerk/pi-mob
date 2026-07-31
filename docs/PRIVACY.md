# Privacy

Pi Mob is local-first. The bridge runs on your hardware and is reachable only through your private Tailscale network. The mobile app does not talk to any third-party service other than the push providers required to deliver notifications.

## What data Pi Mob handles

On the host:

- Your Pi conversation history, persisted by Pi itself.
- A durable stream journal produced by the bridge, including event envelopes, command journal entries, controller-lease state, and registered device rows.
- A Firebase Cloud Messaging service account used solely to send notifications to devices you have registered through the app.

On the mobile device:

- A local cache of the streams the user has subscribed to.
- The most recent draft and any attachments in flight.
- The FCM device token, registered with the host behind the bridge handshake.
- No analytics, no crash reporting, no tracking identifiers.

## What leaves your host

- One FCM request per notification. The bridge uses the Google-provided service account to deliver a data-only message to Apple/Google for the targeted device. The payload contains the session identifier, the notification identifier, a deep link, and the message body that the bridge already produced for the chat UI.
- That is the entire outbound traffic from the bridge.

## What reaches the mobile device

- Stream events for chats the user is subscribed to.
- Notifications from the bridge only.
- App updates are delivered through the App Store / Play Store infrastructure per the OS’s normal distribution.

## What is not collected

- Crash reports.
- Analytics events.
- Diagnostic telemetry other than the host-side logs that the bridge writes to your local filesystem.
- Account identifiers. Pi Mob has no accounts.
- Location, contacts, or any other platform permission not strictly required for notifications.

## Access model

- The bridge listens on the loopback interface and is exposed only through Tailscale. The bridge is not accessible from the public internet.
- The mobile app stores the bridge address in its local database. You can wipe it from the app’s burger menu.
- The bridge validates the installation identifier and the requested protocol version on every connection. Mismatches result in a closed socket and a clear `error` reply.

## Notifications

- The mobile app requests notification permission once per process. The user can revoke it at any time through the OS settings; the app surfaces a control that opens Android’s app notification settings.
- The FCM token is registered with the host bridge behind the same handshake that protects the rest of the API. The bridge never logs the token.
- The bridge deduplicates notifications by `notificationId`. The mobile app deduplicates by message id so re-deliveries never display twice.

## Deletion

- Forgetting a host from the app removes the local cache and the bridge address.
- Removing Pi Mob from the device removes every local cache row and the FCM registration.
- Removing the bridge from your host machine removes every durable row from the host database.

## Reporting a concern

File a private issue using GitHub Security Advisories rather than opening a public tracker item. Coordinates are in the project README.
