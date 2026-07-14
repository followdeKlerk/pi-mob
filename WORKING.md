# Working

Status: M0–M15 done; M16 active with theme, transcript, and product-shell foundation implemented

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
- **M15:** status-only APNs/FCM adapters, production Android FCM activation, permission/channel and foreground service, real background delivery, failure isolation, and foreground reconciliation. See [`M15-SUMMARY.md`](M15-SUMMARY.md) and [`docs/evidence/m15-android-lifecycle-report.json`](docs/evidence/m15-android-lifecycle-report.json).

## Immediate next actions

1. Validate the new shell and theme on the target Android phone from the Taildrop build.
2. Continue migrating session/workspace/control surfaces away from generic nested cards and complete TalkBack evidence.
3. Keep Firebase credentials local; Apple activation remains deferred.

## Do not start yet

M17 hardening and M18 signed release remain blocked until M16 exits.

## Blockers

None. Remaining M16 work is planned product work, not an external blocker.
