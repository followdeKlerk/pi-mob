# pi-mob Backend Simplification and Canonical Event Rewrite Plan

## Purpose

This plan defines a production-oriented rewrite of the pi-mob transcript and message-delivery pipeline.

The objective is to remove the current over-engineered architecture, eliminate competing sources of truth, and move pi-mob toward the simpler delivery model used by Agent of Empires:

```text
Pi process
    -> canonical event adapter
    -> one append-only session event store
    -> replay + live WebSocket delivery
    -> one mobile reducer
    -> UI
```

This is a **subtractive rewrite**. The project is not complete when the new path exists. It is complete only when the old competing transcript paths have been removed.

**Current status (2026-08):** the canonical session-event path is production-wired and used by the released mobile chat, but the rewrite remains in migration. Legacy mobile caches/history compatibility and the bridge recipe projection are still retained. Do not treat this plan as complete until the Phase 7 deletion criteria and parity tests are closed.

---

# 1. Primary architectural outcome

For all user-visible chat state, the single source of truth must be the backend session event log.

The complete chat screen must be reproducible from:

```text
session_events ordered by (session_id, sequence)
```

The event log must be sufficient to reconstruct:

- user messages
- assistant messages
- streamed assistant content
- tool calls
- tool progress
- tool results
- tool failures
- turn completion
- turn failure
- turn cancellation
- waiting-for-input state

No other persisted or in-memory representation may independently determine transcript state.

## Required invariant

> Given the same ordered canonical session event log, live rendering, reconnect replay, cold-start recovery, and test replay must produce the same transcript state.

---

# 2. Scope

## In scope

- Pi RPC notification ingestion
- Pi event compatibility handling
- canonical event definitions
- durable per-session event storage
- event sequencing
- WebSocket replay and live delivery
- reconnect and lag recovery
- mobile event persistence
- transcript reduction
- transcript UI data flow
- removal of duplicate transcript authorities
- migration of existing sessions where practical
- production observability and failure handling

## Out of scope unless required for the rewrite

- replacing Tailscale networking
- replacing enrollment or installation credentials
- redesigning attachments
- replacing push notifications
- replacing process supervision
- changing workspace discovery
- redesigning the full Flutter UI
- replacing the entire command system
- replacing the backend language or framework

Existing subsystems should remain in place unless they directly interfere with the canonical event architecture.

---

# 3. Non-negotiable design rules

The implementation must obey all of the following rules.

## 3.1 One user-visible event path

Every user-visible Pi occurrence must follow exactly this path:

```text
native Pi event
    -> compatibility adapter
    -> canonical event
    -> durable append
    -> live notification
    -> mobile reducer
```

No user-visible event may bypass durable storage.

## 3.2 Persist before publish

The bridge must commit canonical events before notifying WebSocket clients.

Forbidden:

```text
receive Pi event
    -> send WebSocket frame
    -> persist later
```

Required:

```text
receive Pi event
    -> persist transactionally
    -> publish committed sequence
```

## 3.3 Raw Pi events are diagnostics only

Raw Pi events may be logged or stored in a dedicated diagnostics channel, but they must never mutate production transcript state.

The current `pi.rpc.event` concept must not remain part of the user-visible session stream.

## 3.4 Replay and live events have the same shape

A replayed event and a live event must be indistinguishable to the client.

There must not be separate historical and live transcript formats.

## 3.5 One reducer

The Flutter app must use one deterministic reducer for:

- cold-start rebuilding
- initial replay
- reconnect replay
- live delivery
- tests

## 3.6 Stable identity

Every transcript mutation must carry stable identifiers.

Required fields depend on event type:

- `sessionId`
- `sequence`
- `eventId`
- `turnId`
- `messageId` for message events
- `toolCallId` for tool events

The client must never infer identity from list position, timing, or the “currently active” item.

## 3.7 Terminal states are monotonic

After a tool call or turn becomes terminal, older or duplicate progress events must not reopen or regress it.

Examples:

```text
completed + later progress -> ignore progress
failed + duplicate started -> ignore started
turn completed + delayed token event -> ignore token event
```

## 3.8 The event log is authoritative

Pi-owned JSONL history is an import and recovery source only.

Once data has been converted into canonical session events, the canonical event log is authoritative for mobile rendering.

## 3.9 Temporary compatibility code must have deletion criteria

Any dual-write, adapter, legacy protocol, or feature flag introduced during migration must include:

- owner
- purpose
- deletion condition
- expected removal phase

No indefinite compatibility layer is acceptable.

---

# 4. Target architecture

```text
+---------------------------+
| Pi RPC subprocess         |
+-------------+-------------+
              |
              | native Pi notifications
              v
+---------------------------+
| Pi Event Compatibility    |
| Adapter                    |
|                           |
| native shape -> canonical |
+-------------+-------------+
              |
              | CanonicalSessionEvent[]
              v
+---------------------------+
| Session Event Store       |
|                           |
| SQLite                    |
| append-only               |
| per-session sequence      |
| transactional append      |
+-------------+-------------+
              |
        committed event
              |
      +-------+-------+
      |               |
      v               v
+-----------+   +-------------+
| Replay    |   | Live notifier|
| reader    |   | wake-up only |
+-----+-----+   +------+------+
      |                |
      +--------+-------+
               v
+---------------------------+
| Session WebSocket         |
|                           |
| auth                      |
| subscribe-before-replay   |
| replay after sequence     |
| live forwarding           |
| heartbeat                 |
| lag recovery              |
+-------------+-------------+
              |
              v
+---------------------------+
| Flutter Event Sync        |
|                           |
| order                     |
| deduplicate               |
| persist cursor            |
| persist event cache       |
+-------------+-------------+
              |
              v
+---------------------------+
| Transcript Reducer        |
|                           |
| canonical event -> state  |
+-------------+-------------+
              |
              v
+---------------------------+
| Chat View Model / UI      |
+---------------------------+
```

---

# 5. Canonical event model

Begin with a deliberately small closed event set.

Do not create a generic “everything event” that requires Flutter to understand native Pi shapes.

Suggested first version:

```typescript
export type CanonicalSessionEvent =
  | UserMessageCreated
  | AssistantMessageStarted
  | AssistantContentReplaced
  | AssistantMessageCompleted
  | ToolCallStarted
  | ToolProgressReplaced
  | ToolCallCompleted
  | ToolCallFailed
  | TurnWaitingForInput
  | TurnCompleted
  | TurnFailed
  | TurnCancelled;
```

## 5.1 Base envelope

```typescript
export interface CanonicalEventEnvelope<TType extends string, TPayload> {
  eventId: string;
  sessionId: string;
  sequence: number;
  type: TType;
  occurredAt: string;
  payload: TPayload;
}
```

## 5.2 Message events

```typescript
interface UserMessageCreatedPayload {
  turnId: string;
  messageId: string;
  text: string;
  attachments?: CanonicalAttachmentRef[];
}

interface AssistantMessageStartedPayload {
  turnId: string;
  messageId: string;
}

interface AssistantContentReplacedPayload {
  turnId: string;
  messageId: string;
  content: CanonicalContentBlock[];
}

interface AssistantMessageCompletedPayload {
  turnId: string;
  messageId: string;
}
```

## 5.3 Tool events

```typescript
interface ToolCallStartedPayload {
  turnId: string;
  toolCallId: string;
  toolName: string;
  arguments: unknown;
}

interface ToolProgressReplacedPayload {
  turnId: string;
  toolCallId: string;
  progress: unknown;
}

interface ToolCallCompletedPayload {
  turnId: string;
  toolCallId: string;
  result: unknown;
}

interface ToolCallFailedPayload {
  turnId: string;
  toolCallId: string;
  error: CanonicalError;
}
```

## 5.4 Turn events

```typescript
interface TurnTerminalPayload {
  turnId: string;
  reason?: string;
}
```

## 5.5 Replacement versus append semantics

Default to replacement semantics for evolving content.

Examples:

- assistant streaming content: replace the current canonical content snapshot
- cumulative tool progress: replace the current tool progress snapshot
- final tool result: terminal replacement of progress

Only use append semantics where the native Pi event is explicitly a delta and the canonicalizer can prove that it is a delta.

The Flutter reducer must not guess whether content is cumulative or incremental.

---

# 6. Storage design

## 6.1 Required tables

A minimal schema is preferred.

```sql
CREATE TABLE session_event_sequences (
  session_id TEXT PRIMARY KEY,
  last_sequence INTEGER NOT NULL
);

CREATE TABLE session_events (
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source_event_id TEXT,
  PRIMARY KEY (session_id, sequence),
  UNIQUE (event_id),
  UNIQUE (session_id, source_event_id)
);

CREATE INDEX session_events_event_id_idx
  ON session_events(event_id);
```

A separate optional table may be used for raw diagnostics:

```sql
CREATE TABLE pi_event_diagnostics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  received_at TEXT NOT NULL,
  event_type TEXT,
  payload_json TEXT NOT NULL
);
```

The diagnostics table must not participate in rendering.

## 6.2 Atomic append

Appending one or more canonical events for a Pi notification must happen in one transaction.

Pseudo-code:

```typescript
append(sessionId, sourceEventId, events) {
  begin transaction;

  if sourceEventId already exists:
    return existing events;

  lastSequence = read current sequence for session;

  for event in events:
    lastSequence += 1;
    insert event with lastSequence;

  update session sequence;
  commit;

  notify live subscribers of committed sequence range;
}
```

## 6.3 Idempotency

The event store must reject or safely ignore duplicates.

Preferred deduplication order:

1. stable upstream source event ID when Pi provides one
2. bridge-generated deterministic source identity
3. event ID uniqueness

Do not deduplicate using payload text alone.

## 6.4 Event store API

Keep the API small:

```typescript
interface SessionEventStore {
  append(
    sessionId: string,
    sourceEventId: string | undefined,
    events: readonly UnsequencedCanonicalEvent[],
  ): Promise<readonly StoredCanonicalEvent[]>;

  readAfter(
    sessionId: string,
    sequence: number,
    limit?: number,
  ): Promise<readonly StoredCanonicalEvent[]>;

  latestSequence(sessionId: string): Promise<number>;

  readRange(
    sessionId: string,
    fromInclusive: number,
    toInclusive: number,
  ): Promise<readonly StoredCanonicalEvent[]>;
}
```

Do not expose transcript-specific query APIs from the store.

---

# 7. Pi compatibility adapter

## 7.1 Responsibility

The compatibility adapter is the only layer allowed to understand native Pi RPC event shapes.

It must:

- validate input shape
- resolve session identity
- resolve turn identity
- resolve message and tool-call identity
- normalize content
- normalize tool output
- classify progress versus terminal output
- emit zero or more canonical events
- produce deterministic output

It must not:

- persist events
- send WebSocket frames
- mutate Flutter state
- update widgets
- own reconnect logic
- inspect mobile cache state

## 7.2 Suggested API

```typescript
interface PiCompatibilityAdapter {
  normalize(
    raw: unknown,
    context: PiNormalizationContext,
  ): readonly UnsequencedCanonicalEvent[];
}
```

## 7.3 Native-shape fixtures

Create fixture files for every Pi event shape observed in production.

Suggested location:

```text
packages/bridge/test/fixtures/pi-events/
```

Include at least:

- user prompt
- assistant start
- assistant cumulative text
- assistant text delta if supported
- tool start
- tool cumulative progress
- tool final result
- tool error
- turn completed
- turn failed
- turn cancelled
- read result
- bash result
- grep result
- find result
- ls result
- edit result
- content-array result
- redacted path result
- missing optional path
- extension-provided custom tool result
- malformed value
- unexpected primitive
- circular or hostile value if relevant

## 7.4 Unknown events

Unknown native events must not crash the session pipeline.

Policy:

- store them in diagnostics
- log a bounded structured warning
- emit no user-visible canonical event unless there is a safe generic representation
- do not fabricate transcript state

---

# 8. WebSocket delivery model

## 8.1 Session endpoint

Prefer a dedicated session-event endpoint or dedicated protocol capability.

Example:

```text
GET /v2/sessions/{sessionId}/events?afterSequence=123
```

or:

```text
capability: session_events.v2
```

The final design may remain on the existing authenticated WebSocket if it can support the same semantics without preserving old transcript complexity.

## 8.2 Subscribe-before-replay

Connection sequence:

1. Authenticate the client.
2. Validate session access.
3. Subscribe to the session’s live commit notifier.
4. Read all persisted events after `afterSequence`.
5. Send replay events in strict sequence order.
6. Buffer any live commit notifications received during replay.
7. Read and send newly committed ranges.
8. Continue live delivery.

This ordering is mandatory.

## 8.3 Live notifier is not authoritative

The live notifier should carry a wake-up signal or committed sequence range.

It must not be the sole holder of event payloads.

When lag or uncertainty occurs, the server should reread from SQLite.

## 8.4 Wire event

```json
{
  "type": "session.event",
  "payload": {
    "eventId": "...",
    "sessionId": "...",
    "sequence": 124,
    "eventType": "tool.completed",
    "occurredAt": "2026-08-04T15:00:00.000Z",
    "data": {}
  }
}
```

## 8.5 Heartbeat

Implement both:

- protocol-level WebSocket Ping/Pong where available
- application-visible heartbeat frames

Example:

```json
{ "type": "heartbeat" }
```

The client should reconnect when heartbeats stop within the agreed timeout.

## 8.6 Recovery

On reconnect, the client sends its last durably applied sequence.

The server sends all events after that sequence.

If the client sequence is invalid or ahead of the server:

- report a specific protocol error
- reset the local event cache for that session
- rebuild from sequence zero or a server snapshot

Avoid complex multi-part snapshots for the first implementation unless event volume makes them necessary.

---

# 9. Flutter architecture

The existing connection coordinator must no longer own transcript projection.

Create focused components.

## 9.1 `SessionEventTransport`

Responsibilities:

- connect authenticated WebSocket
- send session subscription and last sequence
- decode event envelopes
- surface heartbeats and connection failures

No transcript logic.

## 9.2 `SessionEventSynchronizer`

Responsibilities:

- enforce strict sequence order
- detect gaps
- deduplicate replay/live overlap
- request reconnect or rebuild on gaps
- persist events before marking them applied
- maintain the last durable sequence

Suggested behavior:

```dart
if (event.sequence <= lastAppliedSequence) {
  return; // duplicate
}

if (event.sequence != lastAppliedSequence + 1) {
  triggerRecovery();
  return;
}

await repository.persist(event);
state = reducer.apply(state, event);
await repository.saveAppliedSequence(event.sequence);
```

The exact transaction order may be optimized, but recovery after process death must be deterministic.

## 9.3 `SessionEventRepository`

Responsibilities:

- local cache of canonical backend events
- last applied sequence per session
- reading ordered events for cold-start rebuild
- clearing one session’s cache when recovery requires it

The local database is a cache, not an independent transcript authority.

It should mirror canonical events without translating them into a second domain model before reduction.

## 9.4 `TranscriptReducer`

Responsibilities:

- pure deterministic transformation
- no I/O
- no socket access
- no database access
- no clock reads
- no generated IDs

API:

```dart
TranscriptState reduce(
  TranscriptState current,
  CanonicalSessionEvent event,
)
```

## 9.5 `ChatViewModel`

Responsibilities:

- selected session presentation
- draft text
- attachment selection
- send action
- transient optimistic sending indicator
- mapping reducer state to widgets

It must not reconstruct transcript state from command records, raw Pi events, or session summaries.

---

# 10. Transcript reducer rules

## 10.1 User messages

`user_message.created` inserts a message by stable `messageId`.

Duplicate creation is a no-op.

## 10.2 Assistant messages

`assistant_message.started` creates an empty assistant message if absent.

`assistant_content.replaced` replaces the message content snapshot.

It must not append cumulative snapshots.

`assistant_message.completed` marks the message terminal.

## 10.3 Tool calls

`tool.started` creates the tool card by `toolCallId`.

`tool.progress.replaced` replaces current progress only when the tool is non-terminal.

`tool.completed` replaces progress with final result and marks terminal.

`tool.failed` stores canonical error and marks terminal.

## 10.4 Turn lifecycle

Turn states must progress monotonically.

Suggested order:

```text
pending
running
waiting_for_input
completed | failed | cancelled
```

Terminal states cannot transition back to active states.

## 10.5 Out-of-order domain events

Transport ordering should prevent out-of-order events. The reducer must still fail safely.

Examples:

- content before assistant start: create the message implicitly and record a diagnostic
- tool completion before tool start: create a completed tool card from final data
- progress after completion: ignore
- duplicate terminal event: ignore if equivalent, log if conflicting

The reducer must never crash the chat screen because one event was unexpected.

---

# 11. Optimistic UI policy

Optimistic state must remain visibly and structurally separate from authoritative transcript state.

Allowed:

```text
pending prompt row with commandId
```

Required transition:

```text
pending prompt
    -> canonical user_message.created arrives
    -> pending row removed
    -> canonical message displayed
```

The optimistic row must not be persisted as a canonical transcript event by the client.

The backend remains responsible for creating the canonical user message event.

---

# 12. Existing sources of truth and required disposition

| Existing representation | Final disposition |
|---|---|
| Bridge canonical session event log | Sole transcript authority |
| Pi RPC native events | Adapter input only |
| `pi.rpc.event` session-stream events | Remove from production transcript path |
| Pi JSONL session history | Import/recovery input only |
| Command journal | Command delivery and idempotency only |
| Session state table | Small derived operational summary only |
| Host stream | Session list and host metadata only |
| Flutter Drift transcript rows | Cache of canonical events only |
| Flutter live transcript list | Remove |
| Flutter history transcript list | Remove |
| Flutter merged transcript cache | Remove |
| Optimistic prompt state | Temporary UI only |
| Tool output projections outside canonical events | Remove or make derived cache only |
| Raw RPC response store | Diagnostics or command-response use only |

---

# 13. Migration phases

## Phase 0 — Baseline and freeze

### Goals

- prevent further architecture expansion
- capture current behavior
- establish rewrite invariants

### Tasks

1. Stop adding new transcript event types to the current path unless required for critical fixes.
2. Document all current transcript inputs.
3. Create an architecture inventory of:
   - bridge event writers
   - session-state writers
   - raw Pi event writers
   - JSONL importers
   - Flutter transcript readers
   - Flutter transcript writers
4. Capture representative production Pi traces.
5. Add current-behavior golden screenshots or transcript snapshots.
6. Define a temporary feature flag for the new path.
7. Record every legacy component that must be deleted.

### Deliverables

- `docs/rewrite/current-transcript-dataflow.md`
- `docs/rewrite/source-of-truth-inventory.md`
- trace fixture set
- baseline test report

### Exit criteria

- every current transcript source is identified
- representative traces can be replayed in tests
- no unknown production transcript writer remains

---

## Phase 1 — Canonical event contract

### Goals

- define the only renderer-safe event schema
- establish compatibility fixtures

### Tasks

1. Add canonical event TypeScript definitions.
2. Add JSON schema or equivalent runtime validation.
3. Add stable identity requirements.
4. Define replacement versus append semantics.
5. Define terminal-state rules.
6. Define maximum payload sizes.
7. Define safe path redaction behavior.
8. Define error normalization.
9. Add versioning for canonical event schema.
10. Add fixture-driven contract tests.

### Deliverables

- `packages/protocol-schema/src/session-events-v2.ts`
- generated Dart models or hand-maintained equivalent
- schema validation tests
- event contract documentation

### Exit criteria

- every supported Pi event fixture maps to deterministic canonical events
- unsupported input fails safely
- TypeScript and Dart agree on the wire schema

---

## Phase 2 — Durable session event store

### Goals

- make SQLite the single backend transcript authority

### Tasks

1. Add schema migrations.
2. Implement per-session sequence allocation.
3. Implement atomic multi-event append.
4. Implement idempotency by source event identity.
5. Implement `readAfter`.
6. Implement `latestSequence`.
7. Implement event retention policy if required.
8. Implement diagnostics storage separately.
9. Add transaction and concurrency tests.
10. Add crash-recovery tests.

### Deliverables

- `SessionEventStore`
- database migration
- concurrency tests
- recovery tests

### Exit criteria

- concurrent appends cannot duplicate a sequence
- failed transactions publish nothing
- replay returns exact strict ordering
- duplicate source events create no duplicate canonical events

---

## Phase 3 — Pi compatibility adapter

### Goals

- normalize Pi exactly once
- stop downstream code from understanding native Pi shapes

### Tasks

1. Extract native Pi handling from the current adapter.
2. Implement `PiCompatibilityAdapter`.
3. Map all built-in Pi tool shapes.
4. Map content-array results.
5. Implement path redaction centrally.
6. Implement output bounds centrally.
7. Implement cumulative-progress replacement semantics.
8. Implement stable message and tool-call IDs.
9. Send unknown shapes to diagnostics.
10. Remove canonical rendering decisions from unrelated runtime code.

### Deliverables

- compatibility adapter
- fixture suite
- adapter contract tests

### Exit criteria

- each fixture maps to the expected canonical sequence
- replaying the same native trace produces byte-identical canonical events
- no Flutter code depends on native Pi fields

---

## Phase 4 — Commit notification and WebSocket replay

### Goals

- implement AoE-style persisted replay plus live delivery

### Tasks

1. Add per-session commit notification mechanism.
2. Ensure notification occurs only after successful commit.
3. Add subscribe-before-replay connection flow.
4. Add `afterSequence` support.
5. Add event replay.
6. Add deduplication-safe overlap behavior.
7. Add application heartbeat.
8. Add stale-socket timeout.
9. Add lag detection and SQLite recovery.
10. Add reconnect integration tests.

### Deliverables

- v2 session event endpoint or capability
- WebSocket integration tests
- reconnect and lag tests

### Exit criteria

- events created during connection setup are not lost
- replay/live overlap creates no duplicate applied state
- server restart followed by reconnect restores all events
- dropped notifications recover from SQLite

---

## Phase 5 — Flutter event repository and reducer

### Goals

- create the single mobile transcript path

### Tasks

1. Add Dart canonical event models.
2. Add local canonical event table.
3. Add last-sequence table.
4. Implement `SessionEventRepository`.
5. Implement pure `TranscriptReducer`.
6. Add reducer tests for every canonical event.
7. Add duplicate and terminal-state tests.
8. Add cold-start rebuild tests.
9. Add reconnect replay tests.
10. Add large-transcript performance tests.

### Deliverables

- repository
- reducer
- local schema migration
- reducer golden tests

### Exit criteria

- transcript can be rebuilt from local canonical events alone
- live and replay events use the same reducer
- no raw Pi shape is imported by transcript UI code

---

## Phase 6 — UI cutover

### Goals

- make the app render only the canonical reducer state

### Tasks

1. Add feature-flagged canonical transcript provider.
2. Connect selected session to the v2 event synchronizer.
3. Render user messages.
4. Render assistant streaming and completion.
5. Render built-in tool cards.
6. Render tool errors.
7. Render turn failures and cancellation.
8. Reconcile optimistic prompts with canonical user messages.
9. Validate session switching.
10. Validate Android background/foreground behavior.

### Deliverables

- feature-flagged canonical chat screen path
- UI integration tests
- Android lifecycle tests

### Exit criteria

- all core chat behavior works with legacy transcript reads disabled
- reconnect during tool execution produces the same final transcript as uninterrupted execution
- cold start produces the same final transcript as live mode

---

## Phase 7 — Legacy deletion

### Goals

- remove competing sources of truth
- reduce system complexity permanently

### Required deletions

1. Remove raw Pi events from production session rendering streams.
2. Remove separate Flutter history and live transcript collections.
3. Remove merged transcript caches derived from both.
4. Remove direct JSONL-to-UI reconstruction.
5. Remove transcript-like fields from broad session state where redundant.
6. Remove old tool-output projection code made obsolete by canonical events.
7. Remove old snapshot formats used only by transcript rendering.
8. Remove old reducer paths.
9. Remove temporary dual-write.
10. Remove feature flags after one stable release window.

### Deliverables

- deletion PRs
- updated architecture diagrams
- updated protocol documentation
- reduced dependency graph

### Exit criteria

Run a repository search and confirm:

- no production UI imports native Pi event models
- no production UI reads `pi.rpc.event`
- no separate history/live transcript merge remains
- no legacy transcript snapshot API remains active
- canonical event log is the only backend transcript authority

---

## Phase 8 — Operational hardening

### Goals

- make the simplified path production-ready

### Tasks

1. Add metrics:
   - events appended per session
   - append failures
   - duplicate source events
   - replay size
   - replay duration
   - sequence-gap recoveries
   - WebSocket reconnects
   - unknown Pi event shapes
   - reducer recovery resets
2. Add structured logging with:
   - session ID
   - sequence
   - event ID
   - turn ID
   - tool-call ID where applicable
3. Add bounded payload enforcement.
4. Add database corruption handling.
5. Add event-log integrity verification.
6. Add support bundle export for diagnostics.
7. Add migration rollback documentation.
8. Add load tests for long sessions.
9. Add retention and storage growth policy.
10. Add production runbook.

### Deliverables

- dashboards or log queries
- runbook
- support diagnostics
- performance report

### Exit criteria

- operators can identify the last committed and last applied event for a session
- event loss and sequence gaps are observable
- the app can recover safely from a corrupted local cache
- event payload size is bounded

---

# 14. Testing strategy

## 14.1 Adapter fixture tests

For every native Pi fixture:

```text
native Pi event
    -> expected canonical events
```

Assert exact event type, identifiers, normalized payload, redaction, and replacement semantics.

## 14.2 Event-store tests

Test:

- first sequence is deterministic
- sequences increase without gaps after successful commits
- transaction rollback creates no events
- concurrent appends remain ordered
- duplicate source events are idempotent
- read-after behavior is correct

## 14.3 Reducer tests

Test:

- duplicate events
- progress replacement
- terminal monotonicity
- missing start event
- completion before start
- delayed progress after completion
- tool failure
- turn cancellation
- unknown event version

## 14.4 End-to-end golden tests

Use captured Pi traces.

For each trace, compare:

```text
A. uninterrupted live delivery
B. disconnect and reconnect midway
C. backend restart midway
D. app cold start after completion
E. local cache cleared, full replay
```

All must produce equivalent transcript state.

## 14.5 Required scenarios

- plain assistant response
- multi-chunk assistant streaming
- read
- bash
- grep
- find
- ls
- edit
- cumulative tool progress
- large tool result
- truncated tool result
- redacted path
- intentionally missing path
- malformed tool output
- extension tool
- user cancellation
- Pi process crash
- waiting for user input
- duplicate Pi notification
- delayed terminal notification
- session switch during active output
- Android background and resume
- server restart

## 14.6 Property tests

Where practical, add properties:

- reducer is idempotent for duplicate event application
- reducing events in strict sequence is deterministic
- terminal entities never return to active state
- replaying persisted events reproduces saved projection

---

# 15. Production acceptance criteria

The rewrite is complete only when all criteria below are met.

## Architecture

- one canonical backend session event log exists
- all user-visible Pi events are persisted before publication
- no raw Pi event mutates transcript state
- replay and live delivery use the same event schema
- Flutter uses one transcript reducer

## Correctness

- no message or tool card duplicates after reconnect
- no tool progress appears after terminal completion
- cold-start transcript equals uninterrupted live transcript
- backend restart does not lose committed events
- duplicate native Pi notifications do not duplicate UI state

## Simplicity

- separate history/live transcript lists are removed
- direct JSONL rendering is removed
- old transcript snapshot path is removed
- connection coordinator no longer owns transcript projection
- temporary dual-write code is removed

## Operations

- sequence gaps are observable
- unknown Pi event shapes are observable
- last committed and last applied sequence can be diagnosed
- local cache corruption has a documented recovery path

---

# 16. Agent execution instructions

The implementing agent should follow these rules.

## 16.1 Work in small vertical slices

Each PR should establish one testable invariant.

Recommended PR order:

1. architecture inventory and fixtures
2. canonical event schema
3. session event store
4. Pi compatibility adapter
5. persisted-before-publish commit notifier
6. replay/live WebSocket
7. Dart event models
8. Flutter repository and reducer
9. feature-flagged UI cutover
10. legacy deletion
11. operational hardening

## 16.2 Do not preserve complexity without evidence

When encountering existing abstractions, ask:

> Does this remain necessary when the canonical event log is the sole transcript authority?

If not, remove it rather than adapting it.

## 16.3 Avoid generic frameworks

Do not introduce:

- a plugin framework for canonical events
- a generic event-sourcing library
- a general CQRS layer
- a multi-backend persistence abstraction
- a generic message bus
- multiple projection stores

Implement the smallest production-safe components required by pi-mob.

## 16.4 Keep compatibility isolated

Native Pi version compatibility belongs only in the Pi compatibility adapter.

Legacy pi-mob protocol compatibility belongs only at the protocol boundary.

Neither may leak into the reducer or UI.

## 16.5 Every PR must state deletion impact

PR descriptions must include:

```text
New code added:
Legacy code deleted:
Temporary code introduced:
Deletion condition for temporary code:
Source-of-truth impact:
```

## 16.6 Stop conditions

The agent must stop and report before proceeding if:

- stable turn or tool-call identity cannot be obtained from Pi
- a native Pi event cannot be classified as snapshot or delta
- existing persisted sessions cannot be migrated without ambiguity
- a proposed feature requires a second transcript authority
- compatibility code would need to remain indefinitely

The report should include the exact observed native event examples and a recommended minimal resolution.

---

# 17. Recommended repository structure

Backend:

```text
packages/bridge/src/session-events/
  canonical-event.ts
  canonical-event-schema.ts
  pi-compatibility-adapter.ts
  event-store.ts
  commit-notifier.ts
  session-event-service.ts
  session-event-websocket.ts
  diagnostics.ts
```

Tests:

```text
packages/bridge/test/session-events/
  fixtures/
  canonicalizer.test.ts
  event-store.test.ts
  websocket-replay.test.ts
  reconnect.test.ts
  crash-recovery.test.ts
```

Flutter:

```text
apps/mobile/lib/src/session_events/
  canonical_event.dart
  session_event_transport.dart
  session_event_repository.dart
  session_event_synchronizer.dart
  transcript_reducer.dart
  transcript_state.dart
  chat_view_model.dart
```

Flutter tests:

```text
apps/mobile/test/session_events/
  transcript_reducer_test.dart
  synchronizer_test.dart
  cold_start_rebuild_test.dart
  reconnect_replay_test.dart
  golden_transcript_test.dart
```

Names may be adjusted to repository conventions, but responsibilities must remain separated.

---

# 18. Key risks and mitigations

## Risk: dual-write becomes permanent

Mitigation:

- create deletion issue at the same time dual-write is introduced
- block unrelated feature work until cutover and deletion are complete

## Risk: stable IDs are unavailable

Mitigation:

- generate deterministic bridge identities from stable Pi fields
- persist identity mappings per turn
- never generate new identities during replay

## Risk: JSONL import duplicates live events

Mitigation:

- assign source identities
- maintain import watermark
- import only absent source records
- never overwrite canonical events

## Risk: event log grows indefinitely

Mitigation:

- measure before optimizing
- add retention only when necessary
- prefer compact snapshots derived from the log only if proven necessary
- never make snapshots a competing authority

## Risk: Flutter local database becomes another truth

Mitigation:

- store canonical events unchanged
- persist last sequence
- allow complete cache deletion and server replay
- never create local-only canonical events

## Risk: tool outputs vary across Pi versions

Mitigation:

- fixture native shapes by Pi version
- keep compatibility in one adapter
- add unknown-shape diagnostics

## Risk: migration attempts to preserve every old feature

Mitigation:

- prioritize core chat correctness
- temporarily disable low-value features rather than recreating duplicate architecture

---

# 19. Final definition of done

The rewrite is done when this statement is true:

> A pi-mob chat session is an ordered canonical event log. The backend persists each event before publication. The mobile app applies those events through one reducer. Any local state is disposable and can be rebuilt from the backend event log. Raw Pi events, Pi JSONL, commands, snapshots, summaries, and optimistic UI are not competing transcript authorities.

The practical proof is:

```text
captured Pi trace
    -> live session
    -> reconnect replay
    -> backend restart replay
    -> mobile cold-start rebuild
```

All four paths produce the same transcript.
