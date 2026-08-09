## Context

The bridge owns the durable mobile-facing concerns: authenticated WebSocket sessions, command records, controller leases, stream cursors, attachments, exports, notifications, and canonical session-event replay. The normal daemon now constructs one supervised `OmpSession` provider per active bridge session. That provider feeds the still legacy-named `OneSessionPiAdapter`, which remains the concrete command and canonical-event translation layer consumed by `DurableBridgeRuntime`.

OMP RPC currently reuses bounded process and launch primitives under `packages/bridge/src/pi/`; model, normalization, catalogue, history, and export helpers also retain Pi-shaped names or contracts. The mobile application consumes bridge protocol and canonical session events rather than raw OMP messages. The remaining cleanup must move or remove those compatibility surfaces without weakening the implemented OMP path.

The initial probes used OMP `17.2.11`, whose local subprocess RPC mode emits a `ready` record with protocol and frame limits, accepts newline-delimited JSON requests shaped as `{id,type,...}`, returns correlated `{id,type:"response",command,success,data}` records, and emits unsolicited lifecycle, command-catalogue, and message/turn events. `--session-dir` persists JSONL sessions; `--resume <path-or-id>` reopens one. OMP rejects the Pi-specific `--session-id` flag, so bridge identity must bind to OMP's generated session ID or resume path rather than pass a caller-assigned Pi flag.

The probes produced a persisted OMP session with a version-3 JSONL header, completed a prompt through streamed message and terminal events, and reopened the same session file with the same OMP session ID. A write-tool call produced explicit tool-call and tool-result events, and `abort` produced an aborted terminal event plus a successful response. Killing OMP during the initial assistant turn before completion left no session file in the session directory, so OMP did not provide authoritative recoverable state for that interrupted turn.

## Goals / Non-Goals

**Goals:**

- Make OMP the only backend constructed by the normal production daemon after cutover.
- Keep durable bridge guarantees and the mobile-facing protocol stable where OMP can provide equivalent semantics.
- Give backend-specific commands and events one explicit translation boundary.
- Preserve bridge session identifiers while storing OMP-specific references separately.
- Make interrupted-turn recovery authoritative, bounded, and observable.
- Provide an idempotent migration path for existing Pi session data.
- Remove Pi runtime dependencies and production paths after migration acceptance.

**Non-Goals:**

- Supporting Pi and OMP concurrently after cutover.
- Exposing raw OMP protocol messages to the mobile client.
- Adding a cloud-hosted OMP service or changing the private Tailscale boundary.
- Recreating unsupported OMP features as bridge-side policy extensions.
- Preserving Pi-specific behavior when OMP has no equivalent observable contract.

## Decisions

### Preserve the bridge protocol and canonical event authority

The OMP backend will emit normalized events into the existing canonical session-event pipeline. The bridge will persist canonical events before live publication, and mobile replay and live delivery will continue to use the same event model.

This is preferred over changing the Flutter client to understand OMP because it keeps transport, replay, leases, and rendering concerns independent from agent-runtime vocabulary. OMP-specific fields may be retained only in bounded backend metadata when they are necessary for recovery or display.

### Introduce a backend-neutral execution boundary

The current Pi adapter responsibilities will be separated conceptually into:

```text
backend launch and transport
backend supervision
session operations
command translation
event normalization
history/recovery reconciliation
```

The runtime will depend on the backend-neutral session/adapter contract. OMP implementations will satisfy that contract; the runtime will not import OMP protocol types. Pi-specific names will be removed from the production contract rather than preserved as aliases.

A generic translation wrapper around the current Pi RPC protocol was rejected as the target design because it would preserve Pi-shaped semantics and obscure OMP differences in cancellation, session identity, and recovery.

### Use bridge IDs as the durable identity

The bridge session ID remains the mobile-facing and durable identity. OMP receives or is mapped to a backend session reference stored in bridge state. Backend reference changes must be persisted atomically with the corresponding session state.

This avoids coupling mobile drafts, leases, cursors, notifications, and cached session state to OMP's internal identifier scheme.

### Treat history migration as a separate, idempotent operation

Pi history migration will run with the bridge stopped or in an explicitly quiesced state. It will create a protected backup reference, preflight every input, process sessions independently, and persist per-session migration outcomes.

A migration marker will distinguish at least:

```text
pending
migrated
archived
partial
failed
indeterminate
```

The migration will never overwrite source Pi history. A successful session will not be imported twice on retry. Active turns require authoritative terminal evidence; otherwise the migrated session remains indeterminate.

### Make capability advertisement derive from constructed providers

The daemon will construct the OMP backend and optional services first, then derive `hello.accepted.capabilities` from the providers that are actually available. Schema literals or isolated implementations will not be sufficient evidence for an advertised capability.

This preserves the repository's existing capability discipline and prevents OMP from accidentally advertising Pi-only or unimplemented surfaces.

### Use a cutover gate rather than a runtime feature flag

The branch will use explicit pre-cutover and post-cutover states:

- Before acceptance, OMP integration and migration tooling may be exercised in tests or controlled operator commands.
- On this branch, OMP-only normal-daemon wiring is already active. That construction cutover preceded the required Pi-session migration gate and remains an explicit implementation deviation until migration is completed or the no-source-data case is accepted.
- After cutover, Pi artifacts are archive/cleanup inputs only and cannot be reattached as live production sessions.

A runtime backend selector was rejected because it would multiply recovery paths, capability matrices, fixtures, and operational ambiguity. Rollback is handled by restoring the protected pre-cutover state and deploying the prior release, not by keeping both backends live indefinitely.

### Validate against the real OMP subprocess RPC

Fake backend clients will cover deterministic unit behavior, but production-wiring and recovery acceptance must exercise the actual OMP `--mode rpc` subprocess. The observed newline-delimited transport can reuse the bridge's bounded process mechanics only after its readiness, response, notification, and shutdown semantics are covered by tests. The integration harness must cover prompt streaming, tool events, cancellation, restart, resume, and ambiguous-turn handling.

The OMP runtime does not accept the Pi `--session-id` launch flag. The bridge must launch OMP with a session directory and bind each durable bridge session to the OMP session file or generated session ID returned by `get_state`; resume must use OMP's supported `--resume` path/ID behavior.

### Initial mapping evidence

The first OMP probes establish this starting map; implementation must still validate every payload and event against the bridge contract:

| Bridge concern | OMP observation | Design consequence |
| --- | --- | --- |
| Prompt dispatch | `prompt` accepts `{message}` and returns an immediate successful acknowledgement | Preserve bridge command admission and correlate the later message/turn events to the durable command ID. |
| Streaming transcript | `message_start`, `message_update`, `message_end`, and `turn_end` are emitted; assistant deltas include text and tool-call updates | Normalize OMP message blocks and terminal metadata before canonical persistence. |
| Tool lifecycle | `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, and tool-result messages are emitted | Map tool calls/results into bounded canonical tool events; do not treat an assistant `toolCall` as a completed tool result. |
| Cancellation | `abort` returns a successful response and emits an aborted `turn_end` | Map the terminal stop reason to the bridge cancellation outcome and test races with prompt acknowledgement. |
| Model selection | `get_available_models` and `set_model` succeed with provider/model identifiers | Retain host-driven model selection after validating bounds and provider availability. |
| History and catalogue | `get_messages` succeeds; `get_commands` returns `Unknown command`; startup emits `available_commands_update` | Use `get_messages` for history snapshots and consume the command-update event for catalogue data; do not advertise `catalogue.v1` until that projection is durable and production-wired. |
| Session resume | `--resume` reopens a persisted JSONL path and preserves the OMP session ID; `--session-id` is rejected | Store the OMP session file/reference durably and keep bridge IDs separate. |

### Pi baseline retained for migration comparison

The pre-cutover Pi baseline captured when this change was proposed was:

- `packages/bridge/src/pi/rpc-process.ts`: Pi subprocess launch, newline-delimited request/response correlation, bounded request/stderr handling, and process-group shutdown.
- `packages/bridge/src/pi/one-session-adapter.ts`: durable command dispatch, prompt admission, model selection, extension responses, attachment handling, and canonical-event integration.
- `packages/bridge/src/pi/normalize.ts` and `packages/bridge/src/pi/types.ts`: Pi command names and raw notification-to-bridge event normalization.
- `packages/bridge/src/pi/external-history.ts`: Pi JSONL discovery/import/reconciliation.
- `packages/bridge/src/daemon.ts`: Pi executable/configuration capture, session discovery, per-session launch arguments, model discovery, and production provider construction.
- `packages/bridge/test/integration/daemon-production-wiring.test.ts`, `packages/bridge/test/session-events/canonical-wiring-production.test.ts`, and the Pi adapter/RPC fixtures: construction-path and protocol baselines that OMP tests must replace or intentionally supersede.

The migration described by this change is not implemented, and no source Pi session data has been proven migrated. The normal daemon is already OMP-only, so migration acceptance, compatibility-code cleanup, and final release proof remain open rather than being inferred from the construction cutover.

## Risks / Trade-offs

- **OMP has no persisted session artifact for an early interrupted turn** → persist the mobile prompt in the bridge before dispatch, mark the bridge turn indeterminate after backend loss, and require explicit recovery; never infer completion or silently retry from OMP absence.
- **OMP session history cannot import Pi JSONL** → migrate valid history into the canonical archive path and mark the session non-resumable rather than silently dropping it.
- **OMP command semantics differ from Pi** → advertise only equivalent capabilities and return bounded unsupported errors for the rest.
- **Migration fails for a subset of sessions** → persist per-session outcomes, retain the source backup, and block final cutover while active sessions lack an explicit safe outcome.
- **OMP emits high-volume or unbounded tool output** → apply existing bridge limits before canonical persistence or notification delivery.
- **Backend-neutralization expands the change surface** → keep the mobile protocol unchanged and remove abstractions that have no OMP consumer during cleanup.
- **Post-cutover rollback is operationally expensive** → require a protected state snapshot and a tested restore procedure before enabling OMP-only daemon wiring.

## Migration Plan

1. Capture and validate the authoritative OMP launch, transport, session, event, model, command, and recovery contract.
2. Implement the backend-neutral execution boundary without changing the released mobile protocol.
3. Implement OMP supervision, session operations, command translation, event normalization, and authoritative recovery.
4. Add bridge-state fields and idempotent migration markers for backend references and migration outcomes.
5. Build and exercise Pi-to-OMP migration against copied state directories only.
6. Add real OMP production-wiring, restart/reconnect, migration, and fault-injection tests.
7. Run a pre-cutover migration with the bridge quiesced and verify every active session has a safe terminal migration outcome.
8. Switch the normal daemon to OMP-only construction and update advertised capabilities.
9. Verify mobile pairing, replay, prompt routing, leases, history, drafts, attachments, exports, notifications, model controls, and command catalogue against the OMP daemon.
10. Remove Pi runtime wiring, dependencies, setup flags, fixtures, documentation, and dead compatibility code.
11. Archive or clean up source Pi session artifacts according to the documented operator policy.

Rollback before cutover restores the protected state snapshot. Rollback after cutover deploys the previous release against the preserved pre-cutover backup; the production daemon does not provide an in-process Pi fallback.

## Current unresolved decisions

- Imported-history ownership remains unresolved because Pi-session migration is not implemented.
- OMP model RPC is implemented on the host-driven session path. The command catalogue still needs a bounded projection and normal-daemon production wiring before `catalogue.v1` can be advertised.
