# Pi Mob Android app

This Flutter app connects to the local bridge through private Tailscale Serve. See [Project status](../../docs/PROJECT_STATUS.md) for current capabilities.

## Layout

```text
lib/
  connection/       transport and coordination
  domain/           state and reducers
  notifications/    FCM and Android notifications
  pairing/          manual pairing
  ui/               screens and controls
test/                focused tests
android/             Android project
```

## Build

```sh
flutter pub get
cd android
./gradlew assembleRelease \
  -PreleaseProperties=/absolute/path/to/external-release.properties
```

The external properties file must contain `storeFile`, `storePassword`, `keyAlias`, and `keyPassword`. The release build fails when these values are absent. Use an ephemeral keystore in `/tmp` for local checks.

The APK is written to `build/app/outputs/flutter-apk/app-release.apk`.

## Check changes

```sh
flutter analyze --no-fatal-infos
flutter test
```

## Permissions

The app requests Internet access and Android notification service permissions. It does not request camera, location, contacts, microphone, or general storage access.

Pairing uses a manually entered HTTPS endpoint and one-time passcode from `pi-mob pair`. QR and JSON pairing flows are unsupported.
