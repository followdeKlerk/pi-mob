# Changelog

All notable changes to Pi Mob are recorded here. Versions follow semantic versioning. The preview line uses `0.0.x-alpha.y`.

## `0.0.2-alpha.1` — canonical session events and mobile UX

- Added canonical session-event replay/live delivery and mobile transcript reduction.
- Added bounded home/GitHub workspace discovery for new chats.
- Added date-grouped chat navigation and compact settings.
- Suppressed notification alerts while the app is in the foreground.
- Added the selected-session Pi command catalogue (`catalogue.v1`) and the `/commands` mobile palette.
- Added the host-driven `/model` picker backed by `model.list` and `model.set`.
- Made canonical session events the only transcript authority on the released daemon path; the normal daemon no longer constructs or backfills the legacy recipe projection.
- Added bounded legacy event compaction after listener binding.
- Added stable assistant message identities and diagnostics for orphan assistant completions.
## `0.0.1-alpha.1` — first preview

First public preview of Pi Mob. The mobile app is Android-only and the bridge is a macOS x64 binary tarball. iOS is not distributed in this preview.

### Production-wired

- Manual endpoint plus one-time six-digit passcode enrollment; QR generation/scanning and JSON pairing-payload entry are removed and unsupported.
- Stream subscription with durable cursor, replay, and live delivery.
- Session list, rename, create, and delete.
- Per-session history import with bounded batches, durable checkpoints, and restart coverage.
- Controller leases that survive navigation and reopen quickly.
- Session activation and Pi process ownership tied to a stable `--session-id`.
- Prompt dispatch through the correct session owner with safe rejection when no live owner exists.
- Reconnectable shell that restores the most recent chat, drafts, and attachments.
- Host-driven model picker opened with `/model`, backed by `model.list` and `model.set`.
- Per-chat transcript search and global cross-chat search.
- Bounded workspace discovery and search under the host defaults (`~/GitHub`/`~/github`, home, and the configured workspace) or explicit search roots.
- Cold-launch splash card and per-chat sync progress with current chat, remaining count, elapsed, ETA, and throughput.
- FCM notifications: after the user grants OS permission, token registration and rotation are automatic when the host advertises `notifications.v1`; background delivery works on a real phone. Foreground alerts are suppressed while the app is visible; tap routing and dedupe remain best-effort until proven on a physical device.
- Host diagnostic surface with explicit phases, sanitized errors, and retry actions.

### Known limitations

- Android release signing is fail-closed and requires an external non-debug keystore; an ephemeral `/tmp` keystore is supported for local artifact verification.
- The bridge tarball is not code-signed or notarized.
- iOS is not distributed.
- The bridge is not production-wired for biometrics, public listeners, multi-user, or any cloud relay.
- Per-installation 256-bit credentials are minted by the one-time enrollment route, stored only as a bridge-side hash and Android secure-storage plaintext, and enforced on hello, binary HTTP, and device registration.
