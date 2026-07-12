# Working

Status: ready to scaffold

## Current objective

Build **MVP Slice A: reliable core loop** before implementing polished session management or background notifications.

The first proof must establish that a Flutter client can submit one prompt to a real Pi RPC process through the bridge, lose connectivity, reconnect, and recover without executing the prompt twice.

## Decisions already locked

- Flutter/Dart mobile client.
- Bun/TypeScript bridge in this repository.
- macOS host support first.
- Tailscale Serve to a loopback-only bridge.
- Tailscale is the sole connection-authentication boundary for the initial single-user application.
- One Pi RPC subprocess per active session.
- SQLite/WAL bridge state.
- Client-generated command IDs and duplicate-safe bridge dispatch.
- Running commands become indeterminate after a process/host crash and are not automatically repeated.
- Trusted workspaces execute normally after one approval; read-only mode remains available.
- Concurrent sessions remain an MVP requirement, delivered after the core loop is proven.

## Ordered next work

### 1. Scaffold repository

Create:

```text
apps/mobile
packages/bridge
packages/pi-extension
packages/protocol-fixtures
```

Add pinned tool versions, root commands, formatting, linting, typechecking, and test configuration.

### 2. Implement protocol models first

- TypeScript envelope schemas.
- Dart envelope models.
- Shared JSON fixtures.
- Handshake and version negotiation.
- Stable errors.
- Command IDs, payload hashes, and state transitions.

Do not start transcript polish before both languages consume the same fixtures.

### 3. Implement Pi JSONL adapter

- Strict LF framing.
- Trailing CR removal.
- Chunk and Unicode handling.
- Optional Pi command-ID correlation.
- Real Pi contract test against version 0.80.6.
- Normalization of minimum events required for text prompts, streaming, tools, abort, and settled state.

### 4. Implement bridge persistence

- SQLite migrations.
- Sessions, commands, events, and cursors.
- Persist-before-send event journal.
- Command acceptance transaction.
- Duplicate command lookup.
- Expired-cursor snapshot path.

### 5. Implement one-session bridge

- Loopback HTTP server.
- `/healthz`, `/readyz`, and `/v1/ws`.
- One Pi subprocess.
- Prompt submit.
- Streaming events.
- Abort.
- Heartbeats and reconnect.
- Deliberate crash/failure injection in tests.

### 6. Implement diagnostic Flutter client

- Manual endpoint entry before QR polish.
- Connect and handshake.
- One hard-coded or recent workspace.
- Submit text.
- Display normalized raw event states.
- Abort.
- Persist cursor and draft.
- Reconnect and replay.

The first client is allowed to be visually plain.

### 7. Prove Slice A failure cases

Required demonstrations:

- Disconnect before acknowledgement; resend same command ID; one execution.
- Disconnect during streaming; ordered replay.
- Kill bridge after acceptance but before dispatch; one execution after recovery.
- Kill bridge while Pi is running; mark indeterminate without rerun.
- Kill Pi while running; mark indeterminate and restore session idle.
- Expire cursor; restore through snapshot.
- Oversized output; truncate without bridge failure.

### 8. Add macOS service packaging

- Compiled bridge executable.
- LaunchAgent.
- Versioned TOML config.
- Tailscale Serve setup/check.
- `pi-mob doctor`.
- Install, update, rollback, and uninstall scripts.

### 9. Regenerate project orientation

Run `/check` after the scaffold lands so `check.md` reflects the real package structure and commands. Do not manually preserve its current docs-only snapshot.

## Slice A exit condition

Slice A is complete only when a real phone or simulator drives a real Pi session and the reconnect/idempotency integration suite passes.

## Not part of the first coding pass

These remain MVP work but do not block Slice A:

- Full session switcher and concurrent-process UI.
- Fork, clone, tree, export, and sharing.
- Model/thinking settings polish.
- Extension dialog sheets.
- Image attachments.
- APNs, FCM, Live Activity, and Android foreground service.
- Final visual system and high-refresh tuning.

## Blockers

None. The next action is repository scaffolding, not further broad market research.
