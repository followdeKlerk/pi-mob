# Architecture

Pi Mob has three components: a host, a bridge, and a mobile client. Each one has a single, well-defined responsibility.

```text
Android mobile app
        │
        │ Tailscale Serve (private tailnet)
        ▼
Bridge daemon (loopback listener)
        │
        │ supervised local Pi RPC/session processes
        ▼
Pi processes
```

The bridge is the only authority for durable session state outside Pi itself. The mobile app also persists disposable cache copies of streams, drafts, and its installation credential.

## Bridge

The bridge is a long-running TypeScript daemon. The released build target is macOS x64 only; it is launched under `launchd` on the host and exposes a single HTTPS endpoint on a private Tailscale address. Public exposure is not supported. Non-macOS install paths are not produced by the release pipeline in this preview.

Responsibilities:

- serve the mobile protocol over a single WebSocket;
- own durable streams, command journal, and controller-lease book;
- supervise one Pi process per mobile session and persist that session path so reconnects resume immediately;
- persist tokenized cursors per stream so the mobile app can replay missed events after a network blip;
- deliver notifications by sending bounded status-only FCM messages containing notification copy and a restricted data payload to the registered device for the targeted session, using a host-supplied service account;
- expose a companion binary HTTP API at `POST /v1/attachments` (image uploads, 10 MiB cap, JPEG/PNG decode, bounded retention) and `GET /v1/exports/<id>` (generated HTML sessions). Both endpoints require the per-installation `X-Installation-Id` and `X-Installation-Credential` headers; the multipart `installationId` field is downgraded to a hint. Per-installation rate / quota and aggregate byte ceiling are checked before allocation;
- call Pi `get_commands` for the selected session and expose a bounded, sanitized command catalogue;
- surface explicit unavailable states when host capabilities are not advertised rather than fabricating entries.

The bridge runs on the loopback interface. `runDaemon` binds the loopback listener before it runs bulk external-history reconciliation. The readiness state remains false until command recovery and reconciliation finish. The mobile client only reaches the bridge through Tailscale.

## Canonical session events

The bridge has a dedicated `CanonicalSessionStore` for user-visible session events. It allocates a sequence per session and stores events before live delivery.

The bridge sends replay and live events through the `session_events.v2` capability. Both paths use the same event envelope. The mobile coordinator decodes both paths through one synchronizer and one canonical projection.

The chat panel uses the canonical projection as its released transcript view. The normal daemon writes transcript events only to `CanonicalSessionStore`. History reconciliation also uses this store. These paths do not write normalized transcript rows or the legacy recipe projection. Legacy state remains for bounded synchronization and older operational clients. Isolated legacy adapters can still use the recipe projection until the compatibility cutoff.

## Host

The host is the computer running the bridge. It owns the Pi processes, the workspaces, the credentials, and the notification service account.

- Workspaces are discovered under explicit `--search-root` paths, or the normal shallow defaults (`~/GitHub`/`~/github`, the home directory, and the configured workspace). The bridge exposes bounded workspace search.
- Pi processes are spawned, supervised, and recycled by the bridge. Each mobile session has a stable `--session-id` so reconnect can resume the same process.
- The notification service account is read once at startup; the bridge never logs the credential contents.

## Mobile

The mobile app is a Flutter Android client. It is a single-screen chat shell with a drawer for saved chats and a search affordance, plus a settings surface for the bridge address, notification setup, and forget-host.

Responsibilities:

- paint an immediate splash card on cold launch so the user is never staring at a blank surface while the database is read and the bridge is contacted;
- validate the bridge handshake and subscribe to the durable streams the user has access to;
- gate sensitive actions (such as starting a chat) on bridge readiness and the durable history gate;
- surface the per-chat progress while history sync is in flight, including current chat, remaining chats, elapsed time, ETA, and throughput;
- keep controller leases session-scoped so navigating between chats does not destroy valid leases;
- request notification permission once per process, register the FCM token automatically, and fire a real notification when a reply arrives while the app is backgrounded; foreground FCM alerts are suppressed while the main activity is visible;
- reconcile notifications back to the correct chat via the existing deep-link path.

The mobile app does not run a web server. It stores no host or provider credentials. It stores only its per-installation bearer credential in Android Keystore-backed secure storage. It does not advertise services to other apps. The `/commands` action requests the selected session's authoritative catalogue and opens a searchable local palette; it does not submit a chat prompt.

## Trust boundary

Pairing is deliberately manual: the operator enters the HTTPS endpoint and one-time passcode in the Android app. QR generation, QR scanning, and JSON pairing-payload entry are removed and unsupported. The passcode mints the per-installation bearer credential during enrollment:

- `hello` MUST carry the credential or the handshake is closed with `invalid_auth` / `re_pair_required`.
- `POST /v1/attachments` and `GET /v1/exports/<id>` MUST carry `X-Installation-Id` and `X-Installation-Credential`; the multipart `installationId` is a hint only.
- The credential never lives in SQLite, logs, crash dumps, fixtures, or generated reports. It lives only as a SHA-256 hash on the bridge and in Android Keystore-backed secure storage on the phone.

Tailscale remains the supported network boundary; do not expose the bridge to a wider network than your tailnet's ACLs already protect.

## Why this shape

- **Local-first**: no cloud side, no analytics, no background upload.
- **Tailnet-only**: the bridge is reachable only through Tailscale, never from the public internet.
- **Process-stable**: each mobile session maps to a long-lived Pi process with a stable `--session-id`, so reconnects and app restarts resume instantly.
- **Durable**: streams, commands, and leases are journaled on the host; the phone is a thin cache.
- **Just enough notifications**: the only host-to-phone push path is a per-session FCM delivery tied to a real reply, not a chat-noise ping.
