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
- Host-driven model picker opened with `/model`, backed by `model.list` and `model.set`.
- Selected-session Pi command catalogue through `/commands`, bounded and sanitized by the bridge.
- Per-chat transcript search and global cross-chat search.
- Bounded workspace discovery and search under the host defaults (`~/GitHub`/`~/github`, home, and the configured workspace) or explicit search roots.
- Cold-launch splash card and per-chat sync progress with current chat, remaining count, elapsed time, ETA, and throughput.
- FCM notifications: after the user grants OS permission, token registration and rotation are automatic when the host advertises `notifications.v1`; background delivery works on a real phone. Foreground alerts are suppressed while the app is visible. Native tap routing and notification dedupe remain best-effort until separately proven on a physical device.
- Host diagnostic surface with explicit phases, sanitized errors, and retry actions.

## Layout

```
lib/
  connection/        transport, coordinator, durable projection
  domain/            state and reducers
  notifications/     notification controller and FCM adapter
  pairing/           Endpoint and passcode pairing screen
  ui/                screens, shell, theme, primitives
test/
  ...
android/            Android project
```

## Building

```sh
flutter pub get
cd android
./gradlew assembleRelease \
  -PreleaseProperties=/absolute/path/to/external-release.properties
```

The release build fails when the external signing properties are absent. The
properties file must contain `storeFile`, `storePassword`, `keyAlias`, and
`keyPassword`. Use an ephemeral keystore in `/tmp` for local verification only.

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
| `FOREGROUND_SERVICE` | permit the status foreground service. |
| `FOREGROUND_SERVICE_DATA_SYNC` | classify the status foreground service. |

The app does not request camera access. Pairing uses only the manually entered HTTPS endpoint and one-time six-digit passcode printed by `pi-mob pair`; QR generation/scanning and JSON pairing-payload entry are removed and unsupported. It does not request location, contacts, microphone, or general storage access.

## What is not in the app

- Voice or video.
- Browser. The app does not embed a web view.
- File picker beyond the existing attachment path.
- Cloud account. The app has no user account and no sign-in flow.
