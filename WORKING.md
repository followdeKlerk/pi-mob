# Working

Status: M0–M14 done; M15 activation ready

## Current checkpoint

**M15 — Notifications and background experience**

The complete implementation plan is in [`BACKLOG.md`](BACKLOG.md). Normative documents under `docs/`, current `BACKLOG.md`, and this file override historical planning text.

## Current objective

Add privacy-preserving best-effort APNs/FCM status delivery and platform background surfaces while keeping foreground bridge reconciliation authoritative. Completed evidence is retained in [`M1-SUMMARY.md`](M1-SUMMARY.md) through [`M14-SUMMARY.md`](M14-SUMMARY.md).

## Completed foundation

- **M0–M9:** protocol, durable bridge, private host, trust policy, production transcript/tools/composer.
- **M10–M12:** Pi controls, multiplexed sessions/controller leases, and durable session lineage/lifecycle.
- **M13:** bounded private image attachments, opaque HTML export, and explicit native sharing.
- **M14:** durable bounded follow-up queues, exact Pi extension-response mapping, and reconnect-safe accessible interaction UI.

## Immediate next actions

1. Add durable device registration and APNs/FCM host adapters with permanent rejection cleanup.
2. Implement status-only notification policy, coalescing/rate limits, deep-link reconciliation, and degradation isolation.
3. Add iOS and Android permission/background surfaces and execute the real-device lifecycle matrix.

## Do not start yet

Until M15 exits: M16 release hardening and later release surfaces.

## Blockers

Final M15 proof requires external APNs/FCM credentials, signing, notification permission interaction, and physical iOS/Android devices.
