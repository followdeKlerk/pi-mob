# pi-mob backlog

Status: normative delivery plan.

The backlog decomposes the MVP into independently demonstrable checkpoints. A checkpoint is complete only when its exit criteria and evidence pass; partial happy-path UI does not count.

## How to use this backlog

Statuses:

```text
PLANNED   accepted but dependency not complete
READY     dependencies and decisions complete
ACTIVE    current implementation checkpoint
BLOCKED   cannot proceed; blocker recorded
DONE      exit criteria and evidence complete
DEFERRED  intentionally outside current MVP
```

Priorities:

```text
P0 correctness/release blocker
P1 core MVP
P2 valuable hardening or polish
P3 post-MVP
```

Effort is relative only:

```text
S focused change
M multi-component change
L checkpoint-sized change
```

Every task should land with tests and documentation appropriate to its layer.

## Global definition of ready

A task is Ready when:

- its parent checkpoint dependencies are Done,
- required protocol/state shapes are documented,
- no unresolved hard product choice blocks implementation,
- failure behaviour is defined,
- test approach is named,
- external credentials/hardware required for the task are available or the task has a deterministic substitute.

## Global definition of done

A task is Done when:

- implementation matches normative docs,
- applicable format/lint/type/unit/fixture/integration checks pass,
- state changes are durable and duplicate-safe,
- reconnect/failure behaviour is covered,
- logs are redacted,
- accessibility semantics exist for user-facing work,
- no unbounded storage/memory path is introduced,
- documentation and backlog status are updated,
- checkpoint evidence is retained.

---

# MVP checkpoint map

| Checkpoint | Outcome | Depends on | Status |
|---|---|---|---|
| M0 | Specification and upstream contract frozen | — | ACTIVE |
| M1 | Monorepo scaffold and CI foundations | M0 | PLANNED |
| M2 | Protocol schemas and shared fixtures | M1 | PLANNED |
| M3 | Real Pi RPC adapter proven | M2 | PLANNED |
| M4 | Durable bridge core and replay streams | M2, M3 | PLANNED |
| M5 | One-session end-to-end diagnostic client | M4 | PLANNED |
| M6 | Failure recovery and process supervision | M5 | PLANNED |
| M7 | macOS install, Serve pairing, and doctor | M6 | PLANNED |
| M8 | Workspaces, trust, and read-only policy | M7 | PLANNED |
| M9 | Production transcript, tools, and composer | M8 | PLANNED |
| M10 | Models, context, retry, compaction, commands | M9 | PLANNED |
| M11 | Multi-session control and controller leases | M10 | PLANNED |
| M12 | Session tree, fork, clone, delete, restore | M11 | PLANNED |
| M13 | Attachments, export, and OS sharing | M12 | PLANNED |
| M14 | Extension UI and durable follow-up queue | M13 | PLANNED |
| M15 | Notifications and background experience | M14 | PLANNED |
| M16 | Accessibility, performance, privacy hardening | M15 | PLANNED |
| M17 | Personal MVP release candidate | M16 | PLANNED |

---

# M0 — Specification and upstream contract freeze

**Outcome:** The repository contains one consistent implementable specification and a verified dependency baseline.

**Checkpoint demo:** A new contributor can explain the product, state ownership, protocol, failure semantics, and next task without relying on chat history.

### M0.1 Normative document set

- **Priority:** P0
- **Effort:** M
- **Status:** ACTIVE

Tasks:

- [x] Product goals, journeys, requirements, non-goals, and success criteria.
- [x] System components, authority, streams, leases, queues, and state machines.
- [x] Durable host/mobile data model, retention, backup, migration, deletion, and repair.
- [x] Mobile screen and state specification.
- [x] Security/privacy threat model and accepted risks.
- [x] Build, distribution, update, rollback, and operational specification.
- [x] Architecture decision ledger with review triggers.
- [x] Checkpointed implementation backlog.
- [ ] Correct bridge-mobile protocol to match architecture.
- [ ] Reconcile README, WORKING, defaults, testing, and check snapshot.

### M0.2 Upstream Pi compatibility audit

- **Priority:** P0
- **Effort:** M
- **Status:** ACTIVE

Tasks:

- [x] Identify current upstream repository `earendil-works/pi`.
- [x] Identify current package `@earendil-works/pi-coding-agent`.
- [x] Confirm initial version `0.80.6`.
- [x] Review RPC command union and extension UI shapes.
- [x] Confirm strict LF JSONL semantics.
- [x] Confirm `agent_settled` idle semantics.
- [x] Confirm tool-call extension hook can block policy violations.
- [ ] Capture a permanent compatibility manifest containing upstream commit, package integrity, RPC docs hash, and tested executable hash.
- [ ] Enumerate every Pi RPC command/event consumed by MVP and map it to bridge protocol.
- [ ] Verify Pi durable session file discovery/listing/deletion behaviours against real fixtures.
- [ ] Decide and document how project trust-bearing resources are enumerated using the pinned Pi implementation.

### M0.3 Toolchain pin verification

- **Priority:** P0
- **Effort:** S
- **Status:** READY

Tasks:

- [ ] Verify exact Flutter `3.44.4` archive artifact and Dart `3.12.2` pairing.
- [ ] Select and record exact stable Bun version after macOS compatibility check.
- [ ] Record Xcode, CocoaPods/SwiftPM, Android Gradle Plugin, Gradle, JDK, and Android SDK baselines during scaffold.
- [ ] Add a `toolchain.lock.md` or machine-readable version file with sources/checksums where available.
- [ ] Record supported macOS architecture(s) for the first bridge release.

### M0 exit criteria

- [ ] No contradictory normative statements remain.
- [ ] Protocol v1 uses stream IDs and decimal-string cursors.
- [ ] Every MVP capability appears in product, protocol/architecture, testing, and backlog.
- [ ] Every unresolved item is either a backlog task or explicit post-MVP decision.
- [ ] README points to the correct reading order.
- [ ] `WORKING.md` names M1 as the next implementation checkpoint.
- [ ] `check.md` reflects the current docs-first repository.

**Evidence:** documentation link check, manual consistency checklist, upstream compatibility manifest draft.

---

# M1 — Monorepo scaffold and CI foundations

**Outcome:** Empty but buildable Flutter/TypeScript packages with pinned tools and mandatory checks.

**Checkpoint demo:** One root command validates formatting, analysis/typechecking, unit placeholders, and shared fixture loading on both Dart and TypeScript.

### M1.1 Repository structure

- **Priority:** P0
- **Effort:** M
- **Status:** PLANNED

Create:

```text
apps/mobile
packages/bridge
packages/pi-extension
packages/protocol-schema
packages/protocol-fixtures
scripts
```

Tasks:

- [ ] Root package/workspace configuration.
- [ ] Flutter application with iOS/Android platforms and selected deployment floors.
- [ ] Bun/TypeScript package with strict compiler settings.
- [ ] Pi extension package.
- [ ] Protocol schema and fixture packages.
- [ ] Shared root commands for check, test, build, and clean.
- [ ] `.editorconfig`, ignore files, line-ending policy, and generated-file policy.

### M1.2 Quality gates

- **Priority:** P0
- **Effort:** M

Tasks:

- [ ] TypeScript formatter/linter/typecheck.
- [ ] Dart format/analyze/test.
- [ ] Markdown link and backlog-ID validation.
- [ ] Secret scanning.
- [ ] Dependency/license audit baseline.
- [ ] CI cache strategy without caching secrets or mutable release output.
- [ ] Branch protection/check names documented.

### M1.3 Configuration foundations

- **Priority:** P1
- **Effort:** S

Tasks:

- [ ] Versioned TOML config parser/schema.
- [ ] Separate development and release state directories.
- [ ] Test-only fault flag impossible in release configuration.
- [ ] Structured logger interface with redaction-first event fields.
- [ ] Build/version metadata injection.

### M1 exit criteria

- [ ] Fresh checkout setup is documented and reproducible.
- [ ] Root checks pass on macOS.
- [ ] Flutter debug app launches.
- [ ] Bridge hello-world executable runs from source and compiled form.
- [ ] Protocol fixture is loaded and validated by Dart and TypeScript tests.
- [ ] No real protocol or Pi execution is required yet.

**Evidence:** CI run, setup transcript, compiled bridge smoke artifact.

---

# M2 — Protocol schemas and shared fixtures

**Outcome:** Protocol v1 is executable as schemas/models with cross-language fixture parity.

**Checkpoint demo:** TypeScript and Dart independently accept every valid fixture, reject every invalid fixture, and produce semantically identical canonical envelopes.

### M2.1 Canonical schema package

- **Priority:** P0
- **Effort:** L

Tasks:

- [ ] TypeBox definitions for envelope, hello, capabilities, streams, subscriptions, leases, commands, events, snapshots, errors, attachments, and exports.
- [ ] JSON Schema generation checked into or generated during CI.
- [ ] Stable discriminated unions for all initial command/event types.
- [ ] Required-capability declarations.
- [ ] Decimal-string cursor validator and increment boundary tests.
- [ ] RFC 3339 timestamp parser treating client time as informational.
- [ ] Canonical semantic payload serializer/hash input.

### M2.2 Dart protocol models

- **Priority:** P0
- **Effort:** M

Tasks:

- [ ] Immutable Dart model union.
- [ ] Unknown optional event representation.
- [ ] Safe required-capability failure.
- [ ] Cursor comparison/increment without numeric precision loss.
- [ ] Stable error mapping to domain failures.

### M2.3 Fixture corpus

- **Priority:** P0
- **Effort:** L

Tasks:

- [ ] Valid fixture for every command/event.
- [ ] Invalid fixture for every stable error family.
- [ ] Major mismatch and additive minor examples.
- [ ] Unknown optional fields/events.
- [ ] Unknown required capability.
- [ ] Host/session stream gap, duplicate, and snapshot examples.
- [ ] Lease acquire/renew/takeover/loss examples.
- [ ] Duplicate command same/different payload examples.
- [ ] Queue add/remove/dispatch examples.
- [ ] Maximum boundary payloads.
- [ ] Golden canonical payload hashes.

### M2.4 Protocol documentation validation

- **Priority:** P1
- **Effort:** S

Tasks:

- [ ] Generate command/event catalogue from schema metadata.
- [ ] Fail CI when docs catalogue and schema drift.
- [ ] Record protocol compatibility policy in generated artifacts.

### M2 exit criteria

- [ ] Cross-language fixture suite passes.
- [ ] No protocol cursor is represented as a JSON number.
- [ ] Every mutating command declares lease/idempotency behaviour.
- [ ] Every event declares host or session stream ownership.
- [ ] Schema package contains no bridge business logic.

**Evidence:** fixture matrix and generated schema diff.

---

# M3 — Real Pi RPC adapter proven

**Outcome:** A tested adapter controls pinned Pi and translates upstream behaviour without leaking upstream types into mobile protocol.

**Checkpoint demo:** A command-line harness starts real Pi, submits a deterministic provider-backed or controlled test prompt, captures streaming/tool/session events, and settles cleanly.

### M3.1 Strict JSONL transport

- **Priority:** P0
- **Effort:** M

Tasks:

- [ ] LF-only incremental splitter.
- [ ] Trailing CR support.
- [ ] UTF-8 split handling.
- [ ] Multiple/partial records.
- [ ] Bounded malformed-line diagnostics.
- [ ] Backpressure-safe stdin writes.
- [ ] Response ID correlation and timeout policy.
- [ ] Property/fuzz tests including U+2028/U+2029.

### M3.2 Direct process launcher

- **Priority:** P0
- **Effort:** M

Tasks:

- [ ] Absolute executable and cwd.
- [ ] Explicit PATH/environment allowlist.
- [ ] No interactive/login shell.
- [ ] Distinct process group.
- [ ] Stdout protocol reservation and bounded stderr ring.
- [ ] Clean shutdown, timeout, and forced group termination.

### M3.3 Upstream command mapping

- **Priority:** P0
- **Effort:** L

Map and test:

- [ ] prompt, steer, follow_up, abort, new_session.
- [ ] get_state, get_messages, get_entries, get_tree.
- [ ] set/cycle/list model and thinking level.
- [ ] steering/follow-up modes.
- [ ] compact and auto-compaction.
- [ ] auto-retry and abort-retry.
- [ ] stats, commands, session name.
- [ ] switch, fork, clone, fork messages.
- [ ] export HTML.
- [ ] extension UI requests/responses.
- [ ] agent/turn/message/tool/retry/compaction/model events.

### M3.4 Session fixture compatibility

- **Priority:** P0
- **Effort:** M

Tasks:

- [ ] Create sanitized real Pi sessions with text/tool/fork/compaction/retry states.
- [ ] Reopen and snapshot them.
- [ ] Test missing/corrupt/incompatible session files.
- [ ] Verify session naming, listing, switch, fork, clone, export, and deletion adapter assumptions.

### M3 exit criteria

- [ ] Real Pi `0.80.6` contract suite passes.
- [ ] `agent_settled` is the only idle completion boundary.
- [ ] Adapter exposes normalized domain events, not raw Pi types.
- [ ] Pi startup cannot be corrupted by shell profile output.
- [ ] Compatibility manifest includes exact tested upstream commit/executable.

**Evidence:** sanitized RPC fixtures and real-binary contract report.

---

# M4 — Durable bridge core and replay streams

**Outcome:** The bridge durably accepts commands, journals host/session events, resumes cursors, and fails closed.

**Checkpoint demo:** A local WebSocket test client submits a command, loses its acknowledgement, reconnects, resends, and observes one dispatch plus ordered replay.

### M4.1 SQLite schema and migrations

- **Priority:** P0
- **Effort:** L

Tasks:

- [ ] Implement entities/invariants from `docs/DATA_MODEL.md`.
- [ ] WAL, foreign keys, busy timeout, transactions.
- [ ] Migration framework and fixture databases.
- [ ] Online backup and integrity-check primitives.
- [ ] Database-full/read-only/corruption fault paths.

### M4.2 Handshake and connection generation

- **Priority:** P0
- **Effort:** M

Tasks:

- [ ] `/healthz`, `/readyz`, `/v1/ws`.
- [ ] Hello version/capability negotiation.
- [ ] Stable host ID and host generation.
- [ ] Message/schema/size/rate validation.
- [ ] Heartbeat, close codes, reconnect recommendations.

### M4.3 Streams and subscriptions

- **Priority:** P0
- **Effort:** L

Tasks:

- [ ] Mandatory host stream.
- [ ] Session stream creation.
- [ ] Atomic cursor allocation and persist-before-send.
- [ ] `subscription.set` with cursor map.
- [ ] Replay/current/snapshot-required outcomes.
- [ ] Snapshot baseline reset.
- [ ] Gap and duplicate handling.
- [ ] Slow-consumer buffer limit and disconnect.

### M4.4 Idempotent command journal

- **Priority:** P0
- **Effort:** L

Tasks:

- [ ] Canonical semantic payload hash.
- [ ] Acceptance transaction.
- [ ] Duplicate same-payload lookup.
- [ ] Different-payload conflict.
- [ ] Accepted-before-dispatch recovery.
- [ ] Running-at-crash indeterminate transition.
- [ ] Per-host/per-session serialization lanes.

### M4 exit criteria

- [ ] No command acknowledges before durable acceptance.
- [ ] Duplicate-resend suite proves one dispatch.
- [ ] Host and session replay survive bridge restart.
- [ ] Expired cursor snapshot replaces old stream atomically.
- [ ] Database unavailable/full rejects new commands.
- [ ] Logs contain no test prompt/output content by default.

**Evidence:** bridge integration suite and database transition traces.

---

# M5 — One-session end-to-end diagnostic client

**Outcome:** A plain Flutter client drives one real Pi session through the bridge and recovers after disconnect.

**Checkpoint demo:** On simulator or phone, manually connect, select one configured workspace, submit, stream, abort, disconnect, and resume.

### M5.1 Mobile transport/domain

- **Priority:** P0
- **Effort:** L

Tasks:

- [ ] Host connection state machine.
- [ ] Hello/subscription/resume.
- [ ] Drift database and migrations.
- [ ] Ordered event reducer/deduplication.
- [ ] Host/session snapshots.
- [ ] Draft persistence.
- [ ] Immediate foreground reconnect.

### M5.2 Diagnostic UI

- **Priority:** P0
- **Effort:** M

Tasks:

- [ ] Manual endpoint entry.
- [ ] Connection/version/readiness display.
- [ ] One configured workspace/session.
- [ ] Raw normalized event list.
- [ ] Text composer and accepted state.
- [ ] Abort.
- [ ] Stale/disconnected banner.

### M5.3 End-to-end proof

- **Priority:** P0
- **Effort:** M

Tasks:

- [ ] Real bridge and Pi.
- [ ] Real prompt completion.
- [ ] Abort real turn.
- [ ] Disconnect before acknowledgement and resend.
- [ ] Disconnect during stream and replay.
- [ ] App process restart and cache recovery.

### M5 exit criteria

- [ ] One real Flutter client completes and aborts a real Pi turn.
- [ ] Lost acknowledgement produces one dispatch.
- [ ] Ordered replay reaches the same settled transcript.
- [ ] Draft is not cleared before acceptance.
- [ ] Disconnected draft never auto-sends.

**Evidence:** recorded demo and end-to-end test output.

---

# M6 — Failure recovery and process supervision

**Outcome:** Process limits, crashes, host restart, slow clients, and storage failures produce correct durable states.

**Checkpoint demo:** Deterministic fault controls run the failure matrix and the app always shows settled, failed, or indeterminate truthfully.

### M6.1 Process supervisor

- **Priority:** P0
- **Effort:** L

Tasks:

- [ ] Process state machine.
- [ ] Graceful/forced process-group cleanup.
- [ ] Restart window and crash-loop threshold.
- [ ] Three-process default capacity.
- [ ] LRU eligible idle eviction.
- [ ] 30-minute idle stop.
- [ ] Lazy restore.
- [ ] Host draining/shutdown.

### M6.2 Fault injection

- **Priority:** P0
- **Effort:** M

Implement test-only faults:

- [ ] close after acceptance,
- [ ] pause output,
- [ ] kill Pi after N events,
- [ ] kill bridge after transition,
- [ ] corrupt/expire cursor,
- [ ] oversized output,
- [ ] provider interruption,
- [ ] database full,
- [ ] attachment write failure,
- [ ] notification rejection placeholder.

### M6.3 Recovery UX states

- **Priority:** P0
- **Effort:** M

Tasks:

- [ ] Pi crash idle/running.
- [ ] Bridge crash accepted/running.
- [ ] Host reboot.
- [ ] Crash-loop/manual retry.
- [ ] Slow-consumer reconnect.
- [ ] Oversized output truncation.
- [ ] Indeterminate inspection path.

### M6 exit criteria

- [ ] Entire P0 failure matrix passes deterministically.
- [ ] No indeterminate action automatically repeats.
- [ ] No running session is evicted for capacity.
- [ ] Orphan/process cleanup diagnostics are bounded and redacted.
- [ ] Release build cannot enable fault injection.

**Evidence:** fault matrix report.

---

# M7 — macOS install, Serve pairing, and doctor

**Outcome:** A clean supported Mac can install, start, pair, diagnose, update, rollback, and uninstall the host bridge.

**Checkpoint demo:** Fresh-user installation ends with a phone scanning a QR and opening a ready host dashboard.

### M7.1 Release packaging

- **Priority:** P0
- **Effort:** L

Tasks:

- [ ] Compile bridge executable for supported architecture(s).
- [ ] Release manifest/checksums/licenses.
- [ ] LaunchAgent template.
- [ ] Config template/schema.
- [ ] Pi extension bundle.
- [ ] Install/update/rollback/uninstall scripts.

### M7.2 Environment capture/configuration

- **Priority:** P0
- **Effort:** M

Tasks:

- [ ] Absolute Pi path verification.
- [ ] Explicit PATH setup.
- [ ] Allowlisted environment proposal.
- [ ] Optional owner-only env file.
- [ ] Owner-only state/secrets permissions.
- [ ] Validate Pi/provider execution under LaunchAgent environment.

### M7.3 Tailscale Serve

- **Priority:** P0
- **Effort:** M

Tasks:

- [ ] Detect Tailscale/MagicDNS/HTTPS readiness.
- [ ] Configure persistent Serve to loopback.
- [ ] Detect/reject Funnel/public/wildcard/LAN targets.
- [ ] Preserve unrelated Serve configuration.
- [ ] Remove only pi-mob-owned configuration on uninstall.

### M7.4 Pairing

- **Priority:** P1
- **Effort:** M

Tasks:

- [ ] Stable host ID/display name.
- [ ] QR payload and rendering extension/CLI.
- [ ] Camera scan.
- [ ] Manual endpoint fallback.
- [ ] Pair confirmation and compatibility UX.
- [ ] Forget/re-pair behaviour.

### M7.5 Doctor and maintenance

- **Priority:** P0
- **Effort:** M

Tasks:

- [ ] Versions/config/schema.
- [ ] Loopback/Serve.
- [ ] DB integrity/backup age.
- [ ] Pi executable/environment.
- [ ] process/session/crash-loop state.
- [ ] attachment/export paths.
- [ ] notification degraded placeholder.
- [ ] redacted copyable report.

### M7 exit criteria

- [ ] Fresh install and LaunchAgent restart pass.
- [ ] Host reboot restores bridge and stopped session registry.
- [ ] QR pair works through Tailscale Serve.
- [ ] Update and tested rollback preserve host identity/state.
- [ ] Uninstall variants behave as documented.

**Evidence:** clean-machine install checklist and doctor output.

---

# M8 — Workspaces, trust, and read-only policy

**Outcome:** The phone safely selects allowed workspaces, reviews Pi project resources, and enforces Full/Read-only policy host-side.

**Checkpoint demo:** Select a new repository, approve displayed resources, run a Full turn, switch to Read-only, and observe mutating tools blocked.

### M8.1 Workspace roots and discovery

- **Priority:** P0
- **Effort:** L

Tasks:

- [ ] Root configuration/IDs/labels.
- [ ] Canonicalization and symlink escape rejection.
- [ ] Recents from sessions.
- [ ] Incremental cancellable bounded-depth search.
- [ ] Generated-directory exclusions.
- [ ] Missing/moved/permission states.
- [ ] Root-relative path exposure only.

### M8.2 Trust fingerprint

- **Priority:** P0
- **Effort:** L

Tasks:

- [ ] Pinned-Pi resource discovery implementation.
- [ ] Relative manifest and content hashes.
- [ ] Policy version.
- [ ] Added/removed/changed diff.
- [ ] Durable approval and invalidation.
- [ ] New-process pause before changed resources load.

### M8.3 Read-only extension policy

- **Priority:** P0
- **Effort:** L

Tasks:

- [ ] Block write/edit.
- [ ] Classify/block mutating bash.
- [ ] Block package install and deletion paths covered by policy.
- [ ] Allow read/grep/find/ls and safe state commands.
- [ ] Turn policy snapshot.
- [ ] Effective policy event/UI.
- [ ] Unknown tool default policy decision and tests.

### M8.4 Mobile UX

- **Priority:** P1
- **Effort:** M

Tasks:

- [ ] Recents/search picker.
- [ ] Trust review/change screen.
- [ ] Full vs Read-only choice.
- [ ] Unavailable workspace recovery.
- [ ] Persistent read-only indicator.

### M8 exit criteria

- [ ] Picker cannot select outside roots.
- [ ] Resource change triggers approval before process start.
- [ ] Read-only mutation block is host-enforced and tested.
- [ ] UI states do not claim sandbox protection.

**Evidence:** traversal/trust/policy integration suite.

---

# M9 — Production transcript, tools, and composer

**Outcome:** The diagnostic UI becomes a polished, scalable, accessible agent transcript for one session.

**Checkpoint demo:** A long real session streams reasoning, parallel tools, output truncation, final answer, queue state, errors, and abort without scroll jank.

### M9.1 Transcript domain renderer

- **Priority:** P1
- **Effort:** L

Tasks:

- [ ] Stable turn/item model.
- [ ] Reasoning/tool/final separation.
- [ ] Streaming and completion reducers.
- [ ] Unknown event/tool fallback.
- [ ] Older-history paging.
- [ ] Snapshot replacement without duplicate animations.

### M9.2 Tool cards

- **Priority:** P1
- **Effort:** L

Tasks:

- [ ] read/bash/edit/write/grep/find/ls.
- [ ] Parallel grouping.
- [ ] duration/status/error/cancel/truncation.
- [ ] Safe argument/result previews.
- [ ] Unknown extension tool generic card.
- [ ] Selection/copy and large-output virtualized viewer.

### M9.3 Composer

- **Priority:** P1
- **Effort:** M

Tasks:

- [ ] Multiline draft.
- [ ] Accepted/submitting/error restoration.
- [ ] Idle Send.
- [ ] Explicit Steer/Follow-up while running.
- [ ] Offline disabled send.
- [ ] Observer/read-only states.
- [ ] Abort controls.

### M9.4 Scrolling and rendering performance

- **Priority:** P0
- **Effort:** M

Tasks:

- [ ] Near-bottom pinning.
- [ ] Jump-to-latest.
- [ ] Preserve anchor on history load.
- [ ] Repaint isolation for active stream.
- [ ] Stable keys and lazy construction.
- [ ] 1,000-item test fixture/profile.

### M9 exit criteria

- [ ] Real built-in tool shapes render correctly.
- [ ] Maximum tool chunks do not freeze UI.
- [ ] Long-session scrolling passes performance target.
- [ ] Text scaling/reduced-motion baseline passes.
- [ ] Composer never loses an unaccepted draft.

**Evidence:** profile traces, goldens, real session demo.

---

# M10 — Models, context, retry, compaction, and commands

**Outcome:** Mobile exposes Pi's useful session controls without attempting provider-account management.

**Checkpoint demo:** Switch model/thinking while eligible, inspect stats, trigger compaction, observe retry, abort retry, and invoke a discovered skill/template/extension command.

### M10.1 Model and thinking

- **Priority:** P1
- **Effort:** M

Tasks:

- [ ] Available model list/cache.
- [ ] Active/restored/unavailable model states.
- [ ] Supported thinking levels.
- [ ] Safe command-state restrictions.
- [ ] Model/thinking events and snapshots.

### M10.2 Stats and cost

- **Priority:** P1
- **Effort:** S

Tasks:

- [ ] Token/cost/context display.
- [ ] Unknown/null post-compaction states.
- [ ] Advisory threshold UI only.
- [ ] No spend-cap claims.

### M10.3 Retry and compaction

- **Priority:** P1
- **Effort:** M

Tasks:

- [ ] Auto-retry/auto-compaction controls.
- [ ] Retry wait/count/delay state.
- [ ] Abort retry.
- [ ] Manual compaction and summary transition.
- [ ] Failure distinctions.

### M10.4 Command palette

- **Priority:** P1
- **Effort:** M

Tasks:

- [ ] `get_commands` discovery.
- [ ] Categorize skills/templates/extensions.
- [ ] Search and argument/prompt entry.
- [ ] Capability/change refresh.
- [ ] Do not expose unsupported TUI-only commands.

### M10 exit criteria

- [ ] All controls round-trip through durable commands/events.
- [ ] Restored session state matches Pi.
- [ ] Unsupported model/thinking/capability is handled explicitly.
- [ ] Retry/compaction does not cause false settled state.

**Evidence:** real Pi control suite and mobile demo.

---

# M11 — Multi-session control and controller leases

**Outcome:** Multiple durable sessions run/stop independently and one installation safely controls each session.

**Checkpoint demo:** Run three sessions, observe all from one socket, switch foreground detail, hit capacity, idle-stop one, restore it, and take over control from a second app instance.

### M11.1 Host/session summaries

- **Priority:** P0
- **Effort:** L

Tasks:

- [ ] Host stream session summary events.
- [ ] Paginated session list/search/filter.
- [ ] Active/attention/stopped/deleted sorting.
- [ ] Foreground and bounded background subscriptions.
- [ ] Unread/attention reconciliation.

### M11.2 Controller leases

- **Priority:** P0
- **Effort:** L

Tasks:

- [ ] Acquire/renew/reclaim/release.
- [ ] 45-second expiry and 60-second same-install grace.
- [ ] Explicit takeover.
- [ ] Stale connection rejection.
- [ ] Database uniqueness/race tests.
- [ ] Observer UI and draft preservation.

### M11.3 Process capacity

- **Priority:** P0
- **Effort:** M

Tasks:

- [ ] Three concurrent processes.
- [ ] LRU idle eviction.
- [ ] Host-capacity error with active summaries.
- [ ] Never evict running/waiting/queued states.
- [ ] Lazy stopped-session restore.

### M11.4 Session switcher

- **Priority:** P1
- **Effort:** M

Tasks:

- [ ] Fast cached switch.
- [ ] Subscription/cursor transition.
- [ ] Current controller state.
- [ ] Background completion badges.
- [ ] Host/session snapshot fallback.

### M11 exit criteria

- [ ] One socket reliably tracks all active summaries.
- [ ] Three sessions run independently.
- [ ] Dual-client mutation race cannot produce dual controllers.
- [ ] Capacity and idle eviction follow policy.
- [ ] Switching never cross-applies events to another session.

**Evidence:** multi-client/multi-session integration report.

---

# M12 — Session tree, fork, clone, delete, and restore

**Outcome:** Durable session lifecycle and branching are complete and recoverable.

**Checkpoint demo:** Name a session, inspect tree, fork at a user entry, clone current branch, soft-delete, restore, and handle an extension-cancelled operation.

### M12.1 Session metadata/lifecycle

- **Priority:** P1
- **Effort:** M

Tasks:

- [ ] Create/resume/name.
- [ ] Stable generated fallback names.
- [ ] Session details and parent lineage.
- [ ] Corrupt/missing Pi session repair state.

### M12.2 Tree/fork/clone

- **Priority:** P1
- **Effort:** L

Tasks:

- [ ] Tree normalization and lazy rendering.
- [ ] Eligible fork-message list.
- [ ] Fork confirmation and extension cancellation.
- [ ] Clone and extension cancellation.
- [ ] New-session mapping/snapshot before navigation.
- [ ] Idempotent crash handling.

### M12.3 Delete/restore/purge

- **Priority:** P0
- **Effort:** L

Tasks:

- [ ] Active-turn/queue preconditions.
- [ ] Soft delete and seven-day purge date.
- [ ] Stop process and cancel queued follow-ups.
- [ ] Pi session trash/delete adapter.
- [ ] Restore.
- [ ] Partial `delete_failed` repair.
- [ ] Irreversible purge command/maintenance.

### M12 exit criteria

- [ ] Fork/clone produce correct durable branches.
- [ ] Extension cancellation leaves original session unchanged.
- [ ] Delete is recoverable for seven days.
- [ ] Partial failure is visible/repairable.
- [ ] IDs are never reused.

**Evidence:** session lifecycle fixture matrix.

---

# M13 — Attachments, export, and OS sharing

**Outcome:** Images and exports cross the private transport safely with bounded storage and explicit sharing.

**Checkpoint demo:** Upload/retry an image prompt, expire an unused upload, export a session to HTML, and share through the OS sheet.

### M13.1 Mobile image pipeline

- **Priority:** P1
- **Effort:** M

Tasks:

- [ ] Photo picker permissions/UX.
- [ ] JPEG/PNG conversion.
- [ ] Metadata stripping.
- [ ] 2048-pixel resize.
- [ ] Byte/count validation.
- [ ] Local retry state and cleanup.

### M13.2 Host attachment service

- **Priority:** P0
- **Effort:** L

Tasks:

- [ ] Multipart upload streaming/limits.
- [ ] Upload ID idempotency.
- [ ] Magic/decode/dimension checks.
- [ ] Random private storage.
- [ ] SHA-256 and opaque ID.
- [ ] Reference retention and cleanup.
- [ ] Prompt preacceptance validation.
- [ ] Pi base64 image mapping only at dispatch boundary.

### M13.3 Export/download/share

- **Priority:** P1
- **Effort:** M

Tasks:

- [ ] Host-side Pi HTML export.
- [ ] Opaque export IDs.
- [ ] Bounded private download endpoint.
- [ ] 24-hour expiry.
- [ ] Mobile progress/download.
- [ ] OS share sheet and privacy warning.
- [ ] No public URL generation.

### M13 exit criteria

- [ ] Malformed/decompression-bomb fixtures reject safely.
- [ ] Duplicate upload does not duplicate storage.
- [ ] Referenced attachment survives queue delay.
- [ ] Expired attachments/exports are unavailable and cleaned.
- [ ] Sharing is always explicit.

**Evidence:** attachment security suite and device share demo.

---

# M14 — Extension UI and durable follow-up queue

**Outcome:** Pi can request user interaction reliably across mobile disconnects, and follow-up work is inspectable/removable before dispatch.

**Checkpoint demo:** Queue/remove prompts and answer select/confirm/input/editor dialogs after a reconnect; allow one to expire without an invented response.

### M14.1 Durable queue

- **Priority:** P0
- **Effort:** L

Tasks:

- [ ] Queue table/state machine.
- [ ] FIFO positions and events.
- [ ] Add/remove/clear commands.
- [ ] Attachment reference retention.
- [ ] Dispatch only after settled eligibility.
- [ ] Accepted/restart recovery.
- [ ] Queue-full semantics.
- [ ] Optional reorder only if transactionally complete.

### M14.2 Extension dialog persistence

- **Priority:** P0
- **Effort:** L

Tasks:

- [ ] Persist upstream request mapping.
- [ ] select/confirm/input/editor.
- [ ] notify/status/widget/title/editor-prefill.
- [ ] expiry/cancel/orphan state.
- [ ] Duplicate-safe response.
- [ ] Reconnect replay.
- [ ] Process crash/abort cleanup.

### M14.3 Mobile queue/dialog UX

- **Priority:** P1
- **Effort:** L

Tasks:

- [ ] Queue screen and remove/clear confirmations.
- [ ] Native modal sheets and focus/keyboard handling.
- [ ] Expiry presentation.
- [ ] Typed text preservation after expiry for copying.
- [ ] Bounded extension widgets/status.

### M14 exit criteria

- [ ] Queue survives bridge restart.
- [ ] Removed item is never dispatched.
- [ ] Dialog survives phone disconnect until expiry.
- [ ] Expired dialog never receives default input.
- [ ] Accessibility focus is correct.

**Evidence:** queue/dialog crash/reconnect matrix.

---

# M15 — Notifications and background experience

**Outcome:** The host continues work and the phone receives privacy-preserving best-effort status while always reconciling on foreground.

**Checkpoint demo:** Lock/background both platforms during a turn; receive settled/attention/error state; open into reconciled session; exercise Live Activity and Android foreground mode.

### M15.1 Device registration and providers

- **Priority:** P1
- **Effort:** L

Tasks:

- [ ] Installation/token registration/replacement.
- [ ] APNs token auth.
- [ ] FCM HTTP v1.
- [ ] Key/credential host storage.
- [ ] Permanent invalid-token cleanup.
- [ ] Provider redacted diagnostics.

### M15.2 Notification policy

- **Priority:** P0
- **Effort:** M

Tasks:

- [ ] Settled/failed/indeterminate/attention/crash-loop only.
- [ ] Status-only/default generic payloads.
- [ ] Coalescing and rate limiting.
- [ ] Stale deep-link reconciliation.
- [ ] No mutating notification actions.
- [ ] Host-offline/public-internet-unavailable behaviour.

### M15.3 iOS

- **Priority:** P1
- **Effort:** L

Tasks:

- [ ] Notification permission/registration.
- [ ] APNs environment/topic.
- [ ] ActivityKit attributes/content state.
- [ ] Start/update/end lifecycle.
- [ ] App/host crash and stale activity cleanup.
- [ ] Foreground reconnect.

### M15.4 Android

- **Priority:** P1
- **Effort:** L

Tasks:

- [ ] Notification permission/channels.
- [ ] FCM foreground/background handling.
- [ ] User-enabled foreground service started while visible.
- [ ] Service notification and stop controls.
- [ ] Wi-Fi/cellular/lock lifecycle.
- [ ] Treat high-priority FCM as best effort.

### M15 exit criteria

- [ ] Real-device APNs and FCM tests pass.
- [ ] No transcript/path content appears by default.
- [ ] Opening stale notification shows current bridge truth.
- [ ] Product copy makes no guaranteed socket/push claim.
- [ ] Agent work is unaffected when push is degraded.

**Evidence:** real-device lifecycle matrix.

---

# M16 — Accessibility, performance, privacy, and operational hardening

**Outcome:** Complete MVP behaviour meets release-quality nonfunctional gates.

**Checkpoint demo:** Run full user journey with screen readers, 200% text, reduced motion, long sessions, network changes, backup/restore, and redacted diagnostics.

### M16.1 Accessibility

- **Priority:** P0
- **Effort:** L

Tasks:

- [ ] VoiceOver and TalkBack audit.
- [ ] Switch/keyboard/Voice Control critical actions.
- [ ] 200% text scale.
- [ ] Reduced motion.
- [ ] Contrast and non-colour status.
- [ ] Dialog focus restore.
- [ ] Streaming transition announcements only.

### M16.2 Performance and resource limits

- **Priority:** P0
- **Effort:** L

Tasks:

- [ ] Streaming build/raster measurements.
- [ ] 1,000-item history.
- [ ] Maximum tool output/chunk rate.
- [ ] Six subscribed session summaries.
- [ ] Mobile cache/disk LRU.
- [ ] Bridge journal retention.
- [ ] Memory and file-descriptor soak.
- [ ] 60/90/120 Hz frame pacing where available.

### M16.3 Privacy/security

- **Priority:** P0
- **Effort:** L

Tasks:

- [ ] Mobile backup exclusions.
- [ ] App-switcher snapshot review.
- [ ] Log/diagnostic allowlist tests.
- [ ] Notification payload inspection.
- [ ] Secrets/artifact scans.
- [ ] Traversal/symlink race tests.
- [ ] Lease/idempotency concurrency stress.
- [ ] Release build fault-endpoint absence.

### M16.4 Operations and recovery

- **Priority:** P0
- **Effort:** M

Tasks:

- [ ] Daily online backups/latest three.
- [ ] Restore and host-generation reset.
- [ ] Retention/cleanup resumability.
- [ ] Corrupt/missing session repair UX.
- [ ] Lost-phone token removal CLI.
- [ ] Update/rollback rehearsal.
- [ ] Host reboot and Tailscale recovery.

### M16 exit criteria

- [ ] All accessibility gates pass on representative devices.
- [ ] No performance budget violation or unbounded buffer remains.
- [ ] Privacy/security release gates pass.
- [ ] Backup/restore/update/rollback are demonstrated.
- [ ] Known limitations are documented.

**Evidence:** hardening report and release evidence bundle.

---

# M17 — Personal MVP release candidate

**Outcome:** A signed private release installs cleanly and satisfies every product success criterion.

**Checkpoint demo:** Start from clean host and phone installations and complete the twelve success scenarios in `docs/PRODUCT.md`.

### M17.1 Release preparation

- **Priority:** P0
- **Effort:** L

Tasks:

- [ ] Freeze compatible versions and schemas.
- [ ] Produce signed/checksummed bridge artifact.
- [ ] Produce TestFlight iOS build.
- [ ] Produce signed Android release build.
- [ ] Privacy/permission metadata.
- [ ] Release notes and known issues.
- [ ] Install/update/rollback/uninstall documentation.

### M17.2 Acceptance suite

- **Priority:** P0
- **Effort:** L

Prove:

- [ ] fresh pairing/doctor,
- [ ] trusted task start,
- [ ] lost-ack duplicate safety,
- [ ] Wi-Fi/cellular replay,
- [ ] lock/background completion,
- [ ] extension dialog reconnect,
- [ ] three-session capacity/idle restore,
- [ ] fork/clone,
- [ ] image prompt,
- [ ] export/share,
- [ ] crash/database/cursor failures,
- [ ] accessibility/privacy/install gates.

### M17.3 Release record

- **Priority:** P0
- **Effort:** S

Tasks:

- [ ] Release manifest and checksums.
- [ ] CI/device/fault/accessibility/performance reports.
- [ ] Rollback classification.
- [ ] Backlog MVP tasks marked Done/Deferred with reasons.
- [ ] Tag/release checkpoint.

### M17 exit criteria

- [ ] All P0/P1 MVP tasks are Done or explicitly Deferred with owner decision.
- [ ] No release blocker in `docs/RELEASE.md` remains.
- [ ] Clean install and acceptance suite pass.
- [ ] Owner can operate and recover the system without development tools.

---

# Cross-cutting recurring backlog

These are not separate milestones; apply whenever relevant.

## C-01 Documentation consistency — P0

- [ ] Update normative docs with behavioural changes.
- [ ] Generate schema catalogue.
- [ ] Keep `WORKING.md` current.
- [ ] Regenerate `check.md` after structure/commands change.
- [ ] Record decisions with review triggers.

## C-02 Upstream compatibility — P0

- [ ] Re-run real Pi contract suite on proposed update.
- [ ] Review RPC/session/extension diffs.
- [ ] Update fixtures/manifest only after passing.
- [ ] Keep exact tested boundary versions.

## C-03 Dependency/supply chain — P0

- [ ] Exact pins and lockfile review.
- [ ] License/security scan.
- [ ] No unreviewed lifecycle scripts/native binaries.
- [ ] Release checksum/signing record.

## C-04 Privacy and logging — P0

- [ ] New fields receive privacy classification.
- [ ] Logs remain metadata-only.
- [ ] Notifications remain status-only by default.
- [ ] Diagnostics use explicit allowlist.

## C-05 Accessibility — P0

- [ ] Semantic labels/states/actions.
- [ ] Focus and keyboard handling.
- [ ] Text scaling/reduced motion/contrast.
- [ ] Real screen-reader check for new critical flows.

## C-06 Performance and bounds — P0

- [ ] Define limits before adding queues/caches/output.
- [ ] Add boundary/soak test.
- [ ] Measure transcript and transport hot paths.
- [ ] Avoid background work that violates platform policy.

---

# Post-MVP backlog

These are deliberately deferred and do not block M17.

## P3-01 Linux host service

- systemd user unit,
- Linux paths/secrets/service lifecycle,
- release artifacts and install/rollback,
- real compatibility matrix.

## P3-02 Windows host service

- Windows service/task strategy,
- Job Objects for child cleanup,
- environment/credential integration,
- installer and signing.

## P3-03 Sandbox profiles

- Gondolin/OpenShell/container integration research,
- policy selection per workspace/session,
- host/provider credential boundary,
- performance and path mapping.

## P3-04 Confirmation policy mode

- optional Ask mode for selected tools/classes,
- duplicate-safe mobile approvals,
- timeout/disconnect semantics,
- no simplistic command-text security claims.

## P3-05 Multi-user/shared bridge

Requires new authentication, authorization, tenancy, audit, privacy, and controller design before implementation.

## P3-06 Public internet access

Requires independent identity, authorization, rate limiting, abuse controls, TLS/service hardening, and security review. Tailscale Funnel alone is not an acceptable implementation plan.

## P3-07 Public share links

- explicit publication service,
- revocation/expiry/access control,
- content review/redaction,
- abuse/privacy model.

## P3-08 Obsidian/stored notes

- Markdown source of truth,
- selected vault access,
- sync/conflict model,
- no vulnerable local REST plugin dependency.

## P3-09 Android Termux mode

- on-device Pi lifecycle,
- storage/provider credentials,
- background restrictions,
- parity limitations.

## P3-10 Mobile code/file viewer enhancements

Read-only diff/file navigation may be explored without turning the product into a full IDE or terminal.

## P3-11 Automatic signed updater

Only after signed manifests, transactional install, migration rollback, channel control, and recovery are proven.

## P3-12 Public app-store launch

- external user onboarding/support,
- privacy policies and disclosures,
- analytics/crash reporting decision,
- authentication/threat-model review,
- store review/metadata/compliance.

---

# Immediate next checkpoint

After M0 closes, activate **M1 — Monorepo scaffold and CI foundations**.

The first implementation action is repository scaffolding and shared fixture loading, not transcript polish or notification work.
