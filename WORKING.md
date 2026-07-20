# Working

Status: M0–M15 done; M16 active with theme, transcript, product-shell foundation, and token-only lint shipped

## Current checkpoint

**M16 — Mobile product UX, visual system, and workflow integration (active)**

The complete implementation plan is in [`BACKLOG.md`](BACKLOG.md). Normative documents under `docs/`, current `BACKLOG.md`, and this file override historical planning text.

## Current objective

Complete the new mobile product experience without changing bridge authority or durable command semantics. The first M16 slice now includes light/dark token themes, semantic status colors, a Sessions/Activity/Host product shell, progressive host diagnostics, and a calmer transcript hierarchy.

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

- **M16-06a (token-only lint):** `scripts/token-lint.ts` scans `apps/mobile/lib/src/ui/**` for ad-hoc padding / corner radius / letterSpacing / hex-color literals, with a per-line `// pi-mob:token-legacy-allow` escape hatch and an allowlist for the three token-declaration files. Wired into `bun run all` and `bun run token:lint`. The daily-ui subtree is token-pure as of this checkpoint.
- **Backlog:** `BACKLOG.md` M16-06 split into 06a (lint shipped) and 06b (broader migration pending).
- **Migration follow-up:** migrate transcript widgets, controls, sessions, session tree, attachments, and interaction widgets to PiSpacing/PiRadius tokens, then expand the lint's scope to those subtrees.

## Immediate next actions

1. Extend the token-only lint to the remaining mobile subtrees (transcript widgets, controls, sessions, session tree, attachments, interaction) and migrate the existing ad-hoc constants to tokens. See BACKLOG.md M16-06b.
2. Continue migrating session/workspace/control surfaces away from generic nested cards; add per-row status pills and progress surfaces (M16-02/03).
3. Validate the new shell and theme on the target Android phone from the Taildrop build once M16-02/03 land a row-density change.
4. Keep Firebase credentials local; Apple activation remains deferred.

## Do not start yet

M17 hardening and M18 signed release remain blocked until M16 exits.

## Blockers

None. Remaining M16 work is planned product work, not an external blocker.
