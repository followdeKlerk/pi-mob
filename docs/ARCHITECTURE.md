# Architecture

Pi Mob has three parts:

```text
Android app → private Tailscale Serve → bridge on the host → local OMP
```

## Ownership

- **Host:** repositories, provider credentials, OMP processes, and durable session state.
- **Bridge:** OMP supervision, authentication, commands, streams, leases, attachments, exports, and notifications.
- **Android app:** chat display, controls, drafts, local cache, and pairing credentials.

The bridge maps each stable mobile session ID to a host-private OMP session. It stores canonical session events before delivery, so replay and live updates use the same data path.

## OMP boundary

The normal daemon starts OMP in local RPC mode. OMP IDs, JSONL paths, raw RPC payloads, and provider credentials stay on the host. The mobile protocol uses bridge IDs and canonical events.

## Network boundary

The bridge binds to loopback. Private Tailscale Serve is the supported remote path. Public listeners and Tailscale Funnel are unsupported.

Pairing uses an HTTPS endpoint and a one-time passcode. Enrollment creates a credential for each installation. The bridge stores its hash.
