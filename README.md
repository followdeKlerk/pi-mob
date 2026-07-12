# pi-mob

A private Flutter mobile client for driving Pi coding-agent sessions running on a user-controlled host over Tailscale.

## Status

Planning is now sufficiently defined to begin the first implementation slice. The repository is still docs-first; no Flutter or bridge scaffold exists yet.

## Read this first

1. [`docs/IMPLEMENTATION_DEFAULTS.md`](docs/IMPLEMENTATION_DEFAULTS.md) — normative product and architecture defaults.
2. [`docs/PROTOCOL.md`](docs/PROTOCOL.md) — bridge-to-mobile transport contract.
3. [`docs/RUNTIME.md`](docs/RUNTIME.md) — host daemon, process, storage, workspace, and notification behaviour.
4. [`docs/TESTING.md`](docs/TESTING.md) — required test layers and release gates.
5. [`WORKING.md`](WORKING.md) — current implementation objective and ordered next work.
6. [`PLANNING.md`](PLANNING.md) — research history, source map, and earlier exploration.

Where an older statement in `PLANNING.md` conflicts with a normative document under `docs/`, the normative document wins.

## Core architecture

```text
Flutter app
    |
    | HTTPS / WebSocket over Tailscale Serve
    v
Bun/TypeScript bridge on the private host
    |
    | stdin/stdout JSONL
    v
one pi --mode rpc process per active session
```

The bridge binds to loopback only. Tailscale Serve supplies the tailnet-only HTTPS endpoint. Provider credentials stay on the host.

## MVP delivery slices

All slices belong to the MVP, but they are implemented and proven independently.

### Slice A — reliable core loop

- One paired host.
- Recent-workspace selection.
- Create or resume one visible session.
- Text prompting and streaming output.
- Generic tool cards.
- Abort.
- Duplicate-safe command submission.
- Disconnect, replay, bridge restart, and Pi restart recovery.

### Slice B — full session and tool UX

- Concurrent host sessions and mobile session switcher.
- Session history, naming, deletion, fork, clone, and tree navigation.
- Model and thinking controls.
- Extension dialogs.
- Workspace search.
- Read-only toggle and trusted-workspace flow.
- Image attachments.
- Export and sharing.

### Slice C — background experience

- Host continuation while the phone is backgrounded.
- APNs and FCM status notifications.
- iOS Live Activity.
- Android foreground-service mode when explicitly enabled.
- Reconnect and replay on foreground.

## Deliberate constraints

- Single-user personal application for the initial releases.
- Tailscale is the sole connection-authentication boundary.
- No public Funnel endpoint.
- No provider keys or OAuth tokens on the phone.
- No filesystem sandbox is claimed; trusted workspaces execute with the host user's permissions.
- No automatic bridge updater in v1.
- Obsidian and stored notes remain post-MVP.
