# Pi Mob — R4 Mobile Handoff

## Authority

This file is the **current** checkpoint handoff for the R4 mobile context-inspector slice.
`NEXT_AGENT_STATUS.md` remains authoritative for cumulative progress; this file adds the
R4 mobile slice specifically and the two failing tests the next agent must fix.

## Stop condition

**STOPPED at next checkpoint.** Two R4 mobile tests fail; do not declare R4 done until
both pass. Commit and push happen AFTER the fix, not now.

## Branch / worktree state

- Repository: `/Users/nathandekleerk/github/pi-mob`
- Branch: `main`
- HEAD: `57583d8 feat(bridge): wire R4 context inspector request/mutate/unavailable surface`
- Working tree: **DIRTY** — R4 mobile slice is staged for commit, but TWO tests fail
  and must be repaired before push.

## Files staged for commit (untracked or modified)

- `apps/mobile/lib/src/context/context_domain.dart` (NEW)
- `apps/mobile/lib/protocol_fixture.dart` (modified)
- `apps/mobile/lib/src/connection/connection_coordinator.dart` (modified)
- `apps/mobile/test/connection_coordinator_test.dart` (modified)
- `apps/mobile/test/protocol_fixture_test.dart` (modified)
- `packages/protocol-fixtures/corpus/event-context-unavailable-valid.json` (modified)
- `NEXT_AGENT_STATUS.md` (modified — R4 mobile section appended)

`apps/mobile/lib/src/context/context_domain.dart` is untracked; everything else is modified.

## What's already done (committed pre-this-staging)

- Bridge R3 (bounded workspace file controls) — `9604868`
- Mobile process snapshot correlation — `199b82e`
- Bridge R5/R6 dispatch wiring — `83b84d9`
- Bridge R6 `git.unavailable` host-stream event — `498ff8f`
- Mobile R6 git summary wiring — `a430c42`
- Mobile R2 plan summary wiring — `338ed1a`
- Bridge R2 plan summary wiring — `e95ff65`
- Bridge R4 context inspector wiring — `57583d8`

## What's in this R4 mobile slice (staged, not committed yet)

- **`apps/mobile/lib/src/context/context_domain.dart`** — closed projection:
  - `ContextSnapshotData.tryParse` (closed: sessionId/revision/source/stale/capability/model/thinkingLevel/instructions/pinnedFiles/tokenUsage/compacted/compactRevision/compactedAt/sources/lastRefreshedAt)
  - `ContextUnavailableData.tryParse` (closed: capability must be `contexts.v1`, sessionId UUID, status state ∈ {unavailable, degraded, stale}, reason + remediation required)
  - `ContextState` (snapshot / unavailable / refreshing / lastRequestRevision)
  - `ContextMutationTarget` union (file / source / all) with `toJson()`
  - `reduceContext(state, type, payload)` mirroring `reducePlan` / `reduceGit`

- **`ConnectionCoordinator`** (`connection_coordinator.dart`):
  - Imports `ContextState`, `reduceContext`, `ContextMutationTarget`
  - Private `_ContextSnapshotRequest` keyed by requestId + connection epoch (D-039 pattern)
  - `Map<String, _ContextSnapshotRequest> _contextSnapshotRequests`
  - `ContextState _context = const ContextState()`
  - Public API:
    - `ContextState get contextState`
    - `requestContextSnapshot(sessionId)` — sends `context.snapshot.request`
    - `cancelContextSnapshot(requestId)` — local-only cleanup, no host cancel
    - `pinContext` / `unpinContext` / `excludeContext` / `refreshContext`
    - private `_sendContextMutation(...)`
  - Response router handles `context.snapshot.result` via `_contextSnapshotResult`
  - Event router handles `context.snapshot` (session stream) AND `context.unavailable` (host stream) via `_applyContextStreamEvent`
  - Both `context.snapshot.result` and the stream events are wired into the journal-dispatch branch of `_receive` BEFORE cursor advance (R2/R6 discipline)
  - Lifecycle clears at reconnect, dispose, socket-end — alongside the existing git/plan clears

- **`apps/mobile/lib/protocol_fixture.dart`**:
  - `_responseTypes` now includes `context.snapshot.result`
  - `_eventTypes` now includes `context.snapshot` and `context.unavailable`
  - `_validateContextSnapshotPayload` enforces the closed schema
  - `_validateContextUnavailablePayload` enforces the closed schema
  - `context.unavailable` is host-stream-owned (capability envelope, no sessionId); `context.snapshot` carries sessionId
  - Mirrors the shared TypeScript `EVENT_STREAM_OWNERSHIP` map

- **`apps/mobile/test/protocol_fixture_test.dart`**:
  - `_contextUnavailableEvent` switched from `_recipeEvent` (session) to `_hostEvent` (host) — `context.unavailable` is host-owned

- **`packages/protocol-fixtures/corpus/event-context-unavailable-valid.json`**:
  - Moved from `session:` to `host:` streamId to match the host-owned envelope

- **`apps/mobile/test/connection_coordinator_test.dart`** — 7 new tests:
  1. `R4 context snapshot request correlates context.snapshot.result to the session` — **FAILS**
  2. `R4 context.unavailable host-stream event marks the session unavailable` — **FAILS**
  3. `R4 cancelContextSnapshot clears refreshing when no in-flight request exists` — passes
  4. `R4 cancelContextSnapshot clears the tracked request and refreshing flag` — passes
  5. `R4 pinContext sends context.pin with the closed target and expectedRevision` — passes
  6. `R4 unpin/exclude/refresh all send the matching control with the closed target` — passes
  7. `R4 stale context.snapshot.result from a prior connection epoch is dropped` — passes

## Known failures — next agent MUST fix before pushing

Both tests fail with `Condition was not met` from `eventually()` at line 2714 in
`apps/mobile/test/connection_coordinator_test.dart`.

### Failure 1: `R4 context snapshot request correlates context.snapshot.result to the session`

- Test sends `context.snapshot.request`, waits for socket, then `socket.server(response('context.snapshot.result', validContextSnapshotPayload(), requestId: requestId))`.
- Expects `coordinator.contextState.snapshot != null`, `revision == 'context-r1'`, `model.provider == 'anthropic'`, `refreshing == false`.
- **Diagnostic evidence gathered this turn**: The `eventually` at line 2714 (`Condition was not met`) is the only signal. The fix has NOT yet been located. Two candidate root causes:
  1. `ProtocolEnvelope.fromJson(message)` for the response rejects the payload somewhere — but `context.snapshot.result` is in `_responseTypes` and `_validateContextSnapshotPayload` only enforces the closed schema, which the fixture satisfies.
  2. `ContextSnapshotData.tryParse` rejects the payload — but the fixture has `sessionId` UUID, `revision` non-empty, `source` non-empty, `stale` bool, `lastRefreshedAt` ISO-8601 UTC, `capability.state == 'available'`, `model.{provider,modelId}` non-empty strings, `pinnedFiles` list with valid entries, `tokenUsage` digit strings.

### Failure 2: `R4 context.unavailable host-stream event marks the session unavailable`

- Test sends a `context.snapshot` event on `session:$sessionId`, then a `context.unavailable` event on `host:$hostId`. The latter has `capability: 'contexts.v1'` and `status: { state: 'unavailable', reason: 'No vetted context authority installed', remediation: '...' }`.
- Expects `contextState.unavailable != null`, `snapshot == null`, `unavailable.reason == 'unavailable'`, `unavailable.message` contains 'No vetted context authority'.
- **Hypothesis**: Because the `context.snapshot` event is dispatched through the journal path BEFORE the cursor advance, and a parse failure of that event triggers the `invalid_payload` unavailable state, the subsequent `context.unavailable` event's `ContextUnavailableData.tryParse` should still set state to the proper unavailable (since sessionId IS a UUID, capability IS `contexts.v1`, status state IS `unavailable`, reason/remediation are non-empty strings). But it does not — the `eventually` for `unavailable != null` also times out.

## Diagnostic procedure for the next agent

1. Re-run the failing test in isolation:
   ```
   cd apps/mobile && flutter test test/connection_coordinator_test.dart \
     --name "R4 context snapshot request correlates"
   ```
2. Add a temporary `print(...)` (with `// ignore: avoid_print`) at the entry of `_contextSnapshotResult` AND `_applyContextStreamEvent` so the next agent can see:
   - Did the message reach the handler?
   - What was `requestId` and what is in `_contextSnapshotRequests`?
   - What does `ContextSnapshotData.tryParse` / `ContextUnavailableData.tryParse` return?
   - What does `reduceContext` produce after the call?
3. Inspect the printed values to isolate whether it's a wiring issue (message never arrives) or a parse issue (message arrives but reducer produces null).
4. REMOVE the prints before committing.

## Most likely root cause

Both failures share an early symptom: `eventually` times out with no observable error.
The most likely cause is **a thrown exception inside `_receive` BEFORE the switch case
runs**, swallowing the response. Specifically: the dispatch in `_receive` calls
`ProtocolEnvelope.fromJson(message)` when `message['requestId'] != null ||
message['eventId'] != null`. If that throws (e.g. unknown required field, mismatched
type guard, or a closed-object rejection we haven't surfaced), `_appendRaw` is never
called and the projection never updates.

The fix is most likely:
- Either loosen the closed-object validation for `context.snapshot.result` so the
  fixture's payload (which is intentionally minimal) still validates, OR
- Enlarge `validContextSnapshotPayload` in the test to include every closed field
  listed in `_validateContextSnapshotPayload`'s `_closedObject` whitelist.

Whichever is chosen, BOTH tests must pass before commit.

## Verification required before declaring R4 mobile done

- `flutter analyze` clean (no new warnings)
- `flutter test test/connection_coordinator_test.dart` — all 38 tests pass
  (31 prior + 5 R6 + 7 R4)
- Full `flutter test` for the mobile app: 473 passing, 0 failing
- `bun run typecheck` clean across root + bridge + schema + protocol-fixtures + pi-extension

## What to do next (in order)

1. Diagnose the two failures with the procedure above.
2. Fix the root cause (likely in `protocol_fixture.dart` closed-object validation OR in the test fixture payloads).
3. Remove the diagnostic prints.
4. Run `flutter analyze` + `flutter test test/connection_coordinator_test.dart` + full `flutter test`.
5. Run `bun run typecheck` to confirm bridge/schema unchanged.
6. Commit with message `feat(mobile): wire R4 context inspector request/mutate/unavailable surface`.
7. Push to `origin/main`.
8. Update `NEXT_AGENT_STATUS.md` to mark the mobile slice as committed and replace this CHECKPOINT_HANDOVER.md with a stub pointer or delete it (its job is done once the slice lands).

## Cautions

- Do not add excluded diff / editor / preview / rollback / account / cloud-sync interfaces.
- Do not fabricate stream events for `cwd unknown` or "service not installed" — those
  are host-side validation failures, not truthful capability state.
- Frozen schemas and D-039 response shape must remain unchanged.
- Do not modify `protocol_fixture.dart` outside the `_validateContextSnapshotPayload` /
  `_validateContextUnavailablePayload` closures unless the protocol fixture tests also
  pass with the change.
