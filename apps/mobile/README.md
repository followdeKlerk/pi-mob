# Pi Mob Android app

This Flutter app connects through private Tailscale Serve to the bridge's supervised OMP sessions. It consumes bridge-owned canonical events and never parses raw OMP RPC. See [Project status](../../docs/PROJECT_STATUS.md) for current capabilities.

## Layout

```text
lib/main.dart          production composition
lib/src/
  connection/         transport and coordination
  domain/             state and reducers
  session_events/     canonical replay and synchronization
  transcript/         canonical transcript reduction and rendering
  notifications/      FCM and Android notifications
  pairing/            manual pairing
  ui/                 screens and supported controls
test/                  focused tests
android/               Android project
```

## Build

```sh
flutter pub get
cd android
./gradlew assembleRelease \
  -PreleaseProperties=/absolute/path/to/external-release.properties
```

The external properties file must contain `storeFile`, `storePassword`, `keyAlias`, and `keyPassword`. The release build fails when these values are absent. Use an ephemeral keystore in `/tmp` for local checks.

The APK is written to the repository path `apps/mobile/build/app/outputs/flutter-apk/app-release.apk` (equivalently `../build/app/outputs/flutter-apk/app-release.apk` after `cd apps/mobile/android`).

## Check changes

```sh
flutter analyze --no-fatal-infos
flutter test
```

## Permissions

The app requests Internet access and Android notification service permissions. It does not request camera, location, contacts, microphone, or general storage access.

Pairing uses a manually entered HTTPS endpoint and one-time passcode from `pi-mob pair`. QR and JSON pairing flows are unsupported.
