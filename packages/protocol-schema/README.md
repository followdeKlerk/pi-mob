# @pi-mob/protocol-schema

Canonical TypeBox schemas, TypeScript types, command metadata, event ownership, capability names, limits, and generated JSON Schema for the pi-mob wire protocol.

## Authority boundary

This package defines what messages are valid. It does **not** prove that every valid optional capability is available from the normal daemon.

For feature availability, inspect:

1. providers passed by `packages/bridge/src/daemon.ts` to `DurableBridgeRuntime`;
2. capabilities returned by `hello.accepted`;
3. the production-wiring integration tests;
4. [`docs/PROJECT_STATUS.md`](../../docs/PROJECT_STATUS.md).

The production core includes streams, durable commands, and controller leases. Raw RPC remains an internal compatibility surface; optional schemas for an unwired provider must remain capability-gated.

Git integration is out of product scope. Do not add new Git commands, controls, events, or capability claims. Existing experimental Git definitions may be removed only after compatibility and fixture dependencies are reviewed.

## Development

```sh
bun run --cwd packages/protocol-schema test
bun run schema:check
```

Edit source definitions and generators rather than generated artifacts. After changes, regenerate schemas and update the shared fixture corpus and Flutter parity validation.

Protocol changes should preserve:

- closed outer envelopes and explicit bounds;
- semantic command idempotency metadata;
- canonical decimal cursors;
- host/session event ownership;
- forward-compatible raw Pi event payloads;
- explicit capability absence.
