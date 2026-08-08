# Pi Mob protocol schema and fixtures

This package contains TypeBox schemas, TypeScript types, command metadata, capability names, limits, and generated JSON Schema.

The shared fixture corpus is in `packages/protocol-fixtures`. It checks TypeScript and Flutter acceptance of the same protocol shapes.

## Authority boundary

Schemas and fixtures define and check valid messages. They do not prove that the normal daemon constructs an optional provider or that the mobile release can use it.

Use these sources for availability:

1. providers constructed by `packages/bridge/src/daemon.ts`;
2. capabilities in `hello.accepted`;
3. production-wiring integration tests;
4. [Project status](../../docs/PROJECT_STATUS.md).

Raw RPC is an internal compatibility surface. Git integration is out of product scope.

## Development

```sh
bun run --cwd packages/protocol-schema test
bun run --cwd packages/protocol-fixtures test
bun run schema:check
bun run fixtures:check
```

Change source definitions and generators. Do not edit generated schemas or fixtures by hand.

Protocol changes must preserve closed envelopes, explicit bounds, command idempotency metadata, decimal cursors, event ownership, and explicit capability absence.

When a shape changes, add valid and invalid fixtures as applicable. Run TypeScript validation and Flutter fixture parity checks. Update [Project status](../../docs/PROJECT_STATUS.md) only when the production capability boundary changes.
