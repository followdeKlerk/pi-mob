# Decision ledger

Status: normative.

This file records decisions that shape implementation. Each decision has a review trigger so it is clear when reopening it is justified.

## D-001 — Flutter/Dart mobile client

**Decision:** Build one Flutter application for iOS and Android.

**Why:** Consistent custom transcript UI, shared protocol/domain logic, strong rendering, and acceptable access to platform APIs through plugins and platform channels.

**Review when:** A required native integration cannot be delivered reliably through a maintained plugin or a small platform channel.

## D-002 — Bun/TypeScript host bridge

**Decision:** Implement the bridge in TypeScript on Bun and compile release executables.

**Why:** Pi is TypeScript-based, Bun provides WebSocket/HTTP/SQLite/process primitives and standalone executable builds, and TypeScript gives the closest upstream contract surface.

**Review when:** Bun cannot support the oldest required host, compiled artifacts prove unreliable, or Node/Go/Rust offers a materially safer operational path.

## D-003 — Pi remains a subprocess boundary

**Decision:** Run `pi --mode rpc` as one subprocess per active session rather than embedding `AgentSession` directly.

**Why:** Process isolation, independent cwd and environment, crash containment, process-group cleanup, and a stable language-neutral boundary outweigh direct-library convenience.

**Review when:** Pi removes RPC mode, direct embedding gains a durable compatibility API with equivalent isolation, or process overhead prevents the product goals.

## D-004 — Single-user product assumption

**Decision:** MVP serves one owner controlling phone, host, providers, and tailnet.

**Why:** It avoids building accounts, roles, invitations, and tenancy before they solve a real problem.

**Review when:** Another human needs access to the same bridge or sessions.

## D-005 — Tailscale is the sole connection-authentication boundary

**Decision:** No app account, password, bearer token, pairing secret, or biometric gate in MVP.

**Why:** The owner controls the private tailnet and accepts the documented risk of authorized nodes and an unlocked phone.

**Review when:** The bridge is shared, exposed outside Tailscale, or tailnet nodes are not all trusted.

## D-006 — Loopback bridge behind Tailscale Serve

**Decision:** Bind production bridge traffic to `127.0.0.1:8787`; expose it through persistent Tailscale Serve with MagicDNS HTTPS. Never configure Funnel.

**Why:** TLS and private reachability without creating another public service or certificate system.

**Review when:** Tailscale Serve no longer supports the required transport or a different private-network deployment is explicitly required.

## D-007 — Host is authoritative

**Decision:** Repositories, provider credentials, Pi sessions, command state, replay journals, exports, and process state live on the host. Mobile stores a bounded reconstructible cache and unsent drafts.

**Why:** Execution remains private and durable even when the phone disappears.

**Review when:** Offline mobile execution or cloud-hosted authority becomes a product goal.

## D-008 — One WebSocket per host

**Decision:** One mobile connection multiplexes host and subscribed session streams.

**Why:** Simpler lifecycle, fewer sockets, coordinated host/session state, and clean multi-session background summaries.

**Review when:** Measured transport isolation or scale requires separate connections.

## D-009 — Replayable host and session streams

**Decision:** Maintain one mandatory host stream plus independent session streams.

**Why:** Session summaries, process capacity, trust, and readiness must update even when no transcript is open; each session still needs independent ordered replay.

**Review when:** A simpler event topology can prove equivalent recovery and scaling.

## D-010 — Decimal-string cursors

**Decision:** Protocol cursors are monotonically increasing decimal strings, never JSON numbers.

**Why:** JavaScript/TypeScript cannot safely represent arbitrary unsigned 64-bit integers as JSON numbers.

**Review when:** The protocol moves to a binary integer-safe encoding in a new major version.

## D-011 — Durable command idempotency

**Decision:** Every state-changing command has a client-generated command ID and canonical semantic payload hash stored transactionally before acknowledgement.

**Why:** Lost acknowledgements and reconnects must not duplicate bridge dispatch.

**Review when:** Never; only the hashing/encoding details may evolve compatibly.

## D-012 — Indeterminate actions are never auto-repeated

**Decision:** A command already running when Pi, bridge, or host crashes becomes `indeterminate` and requires a new explicit user action.

**Why:** External shell/filesystem side effects cannot be proven exactly once after a machine/process failure.

**Review when:** An individual command type gains a genuinely transactional/recoverable execution contract.

## D-013 — One active controller lease per session

**Decision:** Multiple installations/connections may observe a session, but one unexpired controller lease authorizes mutations.

**Why:** Prevent stale sockets, tablets, or duplicate app instances from racing state changes without adding user accounts.

**Review when:** Only one physical installation is technically enforced, or collaboration becomes a goal.

## D-014 — One Pi process per active session

**Decision:** Durable sessions may be stopped; active sessions have one Pi RPC subprocess each.

**Why:** Isolation, concurrency, crash containment, and natural cwd/session mapping.

**Review when:** Process overhead is measured as unacceptable or upstream introduces a better isolated multiplexer.

## D-015 — Three active processes by default

**Decision:** Default host capacity is three, configurable from one to eight. Evict only eligible least-recently-used idle processes.

**Why:** Supports useful parallel work without unbounded host resource use.

**Review when:** Real workload measurements indicate another default or adaptive capacity.

## D-016 — Bridge-owned follow-up queue

**Decision:** Steering is dispatched to Pi immediately; follow-ups remain in a durable bridge queue until the session is settled and eligible.

**Why:** Mobile can display, remove, and reliably order queued work before Pi accepts it.

**Review when:** Pi exposes a durable inspectable/removable queue with equivalent crash semantics.

## D-017 — No automatic offline send

**Decision:** A disconnected composer persists a draft but cannot automatically submit it after reconnect.

**Why:** Context and session state may have changed; executing stale intent without another user action is unsafe.

**Review when:** Explicit user-created offline scheduling is designed as a separate feature.

## D-018 — SQLite/WAL bridge state

**Decision:** Use SQLite in WAL mode for registry, commands, events, queues, leases, trust, attachments, exports, and notification registrations.

**Why:** Local transactional durability, simple deployment, backups, and strong testability.

**Review when:** Measured concurrency, corruption, or scale exceeds SQLite's suitable operating envelope.

## D-019 — Direct process spawn with explicit environment

**Decision:** Spawn Pi directly with an absolute executable, explicit cwd/PATH, and allowlisted environment. Never source interactive/login shell startup files in the RPC process.

**Why:** Shell startup output can corrupt stdout JSONL, hang startup, or introduce hidden configuration.

**Review when:** A tested upstream launcher safely exposes the required environment without shell startup side effects.

## D-020 — Configured workspace roots

**Decision:** Mobile may select/search only beneath explicit host workspace roots; no full remote filesystem browser.

**Why:** Better mobile UX and fewer accidental path disclosures/selections.

**Review when:** General remote file access becomes an explicit product goal.

## D-021 — Workspace resource trust

**Decision:** Fingerprint Pi trust-bearing project resources and require approval on first use or change.

**Why:** RPC mode is noninteractive and project resources/extensions can materially alter execution.

**Review when:** Upstream Pi provides a complete remote trust contract the bridge can delegate to.

## D-022 — Full and read-only policies

**Decision:** Trusted Full mode executes without repeated per-tool prompts; Read-only mode blocks write/edit and mutating shell/tool operations host-side.

**Why:** Full mode keeps the personal coding client useful; read-only offers a practical guardrail without pretending to be a sandbox.

**Review when:** The owner wants confirmation modes, or sandbox/container profiles are introduced.

## D-023 — No OS sandbox claim

**Decision:** MVP does not claim containment from the host user account.

**Why:** Pi explicitly runs with launcher permissions; workspace roots and read-only hooks do not create an OS security boundary.

**Review when:** Untrusted-repository execution becomes a product promise.

## D-024 — HTTPS attachment and export transfer

**Decision:** Binary files use bounded HTTPS endpoints on the same Tailscale Serve origin; WebSocket messages contain opaque IDs only.

**Why:** Avoid base64 inflation and oversized protocol frames while retaining one private origin.

**Review when:** A binary protocol major or dedicated object service is justified.

## D-025 — JPEG/PNG only for image MVP

**Decision:** Strip metadata, resize on mobile, verify/decode on host, and limit prompt attachment count/bytes.

**Why:** Covers the primary agent image use case with a constrained attack and compatibility surface.

**Review when:** PDFs or additional media are an explicit supported workflow.

## D-026 — Status-only notifications

**Decision:** Push and Live Activity contain host/session identity and state, not prompts, answers, reasoning, commands, paths, or tool output.

**Why:** Lock-screen privacy and small predictable payloads.

**Review when:** The owner explicitly requests content previews and accepts the privacy tradeoff.

## D-027 — No mutating notification actions

**Decision:** Notification taps only open/reconcile the app; abort/approve/respond actions are not supported in MVP notifications.

**Why:** Mutations require fresh state, lease validation, and visible context.

**Review when:** A secure, duplicate-safe, state-reconciled action flow is separately specified and tested.

## D-028 — Host-side export, local OS share

**Decision:** Generate HTML on the host, download via short-lived opaque ID, then use the mobile OS share sheet. No public links.

**Why:** Reuses Pi export capability while keeping publication explicit and private by default.

**Review when:** Private/public share hosting becomes a product feature.

## D-029 — Private distribution first

**Decision:** Initial releases use TestFlight and signed Android internal/private builds; no public store launch is required for MVP.

**Why:** Matches a one-owner product and reduces store/operational scope while still requiring production-quality signing and privacy configuration.

**Review when:** Other users need installable public distribution.

## D-030 — No automatic bridge updater

**Decision:** Host updates are deliberate, verified, backed up, and rollback-classified.

**Why:** The bridge controls durable state and arbitrary host execution; silent self-update adds unnecessary supply-chain and recovery risk.

**Review when:** Repeated manual updates become materially harmful and signed transactional update infrastructure exists.

## D-031 — Material 3 with an explicit token layer

**Decision:** Use Flutter Material 3 primitives plus project theme extensions; do not adopt a third-party chat/component framework by default.

**Why:** Control over performance, accessibility, and specialized agent states.

**Review when:** A maintained library proves it meets transcript, streaming, accessibility, and performance gates with less risk.

## D-032 — Shared fixtures, canonical TypeScript schemas

**Decision:** Define mobile protocol schemas in a dedicated TypeScript TypeBox package, emit JSON Schema/fixtures, and validate both TypeScript and Dart implementations against the same corpus.

**Why:** Upstream and bridge are TypeScript, while generated JSON Schema and fixtures prevent independent Dart drift without making runtime Dart depend on TypeScript.

**Review when:** A language-neutral IDL offers materially stronger code generation for both platforms.

## D-033 — Upstream Pi pin and compatibility gate

**Decision:** Initial source of truth is `earendil-works/pi`, package `@earendil-works/pi-coding-agent`, exact version `0.80.6`.

**Why:** Planning and implementation need one audited RPC/session/extension contract.

**Review when:** Any Pi update, package/repository move, or RPC/session/extension change is proposed.

## D-034 — Documentation precedence

**Decision:** Normative docs under `docs/`, `BACKLOG.md`, and current `WORKING.md` override contradictory historical text in `PLANNING.md`.

**Why:** Preserve research history without letting obsolete exploration govern implementation.

**Review when:** Documentation is consolidated after implementation stabilizes.

## D-035 — R10 transcript-search extraction identity and privacy boundary

**Decision:** R10 indexes one mutable, bounded search document for each logical
transcript item, not one document per transport event.  Its source identity is
`(hostId, sessionId, turnId, sourceKind, logicalId)`, where `sourceKind` is
`assistant`, `reasoning`, or `tool`.  The persisted search primary key must be
this source identity (or an unambiguous encoded `sourceKey`), never an event ID.
A terminal event updates that same row; it never creates a second terminal row.
The row records the terminal cursor/event ID separately for ordering and
navigation provenance.

### Scope and identity

- `turnId` carried by a lifecycle event is authoritative, including for a late
  event for an older turn.  Otherwise, the extractor may use only the unique
  open turn established by cursor-ordered `turn.started`/turn-terminal events.
  It may also use an assistant-step-to-turn association that was established
  earlier in that same ordered pass.  It must not infer scope from a timestamp,
  text, event ID, or simply the newest turn.  An event with no unambiguous
  scope is diagnostic/unindexed, not attached to a newer turn.
- Assistant and reasoning block keys are respectively
  `(turnId, "assistant", contentBlockId)` and
  `(turnId, "reasoning", contentBlockId)`.  The family discriminator is
  required as well as the turn: Pi may restart block indexes (including `0`)
  for each prompt and the two block families need not have disjoint IDs.  This
  is the same turn namespace required by the transcript reducer.
- Tool state is grouped by `toolCallId` within `(hostId, sessionId)`, exactly
  as the transcript reducer groups parallel calls.  The first resolvable tool
  event binds its turn; a later event with an explicit turn must agree.  A
  repeated `toolCallId` with a conflicting bound turn is a protocol diagnostic,
  not a new or merged call.

### Content admitted to search

- **Assistant:** append only `assistant.delta.text` (the normalized append-only
  fragment) into its scoped buffer.  `assistant.completed` seals/flushes that
  buffer.  Its similarly named `markdown`, `text`, `content`, and `summary`
  fields are not an alternative answer source: current terminal events do not
  define an
  authoritative final-text field.  If a future snapshot contract defines an
  explicit canonical replacement field, it needs a new protocol revision and
  fixtures before it can replace the delta buffer.
- **Reasoning:** index only the non-empty provider-supplied `summary` on
  `reasoning.completed`, under the scoped reasoning key.  Never concatenate or
  index `reasoning.delta`, `steps`, raw `thinking`, or a synthesized summary.
  Bridge/history normalization must therefore emit a `summary` only when the
  provider supplied a displayable summary; it must not relabel private thinking
  as a summary.
- **Tools:** make one document whose searchable fields are assembled in this
  exact way (all text is already source-bounded and is bounded again by the
  search-document cap):

  - `tool.started`: consume `toolCallId`, `turnId`, `assistantStepId`,
    `toolName`, `arguments`, and `startedAt`; bind scope, set name and the
    canonical argument summary, then create/update the running row.
  - `tool.output`: consume `toolCallId`, optional
    `turnId`/`assistantStepId`/`toolName`, `output`, `retainedBytes`,
    `totalBytes`, `isTruncated`, and `digest`; append only `output` and retain
    the latest truncation metadata. Metadata is not text.
  - `tool.completed`: consume `toolCallId`, optional scope/name, `result`,
    `finishedAt`, and truncation fields; seal the same row. Use `result` as
    output text only when no `tool.output.output` was received, so history's
    output/result pair is not indexed twice.
  - `tool.failed`: consume `toolCallId`, optional scope/name, `result`,
    `errorMessage` (or `error.message`), `finishedAt`, and truncation fields;
    seal the same row, add the error text, and use `result` only as the
    no-output fallback.
  - `tool.cancelled`: consume `toolCallId`, optional scope/name, and
    `finishedAt`; seal the same row without inventing output or an error.

  Terminal `toolName` may fill a missing start name but may not overwrite a
  known name; terminal scope may fill a missing scope but may not move a bound
  call.  `delta`, `input`, `message`, arbitrary payload serialization, and
  event IDs are not compatibility fallbacks for the fields above.

### Flushes, bounds, and recovery

- An assistant row is emitted only when it has accumulated non-empty delta
  text.  On `assistant.completed` it becomes complete.  If a turn terminal
  arrives first, flush its non-empty accumulated deltas as an *incomplete* row
  at that turn-terminal cursor; do not manufacture a final answer from terminal
  metadata.  A reasoning row is emitted only for its allowed completed summary.
  A tool row is updated while running and sealed by its own terminal; a turn
  terminal seals any remaining tool row as incomplete.
- A missing start is not fatal when a later event supplies an unambiguous scope:
  retain a provisional scoped assistant/tool buffer and merge a later start
  into it without losing terminal status.  A terminal with no useful content
  creates no anonymous assistant/reasoning row; a tool terminal may produce its
  one tool row from its own allowed name/result/error fields.  After an item is
  sealed, a duplicate is idempotent; a contradictory later lifecycle event is
  diagnostic and must not reopen or cross-attach it.  Stream gaps/conflicts are
  recovered by the existing snapshot/replay path, not guessed around.
- Buffers are bounded in UTF-8 bytes: at most 256 KiB per assistant or tool
  source and 4 KiB for the permitted reasoning summary; each persisted search
  document is capped at 240 UTF-8 bytes.  Retain truncation metadata rather
  than excess text.  Cap unresolved provisional items at the per-session
  search-document limit, evicting the oldest by canonical cursor with a
  diagnostic.  Remove transient buffers on sealing, session deletion, host
  generation reset, and successful replay replacement; delete their persisted
  rows on session deletion/reset.  Search rows remain subject to R10's
  per-session and host document/byte caps.

### Ordering and persistence

Events are reduced in one stream's arbitrary-precision decimal cursor order.
Cursor order decides scope, append order, flush cursor, duplicate handling, and
per-session eviction; timestamps are display metadata only.  Do not compare
session-stream timestamps to establish a global order.  For a host-wide cap,
use the deterministic tuple `(numeric cursor, sessionId, sourceKey)` (and a
transactional tie-breaker), never `occurredAt`/`updatedAt`.  Persist the source
record/index update transactionally with its authoritative cached event, or
make replay from that durable journal recover the same row; live/history
transport event IDs can differ and collapse only through `sourceKey`.

**Why:** This follows the mobile parser/reducer's cursor-ordered turn model,
its turn-namespaced answer builders, and its `toolCallId` grouping for
interleaved output.  It prevents the rejected search change from merging
content-block `0` across turns or using unrelated event IDs, preserves a
single deep-linkable terminal row, and enforces the product/security rule that
private chain-of-thought is never stored or searched.  It also honors R10's
bounded, replayable, all-source projection rather than treating timestamps or
live event shape as authority.

**Rejected alternatives:**

1. Keying deltas/buffers by `eventId` or bare `contentBlockId` (the approach in
   rejected `409a39a`) loses the lifecycle join and merges reused IDs across
   turns.
2. One row for every delta plus another for its terminal event duplicates
   live/history results and cannot deep-link to one logical item.
3. Reading assistant `markdown`/`text`/`content` from generic terminal payloads
   is not a current protocol contract and can index normalization artifacts.
4. Indexing reasoning deltas or history `thinking` makes private reasoning a
   searchable mobile cache.
5. Grouping tools by event ID, or serializing arbitrary payload fields and
   aliases, breaks interleaved calls and makes privacy/bounds unreviewable.
6. Timestamp ordering, newest-turn fallback, or silently healing a cursor gap
   can attach stale events to the wrong turn.

**Affected work and repair consequences:**

- `feat/global-search` (`/private/tmp/pi-mob-search`) now carries the
  committed repair candidate `f159c6d`.  It remains outside `main` pending
  review against this decision and the R10 acceptance tests; do not merge
  the rejected `409a39a` approach.  Its repair must replace event-ID maps
  and the terminal-event upsert key with `sourceKey`, add the documented
  scoped assemblers and cleanup, make the database migration preserve a typed
  deep-link target plus terminal cursor/event provenance, use numeric-cursor
  cap cleanup, and test reused assistant/reasoning block IDs, interleaved
  tools, history/live duplicate collapse, missing/out-of-order lifecycle
  events, byte caps, reset/deletion, and no reasoning-delta indexing.  It must
  fix the commit's incomplete `_Extracted.from` construction rather than patch
  around it.
- `feat/recipe-durability` (R1) must make the transcript parser/reducer use
  the same `(turnId, family, contentBlockId)` namespace for **both** assistant
  and reasoning builders, preserve explicit old-turn association, and retain
  provisional tool lifecycle state without moving a call to the latest turn.
  Its replay tests are a prerequisite for R10 integration.
- The F0 protocol owner and bridge central-integration owner must make
  `turnId` and the listed lifecycle fields explicit/fixture-backed, propagate
  them through live normalization and external history, add valid/invalid
  reuse and ordering fixtures, and stop emitting raw thinking as
  `reasoning.delta`/`summary`.  A future canonical assistant terminal-text
  contract requires a separate additive protocol decision.
- No other preserved candidate is replanned by this decision.  R10 remains
  sequenced after R1, R3, R6, and R9 as recorded in `docs/REMAINING_UX_PLAN.md`.

**Review when:** The protocol gains an explicit, provider-safe canonical final
answer replacement field; Pi guarantees globally scoped content-block IDs; or
the product deliberately changes its private-reasoning policy.

## D-036 — F0 recipe, plan, and targeted-steering contract

**Decision:** Accept the following F0 contract.

- `LIMITS.maxPlanSteps` is **64**. A `plan.snapshot.steps` array has
  `maxItems: 64`; 65 is invalid. This keeps a phone-sized authoritative plan
  bounded without truncating or inventing steps.
- `RecipeActivity.status` is exactly `pending`, `running`, `completed`,
  `failed`, or `cancelled`. These are recipe activity states, not R2 plan-step
  states (`pending`, `running`, `completed`, `blocked`, `skipped`).
- `RecipeActivity` is a closed discriminated union of `thinking` and `tool`
  activities, with shared opaque activity/turn IDs, ordinal, status, and
  timing. Only the `thinking` arm may contain an optional
  `ProviderSummary`; the `tool` arm must reject it. `ProviderSummary` means
  a provider-supplied, displayable summary only: raw thinking, reasoning
  deltas/steps, hidden metadata, and synthesized summaries are never valid in
  either arm. Its nested shape remains closed. Absence of a provider summary
  is unavailable/empty state, not permission to derive one.
- `prompt.submit.planTarget` is an optional, closed object with required
  `{ planId, stepId, revision }` (opaque IDs and `RevisionToken`). Omission
  leaves every existing `prompt.submit` payload and its three delivery modes
  valid, including legacy un-targeted `steer`. When present, the bridge must
  accept it **only** with `deliveryMode: "steer"`; it must validate the
  authoritative plan/step/revision before Pi dispatch and reject a stale or
  unknown target with `stale_plan_target` (a non-steer target is
  `invalid_state`). The target is part of the durable semantic payload, so an
  idempotency retry cannot retarget a command.

**Why:** R1 needs a finite lifecycle and a hard privacy boundary; R2 needs a
small, replayable plan and revision-safe steering. Optional additive targeting
preserves the established prompt contract while preventing an immediate or
queued prompt from being misrepresented as a targeted plan action. This is
consistent with `docs/REMAINING_UX_PLAN.md` §§2, R1, and R2, and with D-035's
provider-summary-only reasoning policy.

**Rejected alternatives:** A 65-step acceptance boundary; sharing plan
`blocked`/`skipped` states with recipes; a generic/open activity payload or
provider summary on tool activity; accepting a target for immediate/follow-up
submission; and requiring a target for legacy steering.

**Affected work and repair consequences:**

- `feat/f0-protocol` must re-plan its uncommitted F0 slice around these exact
  constants, discriminated/closed schemas, event fixtures, invalid 65-step and
  privacy fixtures, generated artifacts, and schema/fixture gates. Its current
  committed shared primitives are not approval of an open recipe payload.
- `feat/recipe-durability` (R1) must persist/reduce only the union above and
  never normalize raw thinking into `ProviderSummary`; test every terminal
  recipe status and live/history deduplication.
- `feat/structured-plans` (R2) must use the distinct plan-step state set and
  the 64-step bound. Its targeted-steer flow must always send all three target
  fields and handle `stale_plan_target` visibly.
- The bridge central-integration owner must perform the steer-only and
  authoritative revision checks before dispatch, preserving existing untargeted
  prompt behavior. R10 remains bound by D-035 and must not index anything that
  D-036 excludes.

**Review when:** A demonstrated mobile/replay limit requires a different plan
bound, Pi supplies an explicit additional recipe activity family, or a new
provider-safe reasoning-summary contract is versioned with fixtures.

## D-037 — F0 files and context protocol topology

**Decision:** Accept the following R3/R4 F0 contract.

1. `prompt.submit.fileRefs` is an optional array of revision-bound,
   root-confined file/range references. `attachmentIds` remains the existing
   binary-attachment array. They share **one** prompt-context cardinality
   budget: `attachmentIds.length + fileRefs.length <=
   LIMITS.maxAttachmentsPerPrompt` (four in v1). Each array may retain an
   individual schema maximum of four, but the bridge MUST enforce the joint
   relational limit before accepting the command. Both arrays are part of the
   durable semantic payload/hash; queued work persists both and revalidates
   file references at dispatch. A stale reference fails visibly and is never
   silently substituted with current file content.
2. Protocol v1 continues to have exactly the mandatory `host:<hostId>` stream
   and subscribed `session:<sessionId>` streams (D-009). R3 workspace tree,
   file-metadata, and file-staleness events belong to the **host stream**,
   not a new `workspace:<workspaceId>` stream class. Every such event MUST
   carry its `workspaceId`; the host stream is already mandatory and can
   invalidate a shared workspace without multiplying subscriptions/cursors.
   Lazy page/read/search responses remain nonjournaled controls. R4 context
   snapshots and outcomes remain session-scoped and use the corresponding
   session stream.
3. `files.v1` and `contexts.v1` are independent, additive, **optional hello
   capabilities**. A bridge advertises each in `hello.accepted.capabilities`
   only when it implements that bounded surface; the current mobile client
   lists each in `optionalCapabilities`, never `requiredCapabilities`. Missing
   advertisement produces explicit unavailable UI and no speculative request
   or fabricated empty state. The general hello rule is unchanged: a future
   client that explicitly makes either capability required fails the handshake
   with `unsupported_capability` when the host lacks it. Advertised capability
   does not promise every workspace/session is usable; scoped unavailable or
   stale state still carries its reason and remediation.
4. `context.pin`, `context.unpin`, `context.exclude`, and `context.refresh`
   are session-scoped durable **commands**, not controls. They therefore carry
   a client-generated `commandId`, require the applicable controller lease and
   current/revision-safe state, participate in semantic hashing/idempotency,
   persist before acknowledgement, and publish `command.state` plus an
   authoritative `context.snapshot` only after the state transition. The
   read-only `context.snapshot.request` remains a repeatable control. A lost
   response, duplicate command, stale revision, refused mutation, and
   crash-running command follow the normal accepted/failed/rejected/
   indeterminate command contract; refresh is not an exception merely because
   it obtains new source data.

**Why:** The product has one bounded prompt-context budget, not two ways to
bypass it. A workspace is shared host state, while D-009 deliberately limits
replay/cursor topology to host and session streams. Optional capability
negotiation preserves compatibility with older bridges and makes absence
truthful. Finally, pinning, exclusion, and refresh change durable context that
must survive reconnect/restart; routing them through controls would bypass
D-011 command IDs, D-012 recovery classification, and D-013 lease protection.

**Rejected alternatives:** Independent four-item `attachmentIds` and
`fileRefs` limits (which permit eight prompt-context inputs); a third
`workspace:<workspaceId>` stream (extra subscription, cursor, snapshot, and
recovery lifecycle for state already owned by the mandatory host stream);
making either new capability required for the current v1 mobile hello (which
breaks older hosts); unconditional advertisement because a schema knows the
literal; and request/response `context.*` mutation controls without command
IDs, leases, durable idempotency, or replayable outcomes.

**Affected work and repair consequences:**

- **F0 protocol owner / `feat/f0-protocol-rest`:** discard the uncommitted
  control-based R4 mutation design and do not introduce a workspace stream
  class. Re-plan the schema/catalogue, generated schemas, fixture generator,
  protocol catalogue, and tests around this decision. Add `fileRefs` to
  `prompt.submit`; bound each list and test that the combined fifth item is
  rejected by bridge semantic validation. Add `workspaceId` to every R3 host
  event and assert `EVENT_STREAM_OWNERSHIP` is `host`; no
  `workspace:<id>` subscription/cursor fixture may be added. Keep file reads,
  searches, metadata lookups, tree pages, and `context.snapshot.request` as
  repeatable controls. Add the four context mutations to `COMMAND_TYPES` and
  metadata as session-scoped lease-required commands; remove their bespoke
  result responses/control types. Fixtures must cover accepted/duplicate
  same-payload, same-ID/different-payload conflict, lease rejection, stale
  revision, terminal failure, and crash indeterminate, followed by the
  session-stream snapshot.
- **Bridge central-integration owner:** advertise `files.v1` and `contexts.v1`
  independently and only after the actual handler/source is available; enforce
  the hello required/optional rule above. Persist, hash, and replay `fileRefs`
  through immediate, steer, and follow-up paths; revalidate workspace, path,
  range, digest, and revision before Pi dispatch. Persist context mutations
  transactionally with command and event state, apply lease and expected
  revision checks, and journal host/session events on the decided streams.
- **R3 file-browser owner:** subscribe only to the mandatory host stream for
  R3 invalidation, scope every projection by `workspaceId`, and retain lazy
  controls. Composer attachment UI must consume the shared four-item budget,
  preserve rejected/stale file references for explicit repair, and never turn
  browsing into a context pin.
- **R4 context owner:** treat context state as session-scoped; send durable
  commands with command IDs, lease IDs, and snapshot revision, then render
  only command/state-confirmed changes. Do not optimistically persist a pin,
  exclusion, or refresh result from a direct control response. It may open R3
  only when `files.v1` is advertised; otherwise it remains an independent
  truthful inspector.
- **Mobile coordinator/database owner:** store the four mutation command
  lifecycle states and reconcile the resulting session snapshot; persist host
  stream file invalidations separately by host/workspace/revision. Missing
  capability is unavailable, not an empty browser or zero context usage.

**Review when:** Measured recovery pressure proves host-stream workspace
invalidations insufficient, a versioned aggregate prompt-context resource
model replaces the four-item limit, or a new protocol major explicitly changes
command/lease/idempotency semantics.

## D-038 — Exact discriminant for durable context mutation targets

**Decision:** Every `ContextMutationTarget` in `context.pin`,
`context.unpin`, `context.exclude`, and `context.refresh` MUST carry an
explicit `kind`; v1 has this closed discriminated union:

```text
{ kind: "file",   path, ranges?, revision? }
{ kind: "source", sourceId,     revision? }
{ kind: "all" }
```

`kind` is required even where the sibling fields would currently identify the
variant. A missing `kind`, an unknown kind, or fields from another variant is
invalid. `kind: "all"` remains the session-wide refresh target described by
D-037; command-specific target eligibility remains a bridge semantic rule, not
an excuse to infer a target variant from its fields.

**Why:** These are durable, semantically hashed commands that must retain the
same meaning across TypeScript, generated JSON Schema, fixtures, bridge
replay, and Dart. Shape inference (`path` means file; `sourceId` means source)
makes the wire union ambiguous as variants evolve, permits two serializations
of the same intent, and forces every consumer to reproduce precedence rules.
An exact discriminator gives one canonical serialized representation, direct
exhaustive dispatch in both languages, closed-variant validation, and a
single-invariant negative fixture for missing `kind`.

**Rejected alternatives:** Retaining the permissive TypeScript union with
kind-less file/source shapes; accepting kind omission only for legacy
`context.unpin`; and treating Dart's field-based fallback as a compatibility
adapter. F0 R4 is not yet a released wire surface, so preserving that
accidental fixture shape is less valuable than a stable cross-language
contract. A generic optional `kind` with bridge normalization is also rejected:
normalization changes the semantic-hash input and hides invalid data before it
can be reported to the caller.

**Affected work and repair consequences:**

- **F0 protocol owner / `feat/f0-protocol-rest`:** replace the nested
  kind-less file/source unions in `ContextMutationTargetSchema` with the three
  exact closed variants above; regenerate every schema/catalogue artifact.
  Update the D-037/D-038 schema proof so each valid command uses an explicit
  kind and file/source targets without it fail.
- **Fixture owner:** change the generated valid `context.unpin` fixture to
  `kind: "file"`; do not hand-edit the corpus. Generate an
  `invalid-context-target-missing-kind` fixture that otherwise contains a
  valid file target, register it in the manifest, and add the corresponding
  one-field repair (`kind: "file"`) to the TypeScript fixture proof. Keep
  file, source, and all as independently valid exact-shape examples.
- **Dart/mobile protocol owner:** make `_validateContextMutationPayload`
  require and switch on `target.kind`; remove the `sourceId` and fallback-file
  inference paths. Add direct Dart parity coverage that rejects omitted kind
  and accepts each exact variant, then consume the regenerated shared corpus.
- **Bridge/R4 owners:** emit and hash the explicit `kind` without silently
  filling it in. Reject old kind-less payloads before persistence or dispatch;
  because R4 is unreleased, no wire migration or compatibility decoder is
  authorized. Preserve D-037 lease, expected-revision, command-state, and
  snapshot rules.

**Review when:** A released protocol version needs a documented compatibility
window for already-persisted kind-less commands, or a new target variant is
versioned with an explicit literal, fixtures, generated schemas, and Dart
parity proof.
