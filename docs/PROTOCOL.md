# Protocol

pi-mob uses a versioned JSON protocol over a single WebSocket per host. The bridge validates envelopes and payloads against the canonical schemas in `packages/protocol-schema`.

## Core concepts

- **Hello:** establishes protocol compatibility, host identity, and capabilities.
- **Streams:** replayable host and session event streams use canonical decimal cursors.
- **Controls:** bounded read requests such as listing, history, and snapshots.
- **Commands:** durable state-changing requests identified by a client-generated command ID.
- **Leases:** a session has at most one active mobile controller for mutations.

## Guarantees

A command is accepted only after its durable record commits. Reusing the same command ID with the same semantic payload returns its current state; a different payload is rejected. If execution cannot be proven after a crash, the result is `indeterminate` and is never automatically rerun.

## Raw RPC envelopes

`PiRpcRequestEnvelopeSchema` carries `{ sessionId, requestId, command }` in a durable, lease-protected `pi.rpc.request`; the inner command requires only a bounded non-empty `type` and otherwise remains unchanged. The bridge has no Pi method allowlist and correlates the upstream call with `requestId`.

`PiRpcResponseEnvelopeSchema` carries `{ sessionId, requestId, response }` as `pi.rpc.response`, preserving the upstream response body. `PiRpcEventEnvelopeSchema` carries `{ sessionId, event }` as `pi.rpc.event`; every known or unknown upstream event, including extension UI requests, is passed through verbatim while curated pi-mob events may be emitted in parallel.

## Source of truth

Generated JSON schemas, catalogues, and shared fixtures are the executable protocol contract. Run:

```sh
bun run schema:check
bun run fixtures:check
```
