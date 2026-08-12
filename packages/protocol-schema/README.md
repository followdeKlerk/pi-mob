# Pi Mob protocol schema and fixtures

This package contains TypeBox schemas, TypeScript types, command metadata, capability names, limits, and generated JSON Schema. The shared fixtures are in `packages/protocol-fixtures`.

Schemas and fixtures define valid messages. They do not prove that the normal daemon constructs an optional provider or that the mobile release uses it. Check daemon construction, `hello.accepted`, integration tests, and [Project status](../../docs/PROJECT_STATUS.md).

Raw OMP RPC is host-internal. The mobile protocol remains backend-neutral, and Git integration is out of scope.

## Checks

```sh
bun run --cwd packages/protocol-schema test
bun run --cwd packages/protocol-fixtures test
bun run schema:check
bun run fixtures:check
```

Change source definitions and generators. Do not edit generated schemas or fixtures by hand. Add valid and invalid fixtures when a message shape changes.
