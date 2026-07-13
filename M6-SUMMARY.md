# M6 Summary — Failure recovery and process supervision

M6 makes Pi, bridge, storage, network, and resource failures resolve to durable, visible truth without silently repeating unknown work.

## Delivered

- Explicit Pi lifecycle supervisor with process-group ownership, bounded graceful/forced cleanup, redacted diagnostics, and real subprocess integration.
- Three-process default capacity (configurable 1–8), eligible-idle LRU eviction, protected running/attention states, and periodic 30-minute idle stop.
- Rolling three-crashes/five-minutes crash-loop threshold, bounded restart, durable crash-loop restoration, and explicit `session.activate` recovery.
- Host drain that emits `host.draining`, rejects new mutation before durable acceptance, stops eligible idle processes, and retains active/attention work.
- Startup reconciliation: running/dispatched commands and sessions become indeterminate, never replay automatically, and require explicit activation.
- Deterministic test-only fault inventory with one-shot/countdown behavior, in-process server hooks, no network control endpoint, and daemon release-artifact exclusion proof.
- Visible mobile states for crashes, repeated crashes, provider interruption, indeterminate completion, host degradation/drain, and safe manual retry.
- Stateful tool-output limiting: final event JSON bounded to 256 KiB, 5 MiB per-call retention, exact retained/total bytes, SHA-256 digest, UTF-8 safety, and recursive path redaction.
- Slow-consumer proof using a fully handshaken/subscribed paused socket and simulated RPC producer: client disconnects, producer settles, reconnect replay matches final cursor/digest, and dispatch remains once.

## Exit evidence

- **No indeterminate action auto-reruns:** RPC-loss, real process-kill, daemon-restart, and runtime admission tests retain one dispatch and block prompts until activation.
- **No running/attention session is evicted:** supervisor capacity/LRU/idle tests protect running, waiting, compacting, queued/attention states.
- **Cleanup and diagnostics are bounded/redacted:** graceful timeout awaits immediate process-group kill; diagnostic count/length and credential/path redaction are tested.
- **Full failure matrix passes:** [`M6-FAULT-MATRIX.md`](M6-FAULT-MATRIX.md) maps every required control to its terminal truth and executable evidence.
- **Release controls absent:** the actual supervised daemon is compiled with release autoload flags and scanned; test injector and distinctive fault markers are absent.

## Validation

```text
bun run all
  bridge: 81 tests passed
  mobile: 23 tests passed
  protocol/schema/fixture/docs/security/dependency/build gates: passed
```

The process pool is implemented and defaults to capacity three. M5 still exposes one configured diagnostic session; broad multi-session product control remains M11 scope.
