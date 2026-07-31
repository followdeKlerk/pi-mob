# Release process

## Versioning

Pi Mob uses semantic versioning. The preview line uses `0.0.x-alpha.y` for the first ship. The first public release will be `1.0.0`.

| Tag | Audience | Sign | Notes |
| --- | --- | --- | --- |
| `0.0.1-alpha.1` | early testers | development only | APK uses debug signing; bridge tarball is not code-signed. |
| `0.x.0` | preview | code-signed before user-facing change | bridge must be signed for macOS use. |
| `1.0.0` | first public release | code-signed and notarized | iOS distribution gates public release. |

## Artifacts

A release ships:

- A `pi-mob-android-<version>.apk` asset and its `.sha256` companion.
- A `pi-mob-bridge-<version>-<platform>-<arch>.tar.gz` asset and its `.sha256` companion.
- A body that states the production-wired capabilities, the planned work, and the out-of-scope work.

## Cutting a release

1. Cut the documentation to match the current `main` branch. Anything claimed must be production-wired and integration-tested.
2. Bump the version in `apps/mobile` and in `packages/bridge`. The bridge prints the version on startup.
3. Build the bridge distributable and the Android APK from the same commit.
4. Tag the commit and push the tag.
5. Use `gh release create` with the `--prerelease` flag for pre-releases.

## Verifying an asset

Each asset is paired with a `.sha256` file. Verify with:

```sh
shasum -a 256 -c <asset>.sha256
```

## Notes for the `v0.0.1-alpha.1` preview

- The Android APK is signed for development only. It will be replaced with a code-signed artifact before public release.
- The bridge tarball is not code-signed or notarized. macOS Gatekeeper will warn the first time the binary is launched. Right-click the binary, choose **Open**, then confirm. A signed and notarized bundle will ship with the next preview.
- iOS is not distributed in this preview.
