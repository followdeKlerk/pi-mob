# Protocol

The bridge and the mobile client speak a single WebSocket protocol over a private tailnet. The protocol is versioned, capability-based, and additive. This document describes the wire shape that is actually shipped in `v0.0.1-alpha.1`.

## Transport

- One HTTPS endpoint exposed by the bridge on a private Tailscale hostname.
- WebSocket upgrade at the documented path. No long-poll fallback.
- The mobile client must speak the documented major protocol version.

## Versioning

Each envelope carries:

```
protocol = { major: 1, minor: 0 }
```

If the major version does not match, the bridge closes the socket with `unsupported_protocol`. Minor increments are strictly additive and never break compatibility.

## Capabilities

Capabilities are advertised in the `hello.accepted` payload. The mobile client may request any subset of advertised capabilities in `hello.requiredCapabilities`. It may list optional capabilities in `hello.optionalCapabilities`.

The current baseline is:

- `streams.v1`
- `commands.v1`
- `controller_leases.v1`
- `raw_rpc.v1`

Optional capabilities are added as the host enables them. `notifications.v1` is advertised when the bridge was started with a valid notification service account.

## Envelope

Every message is a JSON object with the following top-level fields:

| field | type | notes |
| --- | --- | --- |
| `protocol` | object | `{ major: 1, minor: 0 }`. |
| `messageId` | string | server or client UUID for traceability. |
| `requestId` | string | correlate request and response. |
| `type` | string | dotted message name, lowercase. |
| `sentAt` | string | ISO 8601 timestamp. |
| `payload` | object | type-specific payload. |

Errors are returned as `type: "error"` with a numeric or symbolic `code`, a human-readable `message`, and a `retryable` boolean.

## Streams

The bridge publishes two kinds of streams:

- `host:<hostId>` — host-wide events, including session summaries and capability updates.
- `session:<sessionId>` — per-session event projection, including user prompts, assistant replies, tool activity, and context states.

The client sets a `subscription.set` message listing the streams it wants. The bridge responds with `subscription.accepted` and replay begins from the persisted cursor. New events are pushed as `event` messages until the client unsubscribes.

`partialResult` is replacement state. The bridge never appends a `partialResult` to existing state. Only explicitly marked `delta` payloads are added to the cumulative tool projection.

## Commands

Commands are typed, idempotent, and journaled. The client sends a `command.submit` with a wire-generated `commandId`. The bridge writes the command, executes it against the appropriate host scope, and emits `command.state` events until the command reaches a terminal state.

Terminal states:

- `completed` — final result payload is included in the same `command.state` event.
- `failed` — final error payload is included in the same `command.state` event.
- `cancelled` — the client or the host cancelled the command.

The bridge assigns a command-scoped Pi turn identifier. The client must not equate the bridge `commandId` with the Pi `turnId`.

## Controller leases

A controller lease grants the holder exclusive write access to a single session for a bounded duration. The mobile app acquires a lease when the user opens a chat and releases it when the user navigates away. Leases are session-scoped, never global.

The bridge rejects reacquisition of an active lease with `controller_already_active`. The mobile app must restore the prior lease from the runtime rather than re-requesting it.

## Notifications

The bridge dispatches a notification to the registered FCM device when a reply completes for a session that is not currently selected on the phone. The notification payload includes a stable `deepLink` and a `notificationId`. The client must deduplicate by `notificationId` and use the stable request code when building the tap `PendingIntent`.

## Replay and durable cursor

The host persists a per-stream cursor. The mobile app seeds its in-memory cursor from the persisted value even when the local cache is empty. The bridge never resets the in-memory cursor to zero based on missing cache rows.

## Connection lifecycle

1. Mobile app opens the WebSocket.
2. Mobile app sends `hello` with installation identifier, platform, and requested capabilities.
3. Bridge validates the protocol version, the installation identifier, and the requested capabilities, then responds with `hello.accepted`.
4. Mobile app subscribes to the streams it needs.
5. The bridge replays from the persisted cursor, then begins live delivery.
6. The bridge can drain, disconnect, or background the connection at any time. Drain is signalled by a `host.draining` event.

## What is not in the protocol

- File uploads and blob storage. Attachments are referenced by URL and never proxied through the bridge.
- Voice.
- Group chat.
- Cloud mirror. The protocol is designed for one client, one host.
