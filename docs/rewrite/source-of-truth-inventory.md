# Source-of-truth inventory and deletion criteria (Phase 0)

This document enumerates every representation of transcript state in
pi-mob today and assigns it a final disposition under the canonical
session-event rewrite. It is the second deliverable required by
`pi-mob-simplification-plan.md` §13 Phase 0.

The matrix mirrors the plan's §12 "Existing sources of truth and
required disposition" but adds the deletion criteria, deletion owner,
and current implementation evidence that prove the legacy path is safe
to remove at the relevant phase.

## Disposition matrix

| Existing representation | Current location | Final disposition | Deletion criteria | Owner | Deletion phase |
| --- | --- | --- | --- | --- | --- |
| Bridge canonical session event log (curated events) | `CanonicalSessionStore` → `canonical_session_events` with `session_events.v2` replay/live delivery | Production transcript authority | Production adapter and history/recovery paths write canonical rows; legacy stream is now compatibility output only | Bridge runtime | Active authority |
| Pi RPC native events persisted as `pi.rpc.event` envelopes | `OneSessionPiAdapter.handleNotification` and `normalizePiEvent` | Removed from user-visible streams; raw events go to bounded diagnostics | Focused adapter and diagnostics tests pass | Bridge adapter | Complete for live notifications |
| Pi JSONL session history | `external-history.ts` + Pi-owned `*.jsonl` | Import/recovery input only | Normal daemon import/reconciliation writes only canonical events; delete only when canonical recovery no longer needs Pi-owned JSONL | Bridge external-history | Phase 7 |
| `sessions.state_json` blob | `BridgeStore.updateSessionState()` | Small derived operational summary only | Plan keeps runtimeState, attentionState, queueCount, lastActivityAt, pendingDialog as the only fields; UI rendering MUST NOT read this blob | Bridge runtime | Phase 7 |
| `recipe.activity` events on the session stream | `DurableRecipeActivityProjection.append()` | Isolated older-host compatibility only | Normal daemon never constructs/backfills/publishes this projection; remove the implementation after the separate older-host compatibility cutoff | Bridge recipe-activity | Compatibility cutoff |
| `RawRpcEventStore` / `pi.rpc.response` events | `OneSessionPiAdapter` raw RPC handler | Diagnostics + command-response use only | Remove from transcript reads; keep for command/diagnostics use | Bridge adapter | Phase 7 |
| Flutter `CachedEvents` Drift table | `apps/mobile/lib/src/data/app_database.dart` | Migrate to canonical event cache | Once schema migrates to `CanonicalSessionEvent` rows + last-sequence table | Mobile repository | Phase 5 |
| Flutter history transcript list | `ConnectionCoordinator._history` / `transcriptEvents` history path | Remove from the canonical UI path; retain for legacy capability fallback until coordinated release | Canonical panel renders parity and old bridge fallback is retired | Mobile coordinator | Phase 7 |
| Flutter live transcript list | `ConnectionCoordinator._streams` (legacy path of `transcriptEvents`) | Remove from the canonical UI path; retain for legacy capability fallback until coordinated release | Canonical synchronizer owns all live ordering | Mobile coordinator | Phase 7 |
| Flutter merged transcript cache | Removed from `ConnectionCoordinator`; `transcriptEvents()` now recomputes only for older-host compatibility search | Keep the compatibility accessor only until older-host support is retired | No released canonical UI reads the merged list | Mobile coordinator | Phase 7 complete for the released path |
| Optimistic prompt row | `ConnectionCoordinator._optimistic` (transient) | Keep as UI-only | Never persisted as canonical transcript event | Mobile view model | Kept (UI-only) |
| `SnapshotEntries` table | Drift `app_database.dart` | Remove | Once cache reset + replay from canonical store proves cold-start parity | Mobile repository | Phase 7 |
| `session.history.page` control | `runtime.sessionHistoryPage()` | Keep as bounded paging API | The plan keeps it as the safe paging API; UI never reads it for transcript reconstruction | Bridge runtime | Kept (paging only) |

## Deletion PR template

Every deletion PR for this rewrite must state the following (per plan
§16.5):

```text
New code added:
Legacy code deleted:
Temporary code introduced:
Deletion condition for temporary code:
Source-of-truth impact:
```

If any deletion PR cannot answer that contract, the deletion is
rejected and the slice does not land.

## Temporary compatibility code register

The rewrite slice introduces the following temporary code. Each entry
records its purpose, owner, deletion condition, and expected removal
phase.

| Temporary code | Owner | Purpose | Deletion condition | Removal phase |
| --- | --- | --- | --- | --- |
| `pi_event_diagnostics` SQLite table | Bridge adapter | Bounded diagnostics sink for raw Pi notifications | When the adapter proves all raw shapes map to curated events or are recognized as unknown | Phase 7 |
| `appendPiDiagnostics()` helper on `OneSessionPiAdapter` | Bridge adapter | Convenience wrapper for diagnostics sink | When mobile logs no longer surface raw events for support | Phase 7 |
| Legacy stream plus `CanonicalSessionStore` | Bridge runtime | Operational events and older-host compatibility only; transcript dual-write removed from the normal daemon | Remove remaining operational/older-host compatibility paths after the separate cutoff | Compatibility phase |
| Deferred `reconcileStartup()` call in `runDaemon` | Bridge daemon | Binds the listener before bulk reconciliation while readiness remains false | Remove the migration wrapper after startup recovery is covered by the normal integration test | Phase 8 |

## Capability claims discipline

The canonical event capability is additive and is advertised only when
`runDaemon` constructs the dedicated store and transport. The existing
capability matrix remains the source of truth for released claims.

- `commands.v1`, `controller_leases.v1`, and `streams.v1` remain in the
  released baseline. `notifications.v1` remains optional. Internal raw RPC
  command handling remains for compatibility, but `raw_rpc.v1` is not
  advertised to the released mobile client.
- `session_events.v2` is implemented and exercised by the normal daemon
  and coordinator. The normal daemon has no transcript dual-write; legacy
  transcript/recipe code remains only for isolated older-host compatibility.
- Do not claim that legacy deletion is complete until the parity tests pass.
- The removal of `pi.rpc.event` from the user-visible session stream is
  an internal contract change, not a capability addition. The schema
  union keeps `"pi.rpc.event"` so existing fixtures and clients that
  receive the type on the wire still validate, but the bridge no
  longer emits it on `session:<id>` streams. `raw_rpc.v1` request
  handling continues to use `pi.rpc.response` and is unaffected.
- Mobile readers that filter by type (`'pi.rpc.event'`) keep working at
  the schema layer; once Phase 7 lands they will see no events of
  that type from the session stream, which is the desired outcome.

## Open inventory gaps

These items are out-of-scope for this slice and tracked for later
phases:

- Per-turn identity mapping persistence — required to make `turnId` /
  `messageId` / `toolCallId` stable across replay. Current adapter
  infers `turnId` from the active turn at handle time, which is not
  replay-safe in isolation.
- Bounded payload enforcement on `recipe.activity` snapshots — today
  the bridge honors the existing `LIMITS`; the canonical contract
  should codify this.
- Explicit schema versioning for canonical events — defer until
  Phase 1 lands a closed wire contract; this slice carries a
  TypeScript contract under `packages/bridge/src/session-events/`
  but does not regenerate the schema fixtures.