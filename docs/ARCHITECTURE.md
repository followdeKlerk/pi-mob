# Architecture

Pi Mob has three components:

```text
Android app
    │ private Tailscale Serve
    ▼
Bridge daemon on loopback
    │ local Pi RPC
    ▼
Pi processes
```

## Responsibilities

The host owns repositories, provider credentials, Pi processes, and durable session state.

The bridge supervises Pi processes. It also owns durable streams, commands, controller leases, authentication, attachments, exports, and notification delivery. A stable `--session-id` lets a reconnect target the same supervised Pi session.

The Android app presents chats and controls. It keeps a local cache, drafts, attachments in flight, and its installation credential. Android Keystore-backed storage protects the credential on the phone.

`CanonicalSessionStore` is the released transcript store. The bridge stores each canonical event before live delivery. Replay and live messages use the same mobile reduction path.

## Trust boundary

The supported setup binds the bridge to loopback and exposes it through private Tailscale Serve. Public listeners and Tailscale Funnel are unsupported.

Manual pairing uses an HTTPS endpoint and one-time passcode. Enrollment creates a per-installation credential. The bridge stores its SHA-256 hash. Application logging and reporting paths are designed to exclude the plaintext credential.

Authenticated companion endpoints accept bounded image attachments and generated HTML exports. FCM notification requests contain bounded status copy and routing fields. They do not contain user-authored chat content.

The host remains responsible for its operating system, Tailscale ACLs, Pi extensions, and provider credentials.
