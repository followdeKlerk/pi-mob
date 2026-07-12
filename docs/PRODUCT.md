# Product specification

Status: normative for MVP.

This document defines what `pi-mob` is, who it serves, what the MVP must do, and what it deliberately does not attempt. Technical documents must support this product contract rather than expanding scope independently.

## 1. Product statement

`pi-mob` is a private mobile control surface for Pi coding-agent sessions running on a user-controlled host.

It lets one owner start, observe, steer, queue, stop, resume, and manage long-running coding work from an iPhone or Android phone while the actual agent, repositories, provider credentials, shells, and tools remain on the host.

It is not a mobile IDE, terminal emulator, hosted agent service, or public remote-access product.

## 2. Primary user and operating environment

Initial user:

- One technically capable owner.
- The owner controls the phone, host, Pi installation, provider accounts, and Tailscale tailnet.
- The owner accepts that a trusted Pi session can modify files and run commands with the host user's permissions.

Initial environment:

- Flutter application on iOS and Android.
- macOS host first; Linux follows after the macOS service path is stable.
- Tailscale installed and connected on phone and host.
- Tailscale Serve exposes a loopback-only bridge through a stable MagicDNS HTTPS origin.
- Pi `@earendil-works/pi-coding-agent` version `0.80.6` is the first pinned upstream contract.

## 3. Problem being solved

Coding-agent work often continues longer than the user can remain at the computer. Existing terminal remoting is possible but poor on a phone: it is hard to inspect structured tool activity, distinguish reasoning from final output, answer extension dialogs, manage multiple sessions, recover after network changes, or know whether an action was submitted twice.

`pi-mob` provides a mobile-native interface while preserving the host as the execution authority.

## 4. Product goals

The MVP must make these outcomes reliable:

1. Pair a phone with one private host without creating another account system.
2. Select a trusted workspace and create or resume a Pi session.
3. Submit a prompt exactly once at the bridge-dispatch boundary, even across acknowledgement loss.
4. Watch streaming response, reasoning, queue, retry, compaction, and tool activity in a readable transcript.
5. Steer or queue follow-up work without racing the current turn.
6. Abort work and clearly understand whether it stopped, failed, or became indeterminate.
7. Leave the app, lock the phone, change networks, and later reconcile with host state.
8. Switch between durable sessions without keeping every Pi process alive.
9. Answer Pi extension dialogs from mobile.
10. Receive privacy-preserving status notifications when work settles, fails, or needs attention.
11. Diagnose host, bridge, Pi, transport, and compatibility problems without reading raw logs.

## 5. Product principles

### Host authoritative

The host owns repositories, Pi processes, durable Pi sessions, credentials, bridge state, exports, and raw tool output. The phone is a reconnectable control and presentation client.

### Never hide uncertainty

The UI must distinguish:

- accepted,
- queued,
- dispatched,
- running,
- waiting for input,
- retrying,
- compacting,
- settled,
- aborted,
- failed,
- crashed,
- indeterminate.

A process crash must never be presented as successful continuation.

### No silent duplicate side effects

Client-generated command IDs and durable bridge state prevent duplicate bridge dispatch. Actions that may already have reached external tools are never automatically repeated after an indeterminate crash.

### Mobile-native, not terminal parity

Rebuild useful behaviours as structured mobile controls. Do not reproduce terminal themes, keybindings, arbitrary TUI overlays, or a general shell interface.

### Visible tool activity

Every Pi tool call shown to the model must be represented in the transcript. Full mode does not mean invisible execution.

### Background work belongs to the host

The host continues turns after the phone disconnects. Mobile sockets and push delivery are treated as best effort; foreground reconciliation is always authoritative.

### Private by default

No public Funnel, provider credentials on mobile, transcript content in default notifications, content-rich logs, or automatic public sharing.

## 6. Core user journeys

### 6.1 First setup

1. Install and configure the bridge on the host.
2. Verify Pi, SQLite, loopback binding, Tailscale Serve, workspace roots, and optional notification credentials with `pi-mob doctor`.
3. Run the Pi `/pi-mob` extension command or host CLI to display a pairing QR.
4. Scan the QR in the mobile app.
5. Complete a protocol handshake and save the non-secret host identity and endpoint.
6. Display host readiness and any degraded capabilities.

Manual endpoint entry is retained as a recovery path.

### 6.2 Start work

1. Open the host dashboard.
2. Choose a recent workspace or search configured roots.
3. Review trust-bearing project resources when approval is required.
4. Create a session or resume an existing one.
5. Select a configured model and thinking level if no valid session defaults exist.
6. Submit a prompt.
7. See acceptance before execution begins.

### 6.3 Monitor and intervene

The user can:

- follow streaming assistant and reasoning content,
- expand or collapse tool cards,
- inspect queue state,
- submit a steering message,
- queue a follow-up,
- remove a bridge-owned follow-up before dispatch,
- answer extension input,
- abort the current turn,
- change model or thinking level when session state permits,
- initiate compaction or stop a retry.

### 6.4 Recover after disconnect

1. The app reconnects immediately on foreground.
2. It handshakes and resumes the host stream plus subscribed session streams.
3. Missing events replay in order.
4. Expired cursors fall back to snapshots.
5. The client displays the current durable state rather than assuming the previous socket state survived.

### 6.5 Manage sessions

The user can:

- list, search, sort, name, and open sessions,
- see stopped, starting, idle, running, waiting, crashed, crash-loop, incompatible, and deleted states,
- fork from an eligible user entry,
- clone the current branch,
- inspect the session tree,
- soft-delete and restore within the retention window,
- export to HTML and invoke the mobile OS share sheet.

Session names do not need to be unique. Stable IDs are authoritative.

### 6.6 Background completion

1. The host continues the turn.
2. APNs or FCM may deliver a status-only notification.
3. iOS may update a Live Activity.
4. Opening the notification deep-links to the session.
5. The app still reconciles against the bridge before showing the result.

No notification action mutates a session in MVP. Notification taps only open the app.

## 7. Functional requirements

### Host and pairing

- Support one or more paired hosts in the mobile data model, while the first release is validated against one host.
- Give every bridge installation a stable, non-secret `hostId` and mutable display name.
- Pair by QR or manual HTTPS endpoint.
- Use normal platform TLS validation; do not add certificate pinning in MVP.
- Detect incompatible protocol and Pi versions with actionable UX.
- Show bridge version, Pi version, readiness, last seen, and degraded capabilities.

### Workspaces and trust

- Discover only beneath configured workspace roots.
- Canonicalize paths and reject picker results escaping roots through symlinks.
- Show recents first and cancellable incremental search second.
- Never send absolute host paths to the phone when a root-relative display path is sufficient.
- Fingerprint only Pi trust-bearing project resources, not the entire repository.
- Require approval again when the fingerprint or trust-policy version changes.
- Support full and read-only session policies.

### Sessions and processes

- Use one Pi RPC subprocess per active session.
- Default to three active processes, with one to eight configurable.
- Stop eligible idle processes after 30 minutes and restore lazily.
- Never evict running, queued, retrying, compacting, or waiting-for-input sessions.
- Serialize state-changing operations per session.
- Maintain one active mobile controller lease per session; additional connections observe until they explicitly take control.
- A reconnect from the same installation may reclaim its lease without user friction.

### Prompting and queueing

- Do not automatically send prompts composed while disconnected.
- Persist the draft locally and require an explicit send after reconnection.
- Require an explicit delivery mode while a turn is running: steer or follow-up.
- Send steering directly to Pi using its steering semantics.
- Keep mobile follow-ups in a durable bridge-owned queue until Pi is eligible to receive them.
- Permit removing or clearing follow-ups that have not been dispatched.
- Limit the queue to ten accepted follow-ups per session.

### Transcript

- Separate reasoning, tool activity, and final answer surfaces.
- Preserve copy and selection for user-visible text.
- Support lazy history loading and stable event identity.
- Render unknown optional events as a diagnostic placeholder rather than crashing.
- Default completed reasoning to collapsed and active reasoning to expanded.
- Never announce every streamed token to accessibility services.

### Tool activity

- Support generic built-in tool cards for `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`.
- Preserve unknown extension tools as generic cards with safe argument and result summaries.
- Cap inline raw output and clearly mark truncation.
- Distinguish tool cancellation, tool error, provider interruption, process crash, and policy denial.

### Models, context, retry, and compaction

- List only models currently configured on the host.
- Keep provider authentication and custom model configuration host-only for MVP.
- Expose model, thinking level, steering mode, follow-up mode, auto-retry, and auto-compaction state when supported by pinned Pi.
- Display session cost and context usage as advisory values, including unknown/null states.
- Never claim a hard spending cap.

### Attachments

- Support JPEG and PNG upload through HTTPS, outside the WebSocket.
- Strip metadata and resize on mobile before upload.
- Verify content type and decoded dimensions on the host.
- Use opaque attachment IDs and defined expiry/cleanup.
- Prevent prompt acceptance if a referenced attachment is unavailable.

### Extension UI

- Map select, confirm, input, and editor requests to native sheets.
- Map notify, status, title, widget lines, and editor-prefill to supported mobile surfaces.
- Preserve dialog identity, expiry, duplicate-safe response, and cancellation.
- Never invent a default response after disconnect or expiry.

### Export, sharing, and deletion

- Generate exports host-side.
- Expose them through short-lived opaque download IDs over the same Tailscale origin.
- Invoke the platform share sheet only after explicit user action.
- Do not create public share links in MVP.
- Soft-delete sessions for seven days before durable deletion.
- Make partial deletion repairable and visible.

### Notifications

- Notify only for settled, failed, indeterminate, attention-required, and crash-loop states.
- Exclude prompt, reasoning, final-answer, tool-output, credential, and path content by default.
- Coalesce repeated state changes.
- Treat APNs and FCM delivery as best effort.

## 8. Non-functional requirements

### Reliability

- No command is accepted unless its durable acceptance record commits.
- Reconnect replay is ordered, duplicate-safe, and gap-detecting.
- A bridge or Pi crash cannot cause silent automatic repetition of an indeterminate action.
- Database-full and migration failures fail closed for new commands.

### Performance targets

Targets are release gates, not protocol guarantees:

- Local interaction feedback within 100 ms for taps and composer actions.
- Accepted-command acknowledgement within 500 ms on a healthy tailnet, excluding Pi startup.
- First normalized stream event displayed within 150 ms of bridge receipt.
- Reconnect handshake and current-state reconciliation within 5 seconds on a healthy tailnet.
- Smooth scrolling for at least 1,000 rendered transcript items through paging and lazy construction.
- No unbounded queue, event, image, output, or log buffer.

### Accessibility

- Support VoiceOver, TalkBack, Switch Control, Voice Control, keyboard navigation where available, reduced motion, and text scaling to 200%.
- Status must never be communicated by colour alone.
- Focus must return predictably after sheets and dialogs.

### Privacy

- No provider or push credentials on mobile.
- Exclude mobile databases and caches from cloud backup where supported.
- Use OS data protection; no custom database encryption is required for the initial single-user threat model.
- Redact content and secrets from normal logs.

### Maintainability

- Version every protocol shape.
- Keep Pi-specific types inside the bridge adapter.
- Share protocol fixtures between Dart and TypeScript.
- Require migrations, compatibility tests, and documentation updates with behaviour changes.

## 9. MVP boundary

MVP includes:

- reliable core loop,
- pairing and diagnostics,
- workspace selection and trust,
- polished transcript and tool cards,
- model/context controls,
- concurrent session management,
- fork/clone/tree/delete/restore,
- attachments,
- extension dialogs,
- export and local sharing,
- status notifications and background reconciliation,
- accessibility, performance, installation, update, rollback, and recovery gates.

## 10. Explicit non-goals for MVP

- Public internet exposure.
- Multi-user accounts, teams, roles, or collaboration.
- A general-purpose terminal.
- A full filesystem browser.
- Editing repository files directly in a mobile code editor.
- Git staging, commit, or PR UX independent of Pi.
- Provider login, API-key entry, or billing management on mobile.
- Guaranteed background WebSockets.
- Guaranteed push delivery.
- A complete OS sandbox.
- Public share URLs.
- Windows service packaging.
- Android Termux parity.
- Automatic bridge updates.
- Obsidian integration or stored notes.
- App Store or Play Store public launch; initial distribution is private TestFlight and signed Android release builds.

## 11. MVP success criteria

The MVP is successful when the owner can complete all of these without opening a terminal on the phone:

1. Pair a fresh installation and diagnose missing prerequisites.
2. Start a real Pi task in a trusted repository.
3. Disconnect before acknowledgement and prove only one prompt dispatch.
4. Move between Wi-Fi and cellular and recover ordered output.
5. Lock the phone during a turn and later see the correct settled state.
6. Answer an extension dialog after reconnecting.
7. Run three sessions, allow one to stop idle, and restore it.
8. Fork or clone a session and continue from the intended branch.
9. Upload an image and complete a prompt.
10. Export and share a session without creating a public URL.
11. Survive bridge restart, Pi crash, database-full simulation, and expired replay cursor with correct visible states.
12. Pass accessibility, privacy, compatibility, and host-install release gates.

## 12. Product decisions that require review only when assumptions change

Revisit the architecture when any of these becomes true:

- More than one human user shares a bridge.
- The bridge becomes reachable outside Tailscale.
- Provider credentials move to mobile.
- A public app-store release becomes a product goal.
- Mobile file editing or terminal access becomes a product goal.
- Pi removes or materially changes RPC mode.
- The host must support untrusted repositories without host-user-level access.
