# Architecture

Pi Mob has three components:

```text
Android app
    │ private Tailscale Serve
    ▼
Bridge daemon on loopback
    │ local OMP RPC
    ▼
OMP processes
```

## Responsibilities

The host owns repositories, provider credentials, OMP processes, and durable session state.

The bridge supervises OMP processes. It also owns durable streams, commands, controller leases, authentication, attachments, exports, and notification delivery. A stable bridge session ID maps to a host-private OMP session ID and JSONL path; reconnect and daemon restart resume that OMP session with `--resume`.

The Android app presents chats and controls. It keeps a local cache, drafts, attachments in flight, and its installation credential. Android Keystore-backed storage protects the credential on the phone.

`CanonicalSessionStore` is the released transcript store. The bridge stores each canonical event before live delivery. Replay and live messages use the same mobile reduction path.

## OMP execution boundary

The normal daemon requires an absolute OMP executable path and constructs `OmpSession` providers; it has no production Pi fallback or runtime backend selector. Each provider launches OMP in local RPC mode with an isolated session directory. OMP request, response, lifecycle, message, and tool records are normalized before they enter bridge-owned durable state.

OMP session IDs, JSONL paths, raw RPC payloads, and provider credentials stay on the host. The mobile protocol uses stable bridge IDs and canonical events, so the app neither parses OMP records nor depends on OMP's internal identifiers.

## Trust boundary

The supported setup binds the bridge to loopback and exposes it through private Tailscale Serve. Public listeners and Tailscale Funnel are unsupported.

Manual pairing uses an HTTPS endpoint and one-time passcode. Enrollment creates a per-installation credential. The bridge stores its SHA-256 hash. Application logging and reporting paths are designed to exclude the plaintext credential.

Authenticated companion endpoints accept bounded image attachments and generated HTML exports. FCM notification requests contain bounded status copy and routing fields. They do not contain user-authored chat content.

The host remains responsible for its operating system, Tailscale ACLs, OMP extensions, and provider credentials.
