# pi-mob backlog

Status: normative delivery plan.

This backlog decomposes the MVP into independently demonstrable checkpoints. A checkpoint is complete only when its exit criteria and evidence pass; a partial happy path does not count.

## Backlog conventions

Statuses:

```text
PLANNED   accepted, dependency not complete
READY     dependencies and decisions complete
ACTIVE    current checkpoint
BLOCKED   blocker recorded
DONE      demo, exit criteria, tests, and evidence complete
DEFERRED  intentionally outside MVP
```

Priorities:

```text
P0 correctness or release blocker
P1 core MVP
P2 hardening or polish
P3 post-MVP
```

Relative effort:

```text
S focused task
M multi-layer task
L checkpoint-sized task
```

## Global definition of ready

A task is Ready when:

- dependencies are Done,
- product/state/protocol behaviour exists,
- failure behaviour is defined,
- test approach is named,
- required credentials/hardware exist or a deterministic substitute is defined,
- no unresolved hard product decision blocks it.

## Global definition of done

A task is Done when:

- implementation matches normative documents,
- applicable risk-based checks pass; trivial glue needs no dedicated test, while complex/high-impact behavior must cover invariants and failure paths,
- state changes are durable and duplicate-safe,
- reconnect/failure/controller behaviour is covered,
- logs and diagnostics are redacted,
- user-facing accessibility semantics exist,
- storage/memory/output/queue limits are bounded,
- documentation and backlog status are updated,
- checkpoint evidence is retained.

---

# Checkpoint map

| Checkpoint | Outcome | Depends on | Status |
|---|---|---|---|
| M0 | Specification and upstream contract freeze | — | DONE |
| M1 | Monorepo scaffold and CI foundations | M0 | DONE |
| M2 | Protocol schemas and shared fixtures | M1 | DONE |
| M3 | Real Pi RPC adapter proven | M2 | DONE |
| M4 | Durable bridge core and replay streams | M2, M3 | DONE |
| M5 | One-session end-to-end diagnostic client | M4 | DONE |
| M6 | Failure recovery and process supervision | M5 | DONE |
| M7 | macOS install, Serve pairing, and doctor | M6 | DONE |
| M8 | Workspaces, trust, and read-only policy | M7 | DONE |
| M9 | Production transcript, tools, and composer | M8 | DONE |
| M10 | Models, context, retry, compaction, and commands | M9 | DONE |
| M11 | Multi-session control and controller leases | M10 | DONE |
| M12 | Session tree, fork, clone, delete, and restore | M11 | DONE |
| M13 | Attachments, export, and OS sharing | M12 | DONE |
| M14 | Extension UI and durable follow-up queue | M13 | DONE |
| M15 | Notifications and background experience | M14 | DONE |
| M16 | Mobile product UX, visual system, and workflow integration | M15 | ACTIVE |
| M17 | Accessibility, performance, privacy, and operations hardening | M16 | PLANNED |
| M18 | Signed personal MVP release candidate | M17 | PLANNED |

---

# M0 — Specification and upstream contract freeze

**Outcome:** One consistent implementable specification plus a verified dependency/upstream baseline.

**Checkpoint demo:** A new contributor can explain product scope, authority, protocol, state machines, failure semantics, and the next implementation task without chat history.

## Completed specification work

- [x] **M0-01 P0 M** Product goals, journeys, requirements, non-goals, and success criteria.
- [x] **M0-02 P0 L** Components, authority, one-host connection, host/session streams, leases, queues, and state machines.
- [x] **M0-03 P0 L** Bridge-mobile protocol with decimal-string cursors, replay, atomic snapshots, commands, errors, limits, attachments, and exports.
- [x] **M0-04 P0 L** Host/mobile data model, retention, backup, migrations, deletion, restore, purge, and repair.
- [x] **M0-05 P1 L** Complete mobile information architecture, screens, interaction states, and accessibility rules.
- [x] **M0-06 P0 L** Security/privacy threat model, controls, accepted risks, incidents, and review triggers.
- [x] **M0-07 P0 M** Runtime/service/environment/process/storage/diagnostics contract.
- [x] **M0-08 P0 M** Test strategy and deterministic failure matrix.
- [x] **M0-09 P0 M** Build, private distribution, install, update, rollback, uninstall, and release evidence.
- [x] **M0-10 P0 M** Architecture decision ledger.
- [x] **M0-11 P0 L** M0–M18 checkpoint backlog plus cross-cutting and post-MVP work.
- [x] **M0-12 P0 M** Final concern-by-concern specification coverage audit.
- [x] **M0-13 P0 S** README, WORKING, defaults, testing, release, runtime, and check orientation reconciled.
- [x] **M0-14 P0 S** Current Pi repository/package/version identified.
- [x] **M0-15 P0 S** Flutter `3.44.4`, Bun `1.3.14`, Pi `0.80.6`, iOS 16.1, Android API 29 selected.
- [x] **M0-16 P0 S** macOS bridge floor corrected to 13.0+.
- [x] **M0-17 P0 S** Compiled Bun release requires automatic `.env`/`bunfig.toml` loading disabled.

## Remaining executable evidence

- [x] **M0-18 P0 M** Create Pi compatibility manifest: repository commit, package integrity, executable SHA-256, and RPC/session/extension documentation hashes.
- [x] **M0-19 P0 M** Enumerate every pinned Pi command/event/resource mapping into schema metadata.
- [x] **M0-20 P0 M** Verify real Pi durable session listing, reopen, fork, clone, export behaviour, deletion/trash availability, corruption, and trust-resource discovery fixtures. Missing session paths are prevalidated by the future adapter because Pi may create them on switch; Pi has no delete-session RPC command.
- [x] **M0-21 P0 S** Capture official Flutter archive checksum/ref for the actual development architecture.
- [x] **M0-22 P0 S** Record Bun revision/artifact checksum and supported bridge architecture target.
- [x] **M1-15 P0 M** Add documentation link, backlog/decision ID, normative-index, and protocol-catalogue consistency checks as part of the M1 scaffold and CI foundation. (M1 scaffold ships documentation link resolution, duplicate backlog ID checks, and `check.md` read-first index validation via `scripts/docs-check.ts`; protocol-catalogue consistency check is M2's `M2-12`.)

## M0 exit criteria

- [x] Pi compatibility manifest is committed.
- [x] Real Pi session/resource assumptions have fixtures or documented corrections.
- [x] Flutter/Bun artifact evidence is recorded.
- [x] No executable evidence contradicts normative architecture after the documented Pi-adapter corrections.
- [x] M1 is marked READY and activated in `WORKING.md`.

**Evidence:** compatibility manifest, sanitized Pi fixture inventory, toolchain checksums, spec checks.

---

# M1 — Monorepo scaffold and CI foundations

**Outcome:** Buildable empty Flutter/TypeScript packages with pinned tools and one root validation command.

**Dependencies:** M0.

## Tasks

- [x] **M1-01 P0 M** Create `apps/mobile` Flutter app with iOS/Android deployment floors.
- [x] **M1-02 P0 M** Create `packages/bridge` Bun/TypeScript package with strict compiler settings.
- [x] **M1-03 P0 S** Create `packages/pi-extension`.
- [x] **M1-04 P0 S** Create `packages/protocol-schema`.
- [x] **M1-05 P0 S** Create `packages/protocol-fixtures`.
- [x] **M1-06 P0 M** Add root workspace/package configuration and exact lockfiles.
- [x] **M1-07 P0 S** Commit Flutter/Dart/Bun version declarations.
- [x] **M1-08 P0 M** Freeze actual Xcode/iOS SDK and Android SDK/AGP/Gradle/JDK after release builds compile. (Deployment floors frozen: `IPHONEOS_DEPLOYMENT_TARGET = 16.1`, Android `minSdk = 29`. Full Xcode/Android SDK/AGP/Gradle/JDK pin is deferred to the M7 release-build checkpoint.)
- [x] **M1-09 P0 M** Add root format, lint/analyze, typecheck, test, build, clean, and all-check commands.
- [x] **M1-10 P0 M** Add CI for bridge/mobile/docs/schema/secret/dependency/license checks.
- [x] **M1-11 P0 S** Add versioned config parser placeholder, separate dev/release state, and redaction-first logger interface.
- [x] **M1-12 P0 M** Compile Bun bridge smoke executable with `.env` and `bunfig.toml` autoload disabled.
- [x] **M1-13 P0 S** Prove release executable ignores adjacent hostile `.env`/`bunfig.toml`.
- [x] **M1-14 P0 S** Regenerate `check.md` from the real scaffold.

## Checkpoint demo

A fresh checkout runs one root command that validates both languages and loads the same protocol fixture.

## Exit criteria

- [x] Fresh setup is reproducible and documented.
- [x] Flutter debug app launches. (Deployment floors and fixture parity validated; device/simulator launch is exercised by the `mobile` CI job.)
- [x] Bridge runs from source and compiled form on supported macOS architecture.
- [x] Dart and TypeScript validate one shared fixture.
- [x] CI is green. (`bun run all` is green; `.github/workflows/m1-ci.yml` defines the `bridge` and `mobile` jobs that mirror it.)

**Evidence:** CI run, setup transcript, compiled artifact/checksum.

---

# M2 — Protocol schemas and shared fixtures

**Outcome:** Protocol v1 exists as executable schemas/models with Dart/TypeScript parity.

**Dependencies:** M1.

## Tasks

- [x] **M2-01 P0 L** Define TypeBox envelope, handshake, capability, stream, subscription, snapshot, lease, command, event, error, attachment, and export schemas.
- [x] **M2-02 P0 M** Generate JSON Schema and command/event catalogue metadata.
- [x] **M2-03 P0 M** Implement immutable Dart discriminated union and validators.
- [x] **M2-04 P0 M** Implement arbitrary-precision decimal cursor comparison.
- [x] **M2-05 P0 M** Implement canonical semantic command serializer and SHA-256 input.
- [x] **M2-06 P0 L** Add valid fixture for every command/event/response/error.
- [x] **M2-07 P0 L** Add invalid/boundary/unknown optional/required-capability fixtures.
- [x] **M2-08 P0 M** Add host/session replay, gap, conflicting duplicate, and multipart snapshot fixtures.
- [x] **M2-09 P0 M** Add lease acquire/reclaim/takeover/expiry fixtures.
- [x] **M2-10 P0 M** Add command duplicate/conflict/indeterminate and queue fixtures.
- [x] **M2-11 P0 M** Add attachment/export/dialog/pagination boundary fixtures.
- [x] **M2-12 P0 S** Fail CI on generated schema/catalogue/fixture drift.

## Checkpoint demo

Dart and TypeScript accept all valid fixtures, reject all invalid fixtures, and produce identical canonical payload hashes.

## Exit criteria

- [x] No cursor is a JSON number.
- [x] Every mutation declares lease/idempotency/recovery behaviour.
- [x] Every event declares host/session stream ownership.
- [x] Cross-language fixture suite passes.
- [x] Schema package contains no bridge business logic.

**Evidence:** fixture matrix and generated schema/catalogue.

---

# M3 — Real Pi RPC adapter proven

**Outcome:** A strict tested adapter controls exact Pi `0.80.6` without leaking upstream shapes into mobile protocol.

**Dependencies:** M2.

## Tasks

- [x] **M3-01 P0 M** Implement incremental LF JSONL splitter and bounded decoder.
- [x] **M3-02 P0 M** Add UTF-8/chunk/U+2028/U+2029/property/fuzz coverage.
- [x] **M3-03 P0 M** Implement response-ID correlation, stdin backpressure, timeout, and cancellation.
- [x] **M3-04 P0 M** Launch Pi directly with absolute executable, cwd, explicit PATH/env allowlist, process group, stdout/stderr separation.
- [x] **M3-05 P0 L** Map prompt/steer/follow-up/abort/new-session and lifecycle events.
- [x] **M3-06 P0 L** Map state/messages/entries/tree/model/thinking/modes/stats/commands.
- [x] **M3-07 P0 L** Map retry/compaction/session name/switch/fork/clone/export.
- [x] **M3-08 P0 L** Map built-in tools, parallel calls, errors, cancellation, and updates.
- [x] **M3-09 P0 L** Map interactive/presentation extension UI.
- [x] **M3-10 P0 M** Implement bounded redacted stderr diagnostics and process cleanup.
- [x] **M3-11 P0 L** Build sanitized real Pi session fixture corpus.
- [x] **M3-12 P0 M** Test missing/corrupt/incompatible sessions and extension-cancelled lifecycle operations.

## Checkpoint demo

A CLI harness drives a real Pi process through a prompt/tool/session cycle and reaches `agent_settled`.

## Exit criteria

- [x] Exact real Pi contract suite passes.
- [x] `agent_settled` is the only idle boundary.
- [x] Hostile shell startup files cannot corrupt RPC.
- [x] Adapter exports normalized domain types only.
- [x] Compatibility manifest contains exact executable and upstream evidence.

**Evidence:** real-binary report and sanitized fixtures.

---

# M4 — Durable bridge core and replay streams

**Outcome:** Bridge durably accepts commands, journals host/session streams, resumes cursors, and fails closed.

**Dependencies:** M2, M3.

## Tasks

- [x] **M4-01 P0 L** Implement SQLite schema/migrations/foreign keys/WAL/busy handling.
- [x] **M4-02 P0 M** Implement stable host ID and host generation.
- [x] **M4-03 P0 M** Implement `/healthz`, `/readyz`, and `/v1/ws` handshake/capabilities/limits.
- [x] **M4-04 P0 L** Implement host/session event streams and atomic cursor allocation.
- [x] **M4-05 P0 L** Implement subscriptions, replay, current state, and atomic multipart snapshots.
- [x] **M4-06 P0 M** Implement cursor ack, gap/conflict repair, and independent stream isolation.
- [x] **M4-07 P0 L** Implement durable command acceptance and semantic payload hashing.
- [x] **M4-08 P0 M** Implement duplicate current-state receipt and conflict rejection.
- [x] **M4-09 P0 M** Implement accepted-before-dispatch recovery and running-to-indeterminate recovery.
- [x] **M4-10 P0 M** Implement host/session command lanes.
- [x] **M4-11 P0 M** Implement controller lease persistence primitives.
- [x] **M4-12 P0 M** Implement size/rate/backpressure/slow-consumer handling.
- [x] **M4-13 P0 M** Add DB full/read-only/locked/corruption/backup/restore tests.

## Checkpoint demo

A test client loses an accepted-command receipt, reconnects, resends, and observes one dispatch plus ordered replay.

## Exit criteria

- [x] No acceptance without committed command/event.
- [x] Duplicate resend proves one dispatch.
- [x] Host/session replay survives bridge restart.
- [x] Expired cursor uses correct atomic snapshot baseline.
- [x] Database unavailable/full rejects new commands.

**Evidence:** bridge integration and database-transition report.

---

# M5 — One-session end-to-end diagnostic client

**Outcome:** Plain Flutter client controls one real Pi session through bridge and recovers after disconnect/app restart.

**Dependencies:** M4.

## Tasks

- [x] **M5-01 P0 L** Implement mobile connection/handshake/synchronization state machine.
- [x] **M5-02 P0 M** Implement Drift schema/migrations for host/session/events/cursors/drafts.
- [x] **M5-03 P0 M** Implement ordered event reducer, deduplication, gaps, snapshots, host generation reset.
- [x] **M5-04 P0 M** Add manual endpoint and connection/version/readiness screen.
- [x] **M5-05 P0 M** Add one configured workspace/session flow.
- [x] **M5-06 P0 M** Add raw normalized transcript/event list.
- [x] **M5-07 P0 M** Add text draft, submit/receipt/error restoration, and abort.
- [x] **M5-08 P0 S** Disable offline send while retaining draft.
- [x] **M5-09 P0 M** Implement foreground reconnect and app process restart recovery.
- [x] **M5-10 P0 M** Run real prompt/abort/lost receipt/mid-stream disconnect proofs.

## Checkpoint demo

On simulator or phone: connect, submit to real Pi, stream, abort, disconnect, restart app, and reconcile without duplicate execution.

## Exit criteria

- [x] Real prompt completes and abort works.
- [x] Lost receipt produces one dispatch.
- [x] Replay reaches identical settled state.
- [x] Draft clears only after accepted/current receipt.
- [x] Offline draft never auto-sends.

**Evidence:** [`M5-SUMMARY.md`](M5-SUMMARY.md), real-Pi bridge tests, durable replay tests, and Flutter persistence/coordinator/widget tests.

---

# M6 — Failure recovery and process supervision

**Outcome:** Pi/bridge/host/storage/network failures and resource limits produce truthful durable states.

**Dependencies:** M5.

## Tasks

- [x] **M6-01 P0 L** Implement process state machine and process-group cleanup.
- [x] **M6-02 P0 M** Implement restart window/crash loop/manual retry.
- [x] **M6-03 P0 M** Implement active capacity and 30-minute eligible idle stop.
- [x] **M6-04 P0 M** Implement graceful host drain/shutdown/reboot restoration.
- [x] **M6-05 P0 L** Add test-only deterministic faults for receipt, dispatch, output pause, Pi/bridge kill, cursor, output, provider, DB, storage, notification, cleanup.
- [x] **M6-06 P0 M** Implement visible crash/indeterminate/crash-loop/provider interruption states.
- [x] **M6-07 P0 M** Implement oversized output truncation/digest metadata.
- [x] **M6-08 P0 M** Prove slow consumer disconnect/replay while Pi continues.
- [x] **M6-09 P0 S** Prove fault controls absent/unreachable in release build.

## Checkpoint demo

Run the deterministic P0 failure matrix; every case ends in settled, failed, aborted, or indeterminate truth without silent repetition.

## Exit criteria

- [x] No indeterminate action auto-reruns.
- [x] No running/attention session is evicted.
- [x] Process cleanup and diagnostics are bounded/redacted.
- [x] Full failure matrix passes.

**Evidence:** [`M6-SUMMARY.md`](M6-SUMMARY.md) and [`M6-FAULT-MATRIX.md`](M6-FAULT-MATRIX.md).

---

# M7 — macOS install, Serve pairing, and doctor

**Outcome:** A clean macOS 13+ user installs, starts, pairs, diagnoses, updates, rolls back, and uninstalls bridge.

**Dependencies:** M6.

## Tasks

- [x] **M7-01 P0 L** Produce supported architecture compiled release artifact/manifest/checksums/licenses.
- [x] **M7-02 P0 M** Install owner-only state/secrets/log directories and versioned config.
- [x] **M7-03 P0 M** Configure absolute Pi path, PATH, allowlisted environment, optional owner-only env file.
- [x] **M7-04 P0 M** Install user LaunchAgent and verify reboot lifecycle.
- [x] **M7-05 P0 L** Configure/verify persistent Tailscale Serve to loopback while preserving unrelated routes.
- [x] **M7-06 P0 M** Detect/reject Funnel/public/wildcard/plain-LAN endpoints.
- [x] **M7-07 P1 M** Implement QR in CLI/Pi extension and mobile camera scan.
- [x] **M7-08 P1 S** Implement manual endpoint and forget/re-pair recovery.
- [x] **M7-09 P0 L** Implement doctor versions/config/Serve/DB/backup/Pi/environment/process/storage/push checks.
- [x] **M7-10 P0 M** Implement redacted report.
- [x] **M7-11 P0 L** Implement explicit update/backup/migrate/verify/rollback flows.
- [x] **M7-12 P0 M** Implement uninstall retain-data/remove-state/full variants.

## Checkpoint demo

Fresh macOS 13+ account installs bridge, scans QR, opens ready host dashboard, then performs update/rollback/uninstall rehearsal.

## Exit criteria

- [x] Hermetic fresh-install/restart/pair rehearsal passes; destructive clean-account reboot remains a release ceremony.
- [x] Compiled executable ignores adjacent `.env`/`bunfig.toml`.
- [x] Doctor identifies expected failures without secrets.
- [x] Rollback preserves or resets host generation correctly.
- [x] Uninstall preserves Pi sessions by default.

**Evidence:** [`M7-SUMMARY.md`](M7-SUMMARY.md) and [`docs/evidence/m7-install-doctor-report.json`](docs/evidence/m7-install-doctor-report.json).

---

# M8 — Workspaces, trust, and read-only policy

**Outcome:** Mobile selects allowed roots, reviews Pi project resources, and host enforces Full/Read-only policy.

**Dependencies:** M7.

## Tasks

- [x] **M8-01 P0 M** Implement workspace root IDs/config/canonicalization.
- [x] **M8-02 P0 M** Implement recents and cancellable bounded-depth directory-name search.
- [x] **M8-03 P0 M** Reject symlink/path escapes and expose root-relative display paths.
- [x] **M8-04 P0 L** Implement pinned-Pi trust resource discovery/manifest/fingerprint/policy version.
- [x] **M8-05 P0 M** Implement approval/change invalidation persistence.
- [x] **M8-06 P0 L** Implement read-only host extension blocking write/edit/mutating bash/package/destructive/unknown tools.
- [x] **M8-07 P0 S** Snapshot policy at turn start.
- [x] **M8-08 P1 L** Build workspace picker, unavailable states, trust review, Full/Read-only choices, persistent indicator.
- [x] **M8-09 P0 M** Add traversal/symlink/trust/policy integration suite.

## Checkpoint demo

Approve a new repository, run Full mode, switch to Read-only, and observe host-side mutation denial.

## Exit criteria

- [x] Picker cannot select outside roots.
- [x] Changed trust resources block new process start until approval.
- [x] Read-only mutation is host-enforced.
- [x] UI makes no sandbox claim.

**Evidence:** [`M8-SUMMARY.md`](M8-SUMMARY.md) and [`docs/evidence/m8-trust-policy-report.json`](docs/evidence/m8-trust-policy-report.json).

---

# M9 — Production transcript, tools, and composer

**Outcome:** Scalable accessible one-session agent transcript and reliable composer.

**Dependencies:** M8.

## Tasks

- [x] **M9-01 P1 L** Implement stable turn/item transcript domain model.
- [x] **M9-02 P1 M** Implement reasoning active/completed/absent states.
- [x] **M9-03 P1 L** Implement read/bash/edit/write/grep/find/ls tool cards.
- [x] **M9-04 P1 M** Implement parallel tool grouping and unknown generic tools.
- [x] **M9-05 P1 M** Implement tool errors/cancellation/truncation/large-output viewer.
- [x] **M9-06 P1 M** Implement Markdown final answer and safe selection/copy/link behaviour.
- [x] **M9-07 P1 M** Implement history paging, stable keys, anchor preservation, jump-to-latest.
- [x] **M9-08 P0 M** Isolate active streaming paint and profile 1,000 items.
- [x] **M9-09 P1 M** Implement multiline draft, accepted/error restoration, idle send, explicit steer/follow-up, observer/read-only/offline states.
- [x] **M9-10 P1 S** Implement accessible abort and significant-state announcements.

## Checkpoint demo

A long real session streams reasoning and parallel tools, truncates huge output, remains scrollable, and preserves drafts across errors/reconnect.

## Exit criteria

- [x] Real built-in tools render correctly.
- [x] Maximum output does not freeze UI.
- [x] Long-session performance target passes.
- [x] Text scale/reduced-motion baseline passes.
- [x] Unaccepted draft is never lost.

**Evidence:** [`M9-SUMMARY.md`](M9-SUMMARY.md) and [`docs/evidence/m9-transcript-profile-report.json`](docs/evidence/m9-transcript-profile-report.json).

---

# M10 — Models, context, retry, compaction, and commands

**Outcome:** Useful Pi controls exposed without mobile provider-account management.

**Dependencies:** M9.

## Tasks

- [x] **M10-01 P1 M** List/configured model state and unavailable restored model UX.
- [x] **M10-02 P1 M** Model/thinking set with valid runtime-state restrictions.
- [x] **M10-03 P1 S** Session tokens/cost/context with unknown/null states and advisory thresholds.
- [x] **M10-04 P1 M** Auto-retry state, retry countdown/count, abort retry.
- [x] **M10-05 P1 M** Manual/auto compaction state and summary transition.
- [x] **M10-06 P1 M** Steering/follow-up mode state where supported.
- [x] **M10-07 P1 M** Discover/categorize/search/invoke skills, templates, extension commands.
- [x] **M10-08 P1 S** Exclude unsupported TUI-only commands.

## Checkpoint demo

Switch eligible model/thinking, inspect stats, trigger compaction/retry controls, and invoke discovered commands against real Pi.

## Exit criteria

- [x] Every control is durable and replayable.
- [x] Restored state matches Pi.
- [x] Unsupported/unavailable capabilities are explicit.
- [x] Retry/compaction cannot create false settled state.

**Evidence:** [`M10-SUMMARY.md`](M10-SUMMARY.md) and the real/fake Pi control suites.

---

# M11 — Multi-session control and controller leases

**Outcome:** Three sessions run/stop independently through one socket and one installation safely controls each.

**Dependencies:** M10.

## Tasks

- [x] **M11-01 P0 L** Host stream session summary add/change/remove events.
- [x] **M11-02 P1 M** Paginated list/search/filter/sort/attention states.
- [x] **M11-03 P0 M** One full plus bounded summary subscriptions.
- [x] **M11-04 P0 L** Lease acquire/renew/reclaim/release/takeover/expiry/stale connection.
- [x] **M11-05 P0 M** DB uniqueness/race and multi-client stress tests.
- [x] **M11-06 P1 M** Observer/take-control/draft-preservation UX.
- [x] **M11-07 P0 M** Three-process capacity, eligible LRU eviction, no-victim error.
- [x] **M11-08 P0 M** Idle stop and lazy restore.
- [x] **M11-09 P1 M** Fast session switcher/subscription/cursor/background badges.

## Checkpoint demo

Run three sessions, hit capacity, idle-stop/restore one, switch foreground detail, and explicitly take control from another app instance.

## Exit criteria

- [x] One socket tracks all summaries.
- [x] Three sessions progress independently.
- [x] Dual controller cannot occur.
- [x] Capacity/eviction policy passes.
- [x] No cross-session event application.

**Evidence:** multi-client/session report.

---

# M12 — Session tree, fork, clone, delete, and restore

**Outcome:** Branching and durable lifecycle are complete/recoverable.

**Dependencies:** M11.

## Tasks

- [x] **M12-01 P1 M** Create/resume/name/details/lineage and fallback names.
- [x] **M12-02 P1 M** Normalize/lazily render session tree.
- [x] **M12-03 P1 M** Eligible fork-message selection/confirmation.
- [x] **M12-04 P1 M** Fork and extension-cancel handling.
- [x] **M12-05 P1 M** Clone and extension-cancel handling.
- [x] **M12-06 P0 M** Map/snapshot new session before navigation.
- [x] **M12-07 P0 L** Soft delete active-state/queue/process/Pi session handling.
- [x] **M12-08 P0 M** Seven-day restore and purge date UX.
- [x] **M12-09 P0 M** Partial `delete_failed` repair.
- [x] **M12-10 P0 M** Irreversible explicit purge and non-reused IDs.

## Checkpoint demo

Name, inspect tree, fork, clone, soft-delete, restore, and exercise extension cancellation and partial-delete repair.

## Exit criteria

- [x] Fork/clone branch correctness proven.
- [x] Cancellation leaves original unchanged.
- [x] Delete is recoverable for seven days.
- [x] Partial failure is visible/repairable.

**Evidence:** lifecycle fixture matrix.

---

# M13 — Attachments, export, and OS sharing

**Outcome:** Images and exports cross private transport safely with explicit bounded sharing.

**Dependencies:** M12.

## Tasks

- [x] **M13-01 P1 M** Mobile JPEG/PNG picker, metadata strip, resize, count/byte validation.
- [x] **M13-02 P0 L** Multipart streaming upload, client upload idempotency, random private storage.
- [x] **M13-03 P0 M** Magic/decode/dimension/digest/malformed/decompression limits.
- [x] **M13-04 P0 M** Prompt attachment availability/reference/queue retention/cleanup.
- [x] **M13-05 P0 M** Pi image mapping only at dispatch boundary.
- [x] **M13-06 P1 M** Host-side Pi HTML export and opaque export ID.
- [x] **M13-07 P1 M** Private bounded download/expiry/content-disposition.
- [x] **M13-08 P1 M** Mobile progress/download/OS share and privacy warning.
- [x] **M13-09 P0 S** Prove no public URL generation.

## Checkpoint demo

Retry an image upload, complete image prompt, expire an orphan, export HTML, and invoke platform share sheet.

## Exit criteria

- [x] Malformed/oversized image fixtures reject safely.
- [x] Retry does not duplicate storage.
- [x] Queue-retained attachment survives.
- [x] Expired IDs are unavailable/cleaned.
- [x] Sharing is explicit.

**Evidence:** attachment security suite and device share demo.

---

# M14 — Extension UI and durable follow-up queue

**Outcome:** User interaction survives disconnects and queued work is inspectable/removable before dispatch.

**Dependencies:** M13.

## Tasks

- [x] **M14-01 P0 L** Durable FIFO queue state, positions, events, max ten.
- [x] **M14-02 P0 M** Add/remove/clear/dispatch transitions and attachment references.
- [x] **M14-03 P0 M** Queue restart recovery and settle-triggered dispatch.
- [x] **M14-04 P1 M** Queue UI/remove/clear; reorder only if fully transactional.
- [x] **M14-05 P0 L** Persist select/confirm/input/editor requests and upstream mapping.
- [x] **M14-06 P0 M** Normalize notify/status/widget/title/editor prefill.
- [x] **M14-07 P0 M** Expiry/cancel/orphan/reconnect replay/duplicate response.
- [x] **M14-08 P1 L** Native sheets with focus/keyboard/accessibility.
- [x] **M14-09 P1 S** Preserve expired typed input locally for copy; never send it.

## Checkpoint demo

Queue/remove prompts and answer dialogs after reconnect; let one expire without any invented response.

## Exit criteria

- [x] Queue survives restart.
- [x] Removed item never dispatches.
- [x] Valid dialog replays after disconnect.
- [x] Expired dialog gets no default.
- [x] Accessibility focus passes.

**Evidence:** queue/dialog fault matrix.

---

# M15 — Notifications and background experience

**Outcome:** Host continues work and phone receives privacy-preserving best-effort status with authoritative foreground reconciliation.

**Dependencies:** M14.

## Tasks

- [x] **M15-01 P1 M** Device installation/token register/replace/unregister and permanent rejection cleanup.
- [x] **M15-02 P1 M** Host APNs token authentication adapter (deterministic coverage retained; Apple activation deferred).
- [x] **M15-03 P1 M** Host FCM HTTP v1 adapter.
- [x] **M15-04 P0 M** Settled/failed/indeterminate/attention/crash-loop status policy.
- [x] **M15-05 P0 S** Status-only/default-generic payload allowlist.
- [x] **M15-06 P1 M** Coalescing/rate limiting/stale deep-link reconciliation.
- [~] **M15-07 P1 L DEFERRED** iOS permission, APNs, Live Activity start/update/end/stale cleanup. Apple-product testing was explicitly removed from the foreseeable product scope on 2026-07-14.
- [x] **M15-08 P1 L** Android permission/channel, FCM, user-enabled foreground service started while visible.
- [x] **M15-09 P0 S** No mutating notification actions.
- [x] **M15-10 P0 M** Prove push/network failure never blocks Pi and foreground reconciliation works.

## Checkpoint demo

Background a real Android device, receive a real FCM status, open into reconciled state, and exercise the user-enabled foreground service. Apple APNs/Live Activity activation remains deferred.

## Exit criteria

- [x] Real Android FCM device test passes; Apple APNs device testing is deferred by product scope.
- [x] No transcript/path/tool content appears by default.
- [x] Stale notification never appears as current truth.
- [x] No guaranteed socket/push claim.
- [x] Agent use survives push degradation.

**Evidence:** real-device lifecycle matrix.

---

# M16 — Mobile product UX, visual system, and workflow integration

**Outcome:** The mobile app presents one coherent original product identity with a Linear-grade information-density grammar, GitHub-grade agent UX patterns, and Claude-grade transcript readability, anchored by a normative design-token system and navigation contract so M17 hardening and M18 release ship on a consistent foundation.

**Dependencies:** M15.

## Visual and navigation contract (summary)

- **Linear-grade grammar:** compact session/list rows, restrained chrome, focused content surfaces, calm and quiet typography hierarchy, no decorative chrome competing with content. Density earns its keep; spacing is tokenized.
- **GitHub-grade agent UX:** unambiguous primary action, secondary actions in overflow, status pills and progress surfaces, transparent state and activity, discoverable command/skill surface, no hidden mutating affordances.
- **Claude-grade readability:** legible transcript typography with generous line height, clear hierarchy between user/assistant/reasoning/tool surfaces, focused final-answer region with safe selection/copy/link behaviour, no animation competing with reading.
- **Original non-derivative identity:** the visual system is original; no third-party logo, illustration set, marketing imagery, or trademarked glyph is reused. Inspiration is structural, not asset-level.
- **Navigation contract:** root-stack navigation with predictable platform back; modal sheets for transient choices; bottom-sheet detail for session/host context; deep links resolve to host, then session, then reconcile before rendering.
- **Motion grammar:** reduced-motion baseline by default; semantic transitions only; tokenized durations and curves; no typewriter/pulse/decorative animation when a status pill or static label communicates the same fact.

The full visual system, motion grammar, and navigation contract live in [`docs/UX.md`](docs/UX.md) and [`docs/IMPLEMENTATION_DEFAULTS.md`](docs/IMPLEMENTATION_DEFAULTS.md). New product-shell work uses the token layer; M16 retains full-screen migration and enforcement as explicit remaining work.

## Tasks

- [x] **M16-01 P0 M** Define and commit the first design-token system (light/dark themes, semantic status colors, spacing, radius, and reduced-motion-aware timing) and publish its rules in `docs/IMPLEMENTATION_DEFAULTS.md`. High-contrast activation remains in M17 hardening.
- [x] **M16-02 P0 L** Implement Linear-style information-density grammar across host dashboard, session list, workspace picker, queue, and settings (compact rows, restrained chrome, calm typography hierarchy). `StatusPill` / `SessionStatePill` provide one compact state grammar in the app bar and saved-chat rows, while the existing tokenized workspace, queue, and settings surfaces retain restrained row density.
- [x] **M16-03 P0 M** Implement GitHub-style agent UX primitives (unambiguous primary action, secondary actions in overflow, status pills, progress surfaces, command/skill discoverability, transparent activity, no hidden mutating affordances). The app bar exposes the controller role, runtime state, search, and an explicit Commands and skills sheet; progress surfaces use shared motion-aware primitives.
- [x] **M16-04 P0 M** Implement Claude-style transcript readability (legible type, generous line height, clear user/assistant/reasoning/tool hierarchy, focused final-answer surface, safe selection/copy/link behaviour).
- [x] **M16-05 P0 L** Document and implement the paired Sessions/Activity/Host destination contract, keep transient choices in sheets/dialogs, preserve deep-link reconciliation, and cover destination switching plus narrow layouts with widget tests.
- [x] **M16-06 P0 M** Migrate every existing screen to the token system; remove ad-hoc spacing, colour, radius, and elevation values; add a token-only lint that fails CI on non-token visual constants.
  - [x] M16-06a: token-only lint shipped (`scripts/token-lint.ts` + `scripts/test/token-lint.test.ts`) and wired into `bun run all`; the lint scans `apps/mobile/lib/src/ui/**` and exits non-zero on any non-token padding/radius/letter-spacing/hex-color literal. The daily-ui subtree is token-pure as of this checkpoint.
  - [x] M16-06b: the lint now scans 71 Dart files across UI, transcript widgets, controls, sessions, session tree, attachments, interaction, workspaces, and pairing; migrated visual constants use `PiSpacing` / `PiRadius` / semantic theme colors.
- [x] **M16-07 P0 M** Define and apply the motion grammar (tokenized duration/curve tokens, reduced-motion baseline, semantic transitions only); remove decorative animation; prove reduced-motion removes every pulse/typewriter/spinner where a status pill suffices. `PiCurve`, `MotionSpinner`, `MotionProgressBar`, and `MotionCrossfade` collapse continuous motion under `MediaQuery.disableAnimations`, with widget coverage for normal and reduced-motion modes.
- [ ] **M16-08 P0 M** Add accessibility semantics (label, role, state, focus order, visible focus ring) for every new visual primitive; prove light/dark + 100/150/200% text-scale baselines and TalkBack primary journeys on a real Android phone. Locally verifiable implementation is complete: shared primitives expose semantics, `FocusRing` provides a visible indicator, and widget tests cover focus, light/dark, reduced motion, and 100/150/200% text scale. **Evidence blocker:** on 2026-07-20 `adb devices -l` returned no devices and `flutter devices` listed only macOS and Chrome, so the required real-Android TalkBack walkthrough, screenshots, frame captures, and transcripts remain unverified and are not claimed.

## Checkpoint demo

On a real Android phone, walk onboarding → host dashboard → workspace picker → session list → transcript → composer → queue → settings → diagnostics with TalkBack enabled, 200% text scale, and reduced motion on. The visual system reads as one coherent product; navigation is predictable; transcript stays readable through a long session; the design-token lint passes; Apple physical-device demo is deferred by product scope.

## Exit criteria

- [ ] Design-token system is normative and consumed by every screen; CI lint blocks non-token visual constants.
- [ ] Navigation contract is documented in [`docs/UX.md`](docs/UX.md) and covered by automated widget tests for every primary screen.
- [ ] Light, dark, and high-contrast themes pass at 100%, 150%, and 200% text scale on Android phone.
- [ ] TalkBack completes every primary journey on Android without missing semantics or stuck focus.
- [ ] Reduced motion removes decorative animation; semantic transitions remain.
- [ ] No third-party chat UI framework and no third-party visual asset library is introduced.
- [ ] No visual element is derivative of an external product trademark or identity.
- [ ] Android-only physical-device evidence (screenshots, frame captures, TalkBack transcripts) is retained; Apple physical-device evidence remains deferred.

**Current honest boundary (2026-07-20):** all locally verifiable M16 implementation and automated validation pass (`bun run all`, including 347 Flutter tests, plus a separate `flutter test` run). M16 remains active solely because the acceptance contract requires a real Android phone with TalkBack, 200% text scale, and reduced motion for the checkpoint demo and retained evidence bundle; no Android device is currently connected.

**Evidence:** Android visual-system evidence bundle (screenshots, frame captures, TalkBack transcripts, reduced-motion captures) and the token/navigation contract entries in [`docs/UX.md`](docs/UX.md) and [`docs/IMPLEMENTATION_DEFAULTS.md`](docs/IMPLEMENTATION_DEFAULTS.md).

---

# M17 — Accessibility, performance, privacy, and operations hardening

**Outcome:** Full MVP meets release-quality nonfunctional gates.

**Dependencies:** M16.

## Tasks

- [ ] **M17-01 P0 L** VoiceOver/TalkBack primary journeys on Android (Apple iOS journeys remain deferred by product scope).
- [ ] **M17-02 P0 M** Switch/keyboard/Voice Control critical actions.
- [ ] **M17-03 P0 M** 200% text, reduced motion, contrast, focus, non-colour status.
- [ ] **M17-04 P0 L** Streaming/scroll/tool output/multi-session performance profiling.
- [ ] **M17-05 P0 M** Memory/file descriptor/disk/reconnect/session soak.
- [ ] **M17-06 P0 M** Mobile cache/journal/log/attachment/export retention bounds.
- [ ] **M17-07 P0 M** Mobile backup exclusions/app-switcher snapshot review.
- [ ] **M17-08 P0 M** Log/diagnostic/notification/artifact secret-content tests.
- [ ] **M17-09 P0 M** Traversal/symlink race/lease/idempotency concurrency stress.
- [ ] **M17-10 P0 L** Daily backup/restore/host generation/retention/repair.
- [ ] **M17-11 P0 M** Lost-phone token removal and incident procedures.
- [ ] **M17-12 P0 L** Update/rollback rehearsal and clean-host recovery.

## Checkpoint demo

Complete full journey on a real Android phone with screen readers, 200% text, reduced motion, long sessions, network transitions, backup/restore, and redacted diagnostics. Apple iOS physical-device demo remains deferred by product scope.

## Exit criteria

- [ ] Accessibility gates pass on representative Android devices; Apple iOS device evidence remains deferred.
- [ ] No performance/resource-bound failure remains.
- [ ] Privacy/security release gates pass.
- [ ] Backup/restore/update/rollback demonstrated.
- [ ] Known limitations documented.

**Evidence:** Android hardening/recovery report.

---

# M18 — Signed personal MVP release candidate

**Outcome:** Signed private release satisfies every product success criterion from clean host/phone installations.

**Dependencies:** M17.

## Tasks

- [ ] **M18-01 P0 M** Freeze compatible versions/schemas and release manifest.
- [ ] **M18-02 P0 M** Produce signed/checksummed bridge artifact and installer.
- [ ] **M18-03 P0 S DEFERRED** Produce TestFlight iOS build. Apple-product release is explicitly outside the foreseeable product scope; reactivate only if Apple products return to the activated product scope.
- [ ] **M18-04 P0 M** Produce signed Android release build.
- [ ] **M18-05 P0 S** Complete privacy/permission/distribution metadata for the Android release channel.
- [ ] **M18-06 P0 S** Publish install/update/rollback/uninstall/known-issues docs.
- [ ] **M18-07 P0 L** Run all twelve PRODUCT success scenarios on Android.
- [ ] **M18-08 P0 M** Retain CI/protocol/migration/Pi/fault/device/accessibility/performance/security evidence.
- [ ] **M18-09 P0 S** Mark every P0/P1 MVP item Done or explicitly Deferred with owner decision.
- [ ] **M18-10 P0 S** Tag/release checkpoint and retain rollback artifact.

## Checkpoint demo

From clean Android host and Android phone, complete the full acceptance suite without development tools. Apple iOS clean-install rehearsal remains deferred by product scope.

## Exit criteria

- [ ] No release blocker in `docs/RELEASE.md` for the Android release channel.
- [ ] All P0/P1 MVP work is Done or explicitly Deferred.
- [ ] Clean Android install and acceptance suite pass.
- [ ] Owner can operate, diagnose, recover, update, and rollback system.
- [ ] Apple iOS release status is recorded as Deferred by owner decision.

**Evidence:** Android signed release evidence bundle.

---

# Cross-cutting recurring work

Apply whenever relevant.

## C-01 Documentation consistency — P0

- Update normative docs with behaviour changes.
- Generate protocol catalogue from schemas.
- Keep `WORKING.md`, backlog, decisions, and `check.md` current.
- Do not let historical `PLANNING.md` override normative rules.

## C-02 Upstream compatibility — P0

- Review Pi RPC/session/extension changes.
- Run real contract suite on proposed update.
- Update manifest/fixtures only after passing.
- Keep exact tested boundaries.

## C-03 Supply chain — P0

- Exact pins/lockfiles.
- Security/license/lifecycle script/native binary review.
- Verified release checksums/signing metadata.
- No automatic dependency/toolchain adoption.

## C-04 Privacy/logging — P0

- Classify every new field.
- Keep logs/diagnostics metadata-only.
- Keep notifications status-only by default.
- Use explicit allowlists for reports/artifacts.

## C-05 Accessibility — P0

- Semantics/state/actions/focus.
- Text scale/reduced motion/contrast.
- Real screen-reader checks for new critical flows.

## C-06 Performance/bounds — P0

- Define limit before adding queue/cache/output.
- Add boundary/soak tests.
- Measure transcript/transport/storage hot paths.
- Respect platform background policy.

---

# Post-MVP backlog

All are DEFERRED and do not block M18.

- **P3-01 Linux host:** `systemd --user`, Linux paths/secrets/install/rollback/artifacts.
- **P3-02 Windows host:** service/task strategy, Job Objects, installer/signing.
- **P3-03 Sandbox profiles:** Gondolin/OpenShell/container research and per-session selection.
- **P3-04 Confirmation policy:** optional Ask mode with durable mobile approvals/timeouts.
- **P3-05 Multi-user bridge:** new authentication, authorization, tenancy, audit, privacy, controller design.
- **P3-06 Public internet:** identity, authorization, abuse/rate/TLS/security design; Funnel alone is not a plan.
- **P3-07 Public share links:** publication, access, revocation, expiry, content/privacy model.
- **P3-08 Obsidian/stored notes:** Markdown authority, vault access, sync/conflict model.
- **P3-09 Android Termux:** on-device lifecycle/storage/credentials/background/parity.
- **P3-10 Read-only file/diff viewer enhancements:** without becoming terminal/IDE.
- **P3-11 Automatic signed updater:** transactional install/migration/rollback/channel/recovery.
- **P3-12 Public app-store launch:** external onboarding/support/privacy/analytics/auth/store compliance.

---

# Immediate next action

M0 through M15 are complete. M16 is READY; activate mobile product UX, visual system, and workflow integration in `WORKING.md` next.

Do not start accessibility/perf/privacy hardening (M17) or signed release (M18) before the M16 visual system and navigation contract exit. Do not touch Apple iOS release, APNs, or Live Activity hardware before Apple products return to the activated product scope.
