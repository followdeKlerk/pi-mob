# Pi Mob — Current Agent Handoff

## Authority

The user has explicitly designated this file as the current handoff authority.
Use it over historical checkpoint prose when they conflict. The product remains
chat-first and preserves all exclusions in `FIELD_GUIDE.md`.

## Canonical branch state

- Repository: `/Users/nathandekleerk/github/pi-mob`
- Branch: `main`
- HEAD: `338ed1a feat(mobile): wire R2 plan summary request and stream events into coordinator`
- Working tree: clean at handoff; this file is intentionally untracked until
  the docs commit lands.

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
