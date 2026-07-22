# Working

Status: R1/R3/R5/R6/R9 core slices integrated; central runtime/mobile integration active. M16 physical-Android TalkBack evidence remains pending.

## Current checkpoint

**Central R3/R5/R6 runtime and mobile integration (active)**

The complete implementation plan is in [`BACKLOG.md`](BACKLOG.md). Normative documents under `docs/`, current `BACKLOG.md`, and this file override historical planning text.

## Current objective

Continue the additive R3/R5/R6 integration without changing bridge authority or durable command semantics. The latest integrated slices are `9604868` (bounded R3 workspace-file control routing, optional `files.v1` advertisement, and send-time file-reference admission) and `199b82e` (D-039 process snapshot request correlation on mobile).

M16 builds the mobile product's original non-derivative identity on three proven grammars:

- **Linear-grade information density** — compact session/list rows, restrained chrome, focused content surfaces, calm typography hierarchy.
- **GitHub-grade agent UX** — unambiguous primary action, secondary actions in overflow, transparent state, status pills, discoverable command/skill surface.
- **Claude-grade readability** — legible transcript typography, generous line height, clear user/assistant/reasoning/tool hierarchy, focused final-answer surface.

M16 is anchored by a normative design-token system and navigation contract documented in [`docs/UX.md`](docs/UX.md) and [`docs/IMPLEMENTATION_DEFAULTS.md`](docs/IMPLEMENTATION_DEFAULTS.md), so M17 hardening and M18 signed release ship on one coherent visual foundation. Apple physical-device evidence is deferred by product scope; M16 physical evidence is Android-only.

## Completed foundation

- **M0–M9:** protocol, durable bridge, private host, trust policy, production transcript/tools/composer.
- **M10–M12:** Pi controls, multiplexed sessions/controller leases, and durable session lineage/lifecycle.
- **M13:** bounded private image attachments, opaque HTML export, and explicit native sharing.
- **M14:** durable bounded follow-up queues, exact Pi extension-response mapping, and reconnect-safe accessible interaction UI.
- **M15:** status-only APNs/FCM adapters, production Android FCM activation, permission/channel and foreground service, real background delivery, failure isolation, and foreground reconciliation. Apple APNs and Live Activity activation remains deferred by product scope. See [`M15-SUMMARY.md`](M15-SUMMARY.md) and [`docs/evidence/m15-android-lifecycle-report.json`](docs/evidence/m15-android-lifecycle-report.json).

## Latest M16 slice

- **M16-02/03 (density and agent UX):** `StatusPill` / `SessionStatePill` unify runtime state in the app bar and saved-chat rows; the app bar now exposes observer/controller role, search, and an explicit Commands and skills sheet backed by the existing command model.
- **M16-06b (full token migration):** `scripts/token-lint.ts` now scans 71 Dart files across nine mobile trees. Existing ad-hoc spacing, radius, and color literals in transcript widgets, controls, sessions, session tree, attachments, interaction, workspaces, and pairing use the shared Pi token/theme layer.
- **M16-07 (motion grammar):** `PiCurve` and shared `MotionSpinner`, `MotionProgressBar`, and `MotionCrossfade` primitives apply semantic transitions and collapse continuous motion under `MediaQuery.disableAnimations`.
- **M16-08 (local accessibility implementation):** new primitives expose stable semantics; `FocusRing` provides a visible 2dp focus indicator; widget coverage proves light/dark rendering, focus behavior, reduced-motion fallbacks, and 100/150/200% text-scale baselines.
- **Validation:** `bun run all` passes (including formatting, analysis, typechecks, security/docs/schema/fixture checks, 71-file token lint, 347 Flutter tests, release build) and a separate `cd apps/mobile && flutter test` passes all 347 tests.

## Immediate next actions

1. Wire `AuthoritativeProcessRegistry` and `GitSummaryService` into bridge runtime/server dispatch, including explicit unavailable state and cancellable Git summaries.
2. Complete mobile durable projections and shell reachability for R1/R3/R5/R6/R9/agent supervision; file and palette insertion must never send automatically.
3. Implement R2/R4, audit R7–R12, then run full repository checks, build an Android APK, and capture physical-device evidence.

## Do not start yet

M17 hardening and M18 signed release remain blocked until M16 physical-device evidence exits.

## Blockers

The real-Android M16 checkpoint is blocked by device availability. On 2026-07-20, `adb devices -l` returned no devices and `flutter devices` listed only macOS and Chrome. Therefore the required TalkBack primary-journey walkthrough and Android evidence bundle cannot be truthfully completed or claimed in this pane. No M17 work has started.
