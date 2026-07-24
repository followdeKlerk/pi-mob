# Bridge daemon startup busy loop

## Status

**Active blocker on `debug/bridge-daemon-busy-loop`.**

The branch contains the larger control-oriented implementation that runs Pi with the owner's normal execution model. It is intentionally not equivalent to `main`: the bridge no longer depends on the host-policy extension to constrain Pi, and setup captures the owner's login environment so Pi sees the same PATH and provider configuration as a normal local session.

Do not remove or weaken those branch goals as a workaround for this incident. The current blocker is daemon startup and listener readiness.

## Reproduction recorded on the debug branch

The WIP checkpoint commit `71ecdcb47b0ecf8ebe4b3936ea23ffe5b43e862a` recorded this host behaviour on macOS x86_64:

- `bridge-daemon` starts and consumes approximately one CPU thread.
- The loopback HTTP/WebSocket listener is never bound.
- No Pi RPC subprocess is started.
- `bridge.out` and `bridge.err` remain empty.
- `pi-mob start` ends with `bridge readiness timeout`.
- A process sample repeatedly enters `sqlite3_step` and SQLite B-tree/index traversal.
- The observed database contained 45,833 events across 20 sessions.
- The event count did not grow while the process was spinning.

The mobile application cannot connect in this state because no loopback listener exists for Tailscale Serve to proxy.

## Confirmed startup ordering

`runDaemon()` currently completes synchronous durable-store and history work before creating the bridge server:

1. Open `bridge.sqlite`.
2. Configure SQLite and run migrations.
3. Run `PRAGMA integrity_check`.
4. Mark uncertain commands and restore session state.
5. Discover Pi sessions.
6. Import changed external Pi session histories.
7. Start the primary Pi RPC supervisor.
8. Start the durable runtime.
9. Create the loopback server with `Bun.serve`.

The lifecycle command waits only 30 attempts at 100 ms each for `/readyz`, so startup receives roughly three seconds before reporting `bridge readiness timeout`.

## Working diagnosis

### Primary suspect: historical import/projection complexity

`importExternalSessionHistory()` constructs a `DurableRecipeActivityProjection`. Its constructor hydrates by reading every existing event for the session. During import, each source event is appended through `projection.append()`, which immediately calls `appendChanged()`.

`appendChanged()` walks the complete projector snapshot, canonical-serialises activities, compares them with prior published snapshots, and may append derived `recipe.activity` events. Repeating that full scan after every imported source event produces approximately O(source events × projected activities) work and can approach O(n²) for large histories.

The import is wrapped in one outer transaction and writes the source revision marker only at the end. If startup is terminated before commit, the transaction rolls back and the next launch repeats the same import. That is consistent with high SQLite activity without visible event-count growth from another connection.

This is a diagnosis supported by code structure and the process sample, not yet a measured attribution. Instrumentation must identify the exact stage and elapsed time.

### Secondary suspect: full integrity check on every boot

`BridgeStore.open()` runs `PRAGMA integrity_check` synchronously during every normal daemon startup. This can be expensive on a transcript-heavy database and should not sit on the listener-critical path.

### Not currently supported as root causes

There is no present evidence that the failure originates in:

- Flutter pairing or WebSocket handling;
- Tailscale Serve route configuration;
- provider credentials or the captured login environment;
- the removal of the host-policy extension;
- Pi RPC itself, because the reproduction recorded no Pi subprocess.

Investigate those only after the loopback listener becomes reachable.

## Required diagnostic instrumentation

Add bounded startup timing markers to stderr or the redacting logger. Every marker must include a stage name and elapsed monotonic milliseconds, but no private paths, transcript content, environment values, or credentials.

Minimum stages:

- `store.open.begin` / `store.open.end`
- `store.integrity.begin` / `store.integrity.end`
- `sessions.discover.begin` / `sessions.discover.end`
- one summary per imported session: source entries, pending entries, existing durable events, derived events, elapsed time
- `history.import.all.end`
- `rpc.start.begin` / `rpc.start.end`
- `runtime.start.begin` / `runtime.start.end`
- `server.bind.begin` / `server.bind.end`

Do not add per-event logging; that can worsen the incident and leak unnecessary metadata.

## Corrective design

Implement the smallest safe sequence that makes listener readiness independent of historical replay:

1. **Bind first.** Create the loopback server before bulk history synchronisation.
2. **Expose initialization truthfully.** `/readyz` should distinguish process liveness from full history readiness, or add a separate startup-state endpoint. Mobile may connect while the host reports `initializing`.
3. **Batch projection.** Apply a bounded batch of source events to the projector, then emit changed derived snapshots once per batch rather than once per source event.
4. **Checkpoint progress.** Persist a source cursor or equivalent import checkpoint after each committed batch. Do not require an entire session history to succeed atomically.
5. **Yield between batches.** Return to the event loop so health checks and connections remain responsive.
6. **Move full integrity verification.** Keep normal startup lightweight. Run full `integrity_check` through `pi-mob doctor`, explicit maintenance, or recovery mode.
7. **Improve lifecycle reporting.** Replace the undifferentiated three-second timeout with bounded phase-aware readiness output. A longer timeout alone is not the fix.

## Acceptance criteria

The incident is resolved only when all of the following hold:

- The loopback listener becomes reachable promptly with the existing 45k-event-class database.
- The daemon reports an explicit startup phase while history synchronization continues.
- The mobile app can establish its host connection during or immediately after initialization.
- Imported histories remain idempotent across restart and interruption.
- Terminating the daemon mid-import does not force replay from the beginning.
- No duplicate source or derived events are created.
- No Pi subprocess is orphaned.
- The owner-captured launch environment and normal Pi execution model remain intact.
- A regression test covers approximately 20 sessions and 50,000 durable events.
- Relevant bridge tests, typecheck, and mobile connection tests pass.

## Suggested implementation order

1. Add startup stage timings and reproduce against a copy of the affected database.
2. Confirm whether time is dominated by `integrity_check`, projection hydration, repeated `appendChanged()`, or another query.
3. Add an early listener plus explicit initialization state.
4. Refactor history import into bounded, checkpointed batches.
5. Move full integrity checking out of ordinary startup.
6. Add the large-history regression fixture and interruption/restart test.
7. Re-run mobile pairing only after local `/readyz` and WebSocket connectivity are proven.

## Files to inspect first

- `packages/bridge/src/daemon.ts`
- `packages/bridge/src/core/store.ts`
- `packages/bridge/src/pi/external-history.ts`
- `packages/bridge/src/pi/recipe-activity.ts`
- `packages/bridge/src/core/server.ts`
- `packages/bridge/src/ops/macos-system.ts`
- `packages/bridge/src/ops/cli.ts`

## Guardrails for the next agent

- Work on `debug/bridge-daemon-busy-loop`; do not assume `main` represents this branch.
- Preserve unrelated R7/R8/R9/R12 work already captured on the branch.
- Do not delete the existing database during diagnosis; reproduce against a copy.
- Do not treat increasing the readiness timeout as resolution.
- Do not reintroduce the host-policy extension merely to make startup simpler.
- Separate confirmed measurements from hypotheses in commits and documentation.
- Commit diagnostic instrumentation separately from behavioural fixes where practical.
