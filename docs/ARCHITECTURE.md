# Architecture

pi-mob is a private, host-authoritative mobile control system for Pi coding-agent sessions.

## Components

1. **Android application** — Flutter client for pairing, chat selection, transcript presentation, local drafts, and mobile controls.
2. **Bridge daemon** — Bun/TypeScript service that validates the protocol, persists commands and events, manages controller leases, supervises Pi processes, and serves the loopback HTTP/WebSocket endpoint.
3. **Pi runtime** — one or more Pi RPC processes launched with the owner's captured login environment and explicit per-session working directories.
4. **Tailscale** — private network transport between the phone and the host. The bridge itself remains loopback-only.

```text
Android app
    ⇅ private Tailscale HTTPS / WebSocket
loopback bridge
    ⇅ Pi RPC
Pi processes
    ⇅
host repositories, tools, credentials, and session files
```

## Ownership

### Host owns

- repositories and working directories;
- provider credentials and usable login environment;
- Pi processes and Pi-owned session files;
- durable bridge commands, events, cursors, queues, leases, exports, and attachment bytes;
- process-capacity and lifecycle decisions.

### Mobile owns

- paired-host connection metadata;
- local prompt drafts and mobile presentation state;
- cached projections needed to render reconnectable views;
- user intent sent through the bridge protocol.

The phone is never authoritative for whether a command executed.

## Durable control path

State-changing requests use a client-generated command ID.

1. The server validates the envelope and payload.
2. The durable command record commits before dispatch.
3. A controller lease is checked when the command requires exclusive mutation rights.
4. The adapter dispatches the operation to Pi or a bridge-owned service.
5. Command and session events are appended to replayable streams.
6. The mobile app acknowledges cursors after applying durable events.

Reusing a command ID with the same semantic payload returns the existing command state. Reusing it with different semantics is rejected. If execution cannot be proven after a crash or disconnect, the command becomes `indeterminate` and is not automatically repeated.

## Raw and curated Pi surfaces

The production bridge exposes two complementary paths:

- **Raw RPC** passes a bounded Pi command through without a method allowlist and journals its correlated response and events.
- **Curated controls** provide mobile-native flows for common operations such as prompt, steer, follow-up, abort, model selection, compaction, clone, export, and session lifecycle.

Raw RPC preserves forward access to Pi. Curated controls provide safer, clearer mobile UX. Curated support must not silently discard unknown Pi events.

## Multi-session host model

The production adapter supports multiple durable sessions. Each session can resolve to its own Pi RPC client and working directory. A host process supervisor applies a bounded concurrency limit and lifecycle policy.

The class name `OneSessionPiAdapter` is retained for compatibility, but its current role is multi-session.

## Capability-provider model

The handshake advertises the durable core and `raw_rpc.v1` directly. Other capabilities are advertised only when `DurableBridgeRuntime` receives the corresponding provider.

### Production-wired core

- streams;
- commands;
- controller leases;
- raw RPC;
- session and workspace controls supplied by the Pi adapter.

### Implemented but not wired by the normal daemon

- attention projection;
- first-class agent supervision;
- command and skill catalogue management;
- structured plans;
- context inspection and mutation;
- workspace file browsing;
- process snapshots and paged output.

A service implementation, schema, test fixture, or Flutter widget is not sufficient to call a capability shipped. The normal daemon must construct the provider, the handshake must advertise it, the app must exercise it, and a production-wiring integration test must prove the path.

## Git boundary

Git integration is intentionally outside the architecture. pi-mob will not production-wire Git summaries, commit, push, CI status, or repository actions. Experimental Git-related modules are not product capabilities and should not shape the roadmap.

## Startup path

Current startup performs:

1. state-directory creation and SQLite open/migrations;
2. uncertain-command recovery and session-state recovery;
3. Pi login-environment resolution;
4. external Pi-session discovery;
5. changed-history import and projection;
6. primary Pi RPC startup;
7. durable runtime recovery;
8. loopback server binding.

The former full SQLite integrity scan was removed from ordinary startup and the historical recipe projection was changed from repeated full scans to dirty-identity updates. The remaining architectural weakness is that history work and Pi startup still occur before listener binding.

The beta design should bind after lightweight durable recovery, expose an explicit initialization phase, and perform history synchronization in bounded checkpointed batches while the service remains reachable.

## Trust and security boundaries

- The production server rejects non-loopback bind addresses.
- Remote access is intended only through a private Tailscale Serve route.
- Public listeners and Tailscale Funnel are unsupported.
- The bridge verifies protocol shape, host identity expectations, installation identity, command semantics, lease ownership, and bounded payloads.
- Pi runs with the owner's normal execution model. The bridge does not inject a default policy or read-only extension.
- pi-mob is designed for one owner, not multi-user tenancy.

## Failure model

- Transport loss triggers reconnect and replay rather than blind re-execution.
- Slow consumers are disconnected once bounded outbound buffering is exceeded.
- Store failures block new durable commands.
- Unknown forward-compatible durable events should not poison a healthy connection.
- Malformed known-event projections should be isolated but also recorded as bounded, redacted degradation; this observability work remains planned.

## Source of truth

- Current product boundary: [`PROJECT_STATUS.md`](PROJECT_STATUS.md)
- Executable wire contract: `packages/protocol-schema`
- Production construction: `packages/bridge/src/daemon.ts`
- Bridge runtime capability advertisement: `packages/bridge/src/core/runtime.ts`
- HTTP/WebSocket behaviour: `packages/bridge/src/core/server.ts`
