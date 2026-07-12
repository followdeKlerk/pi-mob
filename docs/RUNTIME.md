# Host runtime contract

Status: normative MVP contract.

This document defines how the bridge installs, starts, owns Pi processes, stores state, and exposes diagnostics.

## 1. Initial host target

The first supported host is macOS.

- Development baseline: the owner's current macOS machine.
- Service manager: `launchd` LaunchAgent for a user-scoped daemon.
- The bridge runs as the signed-in user because Pi and its tools need that user's repositories, credentials, shells, and developer environment.
- Linux `systemd --user` support follows after the macOS service path is proven.
- Running the daemon as root is unsupported.

## 2. Repository layout target

```text
apps/
  mobile/                 Flutter application
packages/
  bridge/                 Bun/TypeScript bridge
  pi-extension/           Pi command/QR extension
  protocol-fixtures/      shared JSON fixtures
scripts/
docs/
```

The first scaffold may be introduced incrementally, but package responsibilities must remain separate.

## 3. Release packaging

- Development uses the pinned Bun toolchain.
- Release builds compile the bridge into a self-contained executable.
- The release bundle contains the bridge executable, Pi extension, launchd template, default configuration, migration metadata, and uninstall script.
- The bridge does not download or update itself automatically.
- An update command validates the new binary, backs up the SQLite database and configuration, stops the service, replaces files, runs migrations, and restarts.
- Rollback restores the previous binary and database backup when the migration is reversible.

## 4. Filesystem locations on macOS

Suggested paths:

```text
~/Library/Application Support/pi-mob/config.toml
~/Library/Application Support/pi-mob/state.sqlite3
~/Library/Application Support/pi-mob/attachments/
~/Library/Application Support/pi-mob/backups/
~/Library/Logs/pi-mob/bridge.jsonl
~/Library/LaunchAgents/digital.deklerk.pi-mob-bridge.plist
```

- Configuration and state directories use owner-only permissions.
- APNs and FCM credentials live in an owner-readable secrets subdirectory or macOS Keychain adapter; never in the repository.
- Temporary attachment files are owner-only.
- Logs avoid content and secret material.

## 5. Configuration

`config.toml` has a required schema version.

```toml
schema_version = 1
listen_host = "127.0.0.1"
listen_port = 8787
pi_executable = "/absolute/path/to/pi"
pi_version = "0.80.6"
max_active_sessions = 3
idle_process_minutes = 30
event_retention_days = 30
session_event_cap_mb = 100

[[workspace_roots]]
path = "~/Projects"
label = "Projects"
include_hidden = false

[notifications]
enabled = false
preview_mode = "status_only"
```

Validation rules:

- Reject unknown required fields.
- Preserve unknown optional fields during migrations when possible.
- Refuse wildcard or non-loopback listen addresses in production mode.
- Canonicalize workspace roots at startup.
- Fail readiness when Pi is missing or has an incompatible version.
- Notification credential problems disable push and report degraded readiness; they do not prevent local agent use.

## 6. Tailscale Serve setup

The installer configures a persistent Serve reverse proxy to the loopback bridge.

Target shape:

```text
https://<host>.<tailnet>.ts.net/
    -> http://127.0.0.1:8787
```

Operational rules:

- Use Serve background/persistent configuration.
- Never use Funnel.
- Setup verifies MagicDNS and HTTPS availability.
- `pi-mob doctor` compares expected and actual Serve configuration.
- QR generation refuses to publish loopback, wildcard, public Funnel, or plain-LAN endpoints.
- The bridge trusts transport identity to Tailscale for MVP and does not add a second authentication layer.

## 7. Database

SQLite runs in WAL mode.

Core tables:

```text
hosts
installations
workspaces
workspace_trust
sessions
session_processes
commands
events
client_cursors
attachments
notification_devices
schema_migrations
```

Required properties:

- Foreign keys enabled.
- Transactions around command acceptance and state transitions.
- Unique `(session_id, sequence)` for events.
- Unique command ID plus stored payload hash.
- Database integrity check in `pi-mob doctor`.
- Daily online backup while the bridge is idle.
- Retain the latest three successful backups.

## 8. Pi subprocess ownership

The bridge is the sole owner of Pi RPC subprocesses created for mobile sessions.

For each process it records:

```text
mobile session ID
Pi durable session identity/path
canonical workspace path
PID and process-group ID
start time
last activity
current turn ID
last Pi entry ID
restart count/window
state
```

States:

```text
stopped
starting
idle
running
waiting_for_input
stopping
crashed
crash_loop
incompatible
```

Rules:

- Spawn with explicit cwd and a minimal inherited environment.
- Inherit only the environment required for the user's shell/toolchain and configured providers.
- Never serialize the full process environment to logs, database events, or mobile messages.
- Capture stderr into a bounded redacted diagnostic ring buffer.
- A phone disconnect never terminates an active turn.
- Idle eviction never occurs during a turn, retry, compaction, queued prompt, or pending extension dialog.

## 9. Process limits

Defaults:

- Three active Pi subprocesses.
- One turn per session.
- Ten queued prompts per session.
- Five-minute extension-dialog maximum.
- Thirty-minute idle stop.
- Three unexpected restarts per five-minute window.
- Five-second graceful process-stop window.
- Stderr diagnostic ring: 256 KiB per process.

When the active-process limit is reached:

1. Stop the least-recently-used eligible idle process.
2. If none is eligible, return `host_capacity` with the active sessions listed.
3. Never terminate a running process merely to satisfy a new session selection.

## 10. Process-group cleanup

On macOS and Linux:

- Start Pi in a distinct process group.
- Graceful stop targets Pi first.
- Forced cleanup targets the process group, not only the direct child.
- The bridge records whether forced cleanup was required.

This reduces orphaned child processes but does not claim that every daemonized process can be recovered. `pi-mob doctor` reports suspicious descendants or ports only as diagnostics.

## 11. Crash recovery

### Bridge restart

- Open and migrate SQLite before accepting connections.
- Commands left `accepted` but not dispatched may be resumed.
- Commands left `running` become `indeterminate`.
- Sessions restore lazily when selected or when required to finish a pending safe state transition.
- No user prompt, tool response, delete, fork, or clone command is repeated automatically after entering `indeterminate`.

### Pi crash

- Journal the crash and bounded stderr metadata.
- Mark the active turn `indeterminate`.
- Restart Pi against the same durable session when under the crash-loop threshold.
- Restore the session as idle and allow the user to inspect state before manually retrying.
- Do not represent a restarted process as continuation of the same active turn.

### Host reboot

- `launchd` restarts the bridge.
- Tailscale Serve persistent configuration resumes independently.
- Sessions remain listed but stopped.
- The phone reconnects and receives current host/session state.

## 12. Workspace discovery

- Recents are derived from bridge session history under allowed roots.
- Search walks directory names under configured roots with bounded depth and excludes common generated directories.
- Initial exclusions: `.git`, `node_modules`, `.dart_tool`, `build`, `.gradle`, `.idea`, and hidden directories unless configured.
- Search is cancellable and returns incrementally.
- The bridge does not build a permanent full-filesystem index in MVP.
- Results include canonical path, display path, repository marker, last-used timestamp, and trust state.

## 13. Workspace trust fingerprint

Trust-bearing resources are discovered before Pi starts in an unknown workspace.

The stored fingerprint includes:

- Canonical workspace path.
- Relative names and content hashes of project Pi settings/resources/extensions that Pi would load.
- Bridge trust-policy version.

When the fingerprint changes:

- Existing sessions may display the changed trust state.
- New process start pauses before loading changed resources.
- The phone shows what changed at a file/category level.
- Approval stores the new fingerprint.

The bridge does not scan or hash the entire repository.

## 14. Read-only mode

Read-only mode is enforced through the Pi host extension/tool policy, not only by hiding buttons in Flutter.

Allowed by default:

```text
read
grep
find
ls
safe session/model/stat commands
```

Blocked by default:

```text
write
edit
mutating shell execution
package installation
session deletion
```

- The bridge reports the effective policy in session state.
- Changing policy is a duplicate-safe command.
- A turn already running keeps the policy snapshot under which it started.
- Read-only mode is a product guardrail, not a complete operating-system sandbox.

## 15. Attachments

- Store uploads outside workspace roots.
- Use random filenames unrelated to the user-supplied name.
- Verify JPEG/PNG magic and decode dimensions before acceptance.
- Reject malformed images and unreasonable decoded dimensions.
- Strip metadata on the phone and do not preserve the original filename by default.
- Run a periodic cleanup for expired or orphaned uploads.
- Attachment content is not written to structured logs.

## 16. Push credentials and device registration

### APNs

- Use token-based APNs authentication.
- Store key identifier, team identifier, topic, and private key on the host.
- Reuse provider tokens within their allowed lifetime rather than creating one per notification.
- Record provider rejection codes without including notification content.

### FCM

- Store the service-account credential on the host.
- Use the current HTTP v1 API path.
- Remove device tokens on permanent unregistered/invalid responses.

### Registration

The mobile app registers:

```text
installation ID
platform
push token
app version
notification capabilities
last-seen timestamp
```

Tokens are replaceable and never treated as user identity.

## 17. Notification events

Push only for:

```text
turn settled
turn failed
turn indeterminate
extension attention required
host entered crash loop
```

Do not push every streamed delta or tool event.

- Coalesce repeated status changes for the same turn.
- Rate-limit attention reminders.
- Dismiss or update the Live Activity when a turn settles, aborts, or becomes indeterminate.
- The phone always reconciles with bridge state after opening from a notification.

## 18. Health and diagnostics

### `/healthz`

Returns success when the HTTP process and event loop are alive.

### `/readyz`

Checks:

- Configuration parsed.
- Database writable.
- Schema current.
- Pi executable exists and version matches.
- Attachment directory writable.
- Loopback binding active.
- Tailscale/Serve status discoverable where permissions permit.

Push configuration may be reported as `degraded` without failing core readiness.

### `pi-mob doctor`

Reports:

- Bridge, protocol, Bun-build, and Pi versions.
- Host OS and architecture.
- Config path and schema version.
- Loopback listener and Serve target.
- Database integrity and backup age.
- Session/process counts and crash loops.
- Push configured/degraded state.
- Log path and redaction mode.

It never prints provider keys, push private keys, environment values, prompt text, output, or attachment bytes.

## 19. Logging

Structured records contain:

```text
timestamp
level
component
event code
host/session/turn/command identifiers when relevant
duration and byte counts
error class and stable code
```

Default redactions:

- Prompt and response content.
- Reasoning and tool output.
- File contents.
- Full filesystem paths in normal logs; use stable path IDs or root-relative paths.
- Environment variables.
- Provider and push credentials.
- WebSocket query strings.

## 20. Shutdown

On SIGTERM or launchd stop:

1. Stop accepting new connections and commands.
2. Notify connected clients with `host.draining` where possible.
3. Persist current command/process state.
4. Allow a brief grace period for journal flush.
5. Request graceful Pi child shutdown.
6. Force process-group cleanup after timeout.
7. Checkpoint SQLite WAL when safe.
8. Exit nonzero if state persistence or cleanup failed.
