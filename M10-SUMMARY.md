# M10 Summary — Models, context, retry, compaction, and commands

M10 exposes configured Pi controls without moving provider credentials or model configuration to mobile.

## Delivered

- Pi capability refresh through `get_available_models`, `get_state`, `get_session_stats`, and `get_commands`, persisted into durable session state and replayable `model.state` / `context.state` events.
- Durable model, thinking, auto-retry, retry-abort, manual/auto compaction, steering-mode, and follow-up-mode commands mapped to pinned Pi RPC methods. Model/thinking changes are rejected outside idle/stopped state.
- Advisory token/context/cost state with explicit unknown/null handling and no spending-cap claim.
- Retry countdown/attempt and compaction lifecycle presentation without inventing settled boundaries.
- Bounded, redacted, categorized, searchable skill/template/extension command catalogue; TUI-only commands are excluded. Invocation prefills the composer and never auto-sends.
- Accessible model/thinking, context, retry, compaction, unsupported-state, and command widgets with 200% text-scale tests.

## Evidence

- `packages/bridge/test/one-session-adapter.test.ts`
- `packages/bridge/test/command-catalogue.test.ts`
- `apps/mobile/test/connection_coordinator_test.dart`
- `apps/mobile/test/controls/`
- Root `bun run all`: bridge 267 tests, fixtures 5, extension 248, Flutter 125, all build/analyze/schema/security gates passed.
