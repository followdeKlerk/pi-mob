# pi-mob mobile app

Flutter client for pi-mob. It connects to a bridge on a host you control; repositories, Pi processes, and provider credentials remain on that host.

> **Preview:** pi-mob is pre-release. The Android artifact currently uses a placeholder application identity and development/debug signing, not production signing.

## Download the Android preview

Requirements:

- Android 10 or newer (**API 29+**)
- [Tailscale](https://tailscale.com/download/android) installed and signed in to the same tailnet as the host bridge
- A configured [pi-mob host bridge](../../packages/bridge/README.md)

1. Open [GitHub Releases](https://github.com/followdeKlerk/pi-mob/releases).
2. Choose a published preview release and download `pi-mob-android-preview-<version>.apk` and its adjacent `.sha256` file.
3. Put both files in the same directory and verify the download:

   ```sh
   sha256sum -c pi-mob-android-preview-<version>.apk.sha256
   ```

   On macOS, use:

   ```sh
   shasum -a 256 -c pi-mob-android-preview-<version>.apk.sha256
   ```

4. Open the APK on the Android device. Android may ask you to allow **Install unknown apps** for the browser or file manager you used. Grant that permission only for this install, complete the prompt, and disable it again if desired.

Android may warn that this preview has an unknown developer. That is expected for the current development-signed APK. Verify the checksum and release source before proceeding. An existing build signed with a different development key may need to be uninstalled before an upgrade; uninstalling can remove local app data.

## Connect to the host

Keep Tailscale connected on both devices. The app accepts only a private HTTPS Tailscale MagicDNS endpoint ending in `.ts.net`; ordinary LAN addresses, loopback addresses, plain HTTP, and public Funnel-like endpoints are rejected.

Use either first-pass pairing route:

- Scan the pairing QR produced by the host, then confirm its host name, MagicDNS hostname, protocol version, and host-ID suffix.
- Choose manual entry and type or paste the host name or full URL, for example `host.tailnet-name.ts.net` or `https://host.tailnet-name.ts.net`. A missing scheme is normalized to HTTPS.

After a successful handshake, the app saves the host endpoint locally and reuses it for reconnects and later launches. Pair again after deliberately forgetting the host or when its endpoint changes.

## iOS status

**iOS is not yet distributed.** There is no App Store listing, TestFlight invitation, IPA download, or supported sideload path. The iOS project remains development source only.

## Developer commands

These commands build and test from source; they are separate from installing the preview APK:

```sh
cd apps/mobile
flutter pub get
flutter analyze
flutter test
flutter build apk --release
```

The current Android release build is still preview-only because production signing and final application identity are not configured. When `android/app/google-services.json` is absent, the app still builds and supports bridge control and pairing, but push notifications are unavailable. Provide the non-secret Firebase Android configuration in the build environment when testing notifications; do not commit credentials.

The app never stores provider credentials and is not intended to replace a terminal or editor.
