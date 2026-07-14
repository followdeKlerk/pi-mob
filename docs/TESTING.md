# Testing strategy

Status: normative MVP release requirements.

`pi-mob` controls a coding agent with durable external side effects. Tests must prove command identity, controller ownership, event order, queue semantics, recovery, policy enforcement, privacy, and installation before visual polish is considered complete.

## 1. Testing principles

- Test state transitions and invariants, not only screens.
- Run contract tests against the exact real Pi executable.
- Share protocol fixtures across TypeScript and Dart.
- Use deterministic fault injection for crash windows.
- Treat reconnection as a normal execution path.
- Fail closed when durable state cannot commit.
- Preserve privacy in fixtures, logs, screenshots, and CI artifacts.
- No release gate depends solely on a simulator when platform lifecycle/push behaviour is involved.

### Proportional testing and test cap

Testing effort is risk-based, not line-count- or coverage-target-based.

- **Trivial code needs no dedicated test** when it is declarative or mechanically obvious, has no branching or state transition, and failure is already caught by compilation, static analysis, schema validation, or an existing higher-level test. Examples include constants, simple field forwarding, generated boilerplate, and passive manifest wiring.
- **Non-trivial code requires focused tests** when it contains branching, parsing, normalization, state, concurrency, persistence, protocol behavior, security/privacy policy, recovery, platform integration, or external side effects.
- **Complex or high-impact code must test invariants and failure paths**, not merely the happy path. This includes command identity, leases, replay/snapshots, crash recovery, filesystem/process boundaries, migrations, and read-only enforcement.
- Add the smallest test set that proves the behavior. Prefer one table/property/integration test over many near-duplicate examples.
- Do not add tests solely to increase coverage percentages, mirror implementation details, test language/framework behavior, or re-prove an invariant already covered at a more appropriate layer.
- When an existing test already detects the realistic regression, extend it rather than creating another test file.
- Generated command/event fixture matrices remain appropriate because they prove contract exhaustiveness; ordinary trivial code does not inherit that requirement.

The detailed required matrices below apply where their named risk or checkpoint feature exists. They are not a mandate to test unrelated trivial glue.

## 2. Static and repository checks

Every applicable pull request/checkpoint runs:

```text
format
lint/analyze
typecheck
unit tests
protocol/schema drift
fixture parity
Markdown links
backlog/decision ID validation
secret scan
dependency/license audit
generated-file consistency
```

Normative documentation fails CI when:

- a Ready/Active milestone contains an unresolved blocking `TBD`,
- protocol command/event catalogue differs from schema metadata,
- a new stable error lacks fixtures,
- README reading order references missing documents.

## 3. Protocol schema tests

Canonical TypeBox schemas and Dart models consume the same corpus.

Required coverage:

- every valid command, response, event, snapshot, and error,
- invalid/missing/wrong-type fields,
- unknown optional fields and events,
- unknown required capability,
- protocol major mismatch and additive minor examples,
- maximum JSON boundaries,
- decimal-string cursors including values above `9007199254740991`,
- UUID and RFC 3339 validation,
- semantic payload canonicalization and SHA-256 golden values,
- exclusion of request/connection/lease/timestamp metadata from semantic hashes,
- stable error/detail schemas.

Property tests:

- encode/decode round-trip,
- unknown optional field preservation/ignore behaviour,
- cursor arbitrary-precision comparison,
- canonical JSON independent of key insertion order,
- malformed/fuzzed envelopes never crash parser.

## 4. Pi JSONL adapter unit/property tests

Cover:

- LF as only record delimiter,
- optional trailing CR,
- UTF-8 code point split across chunks,
- multiple records per chunk,
- partial final record,
- empty lines,
- malformed JSON,
- U+2028/U+2029 inside JSON strings,
- bounded line/message size,
- stdin write backpressure,
- optional upstream command-ID response correlation,
- response timeout/cancellation,
- stderr ring truncation/redaction.

Use property-based and fuzz tests for splitter and decoder.

## 5. Real Pi contract tests

Run against exact pinned `@earendil-works/pi-coding-agent` executable and recorded upstream commit/integrity.

Prove:

### Startup/process

- direct spawn without login/interactive shell,
- clean stdout JSONL with hostile shell profile fixtures present,
- explicit cwd/environment,
- clean/forced process-group shutdown,
- version mismatch behaviour.

### Prompting/lifecycle

- prompt acceptance and stream,
- steer,
- follow-up upstream mapping where directly tested,
- abort,
- `agent_start`, `agent_end`, and `agent_settled` distinction,
- queued/retry/compaction continuation after `agent_end`,
- durable session reopen.

### State and controls

- get state/messages/entries/tree,
- available/set/cycle model,
- thinking levels,
- steering/follow-up modes,
- session stats,
- auto/manual compaction,
- auto retry/abort retry,
- command discovery.

### Sessions

- new/switch/name,
- fork messages/fork,
- clone,
- export HTML,
- extension-cancelled switch/fork/clone,
- missing/corrupt/incompatible session fixtures.

### Events/tools/extensions

- assistant/reasoning/message lifecycle,
- every built-in tool shape used by renderer,
- parallel tool interleaving and source/completion order,
- tool errors/cancellation/updates,
- extension select/confirm/input/editor,
- extension notify/status/widget/title/editor-prefill,
- tool-call policy blocking.

Store sanitized fixtures derived from real runs. No provider keys, user repositories, or private content enter the repository.

## 6. Bridge domain unit tests

Cover:

- connection/host generation state,
- stream cursor allocation,
- host/session stream routing,
- subscription detail rules,
- snapshot baseline and post-baseline replay,
- duplicate/gap/conflicting-duplicate handling,
- command payload hashing and state machine,
- per-host/per-session serialization lanes,
- accepted-before-dispatch recovery,
- running-to-indeterminate recovery,
- controller lease acquire/renew/reclaim/takeover/release/expiry,
- queue add/remove/clear/dispatch ordering,
- queue attachment reference counts,
- process capacity/LRU eligibility,
- restart-window/crash-loop,
- workspace canonicalization/symlink escape,
- trust fingerprint/resource changes,
- read-only classification/default deny for unknown tools,
- attachment/export expiry and cleanup,
- pagination token binding/expiry,
- retention and backup scheduling,
- notification coalescing/rate limiting,
- log/diagnostic redaction.

Time-dependent logic uses an injected monotonic/wall clock. Tests never sleep for real lease/backoff/expiry durations.

## 7. SQLite and migration tests

Use real SQLite files.

Required:

- fresh schema creation,
- every supported upgrade fixture,
- foreign keys and uniqueness,
- concurrent command-ID acceptance race,
- concurrent controller acquisition race,
- stream cursor allocation race,
- command acceptance plus event transaction atomicity,
- queue position transaction,
- snapshot baseline transaction,
- WAL restart/recovery,
- database busy/locked handling,
- disk full/unwritable/read-only,
- integrity check failure,
- online backup and checksum,
- restore/host-generation increment,
- reversible/restore-required migration classifications,
- retention interruption/resume,
- purge/repair partial failures.

A database failure test MUST prove no accepted receipt is sent without committed durable state.

## 8. Bridge integration tests

Use real SQLite, real WebSocket client, loopback HTTP, and either real Pi or deterministic fixture process.

### Handshake/subscriptions

- hello success/major mismatch/capability failure/host-ID mismatch,
- changed host generation,
- mandatory host stream,
- one full plus five summary session subscriptions,
- stream not found/deleted,
- current/replay/snapshot-required,
- multipart snapshot failure/retry,
- post-baseline event ordering.

### Commands/idempotency

- prompt accepted/completed,
- disconnect before receipt and resend,
- disconnect after receipt before Pi event,
- duplicate after completion,
- same ID/different payload,
- same semantic command with changed request/connection/lease metadata,
- accepted-before-dispatch bridge crash,
- running bridge/Pi/host crash to indeterminate,
- state-changing command rejected while DB unavailable/full.

### Streams/backpressure

- sequence values above JS safe integer encoded as strings,
- duplicate/gap/conflicting duplicate,
- expired/ahead cursor,
- slow client exceeds 8 MiB buffer,
- oversized JSON,
- oversized tool output/truncation/digest,
- independent stream continuation when another stream repairs.

### Controller leases

- auto/acquire and observer behaviour,
- renew by traffic,
- same-install reconnect grace,
- explicit takeover,
- stale socket mutation rejection,
- dual acquisition race,
- duplicate already-accepted command after lease expiry.

### Queue

- immediate/steer/follow-up routing,
- maximum ten,
- remove/clear before dispatch,
- no remove after dispatch,
- restart persistence,
- FIFO dispatch after settled,
- attachment retained through queue,
- abort does not clear queue.

### Process supervisor

- Pi crash idle/running/tool call,
- crash-loop threshold/manual reset,
- three-process capacity,
- eligible LRU idle eviction,
- no eligible victim `host_capacity`,
- idle timeout,
- process-group forced cleanup,
- host draining/restart.

### Trust/policy

- unknown/changed workspace approval,
- canonical path and symlink escape,
- full policy,
- read-only write/edit/bash/unknown-tool block,
- turn policy snapshot,
- extension dialog waiting/expiry/reconnect/duplicate response.

### Files and notifications

- upload retry same/different content,
- malformed MIME/decode/dimensions,
- attachment expires before prompt acceptance,
- export success/download/expiry/deletion,
- notification token replace/permanent rejection,
- status payload allowlist,
- push failure does not affect turn.

## 9. Deterministic fault injection

Test builds support explicit unavailable-in-release faults:

```text
close websocket after command acceptance
close websocket after Pi dispatch
pause outbound stream
kill Pi after N events
kill bridge after database transition
corrupt/expire/ahead cursor
force host generation change
emit oversized tool output
return provider interruption
hold extension dialog past expiry
fail attachment/export write
simulate database full/unavailable/locked
simulate migration failure
simulate notification rejection/network failure
force process cleanup timeout
```

Fault controls require test build plus loopback-only test endpoint/config. Release binary inspection/test proves they are absent or unreachable.

## 10. Mobile unit tests

Cover:

- protocol parsing and unknown optional events,
- connection/handshake/synchronization reducer,
- host generation invalidation,
- ordered application and duplicate suppression,
- gap pause/resubscribe,
- multipart snapshot atomic application,
- host/session stream isolation,
- drafts and no offline auto-send,
- submitting/accepted/failure draft restoration,
- controller/observer/takeover state,
- follow-up queue reducer,
- transcript turn/tool/reasoning/final composition,
- parallel tool grouping,
- model/context/retry/compaction state,
- extension dialog expiry/reconnect,
- attachment preprocessing/upload/retry,
- notification deep-link reconciliation,
- cache retention/LRU,
- forget host/clear cache/delete local data.

## 11. Mobile widget and golden tests

Required scenarios:

- onboarding ready/degraded/incompatible/unreachable,
- host dashboard empty/active/degraded,
- workspace recents/search/unavailable/trust changes,
- session list active/attention/stopped/deleted,
- transcript streaming/completed/failed/aborted/crashed/indeterminate,
- reasoning expanded/collapsed/absent,
- every built-in and generic tool state,
- parallel tools and long command/path,
- truncated output,
- disconnected/stale/observer/read-only composer,
- queue and extension sheets,
- model/context/retry/compaction,
- controller takeover,
- fork/clone/delete/restore/export,
- light/dark,
- text scale 100/150/200%,
- narrow/large/tablet widths,
- reduced motion,
- RTL/layout sanity where supported.

Pin Flutter and rendering environment. Goldens supplement, not replace, semantics/accessibility/device tests.

## 12. Mobile/device integration tests

Run representative real devices where behaviour requires hardware/platform services.

### Shared

- QR camera pairing,
- manual endpoint,
- image picker/preprocessing/upload,
- app process kill/relaunch,
- host unreachable/recovery,
- long transcript/scroll/copy,
- stale notification reconciliation.

### iOS

- foreground/background/foreground reconnect,
- phone lock during turn/dialog,
- APNs registration/open,
- Live Activity start/update/end/stale cleanup,
- file protection/backup exclusions,
- VoiceOver, Dynamic Type, Reduce Motion.

### Android

- Wi-Fi/cellular transition,
- phone lock/background restrictions,
- notification permission/channel,
- FCM delivery/open,
- user-enabled foreground service lifecycle,
- backup exclusion,
- TalkBack/font scale/reduce animations.

Simulator/emulator may exercise UI, but real-device evidence is required for each activated release platform. The current Android scope requires real FCM/lock/network/foreground-service evidence. Apple APNs/Live Activity device evidence is deferred until Apple products return to the activated product scope.

## 13. Accessibility gates

Before MVP release:

- all actions/statuses have semantic names/roles/states,
- state transition announcements, not token announcements,
- VoiceOver/TalkBack complete primary journeys,
- 200% text retains actions/content,
- abort/take-control/respond accessible to keyboard/switch/voice,
- reduced motion removes continuous/decorative animation,
- focus traps/restores correctly for sheets/dialogs,
- colour is never sole status cue,
- touch targets meet platform guidance,
- copy/selection works for transcript content.

## 14. Performance and resource gates

Measure release/profile builds on 60 Hz baseline and high-refresh device.

Targets/proofs:

- tap/composer local feedback within 100 ms,
- healthy-tailnet accepted receipt within 500 ms excluding process start,
- normalized event displayed within 150 ms of bridge receipt,
- reconnect/current-state reconciliation within 5 seconds on healthy tailnet,
- 1,000 transcript items remain scrollable through paging/lazy build,
- active delta does not rebuild full transcript,
- maximum allowed tool chunk/output does not freeze UI,
- six subscribed sessions do not create unbounded work,
- no unbounded memory/file descriptor/disk growth,
- stable frame pacing at OS-selected 60/90/120 Hz,
- bridge soak covers repeated reconnects, session starts/stops, retention, and backups.

Record build/raster/frame/network/database timing evidence.

## 15. Security/privacy tests

Automated checks assert normal logs, diagnostics, notifications, and release artifacts exclude:

- provider API keys/OAuth,
- APNs private key,
- FCM service-account key,
- notification provider tokens where not explicitly protected,
- full environment dumps,
- prompt/reasoning/answer/tool/source content,
- attachment/export bytes,
- unrestricted absolute paths,
- WebSocket query strings,
- fixture/test credentials,
- fault-injection controls in release.

Additional tests:

- non-loopback production bind refused,
- Funnel/public/plain-LAN QR refused,
- traversal/Unicode/symlink race,
- malformed image/decompression dimensions,
- lease and command concurrency stress,
- mobile backup exclusions,
- status-only notification payload snapshot,
- diagnostic allowlist output.

## 16. Installation/update/rollback tests

On clean supported macOS user:

- fresh install,
- owner-only permissions,
- LaunchAgent start/restart/reboot,
- explicit PATH/environment with hostile shell startup files,
- Tailscale Serve configure/verify/preserve unrelated config,
- QR pairing,
- doctor ready/degraded/failure outputs,
- update with binary-only migration,
- reversible migration rollback,
- restore-required rollback and host-generation reset,
- uninstall retain-data/remove-state/full variants,
- Pi durable sessions retained by default.

Compiled release binary smoke tests run outside source checkout.

## 17. Compatibility matrix

Initial matrix:

```text
Flutter 3.44.4 / Dart 3.12.2 (artifact verification in M0)
protocol 1.0
Pi @earendil-works/pi-coding-agent 0.80.6 exact
pinned stable Bun chosen in M0/M1
macOS first supported host/architecture set in release manifest
iOS deployment target 16.1
Android minSdk 29
```

Before expanding Pi range, test every boundary version. Major Flutter, Pi, Bun, Xcode, AGP, protocol, plugin, or schema change triggers explicit review.

## 18. Failure-mode release matrix

Each release candidate proves:

| Failure | Required proof |
|---|---|
| Network drop before receipt | Same command ID produces one dispatch |
| Network drop mid-turn | Ordered replay reaches current state |
| Host/session stream gap | Only affected stream pauses and repairs |
| Cursor expired/generation changed | Atomic snapshot and correct baseline |
| Pi crash mid-turn | Turn indeterminate; no automatic rerun |
| Bridge crash before dispatch | Accepted command dispatches once |
| Bridge crash during execution | Command/turn indeterminate |
| Host reboot | Registry returns; clients reconcile; no false continuation |
| Oversized output | Truncation metadata; bridge/mobile responsive |
| Slow consumer | Disconnect/replay; Pi continues |
| Controller race | One controller; stale mutation rejects |
| Queue restart/remove | Queue survives; removed item never dispatches |
| Trust changed | Process start waits for explicit approval |
| Read-only mutation | Host extension blocks and reports policy denial |
| Dialog disconnect/expiry | Replay while valid; no invented answer |
| Provider interruption | Distinct visible failure/manual next action |
| Database full/unavailable | No new accepted commands |
| Attachment malformed/expired | Reject before prompt acceptance |
| Push unavailable | Agent use continues; foreground reconciliation works |
| Migration/restore | Not-ready or new host generation; no silent loss |

## 19. Checkpoint release gates

Backlog milestone completion uses the exit criteria in [`../BACKLOG.md`](../BACKLOG.md).

Critical cumulative gates:

### M5 one-session core

- duplicate-safe prompt submission,
- real Pi stream/abort,
- disconnect/replay,
- no offline auto-send.

### M7 installed host

- LaunchAgent, environment, Serve, pairing, doctor, update/rollback/uninstall.

### M11 multi-session

- one socket host/session streams,
- three-process capacity/idle restore,
- lease race/takeover.

### M15 background

- real Android FCM and foreground-service behaviour,
- status-only payload,
- stale reconciliation,
- deterministic APNs adapter coverage; real Apple APNs/Live Activity activation deferred by product scope.

### M17 personal MVP

- all product success criteria,
- all P0/P1 MVP tasks Done or explicitly Deferred,
- full acceptance/security/accessibility/performance/install evidence.

## 20. Definition of done

A feature is done only when:

1. Product and state behaviour are documented.
2. Protocol/schema is versioned.
3. Durable bridge transition exists for mutations.
4. Duplicate/reconnect/controller behaviour is defined and tested.
5. Failure UX exists.
6. Unit/fixture/contract/integration coverage passes.
7. Logs/notifications/diagnostics are redacted.
8. Accessibility semantics and device checks exist.
9. Limits/retention/performance are bounded and measured.
10. Installation/migration implications are addressed.
11. Documentation/backlog match implementation.
