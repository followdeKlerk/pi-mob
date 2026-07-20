# M5 Summary — One-session end-to-end diagnostic client

M5 delivers a plain Flutter diagnostic client controlling one real Pi `0.80.6` session through the durable loopback bridge.

## Delivered

- Drift-backed mobile installation, host, session, decimal cursor, normalized event, snapshot, and draft/pending-command state.
- HTTPS readiness probe and one `wss` connection with hello, capability checks, host/session subscriptions, replay, cursor acknowledgements, multipart snapshots, and host-generation reset.
- Ordered per-stream reducer with arbitrary-precision decimal cursors, deduplication, conflicting-duplicate and gap recovery, and atomic snapshot replacement.
- One configured workspace/session bridge adapter and daemon entrypoint for use behind private Tailscale Serve.
- Material 3 endpoint/readiness/version UI, workspace/session controls, bounded raw event view, persistent composer, explicit retry, and abort.
- Durable prompt semantics: exact command ID and payload are stored before send; reconnect/app restart performs `command.current` only; offline drafts never auto-send.
- Foreground-only reconnect, process-restart restoration, controller acquisition/renewal, and stale-lease handling.

## Exit evidence

- **Real prompt completes:** `packages/bridge/test/m5-real-adapter.test.ts` runs pinned Pi with the deterministic provider, observes normalized tool events, ordered cursors, and `turn.settled`.
- **Active abort works:** the same test starts a slow real provider turn, sends Pi `abort`, and observes durable `turn.aborted` plus idle materialized state.
- **Lost receipt produces one dispatch:** `packages/bridge/test/m4-demo.test.ts` and `one-session-adapter.test.ts` resend the same durable command and assert one adapter dispatch.
- **Replay reaches identical settled state:** bridge integration tests restart/replay durable host/session state; host snapshots include session summaries; mobile snapshot/replay tests atomically restore the same cursor and projection.
- **Draft clears only after accepted/current:** coordinator tests prove pre-accepted receipts retain text, accepted/current reconciliation clears it, and failed/indeterminate reconciliation retains it.
- **Offline never auto-sends:** widget/coordinator tests prove disabled offline send, reconnect read-only reconciliation, and app-process recreation over the same database without `prompt.submit`.
- **Generation recovery:** coordinator tests prove old cursors/sessions/commands are quarantined while draft text survives and host synchronization restarts without a cursor.

## Validation

Validated on 2026-07-13:

```text
bun run all
  bridge: 51 tests passed
  mobile: 21 tests passed
  protocol/schema/fixtures/security/dependency/build gates: passed
```

The daemon binds only to loopback. The diagnostic app's HTTPS origin is the private Tailscale Serve endpoint that proxies that loopback listener; automated installation/pairing remains M7 scope.
