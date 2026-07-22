# pi-mob Field Guide

Bounded operational invariants for any agent working on this repository. Not a
transcript, task-progress log, or duplicate of the canonical plan — durable
surprises and decisions only. If a rule here conflicts with the plan, the plan
wins.

## Canonical references (read in this order)

1. [`WORKING.md`](WORKING.md) — tracked active checkpoint and immediate next actions.
2. [`docs/REMAINING_UX_PLAN.md`](docs/REMAINING_UX_PLAN.md) — canonical plan for R1–R12 (authoritative for leaf specs, integration phases, gates).
3. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components, authority, state machines.
4. [`docs/PRODUCT.md`](docs/PRODUCT.md) — product statement, journeys, non-goals.
5. [`docs/DECISIONS.md`](docs/DECISIONS.md) — architecture decisions with review triggers.
6. [`docs/TOOLCHAIN.md`](docs/TOOLCHAIN.md) — version pins and host floors.

`NEXT_AGENT_STATUS.md`, when present, is an untracked historical handoff and is
not a canonical planning or repository-state source. Verify any claims in it
against the tracked references above and `git status`.

## 1. Product invariants

**Chat-first; not a mobile IDE.** Fluent Codex-style conversation. No terminal /
editor parity, no new bottom-navigation tabs — use compact app-bar actions,
drawers, sheets, and tablet secondary panes.

**Exact exclusions — never build, not even as a sheet, link, or summary:**

- in-app diff reviewer;
- staging or hunk-level review UI;
- application previews or embedded browsers;
- new checkpoint or rollback system;
- account, team, subscription, or cloud-sync features;
- full mobile code editor.

GitHub remains the detailed diff-review surface. Pi owns checkpoint/rollback and
worktree isolation. No leaf may smuggle an excluded feature in through a sheet,
link, or "summary."

## 2. Authority and capability model

- **Pi, host filesystem/processes, provider APIs, Git/CI providers, and the
  bridge are authoritative** for their respective facts. Mobile Drift is a
  reconstructible cache.
- **Mobile-authoritative only** (never masquerade as host truth):
  installation-local drafts, viewed-file recents, expansion preferences,
  inbox read markers, per-chat scroll positions.
- **Capability state is explicit:** `available` / `degraded` / `unavailable` /
  `stale`, with reason, remediation text, source/revision, and last refresh
  where relevant.
- **Unsupported upstream capability → visible unavailable UX.** Never silently
  omitted, zeroed, or fabricated. If a bridge contract is implementable,
  extend the bridge before accepting unavailable UX.
- **Never infer** plans, context membership, skills, MCP tools, processes,
  agents, worktrees, Git state, or hidden reasoning from prose, tool labels,
  terminal text, or UI strings.
- **Thinking is provider-supplied summary only**; private chain-of-thought is
  never requested, stored, or displayed.

**Pinned Pi 0.80.6 has NO native contracts for:** structured plans, subagent
RPC, MCP catalogue, Bash PID / listening ports / separate stdout-stderr,
process restart / rerun. These are bridge/extension contracts or explicit
blockers — never inference opportunities.

## 3. Candidate branch/worktree preservation

**Preserve every candidate until its reviewed replacement is integrated and
verified.** Never reset, clean, delete, or overwrite a worktree to simplify a
merge. Preserving a branch does not accept its current design. Commit/review
on the existing branch first, freeze the relevant contract, then rebase and
selectively merge.

Canonical list, paths, branches, and current treatment:
[`docs/REMAINING_UX_PLAN.md`](docs/REMAINING_UX_PLAN.md) §4 (verified
against the actual worktree branches at the documentation checkpoint).

**Incidental-noise safeguard:** if `feat/agent-supervision` shows a `bun.lock`
diff consisting only of removed semver carets on unrelated existing
dependencies, restore it before any candidate commit:

```bash
git -C /private/tmp/pi-mob-agents restore bun.lock
```

## 4. Central-file exclusive ownership

Central owners merge one shared-file change at a time, regenerate outputs, and
run focused gates before the next leaf is wired. Feature owners do not
independently change shared protocol, coordinator, database, or shell files.

| Owner | Exclusive write locations |
| --- | --- |
| Protocol owner | `packages/protocol-schema/`, `packages/protocol-fixtures/`, protocol portions of `docs/` |
| Bridge central-integration owner | `packages/bridge/src/core/runtime.ts`, `server.ts`, `store.ts`, `packages/bridge/src/pi/one-session-adapter.ts` |
| Mobile coordinator / database / shell owner | `apps/mobile/lib/src/connection/connection_coordinator.dart`, `data/app_database.dart`, `ui/shell/app_shell.dart` |
| Performance owner | Value-comparing projections/listenables, exact rebuild boundaries, transcript rendering, profile methodology |
| Android evidence owner | Physical-device APK installation, notifications, background, keyboard, accessibility, scrolling, navigation, performance — evidence cannot redefine capability contracts |

## 5. Integrator vs Reconciler boundary

- **Integrator** resolves textual conflicts only.
- **Semantic conflicts** stop integration and go to Reconciler for one recorded
  decision.
- **No worker silently chooses a sibling architecture.**

## 6. Required runtime contracts (every mutation)

- Opaque durable command ID.
- Valid-state and controller-lease checks where applicable.
- Replayable state.
- Explicit outcome: `accepted`, `failed`, `rejected`, or `indeterminate`.

Every paged/read result is bounded by item, byte, line, depth, and time limits
and carries a revision or stale marker. Unknown optional events remain
forward-compatible.

Live events, history pages, reconnect snapshots, and local persistence use
stable IDs and one deduplicating reducer; replay must be deterministic.

## 7. Integration checkpoint lifecycle

Phases: preserve/freeze → foundation/performance → runtime → plans/files/
context → attention/agents → git/catalogue → search → polish/evidence
(full dependency graph in `docs/REMAINING_UX_PLAN.md` §6).

After every central integration commit:

```bash
bun run typecheck
bun run schema:check
bun run fixtures:check
bun test
cd apps/mobile && flutter analyze && flutter test
git diff --check
```

Final gate: `bun run all` plus `cd apps/mobile && flutter build apk --debug`.
Retain source commit, protocol/toolchain versions, APK checksum, and Android
evidence. **Do not claim emulator results as physical-device evidence.**

Every R1–R12 leaf is "done" only when its mobile, bridge, protocol, generated
fixtures, and migration/reconnect paths agree — not when a sheet renders. Each
leaf must provide: one authoritative source/contract, one persistence/replay
test, one protocol/coordinator test per new event family, one primary widget
flow, explicit bounds, and explicit unavailable/error/stale behavior.

## 8. Recurring failure modes (do not relearn)

- **Polling / timer-based UI delays are forbidden** (R11). Use protocol
  backoff / lease / network timers only.
- **Cancel auto-follow immediately** on user drag / wheel / keyboard until
  latest / jump is chosen.
- **Worktrees are Pi-owned.** Mobile never creates, merges, or modifies them.
  Adopt / merge use explicit Pi contracts only.
- **Restore incidental `bun.lock` edits** on candidates before any feature
  commit.
- **No fabricated MCP toggle, no plan inferred from prose, no agent lifecycle
  read from tool labels.** If the host does not advertise the contract, show
  `unavailable` with reason.
- **Emulator ≠ physical Android.** Never claim TalkBack / 200% text /
  reduced-motion / foreground-service / notification evidence from an
  emulator.
- **Textual conflict resolution ≠ silent architectural choice.** Stop
  integration and escalate to Reconciler.
- **Do not claim a destructive live Tailscale / launchctl clean-account test
  unless it actually ran.** Describe deterministic production-driver
  rehearsal instead (per M7/M8 release evidence).
- **Search indexes are bounded projections, not authorities.** Build them from
  authoritative persisted records transactionally or with recoverable replay;
  use stable source identity plus host/stream scope to collapse live/history
  overlap, isolate streams, and invalidate pending writers on deletion/reset.
  Compare decimal cursors numerically (sort `ORDER BY LENGTH(cursor) ASC,
  cursor ASC, updated_at ASC` so canonical numeric order beats lexicographic
  order — `10` must rank after `2`), apply document/byte caps globally using
  UTF-8 byte counts, and keep canonical cursor/transaction order rather than
  timestamp order. Search results need typed destinations that open the exact
  chat/turn/file/Git location and reconcile or report stale targets. Query-side
  tokenization must mirror the indexer's per-character rules exactly
  (lowercase + retained Unicode blocks + single-separator collapse); strip
  `LIKE` wildcards (`%`, `_`) and the escape character (`\`) from query tokens
  before they hit the clause, and always pair the clause with `ESCAPE '\\'` as
  defense-in-depth for any bind parameter (summary/tokens columns) that still
  carries those characters. Snippet rendering must defensively clamp every
  invalid match range (oversized, negative, reversed, empty, end-only-oversize,
  start-only-negative) before `replaceRange` — bounding the summary length is
  not enough. Own controller/indexer lifetimes and dispose them on close,
  deletion, or reset. For spinner-backed widget tests, wait for an explicit
  terminal state instead of `pumpAndSettle`, which can hang on intentional
  continuous motion. Wildcard / literal-match tests must include explicit
  distractor rows that the buggy interpretation would have wrongly matched
  (e.g. `1000 widgets` for a `100%` query, `axb` for an `a_b` query) and assert
  exact returned id sets — hit-only assertions lock in false positives.
- **Crash running a command → `indeterminate`.** Never automatic rerun; external side effects cannot be proven exactly once after a process crash.
- **F0 contracts follow [`D-036`](docs/DECISIONS.md#d-036-f0-recipe-plan-and-targeted-steering-contract).** Plan is capped at 64 steps (`LIMITS.maxPlanSteps`; `plan.snapshot.steps.maxItems: 64`). `RecipeActivity.status` is exactly `pending | running | completed | failed | cancelled` — distinct from R2 plan-step states. `RecipeActivity` is a closed `thinking` / `tool` discriminated union; only `thinking` may carry a `ProviderSummary`, which is a provider-supplied, displayable summary only (never raw thinking, deltas, steps, or synthesized summaries). `prompt.submit.planTarget` is optional and closed (`{ planId, stepId, revision }`); the bridge accepts it **only** with `deliveryMode: "steer"`, validating the authoritative revision first (stale/unknown → `stale_plan_target`, non-steer → `invalid_state`). Omission preserves every legacy prompt payload; an idempotency retry cannot retarget.
- **R3/R4 F0 topology follows [`D-037`](docs/DECISIONS.md#d-037--f0-files-and-context-protocol-topology).** `prompt.submit.attachmentIds` and revision-bound `fileRefs` share one four-item prompt-context budget, enforced semantically by the bridge and preserved in the command hash/queue. V1 has host and session streams only: R3 workspace invalidations use the mandatory host stream and include `workspaceId`; never introduce `workspace:<id>` streams. `files.v1`/`contexts.v1` are independently advertised optional hello capabilities, never current-client requirements; missing advertisement is explicit unavailable UI. `context.snapshot.request` is a read control, but pin/unpin/exclude/refresh are session durable commands with command ID, lease, revision, idempotency, `command.state`, and snapshot-confirmed outcomes—never direct mutation controls.
- **Transcript-search identity and inputs follow [`D-035`](docs/DECISIONS.md#d-035-r10-transcript-search-extraction-identity-and-privacy-boundary).** Logical search identity is `(hostId, sessionId, turnId, sourceKind, logicalId)` — never an event ID. Content-block IDs are turn-and-family scoped (`assistant` vs `reasoning` share a namespace with a family discriminator). Tools group by session-local `toolCallId`. Assistant text comes only from approved delta fragments; reasoning comes only from the provider-supplied `summary` (never deltas, steps, or relabeled thinking). Late or out-of-order lifecycle events feed the same row via bounded assemblers; a terminal event updates its row, never creates a second terminal row. Cursor order governs scope, append order, flush, dedupe, and eviction — timestamps are display only.
- **JSON Schema `maxLength` is UTF-16 code units, not UTF-8 bytes.** TypeBox / JSON Schema `maxLength` is enforced against the JS string `.length` and cannot encode a UTF-8 byte ceiling. To honor a product byte cap (e.g. 4096 bytes on a provider summary), pick a conservative code-unit bound (1024 code units ⇒ worst case 3072 UTF-8 bytes for all-3-byte-BMP content) AND require the bridge to re-measure UTF-8 bytes after encoding and reject any oversize payload. The schema and the bridge each own one guarantee; a schema JSDoc that implies a byte ceiling the validator cannot make is a future incident.
- **Nested privacy-sensitive schemas must close `additionalProperties: false`.** Any nested object that carries user-visible or PII-adjacent data (TruncationSchema, ProviderSummarySchema, CapabilityStatusSchema variants, ErrorInfoSchema, TimingSchema, etc.) must reject unknown siblings so the bridge cannot smuggle `internal`, `private`, `debug`, or other bookkeeping fields through it. Open-by-default is the wrong default for shared-protocol nested shapes.
- **Distinguish shape guarantees from semantic / relational invariants.** The schema proves type, sign, regex pattern, closed shape, and bounded length; it cannot prove `retainedBytes ≤ totalBytes`, NFC normalization, digest correctness, or cross-sibling truncation coverage. Spell out in JSDoc which invariants the schema owns and which the bridge enforces at publish and at receive. Never let a schema claim imply a guarantee the validator cannot make.
- **Protocol fixture corpus is generator-owned.** Change `packages/protocol-fixtures/cmd/generate.ts`, never hand-edit `corpus/`; invalid fixtures must violate only the intended invariant so later schema changes cannot make them pass or fail for an incidental reason. Regeneration is deterministic and exhaustive over every declared command/event/response/error; run `bun run fixtures:check` to prove byte-for-byte drift freedom and the fixture test to prove catalogue coverage.
- **Identity-bearing protocol events carry a required `sessionId` / `turnId` / `source` / `stale` / `capability` envelope** (closed `additionalProperties: false`). Any snapshot, capability report, or other state-carrying event that a mobile client must attribute, correlate, replay, or dedupe downstream MUST include that envelope as required fields — `sessionId` is a UUID, `turnId` is bounded by `LIMITS.maxTurnIdLength`, `source` is bounded by `LIMITS.maxCapabilitySourceLength` (nonempty, identifies the producing surface), `stale` is a boolean, and `capability` is the closed `CapabilityStatus`. Omission forces the cache to refetch; an optional envelope silently degrades correlation and must be treated as a schema defect, not a wire-format choice.
- **Every user-facing error/capability text field is bounded by a named `LIMITS.*` entry and a matching schema `maxLength`.** The standard caps are 512 UTF-16 code units for narrative fields (`CapabilityStatus.reason` / `remediation`, `ErrorInfo.message`) and 128 code units for short identifier-style fields (`CapabilityStatus.source`, shared with `activityId` / `turnId` / `planId`). An unbounded or anonymous `Type.String({ minLength: 1 })` on a field displayed to the user is the F0/R1/R2 regression pattern: the schema cannot reject a multi-KiB dump and the bridge cannot rely on the contract in JSDoc.
- **Canonical root-relative path validation permits dotfiles and rejects exact `.` / `..` segments only.** Workspace-path and similar manifest-path schemas must use a precise segment check (e.g. `(?:^|/)\.\.?(?:/|$)`) so `.git`, `.git/config`, `src/.git`, `foo/.hidden`, `foo...bar`, and `..foo` are accepted while `.`, `..`, `foo/./bar`, `foo/../bar`, leading-slash, backslash, double-slash, and NUL/CR/LF paths are rejected. A blanket leading-dot rejection over-rejects legitimate dotfile segments and breaks worktree inspection; an over-loose "no `..` substring" check lets `..foo` through while still missing the canonical `foo/..` segment. The shape-only check must be paired with bridge-enforced canonicalization, symlink resolution, and `..`-escape rejection against the workspace root — those invariants need filesystem state and cannot be honest in a regex.
- **Token counts are canonical decimal strings, not numbers.** `inputTokens` / `outputTokens` / `cacheReadTokens` / `cacheWriteTokens` / `contextWindowTokens` and any future provider-usage field MUST use `Type.String` with the decimal-digit pattern `0|[1-9][0-9]{0,15}` (max 16 digits, no leading zeros, no decimal point, no exponent, no sign). JS `Number` precision loss begins at `Number.MAX_SAFE_INTEGER + 2`, so any 17-digit token total silently rounds; `Type.Integer` would quietly accept and round, and `Type.Number` accepts `Infinity` / `NaN`. The bridge never re-encodes the value — it is published verbatim from the provider. `usagePercent` stays numeric because it is a derived ratio, not a count. Use `LIMITS.maxContextTokenUsageDigits` (16) as the canonical digit cap.
- **Adding a command extends, never replaces, the protocol catalogues.** A new `command.type` MUST be added (in additive order) to `COMMAND_TYPES`, paired with its `COMMAND_METADATA` entry (scope, `requiresLeaseId`, `acceptedStates`, `semanticHashFields`, `idempotency`, `recovery`, `journaledEffects`, `stableErrors`), wired into `CommandPayloads` and any control/event/response union that publishes it, and regenerated into every generated artefact (`command.schema.json`, `control.schema.json`, `event.schema.json`, `response.schema.json`, `command-catalogue.json`, `event-catalogue.json`). New `context.{pin,unpin,exclude,refresh}` style durable mutations go through the same six-table extension — they are NOT controls and MUST NOT be smuggled into a read-only `context.snapshot.request` channel. Renaming or relocating an existing command is a breaking change: do not silently rewrite union members or `CommandPayloads` keys; instead, add the new entry and let the old one age out per the protocol versioning rules. The fixture corpus and `d-037` / `d-038` test blocks must be regenerated against the extended catalogues before any leaf wires the new command into the bridge.
