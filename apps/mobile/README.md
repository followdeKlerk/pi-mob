# Pi Mob — Android app

The Flutter Android client for Pi Mob. Pairs with a local bridge over a private Tailscale network.

## What is production-wired

- Stream subscription with durable cursor, replay, and live delivery.
- Session list, rename, create, and delete.
- Per-session history import with bounded batches, durable checkpoints, and restart coverage.
- Controller leases that survive navigation and reopen quickly.
- Session activation and Pi process ownership tied to a stable `--session-id`.
- Prompt dispatch through the correct session owner with safe rejection when no live owner exists.
- Reconnectable shell that restores the most recent chat, drafts, and attachments.
- Catalogue authority with explicit unavailable states.
- Model picker with host-supplied models.
- Per-chat transcript search and global cross-chat search.
- Bounded workspace search under the configured search root.
- Cold-launch splash card and per-chat sync progress with current chat, remaining count, elapsed time, ETA, and throughput.
- FCM notifications with capability-gated automatic enrollment, foreground and background delivery, and tap routing back to the correct chat.
- Host diagnostic surface with explicit phases, sanitized errors, and retry actions.

## Layout

```
lib/
  connection/        transport, coordinator, durable projection
  domain/            state and reducers
  notifications/     notification controller and FCM adapter
  pairing/           QR pairing and bridge pairing screen
  ui/                screens, shell, theme, primitives
test/
  ...
android/            Android project
```

## Building

```sh
flutter pub get
flutter build apk --release
```

The release APK is produced at `build/app/outputs/flutter-apk/app-release.apk`.

## Verification

Before submitting changes:

- `flutter analyze --no-fatal-infos`
- `flutter test` for the focused tests you changed

The mobile app uses focused regression tests only. Broad Flutter suites are not part of the preview workflow.

## Permissions

| Permission | Reason |
| --- | --- |
| `INTERNET` | contact the bridge over the user's private tailnet. |
| `POST_NOTIFICATIONS` | surface replies with system notifications. |
| `FOREGROUND_SERVICE_DATA_SYNC` | keep the bridge connection alive while the app is foregrounded. |
| `WAKE_LOCK` | paired with the foreground service. |
| `RECEIVE_BOOT_COMPLETED` | schedule the foreground service after reboot. |
| `REQUEST_INSTALL_PACKAGES` | allow the user to install APK updates in place. |

The app does not request location, contacts, microphone, camera, or storage. Camera access is only used inside the pairing screen to scan the QR code, and only while that screen is visible.

## What is not in the app

- Voice or video.
- Browser. The app does not embed a web view.
- File picker beyond the existing attachment path.
- Cloud account. The app has no user account and no sign-in flow.
