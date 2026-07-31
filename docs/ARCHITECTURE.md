# Architecture

Pi Mob has three components: a host, a bridge, and a mobile client. Each one has a single, well-defined responsibility.

```
┌──────────────────────────────┐    ┌──────────────────────────────┐
│ Host (your computer)         │    │ Mobile (Android phone)       │
│  ┌───────────────┐           │    │  ┌────────────────────────┐  │
│  │ Pi processes  │◄──────────┼────┼──┤ Flutter app            │  │
│  │  (one per     │  durable  │    │  │  (Pi Mob)              │  │
│  │   mobile      │  control  │    │  └────────────────────────┘  │
│  │   session)    │  plane    │    │                              │
│  └───────────────┘           │    │                              │
│         ▲                    │    │                              │
│         │  supervises         │    │                              │
│  ┌──────┴────────────────┐   │    │                              │
│  │ Bridge daemon          │◄──┼────┤ private tailnet (Tailscale) │
│  │  (Bun distributable)   │   │    │                              │
│  └────────────────────────┘   │    │                              │
└──────────────────────────────┘    └──────────────────────────────┘
```

The bridge is the only component that holds durable state outside Pi itself. The mobile app holds no business state other than local cache copies of streams and the user’s drafts.

## Bridge

The bridge is a long-running TypeScript daemon. It is launched under `launchd` (macOS) or `systemd` (Linux) and exposes a single HTTPS endpoint on a private Tailscale address. Public exposure is not supported.

Responsibilities:

- serve the mobile protocol over a single WebSocket;
- own durable streams, command journal, and controller-lease book;
- supervise one Pi process per mobile session and persist that session path so reconnects resume immediately;
- persist tokenized cursors per stream so the mobile app can replay missed events after a network blip;
- deliver notifications by sending data-only FCM messages to the registered device for the targeted session;
- surface explicit unavailable states when host capabilities are not advertised rather than fabricating entries.

The bridge runs on the loopback interface. It is bound to the loopback listener before any bulk external history synchronization. The mobile client only ever reaches the bridge through Tailscale.

## Host

The host is the computer running the bridge. It owns the Pi processes, the workspaces, the credentials, and the notification service account.

- Workspaces are discovered under a configured search root. The bridge exposes a bounded workspace search capability.
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
- request notification permission once per process, register the FCM token automatically, and fire a real notification when a reply arrives while the app is backgrounded;
- reconcile notifications back to the correct chat via the existing deep-link path.

The mobile app does not run a web server. It does not cache credentials. It does not advertise services to other apps.

## Why this shape

- **Local-first**: no cloud side, no analytics, no background upload.
- **Tailnet-only**: the bridge is reachable only through Tailscale, never from the public internet.
- **Process-stable**: each mobile session maps to a long-lived Pi process with a stable `--session-id`, so reconnects and app restarts resume instantly.
- **Durable**: streams, commands, and leases are journaled on the host; the phone is a thin cache.
- **Just enough notifications**: the only host-to-phone push path is a per-session FCM delivery tied to a real reply, not a chat-noise ping.
