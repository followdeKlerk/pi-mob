# Bridge–mobile protocol

Status: normative MVP contract.

This protocol carries normalized Pi RPC activity between the Flutter client and the host bridge. Pi's stdin/stdout JSONL remains an internal bridge concern and is not exposed directly to the phone.

## 1. Transport

The bridge exposes one HTTPS origin through Tailscale Serve.

```text
GET  /healthz
GET  /readyz
GET  /v1/ws
POST /v1/attachments
```

- `/v1/ws` upgrades to WebSocket.
- WebSocket application data uses UTF-8 JSON text frames.
- Each WebSocket message contains exactly one JSON envelope.
- WebSocket compression is disabled for protocol v1.
- Attachments use HTTPS multipart upload and are referenced by opaque IDs from later WebSocket commands.

## 2. Connection handshake

Immediately after WebSocket establishment, the client sends `hello`.

```json
{
  "protocol": { "major": 1, "minor": 0 },
  "messageId": "8fd5bb94-ecdf-4bf3-85f3-62180db06080",
  "type": "hello",
  "sentAt": "2026-07-12T18:00:00Z",
  "payload": {
    "mobileVersion": "0.1.0",
    "platform": "ios",
    "installationId": "919cd681-bd37-4451-9475-baf53ed29184",
    "capabilities": ["attachments.v1", "extension_dialogs.v1"]
  }
}
```

The bridge responds with `hello.accepted` or closes with a version error.

```json
{
  "protocol": { "major": 1, "minor": 0 },
  "messageId": "2470e38d-e662-4243-9984-805156894c2d",
  "type": "hello.accepted",
  "sentAt": "2026-07-12T18:00:00Z",
  "payload": {
    "bridgeVersion": "0.1.0",
    "piVersion": "0.80.6",
    "serverCapabilities": ["attachments.v1", "replay.v1"],
    "limits": {
      "maxJsonBytes": 1048576,
      "maxAttachmentBytes": 10485760,
      "maxAttachmentsPerPrompt": 4
    }
  }
}
```

Rules:

- Protocol-major mismatch is fatal.
- Minor versions are additive.
- Unknown optional fields and unknown event types are ignored and recorded in diagnostics.
- A message declaring an unknown required capability is rejected with `unsupported_capability`.

## 3. Common envelope

All post-handshake messages use this shape:

```json
{
  "protocol": { "major": 1, "minor": 0 },
  "messageId": "uuid",
  "requestId": "uuid-or-null",
  "commandId": "uuid-or-null",
  "sessionId": "uuid-or-null",
  "sequence": 182,
  "type": "session.event",
  "sentAt": "2026-07-12T18:00:00Z",
  "payload": {}
}
```

Field rules:

- `messageId` uniquely identifies this envelope.
- `requestId` correlates a direct request and response.
- `commandId` identifies a user-intent command and provides idempotency.
- `sessionId` is present for session-scoped traffic.
- `sequence` is present only on journaled server-to-client session events.
- `type` is a stable dotted identifier.
- `sentAt` is UTC RFC 3339.
- `payload` is always an object, including when empty.

## 4. Commands and acknowledgement

Every command that can mutate state or cause execution contains a client-generated `commandId`.

Examples:

- `prompt.submit`
- `turn.abort`
- `session.create`
- `session.delete`
- `session.rename`
- `session.fork`
- `session.clone`
- `model.set`
- `thinking.set`
- `extension.respond`

Command processing:

1. The bridge validates the envelope and payload.
2. The bridge stores the command ID, payload hash, and `accepted` state in SQLite.
3. The bridge emits `command.accepted`.
4. The bridge dispatches the command once.
5. The bridge journals state transitions: `running`, `completed`, `failed`, or `indeterminate`.

If the phone does not receive acknowledgement, it resends the same command with the same `commandId`.

- Same ID and same payload: the bridge returns the existing command state and does not dispatch twice.
- Same ID and different payload: the bridge rejects it with `idempotency_conflict`.
- Accepted but not yet dispatched at bridge restart: dispatch may resume.
- Running at Pi, bridge, or host crash: mark `indeterminate`; never automatically repeat the user action.

The protocol guarantees duplicate-safe bridge dispatch. It does not pretend that an external shell command can be proven exactly-once after a machine crash.

## 5. Session ordering

- Each mobile session has an independent unsigned 64-bit `sequence` counter.
- The bridge commits a normalized event before sending it.
- Sequence values increase by one with no reuse.
- The client applies events strictly in sequence order.
- A duplicate sequence is ignored after verifying that its message identity matches the cached event.
- A sequence gap pauses live application and triggers replay from the last contiguous sequence.

The phone sends `cursor.ack` at least once per second while receiving traffic, or after 20 new events, whichever occurs first.

```json
{
  "protocol": { "major": 1, "minor": 0 },
  "messageId": "uuid",
  "sessionId": "uuid",
  "type": "cursor.ack",
  "sentAt": "2026-07-12T18:00:01Z",
  "payload": { "sequence": 182 }
}
```

## 6. Resume and replay

After reconnect and handshake, the client sends one `resume.request` containing the selected host/session state.

```json
{
  "protocol": { "major": 1, "minor": 0 },
  "messageId": "uuid",
  "requestId": "uuid",
  "sessionId": "uuid",
  "type": "resume.request",
  "sentAt": "2026-07-12T18:01:00Z",
  "payload": { "afterSequence": 182 }
}
```

Outcomes:

- `resume.replay`: the bridge sends every journaled event after the cursor, then `resume.complete`.
- `resume.current`: no events are missing; the bridge sends current session/process state.
- `resume.snapshot_required`: the cursor is absent, invalid, or older than retention.

Snapshot fallback:

1. Bridge reads the durable Pi session state.
2. Bridge normalizes it into `session.snapshot`.
3. Bridge assigns a new replay baseline sequence.
4. Live journal traffic continues after that baseline.

A snapshot may replace incomplete streaming presentation with the latest durable canonical message state.

## 7. Event model

The bridge normalizes Pi-specific messages into stable mobile events. Initial event families:

```text
host.*
session.*
turn.*
assistant.*
reasoning.*
tool.*
queue.*
model.*
compaction.*
retry.*
extension.*
command.*
attachment.*
notification.*
error.*
```

Important events include:

- `session.state`
- `turn.started`
- `turn.settled`
- `turn.aborted`
- `turn.indeterminate`
- `assistant.delta`
- `assistant.completed`
- `reasoning.delta`
- `reasoning.completed`
- `tool.started`
- `tool.output`
- `tool.completed`
- `tool.failed`
- `extension.dialog`
- `command.accepted`
- `command.state`

Pi's `agent_settled` maps to `turn.settled` and remains the idle boundary.

## 8. Active-turn and queue rules

- One running agent turn per session.
- A new prompt during a running turn becomes a queued follow-up unless explicitly sent as a steering command supported by Pi.
- Queue capacity is ten prompts.
- Queue overflow returns `queue_full`; the command is not accepted.
- `turn.abort` targets the current turn ID.
- Aborting a turn does not silently delete queued prompts; the client chooses whether to keep or clear them.

## 9. Limits and backpressure

Defaults:

- Maximum JSON envelope: 1 MiB UTF-8.
- Maximum individual tool-output chunk: 256 KiB.
- Maximum inline tool output retained for mobile: 5 MiB per tool call.
- Maximum queued outbound data per WebSocket client: 8 MiB.
- Maximum accepted control commands: 10 per second per connection, with a short burst of 20.
- Maximum sessions listed in one response page: 100.

When output exceeds 5 MiB:

- The bridge stops journaling inline raw output.
- It emits a truncation marker with byte counts and digest.
- The phone presents the result as truncated.
- Full raw output remains host-only for v1.

If a client exceeds the outbound buffer:

- The bridge closes it with `slow_consumer`.
- The Pi process continues.
- The client reconnects and recovers from the journal.

## 10. Heartbeat and reconnect

- WebSocket ping interval: 20 seconds while connected.
- Connection considered dead after 60 seconds without pong or application traffic.
- Reconnect delays: 2 seconds, 8 seconds, 30 seconds, 2 minutes, then 10 minutes capped.
- Apply ±20% random jitter.
- Returning the app to foreground triggers an immediate reconnect attempt without waiting for the current backoff delay.
- A deliberate unpair or logout-equivalent action disables automatic reconnect.

## 11. Attachments

`POST /v1/attachments` uses multipart form data.

Required request metadata:

```text
installationId
clientUploadId
content
```

Successful response:

```json
{
  "attachmentId": "uuid",
  "sha256": "hex",
  "mimeType": "image/jpeg",
  "bytes": 428391,
  "expiresAt": "2026-07-13T18:00:00Z"
}
```

Rules:

- `clientUploadId` provides upload retry deduplication.
- The bridge determines type from content, not only the filename or header.
- Accepted v1 types: JPEG and PNG.
- One file: 10 MB maximum.
- One prompt: four files and 25 MB maximum total.
- `prompt.submit` references attachment IDs and does not embed bytes.
- Reusing an expired or unknown attachment ID returns `attachment_unavailable` before prompt acceptance.

## 12. Errors

Errors have stable machine-readable codes.

```json
{
  "protocol": { "major": 1, "minor": 0 },
  "messageId": "uuid",
  "requestId": "uuid",
  "commandId": "uuid",
  "sessionId": "uuid",
  "type": "error",
  "sentAt": "2026-07-12T18:00:00Z",
  "payload": {
    "code": "idempotency_conflict",
    "message": "The command ID was already used with another payload.",
    "retryable": false,
    "details": {}
  }
}
```

Initial codes:

```text
invalid_message
unsupported_protocol
unsupported_capability
unauthorized_tailnet_connection
session_not_found
workspace_not_found
workspace_not_allowed
workspace_trust_required
command_not_found
idempotency_conflict
queue_full
invalid_state
attachment_unavailable
payload_too_large
slow_consumer
pi_unavailable
pi_version_mismatch
provider_interrupted
permission_denied
crash_loop
internal_error
```

- Error messages are safe for display.
- Stack traces, environment variables, raw stderr, and secrets are never sent by default.
- Retryable errors state `retryable: true` and may include a recommended delay.

## 13. Extension dialogs

- Every bridge-routed extension dialog has a stable `dialogId` and expiry.
- Dialog responses use a command ID and are duplicate-safe.
- A response after expiry returns `invalid_state`.
- The bridge never invents a default answer when the phone disconnects.
- Default expiry is five minutes unless the extension supplies a shorter supported value.
- The Pi turn remains pending until response, expiry, abort, or process failure.

## 14. Session deletion

Deletion is two-stage:

1. `session.delete` marks the mobile session deleted and stops its Pi process.
2. The bridge moves bridge metadata and exports to a recoverable trash state for seven days.

The durable Pi session file is deleted only after command acceptance and successful bridge metadata transition. Failed partial deletion produces a repairable `session.delete_failed` state rather than pretending success.

## 15. Protocol test fixtures

The repository must retain fixtures for:

- Hello success and major-version failure.
- Duplicate prompt submission before and after acknowledgement.
- Same command ID with changed payload.
- Fragmented Pi JSONL input and Unicode content.
- Sequence gaps, duplicates, and expired cursors.
- Bridge restart with accepted, running, and completed commands.
- Oversized JSON and tool output.
- Slow consumer disconnect and replay.
- Attachment retry and expiry.
- Extension-dialog timeout and duplicate response.
