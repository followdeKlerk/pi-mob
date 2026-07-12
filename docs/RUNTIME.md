# Host runtime contract

Status: normative MVP contract.

This document defines how the host bridge installs, starts, owns Pi processes, stores state, manages workspaces, exposes diagnostics, and recovers from failure.

## 1. Initial host target

The first supported host is macOS.

- Service manager: user-scoped `launchd` LaunchAgent.
- Bridge runs as the signed-in user because Pi needs that user's repositories, provider credentials, shell tools, and developer environment.
- Running bridge or Pi as root is unsupported.
- Linux `systemd --user` follows after macOS is proven.
- Windows service and Android Termux are post-MVP.

## 2. Runtime components

```text
Tailscale Serve
  -> loopback bridge HTTP/WebSocket server
       -> SQLite/WAL state
       -> process supervisor
            -> one pi --mode rpc subprocess per active session
       -> workspace/trust service
       -> attachment/export service
       -> APNs/FCM notification adapters
       -> structured diagnostics
```

One bridge process owns all Pi subprocesses created for mobile sessions.

## 3. Repository target

```text
apps/
  mobile/
packages/
  bridge/
  pi-extension/
  protocol-schema/
  protocol-fixtures/
scripts/
docs/
```

Package boundaries are enforced even if scaffolding lands incrementally.

## 4. Release packaging

Development uses pinned Bun and source packages. Release builds compile the bridge into a self-contained executable.

Release bundle contains:

```text
bridge executable
Pi extension
LaunchAgent template
config template/schema
migration metadata
install/update/rollback/uninstall scripts
doctor command/help
checksums/release manifest
license notices
```

The bridge does not self-update automatically.

## 5. Filesystem locations on macOS

Suggested locations:

```text
~/Library/Application Support/pi-mob/config.toml
~/Library/Application Support/pi-mob/state.sqlite3
~/Library/Application Support/pi-mob/secrets/
~/Library/Application Support/pi-mob/attachments/
~/Library/Application Support/pi-mob/exports/
~/Library/Application Support/pi-mob/backups/
~/Library/Application Support/pi-mob/releases/
~/Library/Logs/pi-mob/bridge.jsonl
~/Library/LaunchAgents/digital.deklerk.pi-mob-bridge.plist
```

Rules:

- State, attachments, exports, backups, and secrets are owner-only.
- Push/provider/tool secrets are not stored in repository or normal config.
- Temporary files use owner-only permissions and atomic rename where applicable.
- Logs avoid transcript/source/secret material.
- Pi durable sessions remain in Pi's configured storage and are not silently relocated.

## 6. Configuration

`config.toml` has a required schema version.

Example:

```toml
schema_version = 1
host_display_name = "Mac mini"
listen_host = "127.0.0.1"
listen_port = 8787
pi_executable = "/absolute/path/to/pi"
pi_version = "0.80.6"
max_active_sessions = 3
idle_process_minutes = 30
event_retention_days = 30
session_event_cap_mb = 100
host_event_cap_mb = 100
mobile_cache_guidance_mb = 250

[environment]
path = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
pass_names = ["SSH_AUTH_SOCK", "LANG", "LC_ALL"]
env_file = "~/Library/Application Support/pi-mob/secrets/tools.env"

[[workspace_roots]]
path = "~/Projects"
label = "Projects"
include_hidden = false
search_depth = 4

[notifications]
enabled = false
preview_mode = "status_only"
```

Validation:

- Reject unsupported required schema versions.
- Refuse wildcard or non-loopback production listener.
- Canonicalize roots at startup.
- Validate numeric limits/ranges.
- Fail readiness when Pi is missing/incompatible.
- Notification credential failures degrade push only.
- Unknown optional config keys may be preserved for migration, but unknown security-sensitive keys are not silently applied.

## 7. Process environment

A LaunchAgent does not inherit an interactive terminal environment. Pi MUST be spawned directly, not through `zsh -lc`, `bash -lc`, or sourced startup profiles.

Launch rules:

- absolute `pi_executable`,
- explicit cwd,
- explicit PATH,
- minimal safe locale variables,
- allowlisted environment names only,
- optional owner-only environment file,
- provider credentials through Pi's supported credential stores/configuration,
- stdout reserved exclusively for Pi JSONL RPC,
- stderr captured into bounded redacted diagnostics.

Why:

- interactive shell startup output can corrupt JSONL stdout,
- startup scripts can hang or prompt,
- hidden aliases/functions may make behaviour nonreproducible,
- full environment capture leaks secrets.

`pi-mob env capture` MAY inspect a user terminal and propose variable names/values, but it MUST show names for approval and MUST NOT silently copy the full environment.

## 8. Tailscale Serve

Production shape:

```text
https://<host>.<tailnet>.ts.net/
    -> http://127.0.0.1:8787
```

Rules:

- Use persistent/background Serve configuration.
- Never use Funnel.
- Setup verifies Tailscale, MagicDNS, HTTPS, and expected loopback target.
- Doctor compares actual Serve configuration against expected target.
- Preserve unrelated Serve configuration.
- Uninstall removes only configuration created/owned by pi-mob.
- QR generation refuses loopback, wildcard, public Funnel, and plain-LAN endpoints.
- Bridge adds no second authentication layer for MVP.

## 9. HTTP/WebSocket server

Endpoints:

```text
GET  /healthz
GET  /readyz
GET  /v1/ws
POST /v1/attachments
GET  /v1/exports/{exportId}
```

Server responsibilities:

- protocol handshake/capabilities,
- one connection per host client,
- host/session subscription multiplexing,
- payload/rate/size validation,
- controller leases,
- command durability/idempotency,
- replay/snapshots,
- attachment/export transfer,
- backpressure and close semantics.

Production mode MUST refuse startup if listener is non-loopback.

## 10. Database

SQLite runs in WAL mode with foreign keys enabled.

Core logical tables:

```text
bridge_installation
mobile_installations
workspaces
workspace_trust
sessions
session_processes
turns
commands
event_streams
events
client_cursors
controller_leases
follow_up_queue
extension_dialogs
attachments
exports
notification_devices
schema_migrations
backups
retention_runs
integrity_checks
compatibility_checks
```

Required properties:

- Transactions around command acceptance/state changes.
- Unique command ID and semantic payload hash.
- Unique `(stream_id, cursor)` and event ID.
- One active controller lease per scope/session.
- One durable mapping from mobile session to Pi session reference.
- Database-full/unwritable state rejects new commands.
- Integrity checks and online backups.
- Daily backup when safe; keep latest three successful copies.

Detailed entities/invariants: [`DATA_MODEL.md`](DATA_MODEL.md).

## 11. Host identity and generation

- First initialization creates stable non-secret `hostId`.
- Ordinary restart/update retains host ID and `hostGeneration`.
- Database restore/rollback that can move stream state backwards increments `hostGeneration`.
- Mobile observing a generation change discards cached stream events/cursors and snapshots again.
- Reinstall without restoring state creates a new host ID and requires re-pairing.

## 12. Event streams

Bridge owns:

- one host stream,
- one session stream per durable session.

Events commit before network send.

Host stream covers readiness, degradation, capacity, session/workspace summaries, and host command state.

Session stream covers runtime, controller, policy, turns, transcript, tools, queue, model/context/retry/compaction, dialogs, and command state.

Cursors:

- monotonic per stream,
- stored transactionally,
- converted to decimal strings in protocol,
- never based on wall clock,
- never reused within host generation.

Snapshot generation captures state and baseline consistently, then replays post-baseline events.

## 13. Controller leases

- One controller lease per session authorizes mutations.
- Observers may read without lease.
- Lease duration: 45 seconds.
- Same-install reconnect grace: 60 seconds.
- Traffic/heartbeat renews controlling lease.
- Explicit takeover revokes old lease.
- Stale connection/lease commands reject before acceptance.
- Lease state is durable enough to avoid dual acquisition after bridge restart.
- Lease is concurrency control, not authentication.

## 14. Command lanes

- Host commands serialize through a host lane.
- Session commands serialize independently per session.
- Duplicate lookup occurs before lane admission.
- Commands that cannot execute immediately either enter a documented durable queue or reject; no invisible in-memory wait.
- A state-changing command is not acknowledged before acceptance transaction commits.
- Running-at-crash becomes indeterminate.

## 15. Pi subprocess ownership

For each process, bridge records:

```text
process instance ID
mobile session ID
host-only Pi session reference
workspace ID/canonical path
PID and process-group ID
start/last-activity times
current turn ID
last Pi entry ID
restart count/window
state/exit/cleanup metadata
```

Process states:

```text
stopped
starting
idle
running
waiting_for_input
retry_wait
compacting
stopping
crashed
crash_loop
incompatible
```

Rules:

- One Pi subprocess per active session.
- One active turn per session.
- Phone disconnect never stops active turn.
- Idle eviction never occurs during turn, queue dispatch, retry, compaction, or pending dialog.
- Restored stopped session starts lazily.
- A restarted process is not presented as continuation of an indeterminate turn.

## 16. Capacity and idle policy

Defaults:

- 3 active Pi processes.
- Configurable 1–8.
- 10 queued follow-ups per session.
- 5-minute extension-dialog maximum.
- 30-minute eligible idle stop.
- 3 unexpected restarts in 5 minutes before crash loop.
- 5-second graceful stop before forced process-group cleanup.
- 256 KiB stderr diagnostic ring per process instance.

When capacity is reached:

1. Select least-recently-used eligible idle process.
2. Stop it durably.
3. Start requested session.
4. If no eligible victim exists, return `host_capacity` with bounded active summaries.
5. Never terminate running/attention/queued states to satisfy capacity.

## 17. Process cleanup

On macOS/Linux:

- start Pi in distinct process group,
- graceful stop targets Pi first,
- forced stop targets process group,
- record forced cleanup,
- report suspicious descendants/ports only as diagnostics.

This reduces orphans but does not guarantee cleanup of every deliberately daemonized descendant.

## 18. Crash recovery

### Bridge restart

1. Open/migrate/check SQLite before accepting commands.
2. Retain normal host generation if state is continuous.
3. Commands `accepted` but not dispatched may resume.
4. Commands/turns left running become `indeterminate`.
5. Expire/reconcile controller leases/connections.
6. Restore sessions lazily.
7. Replay host/session state to clients.

No prompt, extension response, delete, fork, clone, shell, or tool action already running is repeated automatically.

### Pi crash

- journal crash and bounded stderr metadata,
- active turn becomes indeterminate,
- restart process under threshold against same durable session,
- query latest durable state,
- restore session idle/repair/incompatible,
- require owner decision before new retry.

### Host reboot

- LaunchAgent restarts bridge,
- persistent Tailscale Serve resumes independently,
- sessions remain listed/stopped unless safe state transition requires attention,
- phone reconnects/snapshots/replays.

### Database full/unavailable

- fail readiness/degrade current reads as appropriate,
- reject all new state-changing commands,
- do not acknowledge acceptance,
- continue/observe already-running Pi only when safe to journal; otherwise drain/fail visibly,
- expose remediation through doctor.

## 19. Follow-up queue

Bridge owns a durable FIFO queue of undispatched follow-ups.

Rules:

- Follow-up accepted only after durable queue row/event commits.
- Maximum ten.
- Attachments remain referenced.
- Queue survives bridge/process restart.
- Remove/clear is transactional and duplicate-safe.
- On `agent_settled`, bridge dispatches next eligible item.
- Dispatch transition commits before Pi write.
- Once dispatched, item becomes a turn and cannot be removed as queued.
- Steering bypasses this queue and maps directly to Pi steering behaviour.
- Abort does not clear queue without separate command.

## 20. Workspace discovery

- Recents derive from session history under allowed roots.
- Search walks directory names with configured bounded depth.
- Initial exclusions: `.git`, `node_modules`, `.dart_tool`, `build`, `.gradle`, `.idea`, and hidden directories unless enabled.
- Search is cancellable and incremental.
- No permanent full-filesystem index in MVP.
- Results include workspace ID, root label, root-relative display path, repository marker, last used, availability, and trust state.
- Absolute paths remain host-only unless explicitly necessary for owner diagnostics.

## 21. Workspace trust

Before starting Pi in unknown/changed workspace:

- discover Pi trust-bearing project settings/resources/extensions/context according to pinned Pi,
- build manifest of relative identifiers/categories/content hashes,
- include bridge trust-policy version,
- compare stored fingerprint,
- show added/removed/changed categories/files,
- await explicit approval,
- store approving installation/timestamp/fingerprint.

Do not hash the full repository.

Existing running process keeps its current loaded state; a new process start pauses on changed trust.

## 22. Read-only policy

Host Pi extension enforces read-only mode through tool-call hooks.

Allowed by default:

```text
read
grep
find
ls
safe model/session/stat commands
```

Blocked by default:

```text
write
edit
mutating shell
package installation
destructive product actions in policy scope
```

Rules:

- effective policy is in session state/snapshot,
- changing policy is durable/duplicate-safe,
- running turn retains policy snapshot,
- unknown tools default to blocked until classified in Read-only mode,
- Full mode remains unsandboxed host-user execution.

## 23. Attachments

- Upload outside roots to private random path.
- Stream multipart with byte limits.
- Verify JPEG/PNG magic, decode, dimensions, and digest.
- Reject malformed/unreasonable dimensions.
- Do not trust filename/header.
- Unique `(installationId, clientUploadId)` retry identity.
- Same ID/different content conflicts.
- Periodically clean expired/orphaned uploads.
- Retain referenced uploads through queued dispatch/ingestion.
- Never log content or storage path.
- Convert to Pi base64 image shape only at RPC dispatch boundary.

## 24. Exports

- `session.export` invokes pinned Pi HTML export host-side.
- Bridge maps result to opaque `exportId` and private generated path.
- Download through same Serve origin.
- Default expiry: 24 hours.
- Clean on expiry/session purge.
- Never expose raw host export path.
- No public hosting/link generation.

## 25. Extension UI

Persist interactive requests with upstream ID, bridge dialog ID, method, payload, expiry, state, and response command.

- select/confirm/input/editor wait for response.
- notify/status/widget/title/editor-prefill normalize to bounded mobile events.
- disconnect does not cancel by itself.
- unexpired request replays after reconnect.
- expiry/abort/process crash resolves/orphans visibly.
- response is controller-lease protected and duplicate-safe.
- no invented default response.

## 26. Notifications

### Credentials

APNs token key and FCM service account remain host-side in Keychain or owner-only secret path.

### Registration

Store installation ID, platform, replaceable token, app version, capabilities, timestamps, and provider failures.

Tokens are not user identity.

### Events

Push only:

```text
turn settled
turn failed
turn indeterminate
extension attention required
host/session crash loop
```

Rules:

- coalesce status changes,
- rate-limit reminders,
- status-only/default generic payload,
- no transcript/command/path content,
- remove permanently invalid tokens,
- push failure never blocks Pi,
- opening notification always reconciles current state.

## 27. Health and readiness

### `/healthz`

Success when HTTP process and event loop are alive.

### `/readyz`

Checks:

- config parsed/schema supported,
- database open/writable/schema current,
- migration/restore not pending,
- Pi executable exists/version matches,
- required storage writable,
- loopback listener active,
- Tailscale/Serve state discoverable/expected where permissions permit,
- protocol schema/build metadata valid.

Push may be `degraded` without failing core readiness.

## 28. Doctor

`pi-mob doctor` reports only allowlisted metadata:

- bridge/protocol/Pi/Bun-build versions,
- host OS/architecture,
- config/schema paths/versions,
- listener/Serve target,
- database integrity/backup age/retention state,
- session/process/queue/crash-loop counts,
- missing/corrupt mappings,
- attachment/export storage state,
- push configured/degraded,
- log path/redaction mode.

It never prints provider/push keys, environment values, prompts, answers, reasoning, tool output, attachment bytes, or unrestricted absolute paths.

## 29. Logging

Structured record fields:

```text
timestamp
level
component
event code
host/session/turn/command IDs where relevant
duration/byte counts
error class/stable code
```

Default exclusions:

- transcript/reasoning/tool/source content,
- full paths; use IDs/root-relative values,
- environment variables,
- provider/push credentials/tokens,
- WebSocket query strings,
- attachment/export bytes.

Rotate at 10 MiB with five retained files.

## 30. Retention and maintenance

Defaults:

- host stream: 30 days/100 MiB total,
- session stream: 30 days/100 MiB each,
- command records: session lifetime plus deletion retention, at least latest 10,000,
- soft delete: 7 days,
- unreferenced upload/export: 24 hours,
- backups: latest 3,
- stderr ring: 256 KiB/process.

Maintenance jobs are bounded, resumable, and avoid long blocking transactions during active turns.

## 31. Backup, restore, and update

- Online backup while idle/lightly loaded.
- Record checksums and bridge/Pi/schema versions.
- Update performs preflight, drain, backup, stop, replace, migrate, start, verify.
- Rollback classification is binary-only, reversible migration, or restore-required.
- State restore/backward rollback increments host generation.
- Missing workspace/Pi-session references enter repair state rather than disappearing.

## 32. Shutdown

On SIGTERM/LaunchAgent stop:

1. Stop accepting new connections/commands.
2. Emit `host.draining` where possible.
3. Persist command/process/lease/queue/dialog state.
4. Flush journal and close attachment/export writes.
5. Request graceful Pi shutdown.
6. Force process-group cleanup after timeout.
7. Checkpoint WAL when safe.
8. Exit nonzero if required persistence/cleanup fails.
