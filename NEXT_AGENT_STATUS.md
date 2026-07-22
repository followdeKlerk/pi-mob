# Pi Mob — Current Agent Handoff

## Authority

The user has explicitly designated this file as the current handoff authority.
Use it over historical checkpoint prose when they conflict. The product remains
chat-first and preserves all exclusions in `FIELD_GUIDE.md`.

## Canonical branch state

- Repository: `/Users/nathandekleerk/github/pi-mob`
- Branch: `main`
- HEAD: R4 mobile slice (commit pending in this turn)
- Working tree: DIRTY at handoff — R4 mobile slice is staged for commit
  but TWO R4 tests are failing (see "Known failures" below). The next
  agent must investigate and fix them BEFORE pushing.

## Integrated in this continuation

### `9604868 feat(bridge): route bounded workspace file controls`

- `DurableBridgeRuntime` optionally accepts `WorkspaceFileService`.
- Bounded tree/search/metadata/read/read controls route only through that service.
- `files.v1` is advertised only when the service is installed.
- Prompt file references are revalidated immediately before command admission.
- `attachmentIds` and `fileRefs` share the four-item budget.
- Focused runtime coverage exists in
  `packages/bridge/test/r3-runtime-integration.test.ts`.

### `199b82e feat(mobile): correlate process snapshot responses`

- Mobile tracks `requestId -> {sessionId, connectionEpoch}` before sending
  `process.snapshot.request`.
- `process.snapshot.result` remains the frozen `{items}` shape. Empty results
  are attributed only by that correlation.
- Results are consumed once; cross-session items are rejected by the existing
  process reducer; correlations clear on send error, reconnect, socket close,
  forget-host, and dispose.
- Added coordinator coverage for uncorrelated, empty, and duplicate responses.
- Repaired a Dart static-type error in `BashToolArgs.fromMap` that blocked the
  coordinator test compilation.

### `83b84d9 feat(bridge): wire R5 process and R6 git services into runtime dispatch`

- `DurableBridgeRuntime` optionally accepts `AuthoritativeProcessRegistry`,
  `GitSummaryService`, and `resolveGitCwd`.
- `process.snapshot.request` returns the frozen closed
  `process.snapshot.result` (`{ items }`) shape; D-039 correlation remains on
  the mobile coordinator.
- `process.output.page` returns one bounded `ProcessOutput` for the requested
  cursor/pageToken, or `undefined` when the cursor no longer matches (implicit
  cancellation of stale pagination).
- `git.summary.request` returns the closed `GitSummary` schema. When the
  service truthfully reports `GitUnavailable` for a workspace, the bridge
  throws `unsupported_capability` so the response payload never embeds the
  unavailable shape inside `git.summary.result`.
- `git.summary.cancel` aborts the in-flight request by `targetRequestId` via
  the tracked `AbortController`; unknown IDs are a no-op.
- `optionalCapabilities()` now advertises `processes.v1` and `git.v1` only
  when their respective services are installed, alongside the existing
  `files.v1`.
- Runtime `control` may now return a Promise so the git path can await
  `GitSummaryService.summarize`; the server already awaits `control`.
- Added focused runtime coverage in
  `packages/bridge/test/r5-r6-runtime-integration.test.ts`.

### `498ff8f feat(bridge): emit git.unavailable host-stream event on runtime GitUnavailable`

- When `git.summary.request` produces a `GitUnavailable` from
  `GitSummaryService.summarize`, the runtime now appends a closed
  `git.unavailable` event to the host stream before throwing
  `unsupported_capability`. Subscribers receive `{ workspaceId, capability:
  "git-ci.v1", status: { state: "unavailable", reason, remediation } }` as
  the truthful Git/CI surface state.
- The response is still rejected with `unsupported_capability` so the
  `git.summary.result` envelope never embeds the unavailable shape; mobile
  coordinators can correlate the throw with the stream event by `workspaceId`.
- `cwd unknown` and "git service not installed" paths do NOT emit
  `git.unavailable`: those are host-side validation failures, not truthful
  Git surface state, and the bridge refuses to fabricate stream events.
- Added three new tests:
  - `git.unavailable` event lands on the host stream (with
    `validateFixture` schema assertion)
  - success path does NOT emit `git.unavailable`
  - `cwd unknown` does NOT emit `git.unavailable`
- Frozen schemas and D-039 response shape unchanged.

### R4 mobile context-inspector wiring (staged for commit — KNOWN FAILURES)

- `apps/mobile/lib/src/context/context_domain.dart` adds the closed
  R4 projection: `ContextSnapshotData.tryParse`,
  `ContextUnavailableData.tryParse`, `ContextState`
  (`snapshot`/`unavailable`/`refreshing`/`lastRequestRevision`),
  `ContextMutationTarget` union (file/source/all), and `reduceContext`
  mirroring `reducePlan` / `reduceGit`.
- `ConnectionCoordinator` exposes `ContextState get contextState`
  plus `requestContextSnapshot(sessionId)` /
  `cancelContextSnapshot(requestId)` and the four D-037 durable
  mutation controls: `pinContext` / `unpinContext` / `excludeContext`
  / `refreshContext`. Tracks
  `Map<String, _ContextSnapshotRequest>` keyed by requestId and
  connection epoch so stale `context.snapshot.result` from a prior
  reconnect is dropped.
- Response router handles `context.snapshot.result`; event router
  handles host-stream `context.unavailable` and session-stream
  `context.snapshot` BEFORE the cursor advance notifies subscribers
  (same pattern R2/R6 used).
- Lifecycle clears at reconnect, dispose, and socket-end reset the
  in-flight context registry alongside the existing plan/git ones.
- `apps/mobile/lib/protocol_fixture.dart` updated: `context.unavailable`
  is host-stream-owned (capability envelope, no sessionId);
  `context.snapshot` stays session-stream-owned (carries sessionId).
  Mirrors the shared TypeScript `EVENT_STREAM_OWNERSHIP` map.
- Corpus fixture `event-context-unavailable-valid.json` moved from
  `session:` to `host:` streamId to match.
- Test helper `_contextUnavailableEvent` switched from `_recipeEvent`
  (session) to `_hostEvent` (host) — `context.unavailable` is host-owned.
- Seven new coordinator tests (5 passing, 2 KNOWN FAILURES):
  - request correlates `context.snapshot.result` to the session
    **<-- FAILS**: `eventually(() => coordinator.contextState.snapshot
    != null)` times out at line 2714. Likely cause: response is
    reaching the socket but `_contextSnapshotResult` is dropping it
    due to epoch mismatch OR `ContextSnapshotData.tryParse` is
    rejecting the payload. Next agent MUST diagnose via tracing
    print (NOT keep) in the coordinator receive path, then remove
    after fix.
  - `context.unavailable` host-stream event marks the session
    unavailable **<-- FAILS**: same line 2714 eventually timeout.
    The test sends `context.snapshot` first on `session:$sessionId`,
    then `context.unavailable` on `host:$hostId`. The latter may not
    reach `_receive` if the prior event triggered a journal failure
    that closed the socket (same class of bug as the R2 fix earlier).
    Next agent should follow the R2 debug pattern that worked.
  - `cancelContextSnapshot` clears refreshing when no in-flight
    request exists (passing)
  - `cancelContextSnapshot` clears the tracked request and refreshing
    flag (passing)
  - `pinContext` sends `context.pin` with the closed target and
    `expectedRevision` (passing)
  - `unpin`/`exclude`/`refresh` all send the matching control with
    the closed target (passing)
  - stale `context.snapshot.result` from a prior connection epoch
    is dropped (passing)

**KNOWN FAILURES — next agent MUST fix before declaring R4 done:**
  1. `R4 context snapshot request correlates context.snapshot.result
     to the session` (connection_coordinator_test.dart ~line 2310)
  2. `R4 context.unavailable host-stream event marks the session
     unavailable` (connection_coordinator_test.dart ~line 2321)

Both look like they share a root cause: the `context.snapshot.result`
response / `context.unavailable` host-stream event never reaches
`_contextSnapshotResult` / `_applyContextStreamEvent`. Hypothesis:
the journal-dispatch branch in `_receive` is firing `_applyContextStreamEvent`
BEFORE the snapshot test's `eventually` runs, but the response test
needs the SAME event-type-via-result to update `snapshot`. Add a
single `print('DBG context-snapshot-result reached _contextSnapshotResult')`
inside that method (with `// ignore: avoid_print`) and re-run to see
whether it's a wiring issue or a parse issue. Clean up the print
before commit.

### R4 bridge context-inspector wiring (now committed)

- New `packages/bridge/src/context/source-service.ts` defines
  `ContextSourceService` (snapshot + mutate), the discriminated
  `ContextSourceResult = ContextSnapshot | ContextUnavailable`, the
  `boundContextSnapshot()` helper that clips every string/array to the
  protocol LIMITS, and the closed `ContextMutationTarget` union
  (`file`/`source`/`all`).
- `DurableBridgeRuntime` now optionally accepts `contexts` (a
  `ContextSourceService`). It advertises `contexts.v1` only when an
  instance is installed and routes five new controls:
  - `context.snapshot.request` (read; tracks in-flight requests so
    the bridge can cancel; surfaces `context.unavailable` on the
    host stream then rejects the response with
    `unsupported_capability` when the service truthfully reports
    unavailable).
  - `context.pin` / `context.unpin` / `context.exclude` /
    `context.refresh` (durable session commands per D-037; the
    bridge forwards a normalised `ContextMutationTarget` and
    surfaces rejection as `unsupported_capability` so a stale tap
    never silently mutates the authoritative snapshot).
- Eleven new bridge tests in
  `packages/bridge/test/r4-runtime-integration.test.ts` cover
  capability advertisement, the read/response shape (validated
  against the shared protocol fixture), truthful unavailable host
  event, the four mutation controls, missing-field rejection,
  mutation rejection as `unsupported_capability`, and the
  no-service `unsupported_capability` path.
- 414 bridge tests pass (was 403, +11 R4).
- 65 protocol-schema + protocol-fixture-runtime tests still pass.
- `bun run typecheck` clean across root + bridge + schema +
  protocol-fixtures + pi-extension.

### R2 mobile plan summary wiring (now committed)

- `apps/mobile/lib/src/plans/plan_domain.dart` adds the closed
  `PlanState` projection with `PlanStepData`, `PlanSnapshotData`,
  `PlanUnavailableData`, and a `reducePlan` reducer mirroring
  `reduceGit`.
- `ConnectionCoordinator` now exposes `PlanState get plans` plus
  `requestPlanSummary(sessionId, turnId)` and
  `cancelPlanSummary(requestId)`; tracks
  `Map<String, _PlanSummaryRequest>` keyed by requestId and
  connection epoch so stale `plan.snapshot.result` from a prior
  reconnect is dropped.
- Response router handles `plan.snapshot.result`; event router
  handles the host-stream `plan.unavailable` and the session-stream
  `plan.snapshot` BEFORE the cursor advance notifies subscribers
  (same pattern R6 used for `git.summary`/`git.unavailable`).
- Lifecycle clears at reconnect, dispose, and socket-end reset the
  in-flight plan summary registry alongside the existing git one.
- Five new coordinator tests:
  - request correlates `plan.snapshot.result` to the session
  - `plan.unavailable` host-stream event marks the session
    unavailable and clears the snapshot
  - `cancelPlanSummary` sends `plan.summary.cancel` with the
    tracked requestId
  - `cancelPlanSummary` is a no-op when no in-flight request exists
  - stale `plan.snapshot.result` from a prior connection epoch is
    dropped
- `plan.unavailable` and `recipe.unavailable` are host-owned
  capability-state envelopes (no `sessionId`); the Dart
  `protocol_fixture.dart` was updated to mark them as such, and the
  shared corpus fixtures (`event-plan-unavailable-valid`,
  `event-recipe-unavailable-valid`, `plan-unavailable-stale-valid`,
  `recipe-unavailable-valid`) moved from `session:` to `host:`
  streamId to match. Without that fix, the second host-stream
  event threw `ProtocolValidationException(streamId: expected
  session: stream, got host:...)` during the R2 unavailable test.

### Mobile R6 coordinator wiring (committed earlier as `a430c42`)

- `ConnectionCoordinator` now imports `GitState` and `reduceGit` and tracks a
  `Map<String, _GitSummaryRequest>` keyed by requestId for in-flight
  `git.summary.request` correlation (mirrors D-039 process snapshot pattern).
- New public API: `GitState get git`, `Future<void> requestGitSummary(id)`,
  `Future<void> cancelGitSummary(id)`.
- Response router handles `git.summary.result`; event router handles the
  host-stream `git.summary` and `git.unavailable` events.
- **Critical journal-dispatch fix**: the early-return path in `_receive()`
  for messages with `eventId`/`streamId`/`cursor` (host-stream events)
  applies the Git projection BEFORE the cursor advance notifies subscribers.
  Without this, the UI sees an out-of-order summary then unavailable.
- `reduceGit` for `git.unavailable` now sets `summary: null` so a stale
  summary cannot linger after the host signals truth.
- Lifecycle clears (`_gitSummaryRequests.clear()`, `refreshing: false`)
  added to reconnect, dispose, and socket-end paths alongside the existing
  process snapshot clears.
- Five new coordinator tests (all passing):

## Verification completed

- `bun run typecheck`
- Focused bridge R5/R6/R3/process/git tests, and full bridge suite (735
  passing, 0 failing).
- `flutter analyze` clean.
- `flutter test test/connection_coordinator_test.dart` 36 passing = 31 prior
  + 5 R6.
- Full `flutter test` for the mobile app: 466 passing, 0 failing.
- `git diff --check` clean on the staged diff.

## Remaining priority work

1. Complete mobile R1/R3 persistence/projection and app-shell reachability.
   File and command insertion must update the draft only, never submit it.
2. Implement R2/R4, audit/complete R7–R12, repair global search before any
   remerge, and perform full test/APK/physical-Android/Tailscale validation.
3. R6 is now wired end-to-end on mobile; the next iteration should expose
   `coordinator.git` to a `GitSummaryCard` widget that subscribes to the
   coordinator so the unreachable workspace UI updates without a per-workspace
   refresh tap.

## Cautions

- Never infer hidden reasoning, agent lifecycle, Git state, or process state.
- Do not add excluded diff, editor, preview, rollback, account, or cloud-sync
  interfaces.
- Use `NEXT_AGENT_STATUS.md` for current progress; the M16 physical-device
  checkpoint remains required before a release claim, but does not erase the
  integrated R3/R5/R6 continuation work.
