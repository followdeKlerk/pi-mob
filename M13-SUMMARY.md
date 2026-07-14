# M13 Summary — Attachments, export, and OS sharing

M13 adds bounded private image transfer and explicit HTML export sharing without exposing host paths or generating public links.

## Delivered

- Gallery JPEG/PNG picker with real decode, bounded resize, pixel re-encoding that strips metadata, four-file/10 MiB/25 MiB validation, and iOS photo-library purpose text.
- Streaming multipart client/server transport, installation-scoped upload idempotency, digest conflict detection, random private UUID storage, startup/periodic expiry cleanup, and resumable chunk integrity.
- JPEG/PNG magic, hardened decode, CRC/entropy, dimension, pixel/decompression, digest, malformed, and compressed-byte limits.
- Pre-acceptance attachment availability checks, durable mobile draft references, queued/accepted retention, expiry cleanup, and base64 Pi image mapping only at RPC dispatch.
- Pi `export_html` integration with durable opaque export registry, bounded private download, sanitized content disposition, 24-hour expiry, and pending/failed download denial.
- Mobile attachment chips/progress/retry/replace/remove/expiry, export progress/download, privacy warning, and explicit native `share_plus` share-sheet adapter.
- No public URL generation and no host/mobile path disclosure in protocol metadata.

## Evidence

- `docs/evidence/m13-attachment-security-report.json`
- `packages/bridge/test/m13-attachments.test.ts`
- `packages/bridge/test/m13-export.test.ts`
- `packages/bridge/test/m13-admission-cleanup.test.ts`
- `apps/mobile/test/attachments/`
- `apps/mobile/test/attachments_domain_m13_test.dart`
- `apps/mobile/test/app_database_m13_test.dart`
- M13 coordinator scenarios in `apps/mobile/test/connection_coordinator_test.dart`
- `apps/mobile/test/m13_platform_config_test.dart`
- Android API 36 device demo: `flutter run -d emulator-5554 -t tool/m13_share_demo.dart --debug --no-resident`; the Android chooser opened for the generated local HTML file and was explicitly dismissed.
- Root `bun run all`: all typecheck, bridge, real pinned-Pi, fixture, extension, Flutter, schema, docs, security, dependency, and release-build gates passed.
