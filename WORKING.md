# Working

Status: M0–M15 done; M16 implementation complete locally; real-Android TalkBack checkpoint evidence blocked by device availability

## Current checkpoint

**M16 — Mobile product UX, visual system, and workflow integration (active)**

The complete implementation plan is in [`BACKLOG.md`](BACKLOG.md). Normative documents under `docs/`, current `BACKLOG.md`, and this file override historical planning text.

## Current objective

Complete the new mobile product experience without changing bridge authority or durable command semantics. All locally verifiable M16 implementation now includes light/dark token themes, semantic status colors, compact status grammar, discoverable commands and skills, shared reduced-motion primitives, visible focus treatment, a Sessions/Activity/Host product shell, progressive host diagnostics, and a calmer transcript hierarchy.

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

1. Connect the target Android phone and run the complete M16 checkpoint journey with TalkBack enabled, 200% text scale, and reduced motion.
2. Retain the required Android screenshots, frame captures, TalkBack transcript, and reduced-motion captures; update M16-08 and exit criteria only after that evidence exists.
3. Keep Firebase credentials local; Apple activation remains deferred.

## Do not start yet

M17 hardening and M18 signed release remain blocked until M16 exits.

## Blockers

The real-Android M16 checkpoint is blocked by device availability. On 2026-07-20, `adb devices -l` returned no devices and `flutter devices` listed only macOS and Chrome. Therefore the required TalkBack primary-journey walkthrough and Android evidence bundle cannot be truthfully completed or claimed in this pane. No M17 work has started.
