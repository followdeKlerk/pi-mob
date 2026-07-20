# M15 Summary — Android notifications and background experience

M15 adds privacy-preserving, best-effort status delivery while keeping the foreground bridge state authoritative.

## Delivered

- Durable device installation and token registration, replacement, unregister, permanent-rejection cleanup, and restart-safe storage.
- APNs token-auth and FCM HTTP v1 transport adapters with bounded requests and failure isolation from Pi processing.
- Production bridge `--fcm-service-account` activation from an owner-only local credential file; only FCM is advertised when configured in Android-only mode.
- Closed settled/failed/indeterminate/needs-attention/crash-loop status policy, strict generic-copy/data allowlist, coalescing, rate limits, stale-event dropping, and opaque deep links.
- Android Firebase initialization, real token acquisition, permission/channel flow, token-rotation retry across handshake races, and user-enabled foreground service started only while visible.
- Real background FCM delivery on a Samsung SM-A528B, followed by safe stale-target reconciliation back to authoritative ready state.
- No mutating notification actions and no transcript, prompt, path, tool, output, or content fields in push payloads.
- Apple APNs and Live Activity activation is explicitly deferred from the foreseeable product scope; deterministic APNs adapter coverage remains.

## Credential handling

- `google-services.json` is provisioned locally and ignored by Git.
- The Firebase service-account JSON remains outside the repository with owner-only permissions.
- Tests and evidence never print or retain token/private-key values.

## Evidence

- `docs/evidence/m15-android-lifecycle-report.json`
- `packages/bridge/test/m15-notifications.test.ts`
- `packages/bridge/test/m15-fcm-daemon-config.test.ts`
- `apps/mobile/test/notification_controller_m15_test.dart`
- Physical Android Firebase initialization, durable registration, real FCM HTTP v1 delivery, notification display, tap, and stale deep-link reconciliation.
- Root `bun run all` passed after implementation.
