# @pi-mob/protocol-fixtures

Shared generated protocol corpus used to keep the TypeScript bridge and Flutter client in agreement.

The corpus proves cross-language acceptance and rejection of protocol shapes. It does not prove that an optional provider is constructed by the normal daemon or usable end to end.

For product availability, use [`docs/PROJECT_STATUS.md`](../../docs/PROJECT_STATUS.md) and a production-wiring integration test that inspects the real handshake.

Git integration is out of product scope. Do not expand Git-related fixture coverage as new feature work. Existing experimental Git fixtures may be removed after confirming that schema generation, Dart parity, and compatibility expectations remain intact.

## Development

```sh
bun run --cwd packages/protocol-fixtures test
bun run fixtures:check
```

Edit the fixture generator and source protocol definitions, not individual generated files in the corpus.

When adding or changing a protocol shape, include:

- at least one valid fixture;
- invalid fixtures for closed-object, bound, identifier, enum, and ownership rules as applicable;
- TypeScript validation coverage;
- Flutter fixture-parity coverage;
- documentation updates when the production capability boundary changes.
