# System architecture

Status: normative for MVP.

This document defines component boundaries, authority, deployment topology, stream ownership, concurrency, and the major runtime flows.

## 1. Context

```text
+-------------------------+          private tailnet          +---------------------------+
| Flutter mobile app      |  HTTPS / WebSocket via Serve     | macOS host                |
|                         | <-------------------------------> |                           |
| UI + local cache        |                                  | Bun/TypeScript bridge     |
+-------------------------+                                  | SQLite + process manager  |
                                                             |            |              |
                                                             |            | JSONL        |
                                                             |            v              |
                                                             |     pi --mode rpc         |
                                                             |       per session         |
                                                             +---------------------------+
                                                                         |
                                                                         | provider APIs,
                                                                         | filesystem,
                                                                         | shell and tools
                                                                         v
                                                               user repositories and
                                                               configured LLM providers
```

Tailscale is the sole connection-authentication boundary for the initial single-user product. The bridge binds only to loopback. Tailscale Serve terminates TLS and forwards traffic.

## 2. Repository target

```text
apps/
  mobile/                    Flutter app
packages/
  bridge/                    host daemon and CLI
  pi-extension/              QR and policy extension
  protocol-schema/           canonical TypeBox protocol definitions
  protocol-fixtures/         generated and hand-authored JSON fixtures
scripts/
docs/
```

`protocol-schema` is a TypeScript package, but it contains no bridge business logic.

## 3. Components

### 3.1 Mobile presentation

Owns:

- navigation and screens,
- transcript presentation,
- composer and drafts,
- tool cards,
- extension sheets,
- accessibility semantics,
- notification deep links,
- user-visible errors and recovery actions.

Does not own:

- Pi process state,
- durable command acceptance,
- provider credentials,
- workspace trust enforcement,
- canonical session history.

### 3.2 Mobile application state

Use a unidirectional state model with repositories/services behind immutable view state.

Responsibilities:

- paired-host records,
- one transport connection per selected host,
- host and session stream cursors,
- subscriptions,
- controller-lease state,
- local drafts,
- normalized event cache,
- optimistic UI limited to non-executing presentation state.

State-changing host commands are never treated as successful until `command.accepted` is received.

### 3.3 Bridge HTTP/WebSocket server

Responsibilities:

- handshake and capability negotiation,
- payload validation and limits,
- host/session stream subscriptions,
- command acceptance and idempotency,
- controller leases,
- attachment upload/download,
- health/readiness endpoints,
- connection backpressure,
- normalized errors.

One mobile app connection serves the whole host. Do not open one WebSocket per Pi session.

### 3.4 Bridge persistence

SQLite/WAL owns:

- bridge installation identity,
- mobile installation registrations,
- workspaces and trust fingerprints,
- mobile session registry,
- Pi session mapping,
- command journal,
- host and session event journals,
- controller leases,
- follow-up queues,
- client cursors,
- attachments and exports,
- notification registrations,
- migrations and maintenance metadata.

A command is not accepted if its acceptance transaction cannot commit.

### 3.5 Pi adapter

The adapter is the only component allowed to depend on Pi RPC shapes.

Responsibilities:

- spawn `pi --mode rpc`,
- strict LF JSONL framing,
- response correlation,
- normalize Pi events into stable mobile events,
- map bridge commands to Pi commands,
- inspect durable Pi sessions for snapshots,
- handle Pi version and capability differences,
- capture bounded redacted stderr diagnostics.

The mobile protocol never exposes raw Pi filesystem paths, raw RPC errors, or upstream TypeScript types.

### 3.6 Process supervisor

Responsibilities:

- one Pi process per active session,
- process groups,
- active-process limits,
- lazy start and idle stop,
- crash-loop detection,
- graceful and forced cleanup,
- host shutdown draining,
- runtime state restoration.

### 3.7 Policy extension

A host-side Pi extension enforces product policy through Pi's extension hooks.

Responsibilities:

- block write/edit and mutating shell calls in read-only mode,
- expose trust-bearing resource information before startup,
- route extension UI requests,
- publish the pairing QR command,
- report effective policy and supported capabilities.

Read-only policy is snapshotted at turn start. A policy change does not retroactively alter a running turn.

### 3.8 Notification service

Responsibilities:

- register replaceable device tokens,
- send APNs/FCM status events,
- update/end Live Activities,
- coalesce and rate-limit,
- remove permanently invalid tokens,
- avoid transcript content in default payloads.

Notification success is never a prerequisite for agent execution.

## 4. Authority and ownership

| Concern | Authority | Mobile cache allowed? |
|---|---|---|
| Repository files | Host filesystem | No file mirror |
| Provider credentials | Host/Pi | Never |
| Pi conversation history | Durable Pi session | Rolling normalized cache |
| Command acceptance/state | Bridge SQLite | Yes, reconciled |
| Replay order | Bridge event journal | Cursor + cached events |
| Workspace trust | Bridge fingerprint + owner approval | Display copy |
| Session runtime state | Bridge process supervisor | Yes, reconciled |
| Draft text | Mobile | Yes, authoritative until send |
| Attachments before upload | Mobile temporary cache | Yes |
| Uploaded attachments | Bridge private storage | Metadata only |
| Exports | Bridge temporary storage | Downloaded copy after request |
| Notification token | Platform + bridge registration | Platform-managed token |

## 5. Stable identities

All public protocol IDs are opaque strings.

- `hostId`: stable UUID generated on bridge installation.
- `installationId`: random UUID generated by each mobile installation.
- `connectionId`: unique per WebSocket handshake.
- `workspaceId`: bridge UUID mapped to a canonical host path.
- `sessionId`: bridge UUID mapped to one durable Pi session.
- `piSessionRef`: host-only path/identity; never sent to mobile.
- `turnId`: bridge UUID for one user-intent agent run.
- `commandId`: client-generated UUIDv7 when available, UUIDv4 otherwise.
- `eventId`: bridge-generated UUID.
- `streamId`: `host:<hostId>` or `session:<sessionId>`.
- `attachmentId`, `exportId`, `dialogId`, `leaseId`: opaque UUIDs.

A bridge reinstall without its state database creates a new `hostId`. The phone treats it as a different host even if the hostname is unchanged.

## 6. Event streams

Protocol v1 has replayable streams, not a single global event counter.

### Host stream

Always subscribed after handshake.

Carries:

- host readiness/degradation,
- session summary changes,
- workspace/trust summary changes,
- active-process capacity,
- notification capability changes,
- draining and compatibility state.

### Session stream

Subscribed when the user opens a session. The client may keep a bounded number of background session subscriptions for active work.

Carries:

- full turn lifecycle,
- assistant/reasoning deltas,
- tool lifecycle,
- queue changes,
- model/context/retry/compaction state,
- extension dialogs,
- command state affecting that session.

Each stream has its own monotonic decimal-string cursor. JSON numbers are not used for cursors because TypeScript cannot safely represent arbitrary unsigned 64-bit integers.

The client maintains a cursor map:

```json
{
  "host:<host-id>": "184",
  "session:<session-id>": "9921"
}
```

## 7. Subscription model

After handshake the client sends `subscription.set`.

Rules:

- The host stream is mandatory.
- One session is the foreground full-detail subscription.
- Up to five additional active sessions may be subscribed for lifecycle/tool-summary events.
- The bridge may reduce background detail under backpressure but must retain replayable canonical events.
- Opening another session changes foreground subscription; it does not create another socket.
- On reconnect, subscription and cursor maps are restored together.

## 8. Controller lease

One installation controls mutations for a session at a time.

Purpose: prevent a phone, tablet, stale socket, or duplicate app instance from issuing conflicting actions.

Rules:

- Viewing does not require a lease.
- Session-mutating commands require a valid `leaseId`.
- The first foreground installation opening an uncontrolled session may acquire automatically.
- Lease duration is 45 seconds and renews through application traffic or heartbeat.
- A reconnect from the same installation can reclaim the lease during a 60-second grace window.
- Another installation may request takeover; takeover is explicit and immediately invalidates the old lease.
- A stale connection cannot regain control merely by delivering delayed traffic.
- Host-scoped commands use a host controller lease with the same mechanics when necessary.

This is concurrency control, not an authentication boundary.

## 9. Command serialization

- Host commands serialize through a host command lane.
- Session commands serialize per session.
- Independent sessions may execute concurrently.
- Duplicate `commandId` handling happens before lane admission.
- Destructive session operations require the session to enter a compatible state first.
- Commands that cannot run immediately either enter a defined durable queue or fail with `invalid_state`; they never wait invisibly in memory.

## 10. Prompt and queue architecture

### Immediate prompt

When idle, `prompt.submit` is accepted, persisted, and dispatched to Pi.

### Steering

When running, `deliveryMode: steer` maps directly to Pi steering semantics after acceptance.

### Follow-up

When running, `deliveryMode: follow_up` enters a bridge-owned durable queue.

The bridge dispatches queued follow-ups only after the session is settled and eligible. This permits mobile queue removal and ordering before Pi receives the prompt.

Rules:

- Maximum ten queued follow-ups.
- Queue items are ordered by bridge sequence, not client time.
- Attachments remain retained while referenced by a queued item.
- Removing an undispatched item is safe and duplicate-resistant.
- Once dispatched to Pi, an item leaves the editable queue and follows normal turn state.
- Extension commands are not placed in the follow-up queue unless the bridge has an explicit compatible mapping.

## 11. Process/session relationship

A durable mobile session can exist without a running process.

```text
mobile session
  -> workspace
  -> durable Pi session reference
  -> zero or one current Pi process
  -> zero or one current turn
  -> zero or more queued follow-ups
```

Starting a stopped session:

1. Validate workspace exists and remains allowed.
2. Recalculate trust fingerprint.
3. Require approval if needed.
4. Verify pinned Pi compatibility.
5. Acquire active-process capacity.
6. Spawn Pi with explicit cwd/environment.
7. Load the durable session.
8. Query state and entries.
9. Publish idle or incompatibility state.

## 12. Host environment policy

Do not run Pi through an interactive/login shell. Shell startup output could corrupt RPC stdout and shell startup can hang.

The bridge launches Pi directly with:

- absolute `pi_executable`,
- explicit `PATH`,
- locale and terminal-neutral defaults,
- an allowlist of pass-through environment variable names,
- optional owner-only environment file for additional tool variables,
- Pi/provider credential stores already supported by Pi.

`pi-mob env capture` may inspect an interactive terminal and propose values, but it must show the captured variable names and never silently copy the whole environment.

The Pi stdout pipe is reserved exclusively for RPC JSONL. Diagnostics use stderr.

## 13. Main flows

### 13.1 Pair and connect

```text
Host installer -> create hostId/config/db
Host CLI/extension -> QR(hostId, displayName, endpoint, protocol major)
Mobile -> scan and save pairing candidate
Mobile -> wss connection through Tailscale Serve
Mobile -> hello
Bridge -> hello.accepted + capabilities
Mobile -> subscription.set(host stream + cursors)
Bridge -> replay/snapshot
Mobile -> host dashboard ready
```

The QR is not a secret and does not authorize access outside Tailscale.

### 13.2 Submit prompt

```text
Mobile -> prompt.submit(commandId, leaseId, payload)
Bridge -> validate
Bridge -> transaction(command accepted + payload hash)
Bridge -> command.accepted
Bridge -> dispatch to Pi once
Pi -> response success
Bridge -> command running + turn events
Pi -> agent_settled
Bridge -> turn.settled + command completed
```

### 13.3 Lost acknowledgement

```text
Bridge commits acceptance
Socket drops before phone receives acknowledgement
Phone reconnects and replays stream
Phone may resend same commandId
Bridge returns existing state, never dispatches twice
```

### 13.4 Bridge crash during running command

```text
Bridge restarts
SQLite shows command running
Bridge cannot prove external side effects
Command/turn -> indeterminate
Pi process is not assumed to continue as the same turn
User inspects durable session and chooses next action
```

### 13.5 Extension dialog across disconnect

```text
Pi extension -> extension_ui_request
Bridge persists dialog + expiry
Bridge -> extension.dialog
Phone disconnects
Pi remains waiting
Phone reconnects and replays dialog if unexpired
Phone -> extension.respond(commandId, dialogId)
Bridge dispatches once
```

### 13.6 Session switch

Switching the visible mobile session changes subscription and controller lease. It does not force the old Pi process to stop. Normal active-process and idle rules decide process lifetime.

## 14. State machines

### Connection

```text
unpaired
  -> disconnected
  -> connecting
  -> handshaking
  -> synchronizing
  -> ready
  -> degraded
  -> disconnected

handshaking -> incompatible
```

### Session runtime

```text
stopped -> starting -> idle -> running -> idle
running -> waiting_for_input -> running
running -> retry_wait -> running
running -> compacting -> running/idle
starting/running/idle -> crashed -> starting/idle
crashed -> crash_loop
any live state -> stopping -> stopped
any state -> incompatible
any state -> deleted
```

### Command

```text
received -> accepted -> dispatched -> running -> completed
received -> rejected
accepted -> cancelled
accepted -> failed
running -> failed
running -> indeterminate
```

### Turn

```text
accepted -> queued -> dispatching -> running
running -> waiting_for_input -> running
running -> retry_wait -> running
running -> compacting -> running
running -> settled
running -> aborted
running -> failed
running -> indeterminate
```

## 15. Failure containment

- A malformed mobile message closes or rejects only that request/connection.
- A Pi crash affects only its session.
- A slow mobile client is disconnected without stopping Pi.
- Notification provider failure degrades notifications only.
- Attachment storage failure rejects attachment/prompt acceptance only.
- Database write failure rejects all new state-changing commands until healthy.
- One corrupted durable Pi session is marked incompatible/repair-required without blocking other sessions.

## 16. Dependency direction

```text
mobile UI -> mobile domain -> protocol models
bridge HTTP -> bridge domain -> persistence/process/policy ports
Pi adapter -> upstream Pi RPC
notification adapters -> APNs/FCM
```

The bridge domain must be testable without Flutter, Tailscale, APNs, FCM, or a real Pi process.

## 17. Upstream compatibility

Current upstream source of truth:

- Repository: `earendil-works/pi`
- Package: `@earendil-works/pi-coding-agent`
- Initial pin: `0.80.6`

The bridge uses the subprocess RPC contract even though Pi documents a direct `AgentSession` API for TypeScript. Subprocess isolation is retained because it provides per-session crash containment, cwd isolation, process cleanup, and a language-neutral boundary.

Any upstream package rename, RPC type change, session-format change, or extension-hook change triggers the compatibility checkpoint in `BACKLOG.md` before dependency updates.

## 18. Source review anchors

Architecture assumptions were checked against:

- Pi RPC and extension documentation in `earendil-works/pi`.
- Tailscale Serve documentation.
- Flutter SDK archive and Impeller documentation.
- Android foreground-service and FCM priority documentation.
- Apple ActivityKit and notification-provider documentation.
- Bun single-file executable and installation documentation.
