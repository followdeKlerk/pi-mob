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
