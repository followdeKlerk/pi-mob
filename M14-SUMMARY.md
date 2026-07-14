# M14 Summary — Extension UI and durable follow-up queue

M14 makes follow-up work and Pi extension interaction durable, bounded, inspectable, and reconnect-safe.

## Delivered

- SQLite-backed per-session FIFO follow-up queue with stable IDs, authoritative positions, a ten-item cap, restart recovery, atomic dispatch claims, and queue count/snapshot events.
- Explicit add/remove/clear behavior; removed items cannot dispatch, abort does not clear queued work, and `agent_settled` dispatches the next eligible item.
- Attachment references remain retained while queued and are resolved only at Pi dispatch.
- Durable interactive select/confirm/input/editor requests with opaque dialog IDs, upstream correlation, five-minute maximum expiry, duplicate-safe response claims, restart snapshot replay, and no invented expiry response.
- Exact raw Pi `extension_ui_response` transport, separate from ordinary correlated RPC commands.
- Bounded notify/status/widget/title/editor-prefill normalization; editor prefill is visible but never submitted automatically.
- Mobile queue inspection/remove/clear controls and accessible extension interaction surfaces with focus, keyboard actions, 200% text support, and expired typed-text copy preservation.

## Evidence

- `docs/evidence/m14-queue-dialog-fault-matrix.json`
- `packages/bridge/test/m14-queue-dialogs.test.ts`
- `packages/bridge/test/one-session-adapter.test.ts`
- `apps/mobile/test/interaction_m14_test.dart`
- Root `bun run all` passed after implementation.
