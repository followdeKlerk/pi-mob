# Architecture

Pi Mob has three parts:

```text
Android app → private Tailscale Serve → bridge on the host → local Pi
```

## Ownership

- **Host:** repositories, provider credentials, Pi processes, and durable session state.
- **Bridge:** Pi supervision, authentication, commands, streams, leases, attachments, exports, and notifications.
- **Android app:** chat display, controls, drafts, local cache, and pairing credentials.

The bridge maps each stable mobile session ID to a host-private Pi session. It stores canonical session events before delivery, so replay and live updates use the same data path.

## Pi boundary

The normal daemon starts Pi in local RPC mode. Pi IDs, JSONL paths, raw RPC payloads, and provider credentials stay on the host. The mobile protocol uses bridge IDs and canonical events.

## Network boundary

The bridge binds to loopback. Private Tailscale Serve is the supported remote path. Public listeners and Tailscale Funnel are unsupported.

Pairing uses an HTTPS endpoint and a one-time passcode. Enrollment creates a credential for each installation. The bridge stores its hash.
