# Current transcript data flow (Phase 0 inventory)

This document captures every writer and reader that contributes to the
user-visible transcript path as the codebase stands today. It is the
Phase 0 freeze required by `pi-mob-simplification-plan.md` §13 before
the canonical session-event rewrite can begin.

The aim is to identify what the rewrite must remove. A path that does
not contribute to transcript state should not be touched; a path that
contributes transcript state is a candidate for the canonical event
authority.

## Backend writer inventory

| Surface | File | Effect on transcript state |
| --- | --- | --- |
| `BridgeStore.appendEvent()` | `packages/bridge/src/core/store.ts` | Transactional append of one durable event. Used for every `command.state`, `turn.*`, `assistant.*`, `tool.*`, `session.*`, `extension.*`, and `pi.rpc.event` event. The store enforces unique `(stream_id, cursor)` ordering, unique `event_id`, and unique payload byte counts. It fires `onEvent` listeners AFTER commit, which is the natural persist-before-publish seam the rewrite must preserve. |
| `BridgeStore.appendEventTx()` | `packages/bridge/src/core/store.ts` | Same as `appendEvent` but inside an existing transaction. Used by `changeSessionSummary`, `acceptCommand`, `softDeleteSession`, `restoreSoftDeletedSession`, `purgeSessionTombstone`, `markSessionDeleteFailed`, and `addSessionSummary`. |
| `appendNormalizedEvent()` | `packages/bridge/src/pi/one-session-adapter.ts` | Writes curated notifications through `CanonicalEventStore`. The normal daemon also writes the dedicated `CanonicalSessionStore` during the migration. The recipe projection remains a derived compatibility projection. |
| `handleNotification()` diagnostics branch | `packages/bridge/src/pi/one-session-adapter.ts` | Routes unknown/raw Pi notifications to the bounded diagnostics sink. Curated extension UI events enter the canonical session-event store; no `pi.rpc.event` envelope is appended to the user-visible session stream. |
| `normalizePiEvent()` | `packages/bridge/src/pi/normalize.ts` | Returns curated events only. Raw notifications go to the bounded diagnostics sink. |
| `external-history.ts` recipe projection | `packages/bridge/src/pi/external-history.ts` | Imports Pi JSONL through canonical admission, derives `recipe.activity` snapshots, and transactionally appends the compatibility projection. The recipe projection is a derived snapshot whose deletion is deferred until mobile reducer parity is proven. |
| `recipe-activity.ts` projector | `packages/bridge/src/pi/recipe-activity.ts` | In-memory deterministic projector for tool/reasoning activity with terminal monotonicity. Drives `appendNormalizedEvent` and the durable `recipe.activity` writes. |
| `runDaemon()` reconciliation | `packages/bridge/src/daemon.ts` | Walks every persisted session at startup, reconciles Pi JSONL, marks uncertain commands indeterminate, and emits `turn.indeterminate` for sessions with non-terminal persisted state. The loopback server binds first. Readiness remains false until recovery finishes. |
| `runDaemon()` session discovery | `packages/bridge/src/daemon.ts` | Discovers existing Pi sessions under the workspace, ensures a `sessions` row, and ensures a per-session stream. The session summary is published through `addSessionSummary`, which emits `session.summary` on the host stream. |
| `daemon.ts` session-rpc `emit` | `packages/bridge/src/daemon.ts` (per-session supervised RPC) | Routes canonical transcript families through the shared canonical admission/session-event store helper. Operational session state remains on the operational journal. |
| `updateSessionState()` | `packages/bridge/src/core/store.ts` | Writes the `sessions.state_json` blob. The blob is a small derived operational summary (runtimeState, attentionState, queueCount, pendingDialog, lastActivityAt, etc.) and is updated transactionally with the journal event for turn boundaries. The plan limits this to a "small derived operational summary only"; the rewrite must not widen its scope. |
| `purgeSessionTombstone()` / `softDeleteSession()` / `restoreSoftDeletedSession()` / `markSessionDeleteFailed()` | `packages/bridge/src/core/store.ts` | Lifecycle plumbing. Emit `session.deleted`, `session.restored`, `session.delete_failed`, and `session.removed` events on the relevant streams. These are session-state events, not transcript projections, and must stay. |

## Backend reader inventory

| Surface | File | Reads from |
| --- | --- | --- |
| `StreamService.sync()` | `packages/bridge/src/core/domain.ts` | `BridgeStore.listEvents()` / `readReplay()`. Drives `runtime.subscribe()`'s replay path. The plan keeps this as the canonical replay source. |
| `runtime.subscribe()` | `packages/bridge/src/core/runtime.ts` | `StreamService.sync()` + `store.sessionState()`. Returns ordered replay + summary snapshot for the WebSocket subscriber. |
| `runtime.sessionHistoryPage()` | `packages/bridge/src/core/runtime.ts` | `store.pageSessionEvents()` (newest-first paging by `beforeCursor`). Reads `session:<id>` events for the legacy history-page control. The plan keeps this only as a paging API; transcript rendering should not depend on it. |
| `server.ts` live dispatcher | `packages/bridge/src/core/server.ts` | `runtime.onEvent()` and canonical transport commit listeners deliver ordered canonical live events. The legacy dispatcher remains only for operational compatibility; raw Pi notifications are diagnostics-only. |
| `server.ts` slow consumer | `packages/bridge/src/core/server.ts` | Drops the WebSocket on `queuedBytes > outboundBackpressureLimit`. Today the buffer includes raw events; the rewrite must still bound it. |
| `extension-dialog` sweep | `packages/bridge/src/pi/one-session-adapter.ts` | Reads `extension_dialogs` rows to publish `extension.dialog` terminal states. Not transcript-authority; keep. |
| `notification.classifyEvent()` | `packages/bridge/src/notifications` | Reads event type + payload to derive a notification kind. Uses the curated event set; raw events would have polluted this. |
| `recipe-activity.ts` projector hydrate | `packages/bridge/src/pi/recipe-activity.ts` | `store.listEvents(session:<id>)` rebuilds the in-memory projector for replay safety. The rewrite must preserve replay-safe identity. |

## Mobile reader / writer inventory

The mobile reader and writer inventory records the released canonical
cutover and the compatibility paths that remain during migration. The
subtractive rewrite is not complete until the Phase 7 deletion criteria
and parity coverage are satisfied.

| Surface | File | Effect |
| --- | --- | --- |
| `ConnectionCoordinator.transcriptEvents` | `apps/mobile/lib/src/connection/connection_coordinator.dart` | Recomputes a bounded compatibility view only for hosts without `session_events.v2`; canonical-capability clients return no legacy transcript projection. The released chat UI never calls it. |
| `TranscriptEventView` reducer | `apps/mobile/lib/src/transcript/widgets/transcript_view.dart` | Retained compatibility projection and legacy test surface; the released panel uses the canonical session-event repository. |
| `TranscriptReducer.apply` | `apps/mobile/lib/src/transcript/domain/transcript_reducer.dart` | Retained legacy normalized-event projection for migration/older-host compatibility; the released panel uses `CanonicalTranscriptReducer`. |
| Drift `CachedEvents` table | `apps/mobile/lib/src/data/app_database.dart` | Generic normalized event cache; will be migrated to canonical event cache. |
| Drift `SnapshotEntries` | `apps/mobile/lib/src/data/app_database.dart` | Competing reconstruction input; must be removed once canonical event authority proves parity. |
| `search_indexer` | `apps/mobile/lib/src/search/search_indexer.dart` | Indexes `coordinator.transcriptEvents` today; must be redirected to canonical events. |

## Captured Pi trace fixtures

The bridge suite already captures representative Pi traces through the
real RPC subprocess (`m5-real-adapter.test.ts`,
`mobile-disconnect-rpc-loss.test.ts`) and the fake-RPC harness
(`m11-multi-session-adapter.test.ts`,
`one-session-adapter.test.ts`, `m6-slow-consumer.test.ts`). These tests
are the trace fixtures referenced by the plan §13 Phase 0 exit
criteria.

## Inventory baseline test report

The following bridge test files were run before the rewrite slice to
confirm the baseline:

- `packages/bridge/test/pi-adapter.test.ts` — 4 tests pass
- `packages/bridge/test/raw-event-passthrough.test.ts` — 1 test passes
  (this is the test the rewrite must update so its "verbatim"
  expectation becomes "diagnostics-only", not "user-visible passthrough")
- `packages/bridge/test/m4-store.test.ts` — 5 tests pass

The full bridge suite (`bun run test` in `packages/bridge`) and the
integration suite (`packages/bridge/test/integration/`) are the
authoritative run for the rewrite slice. Tests that currently expect
`pi.rpc.event` to be a transcript event must be migrated; tests that
expect raw events to remain observable for diagnostics must continue to
hold once the diagnostics table exists.

## What is NOT in this slice

The following plan phases are deferred and remain on the roadmap. They
are listed here so the rewrite slice's deletion impact is honest.

- Phase 5 — durable Flutter event repository and reducer hardening.
- Phase 7 — deletion of the remaining legacy history/live/merge paths.
- Phase 8 — operational hardening, including metrics, retention, and a runbook.

These phases are documented in `docs/rewrite/source-of-truth-inventory.md`.