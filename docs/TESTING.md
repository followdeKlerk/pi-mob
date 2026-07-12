# Testing strategy

Status: normative MVP release requirements.

The project is a remote-control surface for a coding agent with durable side effects. Tests must prove command identity, event ordering, recovery, and policy enforcement before visual polish is treated as complete.

## 1. Test layers

### Bridge unit tests

Cover:

- Pi JSONL line splitting on LF only.
- Trailing CR removal.
- UTF-8 split across input chunks.
- Multiple records in one chunk.
- Empty lines and malformed JSON.
- Envelope encode/decode and schema validation.
- Command payload hashing and idempotency conflict detection.
- Per-session sequence allocation.
- Queue limits.
- Backoff and jitter bounds.
- Workspace canonicalization and symlink escape rejection.
- Trust fingerprint changes.
- Attachment type, size, dimensions, expiry, and cleanup.
- Log redaction.

Use property-based tests for the Pi line splitter and envelope decoder.

### Pi contract tests

Run against the pinned real `pi --mode rpc` executable rather than mocks only.

Prove:

- Startup and clean shutdown.
- Text prompt and streaming event normalization.
- `agent_settled` mapping.
- Abort.
- Model and thinking controls.
- Durable session resume.
- Tool events for every built-in tool shape used by the mobile renderer.
- Extension dialog routing.
- Retry and compaction event handling.
- Behaviour after Pi version mismatch.

Store sanitized protocol fixtures generated from these tests.

### Bridge integration tests

Use real SQLite, a real WebSocket client, and either real Pi or a deterministic Pi fixture process.

Required cases:

- Prompt accepted and completed.
- Disconnect before command acknowledgement, then resend the same command ID.
- Disconnect after acknowledgement but before first Pi event.
- Duplicate command after completion.
- Same command ID with a changed payload.
- Sequence gap and replay.
- Expired cursor and snapshot fallback.
- Slow client exceeds outbound buffer.
- Oversized tool output truncation.
- Bridge crash after command acceptance but before dispatch.
- Bridge crash while command is running.
- Pi crash while idle.
- Pi crash during a tool call.
- Crash-loop threshold.
- Idle-process eviction.
- Active-process capacity with no idle victim.
- Host draining and restart.
- Extension dialog disconnect, expiry, and duplicate response.
- Attachment retry with the same upload ID.
- Attachment expiration before prompt acceptance.

### Mobile unit and widget tests

Cover:

- Protocol model parsing and unknown optional event handling.
- Ordered application and duplicate suppression.
- Replay state reducer.
- Draft persistence.
- Session switcher states.
- Tool-card states.
- Queue display and controls.
- Extension sheets and timeout states.
- Read-only indicator and policy changes.
- Attachment compression/upload/error states.
- Notification deep-link reconciliation.

### Golden tests

Pin Flutter and the rendering environment.

Required scenarios:

- Light and dark theme.
- Text scale 100%, 150%, and 200%.
- Narrow phone, large phone, and tablet-width layouts.
- Streaming, completed, failed, interrupted, crashed, indeterminate, and truncated tool cards.
- Long file paths and command previews.
- Reduced-motion presentation.
- Session switcher with stopped, running, waiting, and crash-loop sessions.

Goldens do not replace semantics or device accessibility testing.

### Device integration tests

Run on real or hosted devices for:

- iOS foreground/background/foreground reconnect.
- Android Wi-Fi to cellular transition.
- Phone lock during a turn.
- Host unreachable and recovery.
- APNs/FCM notification open into correct session.
- iOS Live Activity settle/error update.
- Android foreground-service enable/disable lifecycle.
- Camera QR pairing.
- Image picker and upload.

## 2. Deterministic failure injection

The bridge must support test-only fault injection behind a build flag.

Faults:

```text
close websocket after command acceptance
pause outbound stream
kill Pi after N events
kill bridge after database transition
corrupt or expire replay cursor
emit oversized tool output
return provider interruption
hold extension dialog past expiry
fail attachment write
simulate database full
simulate notification rejection
```

Fault injection is unavailable in production builds.

## 3. Protocol fixture policy

Fixtures live in `packages/protocol-fixtures` and include:

- Valid examples for every command and event type.
- Invalid examples for every stable error category.
- Old-minor-version examples.
- Unknown optional fields.
- Unknown required capability.
- Maximum-size boundary cases.

Both Dart and TypeScript tests consume the same fixtures.

## 4. Compatibility matrix

CI initially tests:

```text
Flutter 3.44.4 / Dart 3.12.2
Pi 0.80.6
protocol 1.0
macOS bridge host
Android API 29 baseline
current iOS simulator supported by the pinned Xcode
```

Before expanding a Pi version range, CI must test every supported boundary version.

A major Flutter, Pi, Bun, Xcode, Android Gradle Plugin, or protocol change triggers an explicit compatibility review rather than a blind dependency update.

## 5. CI gates

Every pull request must pass applicable gates:

### TypeScript bridge

```text
format check
lint
typecheck
unit tests
property tests
protocol fixture tests
SQLite migration tests
compiled-binary smoke test
```

### Flutter application

```text
dart format check
flutter analyze
unit tests
widget tests
golden tests
protocol fixture tests
integration-test compile
```

### Cross-component

```text
real Pi contract suite
bridge/mobile protocol compatibility
reconnect and duplicate-command integration suite
secret scan
license/dependency audit
```

## 6. Failure-mode release matrix

Each release candidate must prove:

| Failure | Required proof |
|---|---|
| Network drop mid-turn | No duplicated prompt; ordered replay reaches settled state |
| Host unreachable | Correct state, bounded retries, immediate foreground retry |
| Pi crash mid-turn | Turn becomes indeterminate; no automatic rerun |
| Bridge crash before dispatch | Accepted command dispatches once after recovery |
| Bridge crash during execution | Command becomes indeterminate |
| Oversized output | Mobile truncation marker; bridge remains responsive |
| Slow mobile consumer | Disconnect and replay without stopping Pi |
| Permission/trust required | Turn waits; explicit response resumes or expires |
| Backgrounded phone | Host continues; app reconciles on foreground |
| Provider interruption | Distinct failure state and manual retry path |
| Cursor expired | Snapshot fallback produces correct durable history |
| Database unavailable/full | No command accepted without durable record |

## 7. Accessibility gates

Before MVP release:

- Every interactive tool card and status has a semantic label.
- VoiceOver and TalkBack announce state transitions, not streaming tokens.
- Dynamic Type/text scaling works at 200% without losing actions.
- Cancel/abort is keyboard and switch accessible.
- Reduced motion disables decorative or continuous animation.
- Focus returns predictably after extension sheets close.
- Contrast passes for all status pills and disabled states.

## 8. Performance gates

Measure on a real high-refresh phone and a 60 Hz baseline.

- Streaming does not rebuild the entire transcript for each delta.
- Long-session scrolling uses lazy construction and paging.
- No unbounded event, output, image, or log buffer exists.
- The UI remains responsive while receiving maximum allowed tool chunks.
- High-refresh operation is best effort; frame pacing must remain stable when the OS selects 60, 90, or 120 Hz.

Record Flutter build and raster frame timings for the streaming and scrolling scenarios.

## 9. Privacy and secret tests

Automated tests assert that these never appear in normal logs or mobile diagnostics:

- Provider API keys and OAuth tokens.
- APNs private key.
- FCM service-account private key.
- Full environment dumps.
- Prompt, reasoning, response, and tool-output content.
- Attachment bytes.

Release builds must not contain test push credentials, fault-injection endpoints, or fixture secrets.

## 10. Slice release gates

### Slice A complete

- Duplicate-safe prompt submission proven.
- Ordered replay proven across disconnect and bridge restart.
- Pi crash produces indeterminate state without rerun.
- One real Flutter client completes and aborts a real Pi turn.
- Host install, launchd restart, and `pi-mob doctor` work.

### Slice B complete

- Multi-session capacity and idle eviction proven.
- Trust fingerprint and read-only enforcement proven host-side.
- Fork, clone, delete, export, and attachment flows pass integration tests.
- Extension dialogs work across disconnect and timeout.
- Accessibility and golden gates pass.

### Slice C complete

- APNs, FCM, Live Activity, and Android foreground behaviour tested on devices.
- Notification payloads contain no transcript content by default.
- Opening a stale notification reconciles with current bridge state.
- No product copy claims guaranteed background sockets or guaranteed push delivery.

## 11. Definition of done

A feature is not done when only the happy-path UI exists. It is done when:

1. Its protocol shape is versioned.
2. Its bridge state transition is durable.
3. Duplicate and reconnect behaviour is defined.
4. Failure UX exists.
5. Unit or contract coverage exists.
6. Logs are redacted.
7. Accessibility semantics exist.
8. Documentation matches implementation.
