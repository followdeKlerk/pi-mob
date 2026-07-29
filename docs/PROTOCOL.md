# Protocol

pi-mob uses a versioned JSON protocol over one WebSocket per host. The canonical schemas and generated fixtures live in `packages/protocol-schema` and `packages/protocol-fixtures`.

## Connection lifecycle

1. The client opens `/v1/ws` through the private Tailscale HTTPS endpoint.
2. `hello` establishes protocol compatibility, installation identity, expected host identity, limits, and capabilities.
3. `subscription.set` synchronizes requested host and session streams.
4. The server does not admit state-changing commands until initial synchronization completes.
5. Durable events continue live after the replay fence opens.
6. The client acknowledges applied cursors with `cursor.ack`.

## Envelope categories

### Hello

Establishes:

- protocol major compatibility;
- durable host identity and generation;
- bridge and Pi versions;
- server limits;
- capabilities actually available from the current runtime construction.

A client may require capabilities. The server rejects the connection if a required capability is absent.

### Controls

Bounded read or coordination requests that are not durable state-changing commands, including subscription, cursor acknowledgment, history pages, lists, snapshots, and lease renewal.

A control type existing in the schema does not mean the normal daemon advertises the provider behind it.

### Commands

Durable state-changing requests identified by a client-generated command ID. Commands carry semantic metadata used for idempotency and may require a controller lease.

### Events and streams

Host and session streams use canonical decimal cursors. Events can be replayed after reconnect, returned through a snapshot boundary, or delivered live.

## Durable command guarantees

A command is accepted only after its durable record commits.

- Same command ID + same semantic payload: return the existing command state.
- Same command ID + different semantic payload: reject as an idempotency conflict.
- Proven dispatch failure before execution: report failure.
- Execution that cannot be proven after interruption: mark `indeterminate` and never retry automatically.

These guarantees reduce duplicate mutation risk. They do not claim exactly-once execution inside Pi or external tools.

## Controller leases

A session has at most one active mobile controller for mutations. Leases are scoped, renewable, reconnect-aware, and explicitly recoverable through acquire or takeover flows.

Lease ownership is a transport-level concurrency mechanism. It is not a behavioural policy for Pi.

## Raw RPC

`raw_rpc.v1` is part of the production core.

### Request

`pi.rpc.request` carries:

```json
{
  "sessionId": "uuid",
  "requestId": "bounded correlation id",
  "command": {
    "type": "pi_method",
    "additional": "Pi-owned fields remain available"
  }
}
```

The outer payload is validated and lease-protected. The inner command requires a bounded, non-empty `type` but is otherwise passed through without a Pi method allowlist.

### Response

`pi.rpc.response` journals the correlated upstream response:

```json
{
  "sessionId": "uuid",
  "requestId": "same correlation id",
  "response": {}
}
```

Request errors are represented as a response payload rather than silently dropping correlation.

### Events

`pi.rpc.event` carries a raw upstream Pi event alongside any curated pi-mob projections produced from the same source event.

Unknown forward-compatible events must not disconnect an otherwise healthy client. Known-event projection failures should be isolated while remaining observable through bounded, redacted diagnostics; the latter is planned work.

## Capability advertisement

The server always advertises the durable core capabilities used by the production transport, including streams, commands, controller leases, and raw RPC.

Optional capabilities are advertised only when the runtime receives a provider instance. The normal daemon currently does not inject the advanced providers for:

- attention;
- first-class agent supervision;
- command and skill catalogue management;
- plans;
- context;
- file browsing;
- process output.

Their schemas and isolated tests remain useful implementation groundwork, but clients and documentation must treat them as unavailable unless the handshake advertises them.

## Git protocol surface

Git integration is out of scope. Existing experimental Git-related protocol definitions must not be advertised as a pi-mob product capability or expanded with new Git actions.

A later cleanup may remove unused Git schemas and fixtures after dependency analysis and compatibility review.

## Payload and replay discipline

- JSON messages are bounded by protocol limits.
- Binary WebSocket messages are rejected.
- Historical payloads are bounded before replay.
- Outbound buffering is capped; slow consumers are disconnected.
- Stream cursors must use canonical decimal strings.
- Subscription replay is fenced so live events cannot overtake initial synchronization.

## Compatibility

- Protocol major mismatch is fatal.
- Capability absence is explicit.
- Unknown optional capabilities must not be inferred from UI code or schema presence.
- Raw Pi events remain extensible within a validated durable envelope.
- Mobile projections should tolerate unknown event types while keeping malformed known types diagnosable.

## Source of truth

Generated schemas, command metadata, event ownership, catalogues, and shared fixtures are the executable contract.

```sh
bun run schema:check
bun run fixtures:check
```

For product availability, also inspect the providers passed by `packages/bridge/src/daemon.ts` into `DurableBridgeRuntime`. See [Project status and roadmap](PROJECT_STATUS.md).
