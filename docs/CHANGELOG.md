# Changelog

All notable changes to Pi Mob are recorded here. Versions follow semantic versioning. The preview line uses `0.0.x-alpha.y`.

## `0.0.1-alpha.1` — first preview

First public preview of Pi Mob. The mobile app is Android-only and the bridge is a macOS binary tarball. iOS is not distributed in this preview.

### Production-wired

- Stream subscription with durable cursor, replay, and live delivery.
- Session list, rename, create, and delete.
- Per-session history import with bounded batches, durable checkpoints, and restart coverage.
- Controller leases that survive navigation and reopen quickly.
- Session activation and Pi process ownership tied to a stable `--session-id`.
- Prompt dispatch through the correct session owner with safe rejection when no live owner exists.
- Reconnectable shell that restores the most recent chat, drafts, and attachments.
- Catalogue authority with explicit unavailable states.
- Model picker with host-supplied models.
- Per-chat transcript search and global cross-chat search.
- Bounded workspace search under the configured search root.
- Cold-launch splash card and per-chat sync progress with current chat, remaining count, elapsed, ETA, and throughput.
- FCM notifications with capability-gated automatic enrollment, foreground and background delivery, and tap routing back to the correct chat.
- Host diagnostic surface with explicit phases, sanitized errors, and retry actions.

### Known limitations

- The Android APK is signed for development only.
- The bridge tarball is not code-signed or notarized.
- iOS is not distributed.
- The bridge is not production-wired for biometrics, public listeners, multi-user, or any cloud relay.
