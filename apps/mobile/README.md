# Pi Mob Android app

This Flutter app connects to the bridge through private Tailscale Serve. It displays bridge-owned canonical events and does not parse raw OMP RPC.

## Build

```sh
flutter pub get
cd android
./gradlew assembleRelease \
  -PreleaseProperties=/absolute/path/to/external-release.properties
```

The properties file must contain `storeFile`, `storePassword`, `keyAlias`, and `keyPassword`. Keep it and the keystore outside the repository.

The APK is written to `build/app/outputs/flutter-apk/app-release.apk`.

## Test

```sh
flutter analyze --no-fatal-infos
flutter test
```

The app requests Internet access and Android notification permission. Pairing uses a manually entered HTTPS endpoint and one-time passcode.
