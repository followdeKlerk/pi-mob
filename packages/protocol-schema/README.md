# @pi-mob/protocol-schema

Canonical protocol `1.0` package.

It provides TypeBox runtime validators and static types, arbitrary-precision decimal cursor comparison, canonical semantic-command serialization/SHA-256 hashing, and deterministic generation of checked-in JSON Schema plus command/event/error catalogues.

```sh
bun run --cwd packages/protocol-schema test
bun run --cwd packages/protocol-schema generate
bun run schema:check
```

The package is transport- and persistence-independent. Bridge/Pi business logic belongs in later checkpoint packages.
