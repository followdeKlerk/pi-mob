# Bridge–mobile protocol

Status: normative MVP contract.

Protocol version: `1.0`.

This protocol carries normalized Pi activity and pi-mob control state between the Flutter client and the host bridge. Pi's stdin/stdout JSONL remains a private bridge-adapter concern and is never forwarded directly to mobile.

Normative terms `MUST`, `MUST NOT`, `SHOULD`, and `MAY` have their usual requirements meaning.

## 1. Protocol goals

Protocol v1 MUST provide:

- one private connection per host,
- multiplexed host and session state,
- durable duplicate-safe commands,
- ordered replay after disconnect,
- snapshot recovery after cursor expiry or host restore,
- explicit controller ownership for mutations,
- bounded messages, queues, and outputs,
- stable machine-readable errors,
- additive minor-version evolution,
- no dependency on client clock correctness.

It does not provide application-layer authentication. Tailscale is the connection-authentication boundary for the initial single-user product.

## 2. Transport and endpoints

One HTTPS origin is exposed through Tailscale Serve:

```text
GET  /healthz
GET  /readyz
GET  /v1/ws
POST /v1/attachments
GET  /v1/exports/{exportId}
```

Rules:

- `/v1/ws` upgrades to WebSocket.
- WebSocket application data uses UTF-8 JSON text messages.
- One WebSocket message contains exactly one JSON object.
- WebSocket compression is disabled for protocol v1.
- Binary attachments and exports use HTTPS, not base64 WebSocket envelopes.
- Production bridge listens only on loopback; TLS terminates at Tailscale Serve.
- Standard platform certificate and hostname verification applies.
- No certificate pinning is added in MVP.
- Funnel and public endpoints are unsupported.

## 3. Pairing QR

The QR contains non-secret host discovery metadata:

```json
{
  "kind": "pi-mob-host",
  "version": 1,
  "hostId": "6a7c0845-069f-4fe3-bf67-a9fccf43e754",
  "displayName": "Mac mini",
  "endpoint": "https://host.tailnet-name.ts.net",
  "protocolMajor": 1
}
```

Rules:

- `endpoint` is an HTTPS origin without credentials, session IDs, attachment IDs, or query tokens.
- The app derives `wss://.../v1/ws` from the HTTPS origin.
- The QR does not grant access outside Tailscale.
- The app displays host name, hostname, and host-ID suffix before saving.
- A hostname reporting another `hostId` is treated as a changed/reinstalled host and requires explicit re-pairing.
- Manual endpoint entry remains a recovery path; `hostId` is learned during handshake.

## 4. Connection handshake

Immediately after WebSocket establishment, the client sends `hello` before any other message.

```json
{
  "protocol": { "major": 1, "minor": 0 },
  "messageId": "8fd5bb94-ecdf-4bf3-85f3-62180db06080",
  "requestId": "0cfac5e3-a651-4c3f-b955-1ac2680fa9c7",
  "type": "hello",
  "sentAt": "2026-07-12T18:00:00Z",
  "payload": {
    "expectedHostId": "6a7c0845-069f-4fe3-bf67-a9fccf43e754",
    "mobileVersion": "0.1.0",
    "platform": "ios",
    "installationId": "919cd681-bd37-4451-9475-baf53ed29184",
    "requiredCapabilities": ["streams.v1", "commands.v1"],
    "optionalCapabilities": ["attachments.v1", "extension_dialogs.v1", "notifications.v1"]
  }
}
```

For manual first connection, `expectedHostId` MAY be omitted.

Bridge response:

```json
{
  "protocol": { "major": 1, "minor": 0 },
  "messageId": "2470e38d-e662-4243-9984-805156894c2d",
  "requestId": "0cfac5e3-a651-4c3f-b955-1ac2680fa9c7",
  "type": "hello.accepted",
  "sentAt": "2026-07-12T18:00:00Z",
  "payload": {
    "connectionId": "bdf87fa9-7797-41d6-9337-816a684ad1c5",
    "hostId": "6a7c0845-069f-4fe3-bf67-a9fccf43e754",
    "hostGeneration": "3",
    "hostDisplayName": "Mac mini",
    "bridgeVersion": "0.1.0",
    "piVersion": "0.80.6",
    "serverTime": "2026-07-12T18:00:00Z",
    "capabilities": [
      "streams.v1",
      "commands.v1",
      "controller_leases.v1",
      "attachments.v1",
      "extension_dialogs.v1"
    ],
    "limits": {
      "maxJsonBytes": 1048576,
      "maxAttachmentBytes": 10485760,
      "maxAttachmentsPerPrompt": 4,
      "maxPromptAttachmentBytes": 26214400,
      "maxQueuedFollowUps": 10,
      "maxSessionPageSize": 100,
      "maxBackgroundSessionSubscriptions": 5
    }
  }
}
```

Handshake rules:

- Protocol-major mismatch is fatal.
- Minor versions are additive.
- An unknown required capability is fatal with `unsupported_capability`.
- Unknown optional capabilities are ignored.
- `expectedHostId` mismatch is fatal with `host_identity_mismatch`.
- `hostGeneration` is a decimal string incremented when restored/replaced state can invalidate all known cursors.
- A client observing a changed `hostGeneration` MUST discard cached stream events/cursors for that host and request snapshots.
- `serverTime` is used to estimate expiry countdowns only. Server validation remains authoritative.
- No command is accepted before handshake and initial subscription complete.

## 5. Common envelope

All WebSocket messages use this shape:

```json
{
  "protocol": { "major": 1, "minor": 0 },
  "messageId": "uuid",
  "requestId": "uuid",
  "commandId": "uuid",
  "connectionId": "uuid",
  "leaseId": "uuid",
  "streamId": "session:uuid",
  "cursor": "182",
  "type": "turn.started",
  "sentAt": "2026-07-12T18:00:00Z",
  "payload": {}
}
```

Only fields applicable to the message are present.

Field rules:

- `messageId` MUST uniquely identify the envelope.
- `requestId` correlates direct request/response control traffic.
- `commandId` identifies a durable user-intent command.
- `connectionId` is required after handshake on client-to-server traffic.
- `leaseId` is required for session/host mutations that need controller ownership.
- `streamId` and `cursor` appear together only on journaled server events.
- `cursor` is a base-10 non-negative integer encoded as a JSON string.
- Clients MUST compare cursors as arbitrary-precision integers, never floating-point numbers.
- `type` is a stable dotted identifier.
- `sentAt` is UTC RFC 3339 and informational; it MUST NOT establish event ordering, idempotency, or expiry validity.
- `payload` is always a JSON object, including when empty.
- Unknown optional fields are ignored and MAY be recorded in redacted diagnostics.

UUIDs use lowercase canonical text. UUIDv7 is preferred where supported; UUIDv4 is acceptable. Protocol behaviour never relies on UUID ordering.

## 6. Message classes

### Control request/response

Nonjournaled connection, subscription, lease-renewal, page, and current-command queries use `requestId`. A response may be lost and safely repeated.

### Durable command

Any user intent that changes host/session/Pi state uses `commandId`, durable acceptance, payload hashing, and state events.

### Journaled event

Events belong to exactly one stream and carry `streamId` plus `cursor`. They are persisted before network send.

## 7. Streams

Protocol v1 defines replayable streams.

### Host stream

```text
host:<hostId>
```

Mandatory after handshake. Carries:

- host state/readiness/degradation/draining,
- session summary additions/changes/removals,
- workspace/trust summary changes,
- active-process capacity,
- notification capability state,
- host-scoped command transitions.

### Session stream

```text
session:<sessionId>
```

Carries:

- session/process/controller/policy state,
- turn lifecycle,
- assistant/reasoning content,
- tool activity,
- queue state,
- model/context/retry/compaction state,
- extension UI,
- session-scoped command transitions.

Each stream has an independent monotonic cursor. Cursor values increase by exactly one, are never reused within a host generation, and are committed with the event.

## 8. Subscriptions

After handshake the client sends `subscription.set`:

```json
{
  "protocol": { "major": 1, "minor": 0 },
  "messageId": "uuid",
  "requestId": "uuid",
  "connectionId": "uuid",
  "type": "subscription.set",
  "sentAt": "2026-07-12T18:00:01Z",
  "payload": {
    "streams": [
      {
        "streamId": "host:6a7c0845-069f-4fe3-bf67-a9fccf43e754",
        "afterCursor": "184",
        "detail": "full"
      },
      {
        "streamId": "session:0acb5e24-b29e-4e79-8448-1372812e36c1",
        "afterCursor": "9921",
        "detail": "full"
      },
      {
        "streamId": "session:23b05812-cb23-4200-92bc-bb41cd4516a9",
        "afterCursor": "305",
        "detail": "summary"
      }
    ]
  }
}
```

Rules:

- The host stream MUST be included.
- At most one session uses `detail: full` per connection.
- Up to five additional active sessions MAY use `detail: summary`.
- Summary subscriptions receive lifecycle, attention, controller, queue-count, and command-state events, but the bridge still journals the full canonical session stream.
- Opening a different session changes subscription detail; it does not create another WebSocket.
- Unknown or deleted streams produce per-stream errors without necessarily closing the connection.
- A successful response is `subscription.accepted` containing each stream's sync mode.

Example:

```json
{
  "protocol": { "major": 1, "minor": 0 },
  "messageId": "uuid",
  "requestId": "uuid",
  "type": "subscription.accepted",
  "sentAt": "2026-07-12T18:00:01Z",
  "payload": {
    "streams": [
      { "streamId": "host:...", "mode": "replay" },
      { "streamId": "session:...", "mode": "current" },
      { "streamId": "session:...", "mode": "snapshot_required" }
    ]
  }
}
```

## 9. Replay, acknowledgements, and snapshots

### Replay

For `mode: replay`, the bridge sends every retained event after `afterCursor`, then:

```json
{
  "protocol": { "major": 1, "minor": 0 },
  "messageId": "uuid",
  "type": "stream.sync.complete",
  "sentAt": "2026-07-12T18:00:02Z",
  "payload": {
    "streamId": "session:...",
    "currentCursor": "9974",
    "mode": "replay"
  }
}
```

### Current

For `mode: current`, no retained events are missing. The bridge sends current lightweight stream state and `stream.sync.complete`.

### Snapshot required

A cursor is absent, invalid, from another host generation, ahead of the bridge, or older than retention.

The bridge sends:

1. `stream.snapshot.begin` with `snapshotId`, `streamId`, and `baselineCursor`.
2. One or more bounded `stream.snapshot.part` control messages.
3. `stream.snapshot.end`.
4. Any journal events after `baselineCursor`.
5. `stream.sync.complete`.

The bridge captures snapshot state and baseline consistently so events cannot fall between snapshot and replay.

Host snapshot includes readiness, capabilities, session summaries, workspace summaries needed by current screens, capacity, and requesting-installation lease summaries.

Session snapshot includes metadata, runtime/controller/policy/model/queue/retry/compaction state, pending dialog, active/last turn state, and a bounded recent canonical transcript. Older transcript history is loaded through pagination.

Snapshot application rules:

- Client replaces the cached state for that stream atomically.
- Client sets its last-contiguous cursor to `baselineCursor` only after all snapshot parts validate.
- Client MUST discard old events at or before baseline.
- A post-baseline event may not be applied before snapshot completion.
- If snapshot transfer fails, retry the subscription; do not partially merge.

### Cursor acknowledgements

Client sends `cursor.ack` at least once per second while receiving traffic, or after twenty applied events:

```json
{
  "protocol": { "major": 1, "minor": 0 },
  "messageId": "uuid",
  "connectionId": "uuid",
  "type": "cursor.ack",
  "sentAt": "2026-07-12T18:00:03Z",
  "payload": {
    "cursors": {
      "host:...": "190",
      "session:...": "9974"
    }
  }
}
```

Acknowledgements are advisory and do not shorten retention below configured policy.

### Duplicate and gap handling

- Duplicate `(streamId, cursor)` with same `eventId` is ignored.
- Duplicate cursor with another `eventId` is a protocol integrity failure; stop applying that stream and request snapshot.
- A cursor gap pauses live application for that stream and triggers resubscription after the last contiguous cursor.
- Other streams may continue.

## 10. Controller leases

Viewing does not require control. Session mutations require one active controller lease.

### Acquire

```json
{
  "protocol": { "major": 1, "minor": 0 },
  "messageId": "uuid",
  "requestId": "uuid",
  "commandId": "uuid",
  "connectionId": "uuid",
  "type": "controller.acquire",
  "sentAt": "2026-07-12T18:00:04Z",
  "payload": {
    "scope": "session",
    "sessionId": "uuid"
  }
}
```

Acquire/takeover/release are durable commands but do not require an existing lease.

The bridge emits `controller.state` with:

```json
{
  "scope": "session",
  "sessionId": "uuid",
  "mode": "controller",
  "leaseId": "uuid",
  "installationId": "uuid",
  "expiresAt": "2026-07-12T18:00:49Z",
  "reclaimableUntil": "2026-07-12T18:01:04Z"
}
```

Rules:

- Lease lifetime is 45 seconds.
- Traffic/heartbeat from the controlling connection renews the lease.
- Same installation may reclaim during a 60-second grace after disconnect.
- Another installation uses `controller.takeover`; takeover is explicit and revokes the prior lease immediately.
- `controller.release` is idempotent.
- Session mutations include current `leaseId`.
- A stale/expired/revoked lease returns `controller_required` or `stale_controller`.
- Duplicate resend of an already accepted command returns its state even if the old lease has since expired; it does not redispatch.
- Host-scoped mutations that require serialization MAY use an equivalent host lease.

Controller leases provide concurrency control, not authentication.

## 11. Durable command processing

Every state-changing user-intent command includes a client-generated `commandId`.

Processing:

1. Validate envelope, payload, capability, connection generation, state, and lease.
2. Canonicalize the semantic command payload.
3. Compute SHA-256 payload hash.
4. Transactionally store command in `accepted` state and journal `command.state`.
5. Send direct `command.receipt` correlated by `requestId`.
6. Dispatch exactly once at the bridge boundary.
7. Journal transitions such as `dispatched`, `running`, `completed`, `failed`, `cancelled`, or `indeterminate`.

Direct receipt:

```json
{
  "protocol": { "major": 1, "minor": 0 },
  "messageId": "uuid",
  "requestId": "uuid",
  "commandId": "uuid",
  "type": "command.receipt",
  "sentAt": "2026-07-12T18:00:05Z",
  "payload": {
    "state": "accepted",
    "duplicate": false
  }
}
```

Idempotency rules:

- Same command ID and semantic payload: return current state, `duplicate: true`, no second dispatch.
- Same command ID and different semantic payload: `idempotency_conflict`.
- Connection ID, request ID, lease ID, timestamps, and retry metadata are excluded from semantic payload hash.
- Accepted but not dispatched at bridge restart may dispatch after recovery.
- Running during Pi/bridge/host crash becomes `indeterminate` and is never automatically repeated.
- Duplicate-safe bridge dispatch is guaranteed; external shell/filesystem exactly-once execution is not claimed.

The client MUST NOT clear an unsent prompt draft until it receives an accepted/current receipt.

## 12. Prompt, steering, and follow-up queue

`prompt.submit` payload:

```json
{
  "sessionId": "uuid",
  "deliveryMode": "immediate",
  "message": "Implement the parser",
  "attachmentIds": ["uuid"]
}
```

`deliveryMode` values:

- `immediate`: session must be idle/eligible; dispatch as Pi prompt.
- `steer`: session must be running; dispatch using Pi steering semantics.
- `follow_up`: accepted into bridge-owned durable queue.

Rules:

- While a turn is running the mobile client MUST explicitly choose `steer` or `follow_up`.
- Disconnected mobile drafts are never submitted automatically after reconnect.
- Queue capacity is ten accepted follow-ups per session.
- Queue order is bridge-authoritative FIFO unless a later implemented reorder command is advertised.
- Queue attachments remain referenced until removal or dispatch.
- `queue.remove` and `queue.clear` affect only undispatched queue items.
- Once dispatch begins, the queue item becomes a turn and cannot be removed as a queue item.
- On settle, the bridge dispatches the next eligible queued item according to policy.
- A process/bridge restart preserves queued items.
- `turn.abort` does not silently clear follow-ups; clear/keep is a separate explicit command.
- Queue overflow rejects before command acceptance with `queue_full`.

## 13. Command catalogue

This table is the minimum v1 command surface. Canonical schemas define exact payloads.

### Connection/control requests — no durable command ID

```text
hello
subscription.set
cursor.ack
controller.renew
host.snapshot.request
session.snapshot.request
session.list
session.history.page
workspace.list
workspace.search
model.list
command.current
```

These requests are repeatable reads/control messages and use `requestId` where a response is expected.

### Controller commands

```text
controller.acquire
controller.takeover
controller.release
```

### Host/workspace commands

```text
host.display_name.set
workspace.trust.approve
notification.device.register
notification.device.unregister
```

### Session/process commands

```text
session.create
session.activate
session.stop
session.rename
session.policy.set
session.delete
session.restore
session.purge
session.fork
session.clone
session.export
```

### Turn/queue commands

```text
prompt.submit
turn.abort
queue.remove
queue.clear
```

### Model/context/retry commands

```text
model.set
thinking.set
steering_mode.set
follow_up_mode.set
compaction.start
compaction.auto.set
retry.auto.set
retry.abort
```

### Extension command

```text
extension.respond
```

A new mutating command in protocol v1 minor versions MUST declare:

- required capability,
- host/session scope,
- lease requirement,
- accepted states,
- semantic hash fields,
- recovery classification,
- journaled state/event effects,
- stable errors.

## 14. Journaled event catalogue

### Host stream events

```text
host.state
host.degraded
host.draining
host.capacity
host.backup_state
host.compatibility
session.summary
session.removed
workspace.summary
workspace.trust_state
notification.capability
command.state
error.event
```

### Session stream events

```text
session.state
session.metadata
session.policy
controller.state
turn.accepted
turn.queued
turn.started
turn.waiting_for_input
turn.retrying
turn.compacting
turn.settled
turn.aborted
turn.failed
turn.indeterminate
assistant.started
assistant.delta
assistant.completed
reasoning.started
reasoning.delta
reasoning.completed
tool.started
tool.output
tool.completed
tool.failed
tool.cancelled
queue.snapshot
model.state
context.state
retry.state
compaction.state
extension.dialog
extension.notify
extension.status
extension.widget
extension.title
extension.editor_prefill
command.state
error.event
```

Rules:

- Pi `agent_settled` maps to `turn.settled` and is the idle boundary.
- `agent_end` alone MUST NOT settle the mobile turn.
- Parallel tool calls have independent `toolCallId` and may interleave updates.
- Final tool results remain associated with the originating assistant step.
- Unknown optional event types are retained as diagnostic placeholders by mobile and do not crash stream application.
- A receiver MUST reject an event that declares an unsupported required capability.

## 15. Event payload requirements

### Command state

```json
{
  "commandId": "uuid",
  "commandType": "prompt.submit",
  "state": "running",
  "errorCode": null
}
```

### Session summary

Contains only bounded list data:

```text
sessionId
workspaceId
name
runtimeState
attentionState
policyMode
modelSummary
queueCount
lastActivityAt
controllerSummary for requesting installation where appropriate
parentSessionId optional
purgeAfter optional
```

### Tool events

Must include:

```text
toolCallId
assistantStepId
toolName
status
bounded argument summary
bounded output/result summary
duration when known
isError/isTruncated
retainedBytes/totalBytes/digest when truncated
```

Raw full output over the mobile cap remains host-only in v1.

### Assistant/reasoning deltas

- Carry append-only bounded text fragments plus stable content-block ID.
- A completed event contains canonical completed content metadata.
- Snapshot may replace incomplete deltas with durable canonical content.
- Client deduplicates by event cursor, not by text matching.

## 16. Pagination and read responses

List/history queries use opaque page tokens rather than numeric offsets.

Example session list request:

```json
{
  "protocol": { "major": 1, "minor": 0 },
  "messageId": "uuid",
  "requestId": "uuid",
  "connectionId": "uuid",
  "type": "session.list",
  "sentAt": "2026-07-12T18:00:00Z",
  "payload": {
    "filter": "active",
    "query": null,
    "sort": "attention_then_activity",
    "pageSize": 50,
    "pageToken": null
  }
}
```

Response `session.list.result` includes:

```text
items
nextPageToken optional
snapshotRevision
```

Rules:

- Maximum page size 100.
- Page tokens are opaque, short-lived, and bound to query/sort.
- Concurrent changes may cause a new `snapshotRevision`; clients reconcile host-stream summary events and may refresh pages.
- Transcript history pages are ordered newest-to-oldest for fetching but returned in canonical display order within each page.
- Absolute Pi session paths are never returned.

## 17. Attachments

`POST /v1/attachments` uses multipart form data.

Required fields:

```text
installationId
clientUploadId
content
```

Optional safe metadata:

```text
intendedSessionId
```

Successful response:

```json
{
  "attachmentId": "uuid",
  "sha256": "hex",
  "mimeType": "image/jpeg",
  "bytes": 428391,
  "width": 1536,
  "height": 2048,
  "expiresAt": "2026-07-13T18:00:00Z"
}
```

Rules:

- `clientUploadId` is unique per installation and provides retry deduplication.
- Same upload ID/same digest returns existing metadata.
- Same upload ID/different digest returns HTTP conflict with `idempotency_conflict`.
- Bridge determines content type from bytes and verifies decoding/dimensions.
- Accepted types: JPEG and PNG.
- One file maximum: 10 MiB.
- One prompt maximum: four files and 25 MiB total.
- Bridge stores random filenames outside workspace roots.
- `prompt.submit` references IDs, not bytes or paths.
- Expired/unknown ID rejects prompt before command acceptance with `attachment_unavailable`.
- Unreferenced upload expires after 24 hours.
- Upload responses and errors never expose storage paths.

HTTP error bodies use the stable error payload shape without a WebSocket envelope.

## 18. Exports

`session.export` is a durable command. On completion it emits export metadata:

```json
{
  "exportId": "uuid",
  "format": "html",
  "bytes": 823441,
  "sha256": "hex",
  "expiresAt": "2026-07-13T18:00:00Z"
}
```

Mobile downloads through:

```text
GET /v1/exports/{exportId}
```

Rules:

- IDs are opaque and valid only on the paired private host origin.
- HTML is the only MVP export format.
- Default expiry is 24 hours.
- Range requests MAY be supported but are not required for MVP.
- Response content disposition uses a sanitized generated filename.
- No public link is created.
- Unknown/expired/deleted export returns `export_unavailable`.

## 19. Extension UI

Every persisted dialog has `dialogId`, upstream request mapping, method, creation, and server expiry.

Interactive methods:

```text
select
confirm
input
editor
```

Presentation methods:

```text
notify
setStatus
setWidget
setTitle
set_editor_text
```

Rules:

- `extension.respond` is duplicate-safe and requires the session controller lease.
- A response after expiry returns `invalid_state`.
- Bridge never invents a default answer after disconnect/expiry.
- Pending dialog is replayed/snapshotted after reconnect while unexpired.
- Default maximum expiry is five minutes unless a shorter supported upstream timeout applies.
- Pi turn remains waiting until response, expiry, abort, or process failure.
- Presentation widgets/status are bounded by protocol limits.
- `set_editor_text` appears visibly as composer prefill; it is not auto-submitted.

## 20. Session lifecycle operations

### Create

Requires `workspaceId`, policy mode, and optional name/model intent. Process activation may follow create or occur separately.

### Activate/stop

- Activate validates workspace, trust fingerprint, Pi compatibility, and host capacity.
- Stop is rejected while a turn/queue/dialog state prevents safe stop unless a documented combined abort path is chosen.

### Fork/clone

- Fork requires an eligible Pi entry ID represented as an opaque bridge-mapped entry reference.
- Clone duplicates current active branch.
- Upstream extension cancellation completes command with `cancelled: true` and does not create/navigate to a new session.
- New session mapping and snapshot commit before success is presented.

### Delete/restore/purge

- Delete is soft for seven days and cancels/handles active state explicitly.
- Partial failure produces `session.delete_failed` repair state.
- Restore is allowed only while durable material remains.
- Purge is irreversible and uses a separate explicit command.
- IDs are never reused.

## 21. Errors

WebSocket error envelope:

```json
{
  "protocol": { "major": 1, "minor": 0 },
  "messageId": "uuid",
  "requestId": "uuid",
  "commandId": "uuid",
  "type": "error",
  "sentAt": "2026-07-12T18:00:00Z",
  "payload": {
    "code": "idempotency_conflict",
    "message": "The command ID was already used with another payload.",
    "retryable": false,
    "recommendedDelayMs": null,
    "details": {}
  }
}
```

Initial stable codes:

```text
invalid_message
unsupported_protocol
unsupported_capability
host_identity_mismatch
stale_connection
host_draining
host_not_ready
host_capacity
stream_not_found
cursor_invalid
snapshot_failed
session_not_found
session_deleted
session_incompatible
session_repair_required
workspace_not_found
workspace_not_allowed
workspace_unavailable
workspace_trust_required
controller_required
controller_conflict
stale_controller
command_not_found
idempotency_conflict
queue_full
queue_item_not_found
invalid_state
attachment_unavailable
export_unavailable
payload_too_large
rate_limited
slow_consumer
pi_unavailable
pi_version_mismatch
provider_interrupted
permission_denied
crash_loop
database_unavailable
storage_full
migration_required
internal_error
```

Rules:

- Messages are safe for user display.
- Details are bounded and schema-defined by code.
- Stack traces, environment values, raw stderr, absolute paths, credentials, prompt text, and content are excluded by default.
- `retryable: true` MAY include a recommended delay.
- A command rejected before durable acceptance has no accepted command state.
- Failures after acceptance appear as command/turn events, not a second contradictory direct response.

The bridge does not emit `unauthorized_tailnet_connection`; transport reachability is controlled by Tailscale, not an app-layer identity check.

## 22. Limits and backpressure

Defaults:

- Maximum JSON message: 1 MiB UTF-8.
- Maximum individual tool-output event payload: 256 KiB.
- Maximum inline mobile tool output retained: 5 MiB per tool call.
- Maximum queued outbound WebSocket data: 8 MiB per connection.
- Maximum accepted control requests: 10 per second per connection, burst 20.
- Maximum session page: 100.
- Maximum queued follow-ups: 10 per session.
- Maximum background summary subscriptions: 5 plus one full session.
- Maximum interactive extension dialog: 5 minutes.

Oversized tool output:

- Stop journaling inline raw output at cap.
- Emit truncation metadata with retained/total byte counts and SHA-256 digest where available.
- Continue process/turn.
- Full raw output is host-only in v1.

Slow consumer:

- Close connection with `slow_consumer` once buffer cap is exceeded.
- Pi and bridge session continue.
- Client reconnects and recovers from streams/snapshot.

No buffer, list, output, queue, attachment, export, or diagnostic stream is unbounded.

## 23. Heartbeat and reconnect

- WebSocket ping interval: 20 seconds while connected.
- Dead after 60 seconds without pong or application traffic.
- Reconnect delays: 2 seconds, 8 seconds, 30 seconds, 2 minutes, then 10 minutes capped.
- Apply ±20% jitter.
- App foreground triggers immediate reconnect regardless of current delay.
- Deliberate forget/unpair disables reconnect.
- Background socket persistence is not guaranteed on iOS or Android.
- Host continues Pi turns independently from phone connectivity.
- After reconnect, hello and subscription synchronization complete before new user commands.

## 24. Clock and expiry rules

- Event ordering comes only from stream cursors.
- Command identity comes only from command ID and payload hash.
- Lease/dialog/attachment/export expiry is enforced using bridge time.
- Client may estimate countdown using handshake `serverTime` and local monotonic elapsed time.
- Client clock being wrong MUST NOT cause server acceptance of expired state.
- Server includes current `expiresAt` in relevant state/snapshot events.

## 25. Host draining, restart, and generation

During graceful shutdown:

- Bridge emits `host.draining` on host stream/control path where possible.
- New commands reject with `host_draining`.
- Existing accepted state is persisted.
- Clients reconnect after service returns.

Normal bridge restart retains `hostGeneration` and stream cursors.

Database restore, rollback to earlier durable state, or identity-reset operation increments `hostGeneration`. On changed generation, all clients discard host caches and snapshot every required stream.

## 26. Schema and code-generation policy

Canonical protocol definitions live in `packages/protocol-schema` using TypeBox.

The package produces:

- TypeScript runtime validators and static types,
- JSON Schema documents,
- command/event catalogue metadata,
- canonical valid/invalid fixture corpus,
- semantic payload-hash fixtures.

Dart models are implemented as an immutable discriminated union and validated against the same fixtures.

Rules:

- Generated artifacts are reproducible and checked for drift in CI.
- The bridge domain does not depend on generated Flutter code.
- The mobile app never imports Pi upstream schemas.
- Adding an event/command requires fixture, documentation, compatibility classification, and tests in both languages.
- Unknown additive optional fields/events remain forward compatible.
- Required incompatible change increments protocol major.

## 27. Required protocol fixtures

At minimum:

- Pairing payload valid/invalid.
- Hello success, expected-host mismatch, major mismatch, missing required capability.
- Host generation change.
- Host/session subscription current/replay/snapshot-required.
- Decimal cursor values above JavaScript safe integer.
- Stream duplicate, gap, conflicting duplicate, expired cursor.
- Multipart snapshot success/failure and post-baseline replay.
- Controller acquire/reclaim/takeover/expiry/stale mutation.
- Duplicate command before/after acknowledgement and completion.
- Same command ID with changed semantic payload.
- Changed request/connection/lease metadata with same semantic command.
- Accepted-before-dispatch restart.
- Running-at-crash indeterminate.
- Immediate/steer/follow-up prompt paths.
- Queue add/remove/clear/restart/full.
- Every command and event type.
- Session list/history pagination and changed revision.
- Attachment retry/different-content conflict/expiry/malformed/oversized.
- Export success/expiry/deletion.
- Extension dialog reconnect/timeout/duplicate response.
- Oversized JSON/tool output and slow consumer.
- Host draining, Pi mismatch, database unavailable/full.
- Unknown optional event and unknown required capability.

Both Dart and TypeScript MUST consume the same fixture files.
