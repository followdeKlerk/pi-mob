# @pi-mob/protocol-fixtures

Generated shared protocol `1.0` fixture corpus consumed directly by both TypeScript and Dart.

The corpus covers every declared command, event, response, and stable error, plus invalid envelopes, protocol/capability boundaries, replay/snapshot recovery, controller leases, command idempotency/crash recovery, queues, attachments, exports, dialogs, pagination, and semantic-hash goldens.

```sh
bun run --cwd packages/protocol-fixtures test
bun run --cwd packages/protocol-fixtures generate
bun run fixtures:check
```

`fixtures:check` regenerates into a temporary directory and fails on any byte-level corpus drift. Flutter tests load the canonical repository files directly; no copied mobile fixture corpus is committed.
