# Contributing

Thanks for contributing to pi-mob.

## Development setup

Install the pinned Bun and Flutter toolchains, then run `bun install` at the repository root and `flutter pub get` in `apps/mobile`.

## Before opening a pull request

```sh
bun run typecheck
bun run schema:check
bun run fixtures:check
bun test
cd apps/mobile && flutter analyze && flutter test
```

Keep changes focused, add or update tests, and update public documentation when behavior changes.

## Protocol and generated files

Protocol schemas and fixture corpus are generated artifacts. Change the source definitions and generators, then run the corresponding generation/check commands; do not hand-edit generated output.

## Security and privacy

Do not commit credentials, private keys, device tokens, local paths, production logs, transcripts, or repository content. Report vulnerabilities using the process in [SECURITY.md](SECURITY.md).
