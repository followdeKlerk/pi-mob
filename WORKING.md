# Working

Status: M0–M15 done; Android FCM lifecycle proven; Apple activation explicitly deferred

## Current checkpoint

**M16 — Accessibility, performance, privacy, and operations hardening (ready, not started)**

The complete implementation plan is in [`BACKLOG.md`](BACKLOG.md). Normative documents under `docs/`, current `BACKLOG.md`, and this file override historical planning text.

## Current objective

Preserve the completed M10–M15 implementation and evidence. M15 now includes production Firebase configuration, durable device registration, real background FCM delivery, foreground-service lifecycle, and authoritative stale deep-link reconciliation on a physical Android device. Apple APNs and Live Activity activation is outside the foreseeable product scope by explicit owner decision.

## Completed foundation

- **M0–M9:** protocol, durable bridge, private host, trust policy, production transcript/tools/composer.
- **M10–M12:** Pi controls, multiplexed sessions/controller leases, and durable session lineage/lifecycle.
- **M13:** bounded private image attachments, opaque HTML export, and explicit native sharing.
- **M14:** durable bounded follow-up queues, exact Pi extension-response mapping, and reconnect-safe accessible interaction UI.
- **M15:** status-only APNs/FCM adapters, production Android FCM activation, permission/channel and foreground service, real background delivery, failure isolation, and foreground reconciliation. See [`M15-SUMMARY.md`](M15-SUMMARY.md) and [`docs/evidence/m15-android-lifecycle-report.json`](docs/evidence/m15-android-lifecycle-report.json).

## Immediate next actions

1. Keep Firebase client and service-account credentials local and out of version control.
2. Await explicit direction before starting M16.
3. If Apple products return to scope later, reactivate the deferred APNs/Live Activity device matrix as separate work.

## Do not start yet

M16 and later release-hardening work require explicit owner direction.

## Blockers

None for the completed Android M15 scope.
