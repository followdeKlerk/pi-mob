# @pi-mob/bridge

Strict Bun/TypeScript bridge package. M1 ships:

- redaction-first logger interface,
- versioned config parser placeholder with explicit dev/release separation,
- source and compiled smoke entrypoints that load only explicit config paths
  and refuse to read adjacent `.env`/`bunfig.toml`.

M2 and later checkpoints add the real Pi RPC adapter, durable journal, lease
state, queue, and bridge→mobile WebSocket transport. See
[`BACKLOG.md`](../../BACKLOG.md) and [`docs/PROTOCOL.md`](../../docs/PROTOCOL.md).

## Scripts

```sh
bun run --filter '@pi-mob/bridge' typecheck
bun run --filter '@pi-mob/bridge' test
bun run --filter '@pi-mob/bridge' build:smoke
```
