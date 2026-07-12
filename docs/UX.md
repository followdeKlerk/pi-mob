# Mobile UX specification

Status: normative for MVP.

This document defines the mobile information architecture, screen inventory, interaction rules, visible states, and accessibility behaviour.

## 1. Navigation model

Primary hierarchy:

```text
Onboarding / Pair host
  -> Host dashboard
       -> Session list
       -> Workspace picker
       -> Host diagnostics
       -> Host settings
       -> Session transcript
            -> Session details
            -> Model/thinking controls
            -> Queue
            -> Session tree
            -> Export/share
```

Use standard platform back navigation. Deep links from notifications resolve to host, then session, then reconcile before rendering the requested state.

## 2. Global connection presentation

Connection states:

```text
unpaired
connecting
handshaking
synchronizing
ready
degraded
disconnected
host_unreachable
incompatible
host_draining
```

Rules:

- Never use a permanent full-screen blocker for a short reconnect if cached content remains useful.
- Show a compact persistent banner for disconnected/degraded state.
- Disable state-changing actions when the bridge cannot durably accept them.
- Preserve composer text while disconnected.
- Do not queue an offline send automatically.
- Foregrounding triggers immediate reconnect and visible synchronization.
- A stale cached transcript is labelled with last synchronized time.

## 3. Onboarding and pairing

### Prerequisite screen

Explain and check:

- Tailscale is installed and connected.
- Phone and host belong to the same tailnet.
- Bridge is installed and running.
- Tailscale Serve and MagicDNS are configured.

Do not request Tailscale account credentials.

### Pair screen

Actions:

- Scan QR.
- Enter endpoint manually.
- Open troubleshooting.

QR confirmation shows:

- host display name,
- MagicDNS hostname,
- protocol major,
- non-secret host ID suffix.

The user confirms before the host is saved.

### Pair outcomes

- Ready: continue to host dashboard.
- Degraded: continue with unavailable capabilities explained.
- Incompatible: show app/bridge/Pi versions and exact required action.
- Unreachable: retain endpoint for retry or discard.

## 4. Host dashboard

Displays:

- host name and connection state,
- bridge and Pi versions,
- active process capacity,
- running/waiting/crash-loop session counts,
- recent sessions,
- recent workspaces,
- degraded capability cards,
- last successful backup and doctor summary when available.

Primary actions:

- New session.
- Open session list.
- Choose workspace.
- Diagnostics.

Host dashboard is driven by the replayable host stream.

## 5. Workspace picker

Sections:

1. Recent workspaces.
2. Search configured roots.
3. Unavailable recents.

Each row shows:

- display name,
- configured root label and relative path,
- repository marker when detected,
- last used,
- trust state,
- unavailable reason.

Search:

- starts after two characters or explicit submit,
- is cancellable,
- streams results incrementally,
- never exposes paths outside configured roots,
- does not search file contents.

### Trust review

Before starting Pi with changed or unknown trust-bearing resources, show:

- categories of resources Pi would load,
- root-relative filenames,
- added/removed/changed status,
- explanation that approval is not a sandbox,
- Full mode and Read-only mode choices.

Actions:

- Trust and continue in Full mode.
- Trust and continue Read-only.
- Cancel.

No default countdown or auto-approval.

## 6. Session list

Default sort:

1. Needs attention.
2. Running/waiting/retrying.
3. Most recently active.

Filters:

- All.
- Active.
- Needs attention.
- Stopped.
- Deleted.

Search covers session name and workspace display name, not transcript content in MVP.

Session row shows:

- session name or generated fallback,
- workspace,
- runtime state,
- model summary,
- queue count,
- last activity,
- unread/attention marker,
- controller/observer state when relevant.

Runtime state labels use plain language:

| Internal | User label |
|---|---|
| `stopped` | Paused on host |
| `starting` | Starting Pi |
| `idle` | Ready |
| `running` | Working |
| `waiting_for_input` | Needs your input |
| `retry_wait` | Retrying soon |
| `compacting` | Compacting context |
| `crashed` | Pi stopped unexpectedly |
| `crash_loop` | Repeated crashes |
| `incompatible` | Update required |
| `deleted` | In Trash |

## 7. Transcript screen

### Header

Shows:

- session name,
- host/workspace,
- runtime state,
- controller/observer state,
- model and thinking level,
- read-only status,
- queue count.

Header actions:

- session switcher,
- model/thinking sheet,
- details/menu,
- abort while active.

### Turn composition

Each assistant turn is composed of:

1. Optional reasoning container.
2. Ordered tool cards.
3. Final answer surface.
4. Turn status/footer.

Reasoning:

- expanded while actively streaming unless the user collapsed it,
- collapsed after completion by default,
- labelled as model-provided reasoning,
- copyable when visible,
- hidden gracefully when the provider does not emit it.

Final answer:

- streams incrementally,
- remains selectable,
- supports Markdown with safe link handling,
- does not animate character-by-character unless explicitly enabled.

### Scroll behaviour

- Keep pinned only while the user is near the bottom.
- Show `Jump to latest` otherwise.
- New background events increment a badge without moving the user's reading position.
- Loading older history preserves visual anchor.
- Applying replay does not replay decorative animations.

### Turn states

Show a clear status for:

```text
queued
accepted
starting
working
waiting for input
retrying
compacting
completed
aborted
failed
interrupted
indeterminate
```

`indeterminate` includes:

- what was known,
- why the bridge cannot prove completion,
- a link to inspect latest durable session state,
- a manual follow-up action,
- no one-tap automatic rerun labelled as safe.

## 8. Tool cards

Common card structure:

- tool icon/name,
- state pill,
- duration,
- concise argument preview,
- expandable details,
- result summary,
- error/truncation state.

Built-in presentations:

- `read`: relative path, line range, content preview.
- `grep`/`find`/`ls`: query/path and result count.
- `bash`: command preview, exit status, duration, output.
- `edit`: relative path and change summary/diff when available.
- `write`: relative path and byte/line summary.

Rules:

- Long commands and paths wrap or scroll without hiding status/actions.
- Secrets matching redaction patterns are masked in previews.
- Output over the mobile cap displays exact retained/total byte counts and digest metadata.
- Unknown tools use a generic typed JSON summary, never raw unbounded JSON.
- Parallel tool calls remain separate cards grouped under the same assistant step; do not flatten their output into one ambiguous stream.

## 9. Composer

Composer supports:

- multiline text,
- up to four image attachments,
- send,
- steer/follow-up selection while running,
- draft persistence,
- visible delivery mode,
- queue-full and attachment validation.

Rules:

- Idle session: default action is Send.
- Running session: require explicit Steer or Follow up; remember the last choice only for the current session.
- Disconnected: Send is disabled; draft remains.
- Observer: composer is read-only with `Take control` action.
- Read-only session still permits prompts; explain that mutating tools are blocked.
- Empty messages without attachments cannot send.
- A send tap produces immediate local submitting state, then waits for bridge acceptance.

Do not clear the draft until command acceptance. If acceptance fails, restore the exact draft and attachment references.

## 10. Queue UX

The bridge-owned follow-up queue displays:

- stable order,
- prompt preview,
- attachment count,
- time queued,
- remove action,
- clear-all action with confirmation.

Reordering may be added in MVP only after transactional queue ordering is implemented; otherwise preserve FIFO and do not show drag handles.

Once dispatched, a queue item moves into the transcript and can no longer be removed as a queue item.

## 11. Controller lease UX

- The controlling installation sees no distracting lease UI during normal use.
- An observer sees `Viewing only` in the header and disabled composer controls.
- `Take control` requires explicit confirmation if another installation is active.
- A same-installation reconnect reclaims control silently when allowed.
- If control is lost mid-composition, preserve the draft.
- If control is lost after command acceptance, continue showing the command state as an observer.

## 12. Extension dialogs

Map methods:

| Pi method | Mobile surface |
|---|---|
| `select` | searchable modal sheet/list |
| `confirm` | confirmation dialog or sheet |
| `input` | form sheet with keyboard handling |
| `editor` | full-height multiline editor sheet |
| `notify` | banner/snackbar and transcript event when durable |
| `setStatus` | session/header status region |
| `setWidget` | bounded extension status card |
| `setTitle` | session title suggestion/status, not unrestricted navigation title mutation |
| `set_editor_text` | composer prefill requiring visible application |

Dialog UX shows expiry where meaningful. On expiry, close the sheet, preserve typed text locally for copy, and show that Pi did not receive the response.

## 13. Model and context sheet

Displays:

- configured models grouped by provider,
- active model,
- thinking levels supported by that model,
- auto-retry state,
- auto-compaction state,
- context usage,
- session cost summary,
- steering/follow-up modes where exposed.

Rules:

- Provider setup is host-only.
- Unavailable restored model requires explicit selection.
- Null/unknown context and cost are shown as unavailable, not zero.
- Model changes during a running turn are disabled unless pinned Pi explicitly supports safe behaviour and tests cover it.

## 14. Session tree, fork, and clone

Tree screen:

- shows branch structure and current leaf,
- identifies user prompts suitable for fork,
- supports lazy rendering for long trees,
- preserves current session if fork/clone is cancelled by an extension.

Fork confirmation shows the selected user message preview. Clone confirmation explains that it duplicates the current active branch into a new durable session.

After success, the app opens the new session only after its snapshot is available.

## 15. Delete, restore, export, and share

### Delete

Confirmation includes:

- session name/workspace,
- whether a process is active,
- seven-day recovery window,
- queued prompts that will be cancelled.

An active turn must be aborted/settled or the delete flow must explicitly combine abort and delete with separate visible states.

### Restore

Deleted-session row displays purge date and Restore action.

### Export

- Choose HTML in MVP.
- Show generation progress.
- Download through opaque export ID.
- Open platform share sheet.
- Explain that sharing leaves the private tailnet once the user selects a destination.

No public-link option.

## 16. Notifications and Live Activity

Notification copy examples:

- `Session complete — <session name>`
- `Pi needs your input — <session name>`
- `Session stopped unexpectedly — <session name>`

Default payload excludes transcript content.

Tap flow:

1. Open app.
2. Select paired host.
3. Reconnect and reconcile.
4. Open session.
5. Scroll to current attention/settled turn only after state is current.

Stale notification state is not displayed as current truth.

Live Activity displays only:

- host/session display names,
- working/waiting/retrying/completed/error state,
- elapsed time,
- generic tool phase when safe,
- open-app action.

No prompt, answer, reasoning, command, file path, or tool output.

## 17. Diagnostics UX

Host diagnostics groups:

- Transport: endpoint, Tailscale/Serve reachability.
- Compatibility: app, protocol, bridge, Pi versions.
- Storage: database, backup, attachment/export directories.
- Runtime: active/stopped/crash-loop process counts.
- Notifications: configured/degraded without exposing tokens.
- Logs: path and redaction mode.

Actions:

- Retry checks.
- Copy redacted report.
- Open host-side remediation instructions.
- Forget host.

Never copy secrets, prompts, responses, raw paths, or environment values into the report.

## 18. Accessibility

Required:

- Every state pill has semantic text.
- Tool-card expand/collapse state is announced.
- Streaming token deltas are not live regions.
- Significant transitions use polite live announcements.
- Abort is reachable without precise gesture timing.
- Sheets trap focus correctly and restore it on close.
- Text scale to 200% preserves primary actions.
- Reduced motion removes continuous pulses, typewriter effects, and nonessential transitions.
- Colour is supplementary to icon/text.
- Touch targets meet platform guidance.
- Transcript supports external keyboard selection and navigation where Flutter/platform support permits.

## 19. Empty, loading, and failure states

Every screen must define:

- initial loading,
- empty content,
- stale cached content,
- partial/degraded data,
- recoverable error,
- terminal incompatibility.

Avoid generic `Something went wrong` when a stable bridge error code exists.

## 20. Visual and performance rules

- Material 3 is the shared baseline with platform-appropriate navigation and sheets.
- Use a small explicit design-token layer through Flutter themes/extensions.
- Do not introduce a third-party chat UI framework until the transcript performance spike proves it necessary.
- Isolate active streaming paint from the full transcript.
- Paginate older history.
- Profile on a 60 Hz baseline and high-refresh device.
- High refresh is a best-effort enhancement; no UX depends on 120 Hz.
