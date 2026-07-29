# Bridge daemon startup busy-loop — historical incident report

> **Archived:** this document records the July 2026 startup incident and the reasoning that led to the first scalability fixes. It is no longer the active project handoff. Use [Project status and roadmap](PROJECT_STATUS.md) for current work.

## Original incident

On a macOS x86_64 host, the installed bridge daemon could consume approximately one CPU thread without binding the loopback listener. The recorded database contained roughly 45,833 durable events across 20 sessions. No Pi subprocess appeared, logs remained empty, and the lifecycle command ended with `bridge readiness timeout`.

A process sample repeatedly entered SQLite stepping and B-tree traversal. Because no loopback listener existed, all mobile and Tailscale connection failures were downstream symptoms.

## Confirmed original startup order

At the time of the incident, startup performed synchronous durable-store and history work before `Bun.serve`:

1. open and migrate SQLite;
2. run a full `PRAGMA integrity_check`;
3. recover uncertain commands and session state;
4. discover external Pi sessions;
5. import and project changed session histories;
6. start Pi RPC;
7. recover the durable runtime;
8. bind the loopback listener.

## Root cause found

The dominant implementation problem was historical recipe projection complexity.

For each imported source event, the projection layer rescanned and canonicalized the complete accumulated activity snapshot. Large histories therefore approached quadratic work. A representative large session could spend many minutes in projection before the daemon became reachable.

The import also used a single outer transaction and advanced the source revision marker only at the end. A terminated startup could roll back and retry the same tail on the next launch.

A full SQLite integrity check on every boot added another synchronous listener-blocking operation.

## Fixes completed

- Recipe projection now tracks dirty activity identities and publishes only changed projections.
- Regression coverage was added for idempotence and bounded large-history scaling.
- Full SQLite integrity verification was removed from ordinary daemon startup; it belongs in explicit maintenance or recovery operations.
- Additional session and mobile stability fixes prevent individual forward-compatible durable events from automatically poisoning an otherwise healthy connection.

These changes address the observed quadratic busy loop. The old debug branch named in earlier versions of this document is no longer the canonical work location.

## Remaining architectural gap

The broader bind-first design is not complete.

The normal daemon still discovers and imports external history and starts primary Pi RPC before it creates the loopback server. Import still reads a complete JSONL file synchronously and commits the pending tail in one transaction.

Consequences:

- large or malformed histories can still delay host reachability;
- readiness cannot distinguish process liveness from history initialization before the listener exists;
- interrupted pending-tail import can restart from the beginning of that tail;
- connected clients cannot observe progress or degraded history state during initialization.

## Current corrective design

The active roadmap requires:

1. bind the loopback server after lightweight store recovery;
2. expose explicit phases such as `starting`, `initializing_history`, and `ready`;
3. import history in bounded batches;
4. persist a checkpoint after each committed batch;
5. yield between batches so health checks and clients remain responsive;
6. preserve idempotence across interruption and restart;
7. add end-to-end coverage using approximately 20 sessions and 50,000 events.

Increasing the readiness timeout is not a solution.

## Diagnostic order

When the mobile app cannot connect:

1. Check `pi-mob status`.
2. Check `http://127.0.0.1:8788/healthz`.
3. Check `http://127.0.0.1:8788/readyz`.
4. Inspect the LaunchAgent and owner-only logs.
5. Debug Tailscale only after the local listener exists.
6. Debug Flutter only after the private Serve path reaches the local listener.

A timeout by itself does not prove whether startup is slow, the process crashed, or binding failed.

## Preserved evidence

The original checkpoint commit and dated rectification reports remain available in repository history and in:

- [Raw RPC rectification progress snapshot](PROGRESS_SNAPSHOT.md)
- [Raw RPC rectification final report](RECTIFICATION_FINAL_REPORT.md)

Those reports contain host-specific observations and historical test counts. Treat them as evidence snapshots, not current product claims.
