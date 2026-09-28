# Changelog

This file records user-visible preview changes. It does not promise compatibility or support.

## 0.0.3-alpha.1 (main branch; unreleased)

- Restored the normal daemon's supervised Pi subprocess backend while preserving stable bridge session IDs.
- Added the selected-session `/commands` catalogue UI (not production-wired by the normal daemon) and the host-driven `/model` picker.
- Made canonical session events the main-branch transcript path.
- Improved bounded legacy cleanup, tool-result handling, and diagnostics.
- Surfaced a bounded, actionable transcript error when a provider rejects a turn instead of leaving an empty assistant reply.

## 0.0.2-alpha.1

- Added the Android chat shell, multi-session Pi supervision, history replay, search, attachments, exports, and notifications.
- Added bounded workspace discovery and host diagnostics.
- Restored Pi's normal execution model by removing the default bridge policy extension.
- Fixed startup, tool-progress, workspace-search, environment, and activity-display problems.
- Validated the preview bridge on macOS x64. iOS was not distributed.

The `0.0.3-alpha.1` entry describes unreleased main-branch work; the older entries describe published previews. See [Project status](docs/PROJECT_STATUS.md) for current capabilities and scope.
