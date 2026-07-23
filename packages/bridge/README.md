# @pi-mob/bridge

Bun/TypeScript bridge between the mobile client and Pi. It owns protocol validation, durable commands and events, controller leases, host policy, and the local WebSocket service.

```sh
bun run --filter '@pi-mob/bridge' typecheck
bun run --filter '@pi-mob/bridge' test
```

See the public [architecture](../../docs/ARCHITECTURE.md) and [protocol](../../docs/PROTOCOL.md) documentation.
