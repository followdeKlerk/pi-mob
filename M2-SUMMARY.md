# M2 — Protocol schemas and shared fixtures

Status: **DONE**

## Outcome

Protocol `1.0` now exists as executable TypeBox/JSON schemas and immutable Dart models. TypeScript and Dart consume the same generated fixture corpus, compare arbitrary-precision decimal cursors, and produce identical canonical semantic-command SHA-256 values.

## Delivered

- TypeBox schemas for the common envelope, version/capabilities, hello, streams, subscriptions, snapshots, leases, controls, durable commands, journaled events, responses, errors, pairing, attachments, and exports.
- Deterministic checked-in JSON Schema plus command/event/error catalogue artefacts under `packages/protocol-schema/generated/`.
- An immutable Dart discriminated union with runtime validators, round-trip wire preservation, decimal cursor comparison, and canonical semantic hashing.
- Complete valid coverage for all 31 commands, 49 events, 13 responses, and 41 stable errors.
- A generated 245-entry fixture manifest (227 valid and 18 invalid), semantic-hash goldens, and 11 payload-validated recovery/boundary scenarios.
- Replay/gap/conflicting-duplicate, multipart snapshot, lease, idempotency/crash, queue, attachment/export/dialog/pagination, capability, and failure boundary fixtures.
- Byte-for-byte schema/catalogue and fixture drift checks in the root validation pipeline and CI.

## Invariants proven

- Cursors are canonical decimal JSON strings, including values above JavaScript's safe-integer range.
- Every durable mutation declares scope, lease requirement, semantic hash fields, idempotency, recovery, journal effects, and stable errors.
- Every event declares host/session stream ownership.
- Unknown additive optional events are accepted; unsupported required capabilities are rejected.
- Request, connection, lease, timestamp, and retry metadata do not affect semantic command hashes.
- Dart payload/wire maps and nested collections are immutable after decoding.
- The protocol-schema package contains no bridge transport, persistence, or Pi adapter business logic.

## Validation

The checkpoint gate is:

```text
bun run all
```

It runs formatting, TypeScript/Dart analysis, typechecking, fixture/schema drift checks, docs/security/dependency checks, Bun and Flutter tests, and the compiled bridge smoke build. The final M2 run completed with `all ok`; protocol/fixture tests reported 13 passing Bun tests and the mobile suite reported 6 passing Flutter tests.

## Next checkpoint

M3 proves the exact Pi `0.80.6` subprocess RPC adapter. Durable bridge persistence/streams (M4) and product UI work remain out of scope until their dependencies are complete.
