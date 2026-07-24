# Architecture

pi-mob has three components:

1. **Mobile app** — Flutter client for pairing, session control, transcript presentation, and local drafts.
2. **Bridge** — Bun/TypeScript service that validates the protocol, persists commands/events, manages controller leases, and proxies to Pi.
3. **Host runtime** — Pi processes with the owner's captured login environment, trusted workspaces, credentials, and local storage.

```text
Flutter app ⇄ private HTTPS/WebSocket ⇄ loopback bridge ⇄ Pi RPC ⇄ host workspace
```

## Trust boundaries

The bridge accepts traffic only through the configured private network path and validates every message before acting. The host is authoritative for execution and data; the mobile client is a cache and control surface. Durable command IDs and leases prevent duplicate or conflicting mutations.

## Design principles

- Keep provider credentials and repositories on the host.
- Persist command acceptance before execution.
- Replay events deterministically after reconnect.
- Report unavailable or indeterminate state explicitly.
- Treat controller ownership as a transport-level concurrency mechanism; defer all behavioural policy to Pi.
