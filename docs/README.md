# Documentation map

## Active work

- [Bridge daemon startup busy loop](BRIDGE_DAEMON_BUSY_LOOP.md) — active blocker, confirmed evidence, working diagnosis, corrective design, acceptance criteria, and agent handoff for `debug/bridge-daemon-busy-loop`.

## Product and system contracts

- [Architecture](ARCHITECTURE.md) — component boundaries, ownership, and host/mobile topology.
- [Protocol](PROTOCOL.md) — durable command, response, event, and stream contracts.
- [Privacy](PRIVACY.md) — data handling and redaction expectations.
- [Security policy](../SECURITY.md) — supported security model and reporting process.

## Installation and operation

- [Host bridge guide](../packages/bridge/README.md) — macOS bridge installation, lifecycle, pairing, and troubleshooting.
- [Mobile app guide](../apps/mobile/README.md) — Android installation, pairing, and mobile development.

## Agent entry point

Coding agents should begin with [`AGENTS.md`](../AGENTS.md). It identifies the active branch intent, required reading order, current blocker, constraints, and verification expectations.

## Documentation authority

When documents disagree during work on `debug/bridge-daemon-busy-loop`, use this precedence:

1. Measured runtime evidence recorded in `BRIDGE_DAEMON_BUSY_LOOP.md`.
2. Protocol and architecture contracts.
3. Package-specific operational guides.
4. General root README statements.

Do not silently convert a hypothesis into a confirmed fact. Update the incident document when new instrumentation changes the diagnosis.
