# Release process

## Versioning

Pi Mob uses semantic versioning. The preview line uses `0.0.x-alpha.y` for the first ship. The first public release will be `1.0.0`.

| Release type | Audience | Signing | Notes |
| --- | --- | --- | --- |
| Preview | testers | externally supplied non-debug preview signing key; not a production distribution signer | Android APK; bridge tarball may remain unsigned until macOS signing is complete. |
| Stable | users | code-signed and notarized | Requires the stable-release gates. |
## Artifacts

A release ships:

- A `pi-mob-android-<version>.apk` asset and its `.sha256` companion.
- A `pi-mob-bridge-<version>-<platform>-<arch>.tar.gz` asset and its `.sha256` companion.
- A body that states the production-wired capabilities, the planned work, and the out-of-scope work.

## Cutting a release

1. Cut the documentation to match the current `main` branch. Anything claimed must be production-wired and integration-tested.
2. Set the canonical release version in `VERSION`. The Android version code must increase for each APK release. The bridge and APK read the same repository version source.
3. Provide an external Android signing properties file with `storeFile`, `storePassword`, `keyAlias`, and `keyPassword`, then build the bridge distributable and Android APK from the same commit. Never put this file or its keystore in the repository.
4. Tag the commit and push the tag.
5. Use `gh release create` with the `--prerelease` flag for pre-releases.

## Verifying an asset

Each asset is paired with a `.sha256` file. Verify with:

```sh
shasum -a 256 -c <asset>.sha256
```

## Preview artifact notes

- The Android APK release build is fail-closed when external signing credentials are absent. Local verification may use an ephemeral keystore in `/tmp`; never use the debug key.
- The bridge tarball is not code-signed or notarized until the macOS signing work is complete. macOS Gatekeeper may warn when the binary launches.
- iOS is not distributed in the preview.
