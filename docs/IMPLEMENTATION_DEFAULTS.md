# Implementation defaults

Status: normative for MVP planning.

This document resolves the implementation gaps identified after the initial research pass. `PLANNING.md` remains useful research history, but this document takes precedence where the two conflict.

## 1. Product assumption

pi-mob is initially a single-user personal application. The owner controls the phone, host, and Tailscale network.

Consequences:

- Tailscale remains the sole connection-authentication boundary.
- No account system, password, pairing secret, biometric gate, or app-layer session token is added for MVP.
- The bridge still binds to loopback only and is exposed only through Tailscale Serve.
- The application must not claim protection from an unlocked stolen phone, a compromised host, or an already-authorized malicious tailnet node.

## 2. Initial platform order

- Mobile: Flutter for iOS and Android from one codebase.
- Host bridge: macOS first because it is the owner's current development and likely always-on-host environment.
- Linux service support follows after the macOS launch path is stable.
- Native Windows service support is deferred; the protocol and bridge code must remain portable enough not to prevent it later.
- Android Termux execution remains a later power-user route and does not shape MVP architecture.

## 3. Bridge implementation

- Use Bun and TypeScript.
- Keep the bridge in this repository as a sibling package to the Flutter application.
- Compile a self-contained host executable for release rather than requiring the user to manage a global Bun installation.
- Use SQLite in WAL mode for the bridge registry, event journal, command-idempotency records, notification registrations, and attachment metadata.
- Use a versioned TOML configuration file for host settings.

## 4. Connection endpoint

- Production transport is Tailscale Serve plus a stable MagicDNS HTTPS hostname.
- The bridge listens on `127.0.0.1:8787` by default.
- Tailscale Serve reverse-proxies the bridge and terminates TLS.
- Funnel is never configured.
- The QR code stores the host endpoint, not a permanent Pi session identifier.
- After connecting, the app requests the session list and explicitly selects or creates a session.

## 5. Workspace policy

- The host configuration contains an explicit list of allowed workspace roots.
- The initial default root is `~/Projects`; setup may add other roots.
- The phone shows recent workspaces first and folder-name search second.
- There is no general-purpose remote filesystem browser in MVP.
- Every selected path is canonicalized before use. Symlinks that resolve outside an allowed root are rejected by workspace selection.
- Hidden directories are omitted unless the root itself is explicitly configured.
- Missing or moved workspaces remain in recents with a clear unavailable state and can be removed.
- This path policy limits what the workspace picker can select. It is not a shell sandbox: in full tool mode, Pi and shell commands still execute with the host user's permissions.

## 6. Trust and tool policy

The default optimizes for a personal coding tool rather than repeated approval prompts.

- Unknown workspaces show one explicit trust screen before Pi starts with project resources enabled.
- Once trusted, built-in reads, writes, edits, and shell commands execute without per-command confirmation.
- Every tool call remains visible in the transcript.
- A persistent per-session **read-only mode** disables write/edit and non-read-only shell execution through the host extension policy.
- Trust is stored against the canonical workspace path plus a fingerprint of trust-bearing project resources.
- If project settings, extensions, or other trust-bearing resources change, the bridge asks for trust again before loading them.
- Extension-originated confirmation or input dialogs are always routed to the phone and never auto-approved.
- No simplistic command denylist is presented as a security boundary. Container or sandbox profiles may be added later as a separate feature.

## 7. Session and process model

- One `pi --mode rpc` subprocess per active session.
- The mobile application includes a session switcher in MVP.
- The bridge permits three active Pi subprocesses by default; configuration may set a value from one to eight.
- Additional sessions remain durable but stopped until selected or otherwise activated.
- One agent turn runs at a time per session.
- Up to ten follow-up prompts may be queued per session.
- An idle Pi subprocess stops after 30 minutes when it has no active turn, pending extension dialog, or connected foreground viewer.
- Selecting a stopped session lazily restores its Pi process and durable session.
- The bridge does not eagerly restart every prior session after a host reboot.

## 8. Crash and shutdown policy

- The bridge starts Pi in its own process group on Unix hosts.
- Graceful shutdown first requests Pi termination, waits five seconds, then terminates the process group.
- Unexpected Pi exit is retried at most three times in five minutes for that session.
- After the limit, the session enters `crash_loop` and requires a manual retry.
- A turn that was running when Pi or the host crashed is marked `indeterminate`; it is not automatically submitted again.
- Accepted but not yet dispatched commands may be dispatched after bridge recovery.
- Host shutdown persists session and command state before stopping children when the operating system provides enough shutdown time.

## 9. Replay and persistence

- The bridge assigns a monotonic sequence number per mobile session.
- Normalized events are committed to SQLite before they are sent to the phone.
- The phone deduplicates by `(sessionId, sequence)`.
- The bridge stores command IDs for the lifetime of the session, capped at the most recent 10,000 commands.
- Event journals retain 30 days with a 100 MB cap per session.
- If a phone cursor has expired, the bridge sends a fresh session snapshot from Pi and establishes a new replay baseline.
- Partial streaming events are replayable because they use the same journal as completed entries.
- Pi's durable session remains the canonical conversation record; the bridge journal is the canonical transport/recovery record.

## 10. Mobile local storage

- Use Drift/SQLite from the first implementation slice.
- Store paired hosts, session metadata, replay cursors, drafts, user preferences, and a rolling normalized-event cache.
- Keep a 30-day cache with a 250 MB global cap and least-recently-used eviction.
- Full durable history remains on the host and can be fetched again.
- Provide per-session cache deletion, clear-all-local-data, and forget-host actions.
- Mark the local database and attachment cache as excluded from cloud backup where the platform permits it.
- Do not store provider credentials, host shell secrets, APNs credentials, or FCM service credentials on the phone.

## 11. Attachments

- Attachments use an HTTPS upload endpoint on the same Tailscale Serve origin, not base64 inside WebSocket JSON.
- The mobile app converts selected images to JPEG or PNG, strips metadata, and resizes the longest edge to at most 2048 pixels before upload.
- Limit one file to 10 MB, one prompt to four files, and one prompt to 25 MB total.
- The bridge verifies MIME type from file contents, calculates SHA-256, and stores the upload in a private temporary directory.
- The prompt references opaque attachment IDs.
- Unreferenced uploads expire after 24 hours. Referenced temporary files are removed after Pi/provider ingestion no longer needs them.
- Attachment IDs are scoped to one paired host installation and cannot contain filesystem paths.

## 12. Notifications and background behaviour

Notifications remain in the MVP but are delivered as the third implementation slice so they do not block the reliable core loop.

- The host always continues an active Pi turn when the phone backgrounds or disconnects.
- Foreground WebSocket connectivity is preferred while the application is visible.
- iOS background status uses APNs plus Live Activities; the application does not claim that a background WebSocket remains alive.
- Android sustained connectivity is user-enabled and starts its foreground service while the app is visible. FCM is a best-effort notification/wake path, not a guarantee that a new foreground service can always start from the background.
- The bridge sends directly to APNs and FCM using owner-provided credentials stored on the host with restrictive file permissions.
- Device registration uses a random installation ID and replaceable platform token.
- Invalid or unregistered tokens are removed after provider rejection.
- Lock-screen payloads contain only status, session title, and host name by default. Prompt text, reasoning, tool output, file paths, and final-answer text are excluded.
- Notification previews can be reduced to a generic “Pi needs attention” message.
- If the host lacks public internet access, turns continue normally and push delivery is skipped.

## 13. Version compatibility

- The first protocol major is `1`.
- Every connection handshake reports mobile version, bridge version, protocol major/minor, and Pi version.
- A protocol-major mismatch refuses the connection with an actionable upgrade message.
- Minor versions are additive: receivers ignore unknown optional fields and event types but reject unknown required capabilities.
- During the first implementation slice, the bridge requires the pinned Pi version exactly.
- After contract coverage exists, support may expand to an explicitly tested Pi version range.
- No bridge auto-updater ships in v1. Installation and updates are deliberate host actions with rollback instructions.

## 14. Logging and diagnostics

- Structured JSONL logs rotate at 10 MB with five retained files.
- Prompt text, model output, tool output, file contents, environment variables, and provider credentials are not logged by default.
- Diagnostic mode may log event metadata and schemas but still redacts content and secrets.
- `/healthz` reports that the bridge process is alive.
- `/readyz` verifies SQLite, Tailscale-facing configuration, and Pi executable compatibility.
- A `pi-mob doctor` command prints versions, configuration validity, Serve status, database health, and child-process state without printing secrets.

## 15. MVP scope and sequencing

Concurrent sessions, fork/clone/tree, export/share, image attachments, and notifications remain MVP requirements. They do not all land in the first coding pass.

- **Slice A:** reliable core loop and recovery.
- **Slice B:** complete session, model, tool, trust, workspace, attachment, export, and sharing UX.
- **Slice C:** APNs, FCM, Live Activity, and Android foreground behaviour.

A later slice may not weaken contracts proven in an earlier slice.

## 16. Corrected compatibility statements

- Android API 29 remains the deliberate `minSdk` because the project wants one tested modern rendering path. It is a product floor, not a claim that Flutter cannot run below API 29.
- High-refresh rendering is a best-effort frame-pacing target. The operating system and display scheduler choose the actual refresh rate; the product does not guarantee 120 Hz.

## 17. Decisions explicitly deferred

- Multi-user accounts or shared bridges.
- Application-layer authentication.
- Biometric app locking.
- Public-internet access.
- Container/sandbox profiles.
- Windows service packaging.
- Android Termux parity.
- Automatic updates.
- Obsidian and stored notes.
