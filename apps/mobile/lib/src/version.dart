/// Generated mobile version module.
///
/// This file is produced by `scripts/sync-version.ts` from the root
/// `VERSION` file and must not be edited by hand. The Flutter app
/// imports `kMobileAppVersion` everywhere the canonical release
/// identifier is needed (notification registration, the WebSocket
/// handshake payload, the database seed row, and the runtime
/// constructors).
///
/// The `version:check` script fails the CI gate whenever this
/// constant drifts from `VERSION`. There is no fallback: a missing
/// generated file is a build-time bug, not a runtime concern.
library;

const String kMobileAppVersion = '0.0.1-alpha.1';
