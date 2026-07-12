# PROJECT_CHECK_V2

## meta
updated_utc: 2026-07-12T15:00:47Z
root: .
managed_by: /check
vcs: git
head: 79cb2a868aa6
branch: main
worktree_fingerprint: e3b0c44298fc1c14
cache_scope: project-orientation

## project
name: pi-mob
purpose: Flutter mobile client that drives a remote Pi (coding agent) RPC instance over a user-controlled Tailscale network.
status: research
shape: docs-only
stack: Flutter; Dart; Material 3; Tailscale Serve (MagicDNS wss); Pi RPC (JSONL over WebSocket)
package_manager: none
workspace: single

## active_work
source: WORKING.md
status: unknown
objective: not recorded
next:
- Define the first product/research question for the Flutter application (per PLANNING.md `## Next`).
blockers:
- Product requirements undefined; first Flutter screens not yet selected.
do_not_touch:
- PLANNING.md is the single source of truth for research decisions; do not restructure it.

## commands
setup: unknown
dev: unknown
build: unknown
test: unknown
lint: unknown
typecheck: unknown
format: unknown
other:
- none recorded

## entrypoints
- PLANNING.md :: sole repository file; research, design lookup map, decisions, and next steps

## architecture
- PLANNING.md :: Flutter app + bridge over Tailscale Serve wss to a host running `pi --mode rpc`; no app-layer auth; bridge owns Pi lifecycle, cwd selection, session mapping, credentials, replay, extension-dialog routing; mobile owns presentation, drafts, gestures, local cursors, notifications

## flows
- Pair and connect :: scan QR from Pi `/pi-mob` extension → Flutter opens `wss://<bridge>.<tailnet>.ts.net/ws?session=<id>` via Tailscale Serve → bridge spawns `pi --mode rpc` per active mobile session
- Resume session :: persist last entry ID locally → on reconnect call `get_state` then `get_entries(since)` → treat `agent_settled` (not `agent_end`) as idle boundary
- Tool rendering :: generic built-in tools (read, bash, edit, write, grep, find, ls) rendered as cards; extension select/confirm/input/editor mapped to native sheets; built-in TUI slash commands not exposed as RPC

## contracts
- Pi RPC framing: LF-split JSONL, strip trailing `\r`, optional command-ID correlation, never generic line readers (PLANNING.md `## Pi mapping / Integration contract`).
- QR payload schema: `wss://<bridge>.<tailnet>.ts.net/ws?session=<id>`; bridge contract for final path/envelope is TBD.
- Tailscale is the sole connection-security boundary; MagicDNS + HTTPS/Serve required; no Funnel (public).
- Project trust: Pi resource-loading policy, not a sandbox; bridge must surface what would load before starting an unknown workspace.
- Provider credentials/OAuth remain host-side; mobile client must never receive or persist them.

## conventions
- Flutter first; revisit only if requirements demand native integration unreachable via plugins/platform channels :: PLANNING.md `## Decisions`
- Use Flutter built-in Material 3 widgets; no third-party UI library until justified :: PLANNING.md `## Decisions`
- Add a source to the lookup map only when it covers a gap not already mapped :: PLANNING.md `## Decisions`
- Consult the first listed source in the Flutter design lookup map before parallel research :: PLANNING.md `## Flutter design resource lookup`
- Impeller is the default renderer (sole on iOS; Metal/Vulkan target on Android API 29+) :: PLANNING.md `## Phase-2 product research / 120 fps motion target`
- Reasoning display uses three surfaces (reasoning container, per-tool card, final answer); wrap streaming bubble in `RepaintBoundary`; gate typewriter behind user setting (≥16 ms cadence) :: PLANNING.md `## Phase-2 product research / Reasoning/thinking display`

## state
stable:
- Stack decision: Flutter + Dart for the mobile client
- Design baseline: Material 3 via Flutter built-in widget catalog
- Transport: Tailscale Serve + MagicDNS wss; one `pi --mode rpc` subprocess per active mobile session
- Pairing: Pi extension `/pi-mob` command renders a QR with the bridge endpoint
active:
- Research-supported defaults awaiting owner confirmation (host topology, workspace selection UX, tool UX policy, background/notification policy, privacy defaults) — see PLANNING.md `## Research-supported defaults awaiting owner confirmation`
- Open architecture decisions enumerated in PLANNING.md `## Architecture choices still open` (8 items)
known_issues:
- No code, manifests, tests, or CI exist yet; this is a docs-only repo
- No git remote configured
- Obsidian integration deferred; CVE in community `obsidian-local-rest-api` (GHSA-62gx-5q78-wrvx) — must not be used

## documentation
- PLANNING.md :: sole repo document; research findings, Flutter design lookup map, Pi integration contract, decisions, next steps
- /Users/nathandekleerk/.pi/agent/AGENTS.md :: global durable agent rules (not in-repo)

## navigation
read_first:
- PLANNING.md :: entire project context lives here until code lands
task_map:
- Mobile-stack rationale :: PLANNING.md `## Findings`
- Flutter design lookup :: PLANNING.md `## Flutter design resource lookup`
- Pi ↔ mobile integration :: PLANNING.md `## Pi mapping`
- QR pairing + Tailscale :: PLANNING.md `## QR pairing and Tailscale connection`
- Open decisions to confirm :: PLANNING.md `## Architecture choices still open`
- Phase-2 research (reasoning UI, 120 fps, Obsidian) :: PLANNING.md `## Phase-2 product research`
- Next concrete step :: PLANNING.md `## Next`
ignore:
- .git :: VCS internals

## guardrails
- Tailnet-only deployment; never expose bridge via Tailscale Funnel or public internet (PLANNING.md `## Runtime and security constraints`).
- Provider credentials stay host-side; mobile must not store API keys or OAuth tokens.
- QR extension must refuse loopback or wildcard hostnames — not phone-reachable.
- `obsidian-local-rest-api` plugin must not be used (known path-traversal CVE).
- Do not register `obsidian://` URI scheme (conflicts with official Obsidian app); use HTTPS Universal/App Links or a custom scheme.
- Flutter source claims depend on pin of Flutter version and CI rendering environment for visual-regression goldens.

## unknowns
- Whether AGENTS.md or WORKING.md will be added at project root (none present today)
- Whether the bridge will live in this repo or alongside Pi; not yet committed
- Final WS path/envelope in QR payload; bridge contract TBD (PLANNING.md `## QR pairing and Tailscale connection`)
- Process/session model, workspace policy, trust policy, tool UX policy, background policy, privacy defaults — all awaiting owner confirmation
- Verified: no manifests, source dirs, tests, CI, or remote exist in this repo today (`ls`, `git status`, `git remote -v`)