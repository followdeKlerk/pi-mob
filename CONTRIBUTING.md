# Contributing

Pi Mob is an unsupported alpha preview. Keep changes small and preserve the boundaries in [AGENTS.md](AGENTS.md).

## Setup

Use the pinned tool versions:

```sh
bun install --frozen-lockfile
cd apps/mobile && flutter pub get
```

## Checks

Run the checks for your change:

```sh
bun run all
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

Record unavailable checks. Do not claim that an unrun check passed.

## Rules

- Change source definitions and generators, not generated schemas or fixtures.
- Do not commit credentials, keys, device tokens, private paths, logs, databases, transcripts, or raw tool output.
- Do not add public exposure, multi-user tenancy, or Git product actions.
- Update `docs/PROJECT_STATUS.md` when production wiring or accepted scope changes.

## Preview releases

Set the version in `VERSION` and increase the Android version code. Build the bridge and APK from the same revision.

Keep `storeFile`, `storePassword`, `keyAlias`, and `keyPassword` in an external properties file. Keep the keystore outside the repository. The bridge preview remains unsigned and is not notarized.
