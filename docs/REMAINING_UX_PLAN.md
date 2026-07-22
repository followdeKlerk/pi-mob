# pi-mob: remaining UX plan

**Status:** planning artifact only; no implementation is authorized by this document.
**Canonical checkout:** `/Users/nathandekleerk/github/pi-mob`
**Planning baseline:** `main` at `a0d49fb` (`a0d49fb38454219fb7ec3fad204972a8e87566f0`).
The approved planning documents were integrated separately at the canonical
checkpoint recorded by the repository's commit history; this plan's baseline
is intentionally historical so candidate diffs remain reviewable against the
same starting point.

The product remains an accountless, chat-first remote Pi control surface: fluent Codex-style conversation, not a mobile IDE. This is the acceptance contract for the remaining twelve requirements and the integration plan for the preserved candidate worktrees.

## 1. Exact exclusions

Do not build:

- an in-app diff reviewer;
- staging or hunk-level review UI;
- application previews or embedded browsers;
- a new checkpoint or rollback system;
- account, team, subscription, or cloud-sync features;
- a full mobile code editor.

GitHub remains the detailed diff-review surface. Pi owns checkpoint/rollback and worktree isolation. No leaf may smuggle an excluded feature in through a sheet, link, or “summary.”

## 2. Authority and capability invariants

- Pi, the host filesystem/processes, provider APIs, Git/CI providers, and the bridge are authoritative for their respective facts; mobile Drift is a reconstructible cache.
- Installation-local drafts, viewed-file recents, expansion preferences, inbox read markers, and per-chat scroll positions may be mobile-authoritative. They never masquerade as host truth.
- Every mutation has an opaque durable command ID, valid-state/controller-lease checks where applicable, replayable state, and explicit accepted, failed, rejected, or indeterminate outcome.
- Every paged/read result is bounded by item, byte, line, depth, and time limits and carries a revision or stale marker. Unknown optional events remain forward-compatible.
- Never infer plans, context membership, skills, MCP tools, processes, agents, worktrees, Git state, or hidden reasoning from ordinary prose, tool labels, terminal text, or UI strings.
- Thinking is provider-supplied summary only; private chain-of-thought is never requested, stored, or displayed.
- Live events, history pages, reconnect snapshots, and local persistence use stable IDs and one deduplicating reducer; replay must be deterministic.
- Chat is the primary phone surface. New capability surfaces use compact app-bar actions, drawers, sheets, and tablet secondary panes rather than new bottom-navigation clutter.
- Capability state is explicit: `available`, `degraded`, `unavailable`, or `stale`, with a stable reason, remediation text, source/revision, last refresh where relevant, and supported actions separately from readable state.
- An unavailable upstream capability gets visible unavailable UX; it is never silently omitted, represented as zero, or fabricated. If a bridge contract is implementable, extend the bridge before accepting unavailable UX.
- Pinned Pi 0.80.6 has no guaranteed native structured plans, subagent RPC, MCP catalogue, Bash PID/ports/separate stdout-stderr, or process restart/rerun. These are bridge/extension contracts or explicit blockers, never inference opportunities.

## 3. Exclusive ownership and shared-file policy

| Owner | Exclusive decisions and write locations |
| --- | --- |
| Protocol owner | Wire names, schemas, capability IDs, bounds, errors, fixtures, generated outputs, and protocol docs; exclusively `packages/protocol-schema/`, `packages/protocol-fixtures/`, and protocol portions of `docs/`. |
| Bridge central-integration owner | Routing, authorization/lease checks, persistence publication, and adapter wiring in `packages/bridge/src/core/runtime.ts`, `server.ts`, `store.ts`, and `packages/bridge/src/pi/one-session-adapter.ts`; feature workers supply isolated services. |
| Mobile coordinator/database/shell owner | Central state projections, migrations, subscriptions, and navigation wiring in `apps/mobile/lib/src/connection/connection_coordinator.dart`, `data/app_database.dart`, and `ui/shell/app_shell.dart`. |
| Feature owners | Their domain/service/widget directories plus focused tests; they do not independently change shared protocol, coordinator, database, or shell files. |
| Performance owner | Value-comparing projections/listenables, exact rebuild boundaries, transcript rendering/frame evidence, and profile methodology. |
| Android evidence owner | Physical-device APK installation, notifications, background, keyboard, accessibility, scrolling, navigation, and performance evidence; evidence cannot redefine capability contracts. |
| Integrator/Reconciler | Integrator resolves textual conflicts only. Semantic conflicts stop integration and go to Reconciler for one recorded decision; no worker silently chooses a sibling architecture. |

Central owners merge one shared-file change at a time, regenerate outputs, and run focused gates before the next leaf is wired.

## 4. Candidate branch/worktree preservation

Preserve every candidate until its reviewed replacement is integrated and verified. Never reset, clean, delete, or overwrite a worktree to simplify a merge; preserving a branch does not accept its current design. Commit/review on the existing branch first, freeze the relevant contract, then rebase and selectively merge.

| Branch | Worktree and current treatment |
| --- | --- |
| `feat/global-search` | `/private/tmp/pi-mob-search` — committed repair candidate at `f159c6d`; preserve and audit against D-035 and all-source search/deep-link requirements before integration. |
| `feat/agent-supervision` | `/private/tmp/pi-mob-agents` — committed candidate at `80fce2d`; preserve and audit against explicit Pi contracts before integration. |
| `feat/recipe-durability` | `/private/tmp/pi-mob-recipe` — empty at `ba25eac`; retain for R1. |
| `feat/scoped-rebuilds` | `/private/tmp/pi-mob-scoped` — empty at `ba25eac`; retain for R11. |
| `perf/projection-shell` | `/private/tmp/pi-mob-projection` — empty duplicate candidate; retain until R11 owner decides whether it supersedes scoped rebuilds. |
| `feat/command-catalogue` | `/private/tmp/pi-mob-catalogue` — empty at `ba25eac`; retain for R9. |
| `feat/structured-plans` | `/private/tmp/pi-mob-plans` — empty at `ba25eac`; retain for R2. |
| `feat/file-context-browser` | `/private/tmp/pi-mob-files` — empty at `ba25eac`; retain, but review browser and inspector as separate slices. |
| `feat/attention-inbox` | `/private/tmp/pi-mob-inbox` — empty at `ba25eac`; retain for R7. |
| `feat/runtime-surface` | `/private/tmp/pi-mob-runtime` — empty at `ba25eac`; retain for R5. |
| `feat/git-ci-summary` | `/private/tmp/pi-mob-git` — empty at `ba25eac`; retain for R6. |
| `feat/mobile-polish` | `/private/tmp/pi-mob-polish` — empty at `ba25eac`; retain for R12. |
| `fix/app-shell-refinement` | `/private/tmp/pi-mob-app-shell-refinement` at `e7d8f06`; preserve and inspect separately, without treating it as a substitute for this plan. |

## 5. Leaf specifications

### F0 — Freeze additive capability contracts

**Owner:** protocol owner. **Depends on:** none. **Blocks:** R1–R10.

Define bounded, additive event/control/response families for recipe activity, plans/step targets, files and attachments, context sources/mutations, registered processes, Git/CI, attention, agents/actions, commands/skills/MCP, and global-search destinations. Every family carries opaque IDs, revision/page tokens, limits, capability status, typed errors, lease/valid-state requirements, and forward-compatible optional events. Add valid, invalid, oversized, stale, and unavailable fixtures in `packages/protocol-fixtures/`; generate schemas; do not enable an exclusion.

**Acceptance/tests:** `bun run schema:check`, `bun run fixtures:check`, protocol/fixture unit tests, and mobile fixture decoding pass; unknown optional events survive round-trip and every unsupported action has a reason.

### R1 — Persistent chronological execution recipe

**Owner:** execution-history owner. **Branch:** `feat/recipe-durability`. **Depends on:** F0.

Keep each turn’s provider-supplied Thinking summaries and every tool activity in one chronological recipe: stable activity/turn IDs, status, arguments, output, errors, truncation and retained/total byte metadata, start/update/finish timing, cancellation/failure, and final duration. Collapse completed rows by default. Repair the earliest live/history lifecycle boundary in `packages/bridge/src/pi/normalize.ts`, `external-history.ts`, `core/runtime.ts`, and the mobile transcript reducer; persist before publish; merge by stable IDs so history/replay overlap neither duplicates nor drops activity.

**Acceptance:** identical order and terminal metadata after completion, chat switch/back, reconnect, cursor recovery, app restart, imported Pi history, and overlapping live/history events; no private chain-of-thought. **Tests:** live-vs-history normalization parity, reducer replay, Drift close/reopen, overlap dedupe, and bounded output/error/truncation/timing cases.

### R2 — Structured plans and targeted steering

**Owner:** plan owner. **Branch:** `feat/structured-plans`. **Depends on:** F0, R1.

Attach an authoritative plan to a turn with stable plan/step IDs, ordered steps, revision/source, and `pending`, `running`, `completed`, `blocked`, or `skipped` states. Completed plans collapse. Use a vetted Pi extension/bridge event (for example an explicit `update_plan` tool/custom entry), never Markdown/prose inference. Tapping a step opens a targeted steering sheet; one durable `prompt.submit` includes plan ID, step ID, revision, and `steer` mode, preserves drafts on failure, and visibly rejects stale targets.

**Acceptance/tests:** all states replay across reconnect/restart; checklist prose creates no plan; one tap yields one command with accepted/failed/indeterminate state; reducer, revision/out-of-order, stale-target, widget, and extension/bridge tests pass. If no approved source is installed, show `Plans unavailable` with reason rather than invent steps.

### R3 — Complete bounded read-only file browser

**Owner:** file-browser owner. **Branch:** `feat/file-context-browser`. **Depends on:** F0.

Add root-confined bridge controls for lazy repository tree, filename search, content search, metadata/modified indicators, and paginated UTF-8 line reads. Reject canonicalization/symlink/`..` escapes. Mobile provides recent files, modified markers, syntax-highlighted bounded viewing, line-number/range selection, copy path or selected text, attach file/selected lines to the composer, refresh, and visible pagination/truncation. Never eagerly scan or mirror the repository and never edit, diff, preview, or implicitly change context.

**Acceptance/tests:** large/binary/denied/deleted/stale files and unsupported languages have explicit states; attachments carry workspace/path/range/digest/revision and are revalidated at send. Test traversal, bounds/page tokens, UTF-8 boundaries, search, recents, range selection, copy/attach, stale attachments, and one sheet flow.

### R4 — Separate context inspector

**Owner:** context owner. **Branch:** separate slice of `feat/file-context-browser`. **Depends on:** F0; R3 only for opening a file.

Keep a dedicated inspector, not a browser tab, showing active model and thinking level, workspace instructions, pinned files and selected ranges, context/token usage, compacted state, and unavailable/stale sources with revision/last refresh. Support pin, unpin, exclude, refresh, compact, and the existing model picker only through authoritative durable host controls; browsing a file never pins it.

**Acceptance/tests:** pin/unpin/exclude appear only after host acceptance; unknown usage is unavailable, not zero; stale state cannot look current; reconnect/restart reconstructs state; unavailable source/action has a reason. Cover capability fixtures, mutations, stale revisions, model picker/compact reuse, and browser-versus-context widget isolation.

### R5 — Truthful per-process runtime

**Owner:** runtime owner. **Branch:** `feat/runtime-surface`. **Depends on:** F0, R1.

Model live processes separately from historical Bash cards. A registered process snapshot/delta should expose command, running/completed/failed state, PID where authoritative, working directory, start time/duration, bounded distinct stdout/stderr, exit code/signal, detected listening ports, and stop/restart/rerun actions. Use opaque process IDs, lease/valid-state checks, reconnect replay, and bounded output; never kill an arbitrary host PID. Current Pi only guarantees tool events/combined output and `abort_bash`, not PID, ports, separate streams, restart, or rerun: extend an explicit contract where possible and mark each missing field/action unavailable (rerun may only be a clearly labelled composer prefill).

**Acceptance/tests:** simultaneous processes remain separate and controls are exactly-once/idempotent; historical cards remain intact. Test snapshots/deltas, output caps, exit/signal, reconnect, lease failures, PID reuse, unavailable fields, and stop.

### R6 — Lightweight Git/CI summary (no diff)

**Owner:** Git/CI owner. **Branch:** `feat/git-ci-summary`. **Depends on:** F0.

Show bounded repository/root identity, branch, clean/dirty/unknown, changed-file count, ahead/behind, latest commit, detectable active PR, CI/check state, failed names, concise capped logs, and safe external repository/commit/PR/check links. Refresh is cancellable. Where the host advertises it, a confirmed action may request commit-through-Pi or push-through-Pi; it must not stage, hunk-edit, or run an untracked direct mobile mutation.

**Acceptance/tests:** missing repo/Git/remote/provider/CLI/auth and unavailable commit/push produce explicit cards; no diff content or diff UI exists. Test clean/dirty/detached, parsing/caps/timeouts, URL validation, confirmation, controller loss, and indeterminate commit/push.

### R7 — Canonical inbox and Android notification model

**Owner:** attention/notification owner. **Branch:** `feat/attention-inbox`. **Depends on:** F0, R1, R5.

Create one durable attention projection consumed by the in-app inbox and Android notification policy. Categories are needs user input, completed/ready for review, failed, interrupted/indeterminate, and running in background. Items have stable host/session/turn IDs, occurrence, bounded summary, actionability, revision, and resolved/superseded state. Badges exclude generic Ready/Connected; each item reconciles before deep-linking to its chat/turn. Local read markers do not falsely resolve host attention. Android channel/payload/coalescing/tap destination uses the same item ID/category and remains content-private by default.

**Acceptance/tests:** all five categories survive background, reconnect, and restart and agree between notification and inbox. Cover projection/persistence, category transitions, read-versus-resolve, stale notification/coalescing, deep links, and physical Android input/completion/failure/interruption/background evidence.

### R8 — Explicit agent contracts and actions, preserving worktrees

**Owner:** agent-supervision owner. **Branch:** `feat/agent-supervision`. **Depends on:** F0, R1, R7.

For each Pi-authoritative agent show opaque ID, task, model, state, elapsed/start/finish, originating chat/turn, latest meaningful activity, blocked/needs-input, completion summary, transcript reference, and opaque Pi-owned worktree/isolation metadata. Through explicitly advertised contracts support transcript, targeted steer, cancel, compare summaries, adopt, and merge; adopt/merge remain Pi operations and mobile never recreates or merges worktrees. Preserve the candidate projection only as salvageable UI/reducer work; tool-name inference is not authority.

**Acceptance/tests:** replay is deterministic, actions use durable IDs/leases and explicit outcomes, unsupported contracts say `Agent supervision unavailable`, and no hidden reasoning leaks. Test event adapter/negative arbitrary-tool case, paged transcript, steer/cancel idempotency, compare, adopt/merge success/rejection/conflict/indeterminate, and unchanged worktree references.

### R9 — Authoritative skills, commands, and MCP

**Owner:** catalogue owner. **Branch:** `feat/command-catalogue`. **Depends on:** F0.

Replace shell fallback data with bridge-reported, searchable skills, prompt templates/commands, extension commands, configured MCP servers/tools, source/provider, description, invocation syntax, availability, enabled/error state, and supported safe enable/disable actions. Copy or insert invocation without sending. Enable/disable goes through a Pi/host contract, confirmation, durable result, and reload requirement; it never edits unknown config files.

**Acceptance/tests:** no unreported entry appears; absent MCP authority says unavailable and offers no fake toggle. Cover decoding/search, empty/stale/error, copy/insert, safe toggle/restart-required, and removal of fabricated app-shell entries.

### R10 — All-source global search

**Owner:** search owner. **Branch:** `feat/global-search`. **Depends on:** R1, R3, R6, R9.

Incrementally index authoritative bounded records across chats/session titles/workspace labels, user prompts, assistant answers, Thinking summaries, tool names and bounded command output, filenames, selected/viewed file content, branches, and commits where available. Update transactionally or recoverably with source persistence; cap documents/bytes, clean host-generation changes, suppress stale query generations, label source types, and never eagerly scan remote history/repositories. Results open the exact chat, turn/Thinking/activity/tool, file/line range, or Git/CI location; stale destinations reconcile or say stale.

**Acceptance/tests:** the preserved candidate is audited before merge. One result/deep-link per source, migration/restart recovery, cap/cleanup, duplicate live/history, deleted-record, stale-query, and bounded-index performance tests are required; unavailable/uncached source groups are labelled rather than fabricated.

### R11 — Exact rebuild boundaries; no UI polling/timer delays

**Owner:** performance owner. **Branches:** `feat/scoped-rebuilds` plus `perf/projection-shell` until resolved. **Depends on:** R1.

Use equality-checked scoped projections: app bar rebuilds only for selected title/model; drawer only for session-directory/order/filter/attention; composer only for draft/attachments/delivery/controller/send eligibility/selected-turn state; transcript only for selected-session events, with changed active recipe/final-answer regions isolated and completed historical widgets stable. Coalesce transcript invalidation once per Flutter frame, cache unchanged completed Markdown, cap/virtualize output, preserve history anchors, and immediately cancel auto-follow on user drag/wheel/keyboard until latest/jump is chosen. Do not use polling, timer-based UI delays, fake elapsed timers, or delayed auto-follow; protocol backoff/lease/network timers remain non-UI concerns.

**Acceptance/tests:** background sessions cannot rebuild visible transcript/composer; streaming does not rebuild app bar/drawer; large output stays within frame budget. Use build counters/element stability, burst/frame-coalescing, Markdown parse-count, immediate scroll-cancel, anchor, 1,000-row, and physical Android 60/high-refresh profile tests.

### R12 — Tablet/shortcuts/back/sheets/a11y/per-chat scroll polish

**Owner:** mobile-polish owner and Android evidence owner. **Branch:** `feat/mobile-polish`. **Depends on:** R2–R11.

Keep phone chat-first; at a large-width breakpoint use a tablet/landscape split with session navigation and a secondary supervisory pane, preserving selection/draft/expansion/scroll across resize. Support `Ctrl/Command+Enter` send, `Ctrl/Command+K` search, `Ctrl/Command+M` model picker, `Ctrl/Command+Shift+O` chats, and `Ctrl/Command+Shift+P` commands/skills/MCP; modal focus and IME composition win. Back order is keyboard, transient sheet/dialog, tablet pane, drawer, navigation history. Sheets provide safe areas, handle, keyboard avoidance, focus trap/restoration, loading/empty/offline/error/stale/unavailable states, and confirmations.

Validate 200% text, TalkBack labels/roles/actions and announcements, visible keyboard focus, touch targets, reduced motion, and non-color status. Persist scroll per chat: restore follow mode or prior anchor after switch/restart; background events do not move it; intentional inbox/search deep links override it.

**Acceptance/tests:** narrow/landscape/tablet layouts, every shortcut/focus conflict, Back stack, sheet insets/focus, all state variants, 100/150/200% text, TalkBack journey, per-chat restoration/deep-link override, and physical Android walkthrough pass.

## 6. Dependencies and cross-leaf acceptance

Dependency graph:

```text
F0 → R1 → R2
F0 → R3 → R4
F0 → R5
F0 → R6
R1 + R5 → R7 → R8
F0 → R9
R1 + R3 + R6 + R9 → R10
R1 → R11
R2–R11 → R12
```

Every leaf must provide one authoritative source/contract, one persistence/replay test, one protocol/coordinator test for each new event family, one primary widget flow, explicit bounds, and explicit unavailable/error/stale behavior. A leaf is not “done” because a sheet renders: its mobile, bridge, protocol, generated fixtures, and migration/reconnect paths must agree.

## 7. Integration phases and gates

1. **Preserve/freeze:** record this plan, leave all worktrees intact, review preserved candidates, freeze F0, generate schemas/fixtures, and run the baseline.
2. **Foundation/performance:** integrate R1, then R11; prove recipe identity, replay, scoped rebuilds, frame coalescing, and immediate auto-follow cancellation.
3. **Runtime:** integrate R5 host/Pi process contract, mobile projection, bounds, stop, and reconnect before process-dependent inbox work.
4. **Plans/files/context:** integrate R2 and R3 in parallel only in isolated directories; integrate R4 separately; central coordinator/database/shell wiring is sequential.
5. **Attention/agents:** integrate R7 and migrate Android notifications to the same model; then repair R8 against explicit Pi contracts without touching worktrees.
6. **Git/catalogue:** integrate R6 summary/optional Pi actions, then R9 authoritative catalogue/MCP unavailable state and remove fallback data.
7. **Search:** rebase and complete R10 after recipe/file/Git/catalogue identities are stable; run migrations and deep-link tests.
8. **Polish/evidence:** integrate R12, build APK, and collect physical Android evidence for notifications, background, process logs, reconnect, scrolling, keyboard, navigation, large text, TalkBack, and performance.

After each central integration commit run, as applicable:

```text
bun run typecheck
bun run schema:check
bun run fixtures:check
bun test
cd apps/mobile && flutter analyze && flutter test
git diff --check
```

Final project gate is `bun run all` plus `cd apps/mobile && flutter build apk --debug`; retain source commit, protocol/toolchain versions, APK checksum, and Android evidence. Do not claim emulator results as physical-device evidence.

## 8. Whole-goal completion criteria

The goal is complete only when:

1. R1 retains persistent chronological Thinking summaries plus all tool activity with args/output/errors/truncation/timing and identical replay after switch, reconnect, and restart.
2. R2 supplies authoritative structured plans, all five states, collapsed completion, and targeted step steering.
3. R3 is a complete bounded read-only browser with tree, filename/content search, recents, modified indicators, highlighting, line selection, copy/attach, refresh, and pagination.
4. R4 is a separate context inspector with model/thinking/instructions/pins/ranges/tokens/compacted/stale state and pin/unpin/exclude/refresh/compact/model-picker actions.
5. R5 models individual processes and every available command/state/PID/cwd/timing/stdout/stderr/exit/ports field with truthful stop/restart/rerun availability.
6. R6 provides bounded Git/CI summary, optional Pi commit/push, safe external links, and no diff UI.
7. R7 provides all five attention categories and one canonical Android notification model.
8. R8 provides explicit agent contracts/actions—transcript, steer, cancel, compare, adopt, merge—while preserving Pi worktrees.
9. R9 exposes authoritative searchable skills/commands/MCP and safe toggles only where supported.
10. R10 searches every listed source and opens the correct destination.
11. R11 proves exact rebuild boundaries, stable completed content, immediate auto-follow cancellation, and no UI polling/timer delays.
12. R12 passes tablet/shortcuts/back/sheets/state/a11y/per-chat-scroll checks and physical Android evidence.
13. Unsupported upstream capabilities always show explicit unavailable UX; no inference or fabricated state exists.
14. All six exclusions remain absent, candidate worktrees are preserved, generated artifacts are current, focused and full gates are green, and the canonical checkout is coherent.
