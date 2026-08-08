# Contributing

Pi Mob is an unsupported alpha preview. Keep changes small and preserve the product boundaries in [AGENTS.md](AGENTS.md).

Read these files first:

1. [Project status](docs/PROJECT_STATUS.md)
2. [Architecture](docs/ARCHITECTURE.md)
3. [Protocol](docs/PROTOCOL.md)

## Scope

The host owns repositories, credentials, Pi processes, and durable state. The Android app is a control and presentation surface. Private Tailscale Serve is the supported remote path.

Do not add public exposure, multi-user tenancy, or Git product actions. Update `docs/PROJECT_STATUS.md` when production wiring or accepted scope changes.

## Setup

Use the pinned tool versions in the repository.

```sh
bun install --frozen-lockfile
cd apps/mobile && flutter pub get
```

## Validation

Run the checks that apply to your change.

```sh
bun run all
```

For bridge or protocol changes:

```sh
bun run typecheck
bun run schema:check
bun run fixtures:check
bun test
bun run build
```

For mobile changes:

```sh
cd apps/mobile
flutter analyze --no-fatal-infos
flutter test
```

For documentation changes:

```sh
bun run docs
```

Record unavailable tools or host checks. Do not claim that an unrun check passed.

## Generated protocol files

Change the source definitions and generators. Do not edit generated schemas or fixtures by hand.

## Sensitive data

Do not commit credentials, keys, device tokens, private paths, production logs, databases, transcripts, or raw tool output. Report vulnerabilities through [SECURITY.md](SECURITY.md).

## Preview releases

Set the release version in `VERSION`. Increase the Android version code for each APK release.

Build the bridge and APK from the same revision. Supply Android signing values through an external properties file with `storeFile`, `storePassword`, `keyAlias`, and `keyPassword`. Do not store that file or its keystore in the repository.

Preview artifacts include an APK, a macOS bridge tarball, and their `.sha256` files. Verify an asset with:

```sh
shasum -a 256 -c <asset>.sha256
```

The APK build fails when signing values are absent. The preview bridge remains unsigned and is not notarized.
