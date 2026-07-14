# Working

Status: M0–M14 done; M15 implemented with Android lifecycle proof, external push/iOS proof pending

## Current checkpoint

**M15 — Notifications and background experience**

The complete implementation plan is in [`BACKLOG.md`](BACKLOG.md). Normative documents under `docs/`, current `BACKLOG.md`, and this file override historical planning text.

## Current objective

Finish real FCM delivery and signed iOS APNs/Live Activity lifecycle proof. The privacy-preserving notification stack is implemented, deterministic tests pass, and Android permission, foreground-service, background, and reconciliation behavior is physically proven in [`docs/evidence/m15-android-lifecycle-report.json`](docs/evidence/m15-android-lifecycle-report.json). Completed milestone evidence is retained in [`M1-SUMMARY.md`](M1-SUMMARY.md) through [`M14-SUMMARY.md`](M14-SUMMARY.md).

## Completed foundation

- **M0–M9:** protocol, durable bridge, private host, trust policy, production transcript/tools/composer.
- **M10–M12:** Pi controls, multiplexed sessions/controller leases, and durable session lineage/lifecycle.
- **M13:** bounded private image attachments, opaque HTML export, and explicit native sharing.
- **M14:** durable bounded follow-up queues, exact Pi extension-response mapping, and reconnect-safe accessible interaction UI.

## Immediate next actions

1. Supply local Firebase Android configuration and host-side FCM service-account credentials, then prove real background/locked delivery and stale deep-link reconciliation.
2. Select full Xcode, configure Apple signing/APNs credentials, and run the APNs/Live Activity lifecycle matrix on a physical iPhone.
3. Record final M15 evidence, run the full gate, and only then mark M15 complete.

## Do not start yet

Until M15 exits: M16 release hardening and later release surfaces.

## Blockers

Final M15 proof still requires external Firebase/APNs credentials, Apple signing/full Xcode, and a physical iPhone. Android permission and lifecycle interaction is complete.
