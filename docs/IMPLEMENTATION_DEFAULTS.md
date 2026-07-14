# Implementation defaults

Status: normative for MVP.

This document is the compact implementation baseline. Detailed behaviour lives in the linked normative documents:

- [`PRODUCT.md`](PRODUCT.md)
- [`ARCHITECTURE.md`](ARCHITECTURE.md)
- [`PROTOCOL.md`](PROTOCOL.md)
- [`DATA_MODEL.md`](DATA_MODEL.md)
- [`RUNTIME.md`](RUNTIME.md)
- [`UX.md`](UX.md)
- [`SECURITY.md`](SECURITY.md)
- [`TESTING.md`](TESTING.md)
- [`RELEASE.md`](RELEASE.md)
- [`DECISIONS.md`](DECISIONS.md)
- [`../BACKLOG.md`](../BACKLOG.md)

Where historical `PLANNING.md` text conflicts with these documents, the normative documents win.

## 1. Product assumption

- Single-user personal application for the initial release.
- Owner controls phone, host, provider accounts, and Tailscale tailnet.
- Tailscale is the sole connection-authentication boundary.
- No app account, password, pairing secret, bearer token, biometric gate, or public endpoint.
- The product does not protect against an unlocked stolen phone, compromised host, or malicious already-authorized tailnet node.

## 2. Product boundary

`pi-mob` is a mobile-native control surface for Pi sessions running on the host.

It is not:

- a terminal emulator,
- a mobile IDE,
- a hosted agent service,
- a general filesystem browser,
- a provider-account manager,
- a public sharing service.

## 3. Initial platforms

- Mobile: Flutter/Dart for iOS and Android.
- Host: macOS first with a user-scoped LaunchAgent.
- Linux `systemd --user` follows after macOS is proven.
- Windows service and Android Termux are post-MVP.
- Bridge never runs as root.

## 4. Upstream Pi contract

Initial source of truth:

```text
repository: earendil-works/pi
package:    @earendil-works/pi-coding-agent
version:    0.80.6 exact
mode:       pi --mode rpc subprocess
```

- Pi-specific RPC/session/extension shapes remain inside the bridge adapter.
- A real pinned-Pi contract suite is required.
- Any Pi update triggers explicit RPC, session, extension, and compatibility review.
- `agent_settled`, not `agent_end`, is the mobile idle boundary.

## 5. Repository shape

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

- Bridge: Bun/TypeScript.
- Protocol schemas: TypeBox with generated JSON Schema and shared fixtures.
- Release bridge: compiled self-contained executable.
- Direct dependencies and toolchains are pinned exactly.

## 6. Connection topology

- Bridge listens on `127.0.0.1:8787` by default.
- Persistent Tailscale Serve reverse-proxies the loopback bridge.
- MagicDNS HTTPS origin is stored on mobile.
- Funnel is never configured.
- QR contains host discovery metadata only, not a secret or session ID.
- Standard TLS verification applies; no certificate pinning in MVP.
- One WebSocket connection per selected host multiplexes all state.

## 7. Identity and streams

- Bridge install has stable non-secret `hostId` and mutable display name.
- Mobile install has random `installationId`.
- Host generation changes when restored/rolled-back state invalidates all cursors.
- One mandatory host stream carries readiness and session/workspace summaries.
- Independent session streams carry transcript and session-specific state.
- Stream cursors are monotonic decimal strings, never JSON numbers.
- Events commit before network send.
- Mobile deduplicates by `(streamId, cursor, eventId)` and pauses a stream on gaps.
- Expired/invalid cursors use atomic snapshot plus post-baseline replay.

## 8. Controller and concurrency policy

- Multiple installations/connections may observe a session.
- One active controller lease authorizes mutations per session.
- Lease lifetime: 45 seconds.
- Same-installation reconnect grace: 60 seconds.
- Takeover is explicit and revokes the old lease.
- Session commands serialize per session; independent sessions may progress concurrently.
- Controller leases are concurrency control, not authentication.

## 9. Command durability

- Every state-changing user intent has a client-generated command ID.
- Semantic payload is canonicalized and SHA-256 hashed.
- Acceptance and initial command-state event commit in SQLite before acknowledgement.
- Same ID/same semantic payload returns existing state without redispatch.
- Same ID/different semantic payload returns `idempotency_conflict`.
- Accepted but undispatched commands may resume after bridge restart.
- Running-at-crash commands become `indeterminate` and never automatically repeat.
- No command is accepted while SQLite cannot durably write.

## 10. Session and process model

- One durable mobile session maps to one durable Pi session.
- Zero or one Pi RPC subprocess exists per session.
- Default active process capacity: 3.
- Configurable range: 1–8.
- One active agent turn per session.
- Eligible idle process stops after 30 minutes.
- Additional sessions remain durable and stopped.
- Selecting a stopped session restores it lazily.
- Never evict running, queued, retrying, compacting, or waiting-for-input sessions.
- Unexpected Pi exits: maximum three restart attempts per five-minute window before `crash_loop`.
- Pi starts in a distinct process group; forced cleanup targets the group.

## 11. Host process environment

- Spawn Pi directly using an absolute executable and explicit cwd.
- Do not invoke an interactive/login shell or source shell startup files.
- Configure explicit PATH and allowlisted environment names.
- Optional extra variables live in an owner-only environment file.
- Pi stdout is reserved for RPC JSONL; diagnostics use bounded redacted stderr.
- Full environment is never logged, persisted to events, or sent to mobile.

## 12. Prompt and queue policy

- Idle prompt: dispatch immediately after acceptance.
- Running turn: user explicitly selects Steer or Follow up.
- Steering maps to Pi steering semantics.
- Follow-ups remain in a durable bridge-owned queue until Pi is settled and eligible.
- Queue capacity: ten per session.
- Undispatched queue items may be removed or cleared.
- Queue attachments remain retained while referenced.
- Aborting a turn does not silently clear queued follow-ups.
- A disconnected draft is retained locally and never auto-sent after reconnect.

## 13. Workspace selection and trust

- Host configuration contains explicit allowed workspace roots.
- Initial suggested root: `~/Projects`; setup may add others.
- Mobile shows recents first and bounded incremental folder-name search second.
- No permanent whole-filesystem index and no general filesystem browser.
- Paths are canonicalized; picker symlink escape outside roots is rejected.
- Mobile receives root-relative display paths instead of absolute paths where possible.
- Bridge fingerprints Pi trust-bearing project resources before unknown/changed workspace start.
- Owner explicitly approves changed resource manifest before loading.

## 14. Tool policy

- Full mode: trusted workspace read/write/edit/shell execute without repeated per-tool confirmation.
- Every tool call remains visible in transcript.
- Read-only mode is enforced by host Pi extension hooks, not just mobile UI.
- Read-only allows read/grep/find/ls and safe session/model/stat operations.
- Read-only blocks write/edit, mutating shell, package install, and destructive product actions in its policy scope.
- Policy snapshot is fixed for a running turn.
- No command-text denylist or workspace-root policy is claimed as an OS sandbox.

## 15. Bridge persistence

Use SQLite in WAL mode for:

- host/mobile installation registry,
- workspaces and trust,
- sessions/processes/turns,
- commands and events,
- streams/cursors,
- controller leases,
- follow-up queues,
- extension dialogs,
- attachments/exports,
- notification devices,
- migrations/maintenance.

Defaults:

- Session event retention: 30 days and 100 MiB per session stream.
- Host event retention: 30 days and 100 MiB total.
- Command records: session lifetime/deletion retention, at least latest 10,000 per session.
- Daily online backup when safe; keep latest three.
- Soft-deleted session retention: 7 days.

Pi durable session remains canonical conversation history. Bridge journal remains canonical transport/control recovery history.

## 16. Mobile storage

Use Drift/SQLite from the first working client.

Store:

- paired hosts,
- session/workspace summaries,
- stream cursors and bounded normalized events,
- drafts and local attachment state,
- preferences and controller state.

Defaults:

- 30-day cache.
- 250 MiB global LRU cap.
- Per-session cache deletion, clear cache, clear all local data, and forget host.
- Exclude reconstructible database/cache from cloud backup where platforms permit.
- No provider, APNs, FCM service, host shell, or Pi credentials on mobile.
- No custom database encryption required for the initial unlocked-device threat model.

## 17. Transcript and tool presentation

- Three surfaces: reasoning, tool cards, final answer.
- Reasoning expanded while active, collapsed after completion by default.
- Generic built-in cards for read/bash/edit/write/grep/find/ls.
- Unknown extension tools render as bounded generic cards.
- Parallel tool calls remain separate and associated with the same assistant step.
- Maximum individual tool event payload: 256 KiB.
- Maximum inline retained mobile tool output: 5 MiB per call.
- Larger output emits truncation metadata; full output stays host-only in v1.
- Long history uses paging, lazy construction, stable keys, and paint isolation.

## 18. Attachments and exports

Attachments:

- HTTPS multipart upload on same Tailscale origin.
- JPEG/PNG only.
- Strip metadata and resize longest edge to at most 2048 pixels on mobile.
- Maximum 10 MiB per file, four files and 25 MiB per prompt.
- Verify bytes, decode dimensions, hash, randomize private host path.
- Prompt references opaque attachment IDs.
- Unreferenced uploads expire after 24 hours.

Exports:

- Generate HTML host-side through Pi.
- Return opaque export ID.
- Download through private HTTPS endpoint.
- Default expiry: 24 hours.
- Share through platform OS sheet after explicit action.
- No public share links.

## 19. Extension UI

- Interactive: select, confirm, input, editor.
- Presentation: notify, status, bounded widget, title, composer prefill.
- Pending dialogs persist with stable ID and server-enforced expiry.
- Default maximum expiry: 5 minutes.
- Duplicate-safe response requires controller lease.
- Disconnect never invents a default answer.
- Composer prefill is visible and never auto-submits.

## 20. Notifications and background

Notifications remain MVP but land after reliable core/session work.

- Host always continues active Pi turn after phone disconnect/background.
- Foreground WebSocket is preferred while app is visible.
- APNs plus Live Activities remain the designed iOS path, but Apple activation and physical-device testing are deferred until Apple products return to scope; no persistent background socket is claimed.
- Android foreground service is user-enabled and started while app is visible.
- FCM is best effort and does not guarantee background service start.
- The current activated bridge sends directly to FCM with an owner-provided host-side credential. The APNs adapter remains deterministic-only until Apple scope is reactivated.
- Notify only settled, failed, indeterminate, attention-required, and crash-loop states.
- Default lock-screen payload contains status plus host/session display names only.
- No mutating notification actions in MVP.
- Opening any notification reconciles with bridge before showing state.

## 21. Compatibility

- Protocol major `1`; minor versions additive.
- Handshake reports mobile, bridge, protocol, host generation, Pi version, capabilities, and limits.
- Major mismatch refuses connection.
- Unknown required capability refuses affected connection/workflow.
- Unknown optional fields/events are ignored safely and diagnosed.
- Pi is exact-pinned during first implementation checkpoints.
- Expansion to a version range requires tests at every supported boundary.
- No bridge auto-updater in v1.

Current deliberate floors:

- Flutter `3.44.4` / Dart `3.12.2`, subject to M0 artifact verification.
- iOS 16.1 for Live Activities.
- Android API 29 as a product quality floor, not a Flutter impossibility below it.
- High-refresh rendering is best effort; OS selects actual 60/90/120 Hz behaviour.

## 22. Logging and diagnostics

- Structured JSONL logs rotate at 10 MiB with five retained files.
- No prompt, answer, reasoning, tool output, source content, environment values, absolute paths, or credentials by default.
- `/healthz` means HTTP process/event loop alive.
- `/readyz` verifies config, DB/schema, Pi compatibility, storage, listener, and discoverable Serve state.
- Push problems degrade readiness without blocking agent use.
- `pi-mob doctor` reports versions, configuration, Serve, DB/backup, process/session, storage, compatibility, and push state using an explicit redacted allowlist.

## 23. Delivery checkpoints

The MVP is delivered through M0–M17 in [`BACKLOG.md`](../BACKLOG.md), not one oversized implementation pass.

Immediate sequence:

1. Close M0 specification/upstream/toolchain verification.
2. M1 monorepo scaffold and CI.
3. M2 executable protocol schemas/fixtures.
4. M3 real Pi adapter.
5. M4 durable bridge streams/idempotency.
6. M5 one-session end-to-end client.

Later checkpoints add host installation, trust, production UI, controls, multi-session, lifecycle, files, extension UI, notifications, and hardening without weakening earlier reliability contracts.

## 24. Explicitly deferred

- Multi-user/shared bridges.
- Application-layer authentication.
- Biometric app lock.
- Public internet access/Funnel.
- Public sharing links.
- Full OS sandbox/container profiles.
- Per-command confirmation mode.
- Windows service packaging.
- Android Termux parity.
- Automatic updates.
- Obsidian/stored notes.
- General terminal, file editor, or mobile IDE.
- Public app-store launch.
