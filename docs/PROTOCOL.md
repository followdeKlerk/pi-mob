# Protocol

The bridge and the mobile client speak a single WebSocket protocol over a private tailnet. The protocol is versioned, capability-based, and additive. This document describes the wire shape that is actually shipped in `v0.0.3-alpha.1`.

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

The current released baseline is:

- `streams.v1`
- `commands.v1`
- `controller_leases.v1`
- `session_events.v2`
- `catalogue.v1`

The bridge may continue to accept internal raw Pi RPC commands for compatibility, but `raw_rpc.v1` is not advertised because the released mobile client has no raw-RPC surface.

Optional capabilities are added as the host enables them. `notifications.v1` is advertised when the bridge was started with a valid notification service account.

## Normal daemon capability matrix

This is the canonical exact capability contract for `hello.accepted`. The normal daemon emits the baseline set without FCM and adds only `notifications.v1` when FCM is configured.

| Configuration | hello.accepted.capabilities |
| --- | --- |
| without-FCM | `catalogue.v1`, `commands.v1`, `controller_leases.v1`, `session_events.v2`, `streams.v1` |
| with-FCM | `catalogue.v1`, `commands.v1`, `controller_leases.v1`, `notifications.v1`, `session_events.v2`, `streams.v1` |


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
2. Mobile app sends `hello` with installation identifier, platform, the per-installation bearer credential, and requested capabilities. The bridge validates the credential before issuing `hello.accepted`; a missing / wrong / revoked / expired / not-bound credential is rejected with `invalid_auth` (or `re_pair_required` for never-bound installs) and the connection is closed with code `1008`.
3. Bridge validates the protocol version, the installation identifier, and the requested capabilities, then responds with `hello.accepted`.
4. Mobile app subscribes to the streams it needs.
5. The bridge replays from the persisted cursor, then begins live delivery.
6. The bridge can drain, disconnect, or background the connection at any time. Drain is signalled by a `host.draining` event.

## Canonical session events v2

The bridge advertises `session_events.v2` when the normal daemon constructs the canonical session-event store and transport.

The mobile client sends `session.events.subscribe` with `sessionId` and `afterSequence`. The bridge subscribes before it reads replay data.

Replay uses `session.events.replay.result`. Live delivery uses `session.event`. Both messages carry the same event fields:

- `eventId`
- `sessionId`
- `sequence`
- `eventType`
- `occurredAt`
- `data`

The bridge stores each canonical event before it sends a live message. The mobile client rejects gaps and requests replay from its last durable sequence. Assistant and tool updates use replacement events (`assistant.content.replaced`, `assistant.message.completed`, and `tool.progress.replaced`) with stable turn/message/tool identifiers. Bounded tool results keep their exact value, including host paths, for the authenticated mobile client. Diagnostic records and logs redact private paths.

The legacy stream and history API remain only for older hosts and operational state. The canonical mobile chat, transcript search, and search index do not read those paths when `session_events.v2` is advertised.

## Command catalogue

When the bridge advertises `catalogue.v1`, the client sends `catalogue.snapshot.request` with `sessionId` and `requestId`. The bridge calls Pi `get_commands` for that session. The response contains only bounded command names, descriptions, categories, and invocations. Private Pi source metadata is never returned. Results are scoped to the requested session and are not reused after session selection changes.

## What is not in the protocol

- Voice.
- Group chat.
- Cloud mirror. The protocol is designed for one client, one host.

## Enrollment and companion HTTP endpoints

The bridge exposes enrollment and a small binary HTTP API on the same loopback listener. The mobile client reaches these endpoints only through Tailscale Serve, not directly.

Pairing is deliberately manual: the operator enters the HTTPS endpoint and six-digit passcode in the Android app. QR generation, QR scanning, and JSON pairing-payload entry are removed and unsupported.

`POST /v1/enroll` accepts `{ "installationId": "<uuid>", "passcode": "<six-digit passcode>" }`. The passcode is checked against its stored hash for expiry and single use in one SQLite transaction. Enrollment attempts are rate limited. A successful 201 response contains the plaintext `installationCredential` once. The bridge stores only its hash. The Android client writes the returned value only to Keystore-backed secure storage. Missing, expired, or replayed challenges return sanitized errors and never return a credential.

Both `/v1/attachments` and `/v1/exports/<id>` REQUIRE two headers before any body read:

- `X-Installation-Id`: a UUID-shaped stable identifier
- `X-Installation-Credential`: a 256-bit secret minted during enrollment

The server validates the credential against a stored SHA-256 hash with a constant-time compare, rejects unknown / wrong / revoked / expired / not-bound credentials with `401 invalid_auth`, and only then reads the body. A `re_pair_required` distinguished error is returned only for credentials that were never bound, so the mobile app can render an actionable re-pair card.

- `POST /v1/attachments` accepts a multipart upload. The multipart `installationId` field is a HINT only — the header is authoritative. A mismatch is rejected with `401`. The server validates the image (JPEG/PNG only), persists it under the bridge state directory, and returns the attachment id. The per-upload cap is 10 MiB. Per-installation upload rate limit, per-installation retained-byte quota, and aggregate attachment-store byte ceiling are checked before allocation; 429 / 413 / 507-style errors are returned for `rate_limited`, `quota_exceeded`, and `storage_full`.
- `GET /v1/exports/<id>` returns generated HTML for a completed session export. The export id is a UUID. The same `X-Installation-Id` + `X-Installation-Credential` headers are required. An export whose `expiresAt` has passed returns `404 export_unavailable`.

`installationId` identifies one app installation. In `v0.0.3-alpha.1` it is bound to a per-installation bearer credential that the WebSocket handshake and the binary HTTP endpoints share. Pairing pins host discovery but no longer authorises the phone.
