# Release process

## Versioning

Pi Mob uses semantic versioning. The preview line uses `0.0.x-alpha.y` for the first ship. The first public release will be `1.0.0`.

| Tag | Audience | Sign | Notes |
| --- | --- | --- | --- |
| `0.0.3-alpha.1` | early testers | preview/development signing | Mobile release with canonical session events, workspace discovery, grouped chats, and foreground notification suppression. The attached preview APK is not production-signed; bridge tarball is not code-signed. |
| `0.0.1-alpha.1` | previous preview | external release keystore | APK uses a non-debug signer supplied outside the repository; bridge tarball is not code-signed. |
| `0.x.0` | preview | code-signed before user-facing change | bridge must be signed for macOS use. |
| `1.0.0` | first public release | code-signed and notarized | iOS distribution gates public release. |

## Artifacts

A release ships:

- A `pi-mob-android-<version>.apk` asset and its `.sha256` companion.
- A `pi-mob-bridge-<version>-<platform>-<arch>.tar.gz` asset and its `.sha256` companion.
- A body that states the production-wired capabilities, the planned work, and the out-of-scope work.

## Cutting a release

1. Cut the documentation to match the current `main` branch. Anything claimed must be production-wired and integration-tested.
2. Set the canonical preview version in `VERSION`; for this release it is `0.0.3-alpha.1` with Android version code `3`. The bridge and APK read the same repository version source.
3. Provide an external Android signing properties file with `storeFile`, `storePassword`, `keyAlias`, and `keyPassword`, then build the bridge distributable and Android APK from the same commit. Never put this file or its keystore in the repository.
4. Tag the commit and push the tag.
5. Use `gh release create` with the `--prerelease` flag for pre-releases.

## Verifying an asset

Each asset is paired with a `.sha256` file. Verify with:

```sh
shasum -a 256 -c <asset>.sha256
```

## Notes for the `v0.0.3-alpha.1` preview

- The Android APK release build is fail-closed when external signing credentials are absent. Local verification may use an ephemeral keystore in `/tmp`; never use the debug key.
- The bridge tarball is not code-signed or notarized. macOS Gatekeeper will warn the first time the binary is launched. Right-click the binary, choose **Open**, then confirm. A signed and notarized bundle will ship with the next preview.
- iOS is not distributed in this preview.
