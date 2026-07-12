# Toolchain and platform baseline

Status: normative for M0/M1.

Verified on 2026-07-12. This document completes the initial toolchain selection and overrides earlier less-specific language that deferred the Bun/macOS choice until scaffold.

## 1. Flutter and Dart

```text
Flutter: 3.44.4 stable
Flutter tag: 3.44.4
Flutter ref: ad70ec4 (release tag reference)
Dart: 3.12.2 bundled with the selected Flutter SDK
```

Rules:

- Install from the official stable archive or verified Flutter release artifact.
- Record the exact platform archive SHA-256 during M1 setup.
- Commit a version-manager/tool-version declaration.
- CI and golden environments use the same Flutter/Dart pair.
- Flutter 3.47 is scheduled for a later 2026 stable window and is not adopted automatically.

Sources:

- https://docs.flutter.dev/install/archive
- https://github.com/flutter/flutter/releases/tag/3.44.4

## 2. Bun

```text
Bun: 1.3.14 stable
Bun tag: bun-v1.3.14
Bun ref: 0d9b296 (release tag reference)
```

Rules:

- Pin exactly; do not use canary or floating latest in CI/release.
- Record `bun --version` and `bun --revision` in build metadata.
- Use committed lockfile and exact direct dependency versions.
- Compile release bridge as a standalone executable.
- Disable Bun's automatic runtime loading of `.env` and `bunfig.toml`:

```text
bun build --compile \
  --no-compile-autoload-dotenv \
  --no-compile-autoload-bunfig \
  ...
```

The bridge loads only its explicit versioned config and owner-approved secret/environment sources.

Sources:

- https://github.com/oven-sh/bun/releases/tag/bun-v1.3.14
- https://bun.sh/docs/installation
- https://bun.sh/docs/bundler/executables

## 3. Host operating-system floor

```text
macOS bridge minimum: macOS 13.0
architectures to prove in M1/M7: arm64; x64 only if an Intel host/release requirement remains real
```

Reason:

- Bun's current official requirement is macOS 13.0 or later.
- Therefore any earlier planning statement suggesting Catalina/macOS 10.15 bridge support is obsolete.
- The Flutter mobile development host may have its own SDK/Xcode compatibility, but the released bridge itself is not supported below macOS 13.

The first release manifest must explicitly state supported architecture(s). Do not promise x64 without building and smoke-testing an x64 artifact.

## 4. Pi

```text
repository: earendil-works/pi
package: @earendil-works/pi-coding-agent
version: 0.80.6 exact
execution boundary: pi --mode rpc subprocess
```

During M3, record:

- upstream commit used for fixtures,
- package integrity/hash,
- executable hash,
- RPC/session/extension documentation hashes,
- real contract test result.

Sources:

- https://github.com/earendil-works/pi
- https://www.npmjs.com/package/@earendil-works/pi-coding-agent

## 5. Mobile deployment floors

```text
iOS deployment target: 16.1
Android minSdk: 29
```

Rationale:

- iOS 16.1 is selected for Live Activities.
- Android API 29 is a deliberate product/testing floor for the modern default Impeller path, not a claim that Flutter cannot run below 29.
- The actual Android target SDK, compile SDK, AGP, Gradle, and JDK are frozen during M1 against current Flutter-generated project support and current platform requirements.
- Xcode and iOS SDK are frozen during M1 on the development/CI host actually used.

Source:

- https://docs.flutter.dev/perf/impeller

## 6. Protocol and schema

```text
bridge-mobile protocol: 1.0
canonical schema language: TypeScript TypeBox
wire schema: JSON Schema + shared fixture corpus
mobile models: immutable Dart discriminated union validated against fixtures
```

Protocol cursors are decimal strings and must remain precise above JavaScript's safe integer range.

## 7. Pin files to create in M1

At minimum:

```text
.tool-versions or equivalent
pubspec.lock
bun.lock
package.json exact versions
Flutter/Dart version file
bridge build metadata generator
release manifest schema
```

The exact Android/iOS build-tool pins are committed once the scaffold is generated and both release builds pass.

## 8. Update rule

No dependency/toolchain update is routine. A proposed update must:

1. Identify upstream changes and support floors.
2. Run the component-specific tests in `TESTING.md`.
3. Update this document and release manifest.
4. Preserve or explicitly migrate protocol/database/config compatibility.
5. Include rollback classification.

## 9. Remaining M0/M1 verification

The versions are selected. M1 still must capture platform-specific archive checksums, exact Xcode/iOS SDK, Android SDK/AGP/Gradle/JDK, and supported bridge architecture artifacts from the actual build hosts.
