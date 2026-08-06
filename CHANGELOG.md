# Changelog

All notable user-facing changes are recorded here while pi-mob remains pre-release. Dates describe repository changes, not a compatibility or support promise.

## 0.0.2-alpha.1

### Added

- Shared owner login-environment capture for model discovery and Pi RPC processes.
- Multi-session Pi RPC handling with bounded host process capacity.
- Android chat shell with saved chats, model controls, transcript search, global search, follow-up queues, attachments, exports, extension requests, and explicit uncertain-command recovery.
- Canonical session-event v2 replay/live transport and mobile transcript reducer.
- Bounded shallow workspace discovery from host home/GitHub defaults or explicit search roots.
- Date-grouped chat navigation with compact settings and notification controls.
- Foreground notification suppression; background FCM delivery remains enabled.
- Inline subagent activity presentation.
- Canonical project-status and roadmap documentation.

### Changed

- Pi runs with its normal execution model; the previous default bridge-owned policy extension is no longer injected.
- Historical recipe projection now tracks changed activity identities rather than repeatedly rescanning the complete projection.
- Full SQLite integrity verification was removed from ordinary daemon startup and remains an explicit maintenance concern.
- Durable mobile event handling is more tolerant of unknown forward-compatible event payloads so one event does not automatically poison a healthy connection.
- Documentation now distinguishes production-wired, implemented-but-unwired, planned, and out-of-scope capabilities.

### Fixed

- External-history projection scaling that could keep the bridge CPU-bound before listener startup.
- Cumulative Pi tool-progress snapshots being treated as additive output.
- Workspace search feature-level rejection incorrectly demoting an otherwise healthy mobile connection.
- Several environment-capture and LaunchAgent compatibility issues discovered during host installation.
- Subagent output amplification and unreadable activity presentation.

### Known limitations

- Legacy transcript caches/history synchronization and the bridge recipe projection remain during the canonical migration; the subtractive rewrite is not yet complete.
- Advanced providers for attention, first-class agent supervision, catalogues, plans, context, file browsing, and process output are not injected by the normal daemon.
- Projection failures for malformed known events can be isolated without a visible degraded-state signal.
- Android and macOS artifacts remain preview-signed or unsigned; version metadata is not fully aligned.
- Current validated host build is macOS x86_64; Apple Silicon is not release-validated and iOS is not distributed.

### Scope decision

- Git status, commit, push, CI summaries, and repository-action controls are explicitly out of scope and are not part of the roadmap.

See [Project status and roadmap](docs/PROJECT_STATUS.md) for the ordered work required for beta.
