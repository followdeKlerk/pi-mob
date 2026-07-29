# pi-mob Android app

Flutter mobile client for pi-mob. It pairs with a private host, renders durable Pi session state, and provides focused mobile controls while repositories, provider credentials, Pi processes, and authoritative history remain on the Mac.

> **Status:** working private alpha. The current Android artifact uses preview application identity and development signing. See [Project status and roadmap](../../docs/PROJECT_STATUS.md).

## Requirements

- Android 10 or newer (**API 29+**).
- Tailscale installed and signed into the same tailnet as the host.
- A running [pi-mob bridge](../../packages/bridge/README.md).
- A private `.ts.net` HTTPS endpoint produced by bridge setup.

## Install the preview

Download the APK and adjacent checksum from GitHub Releases.

```sh
sha256sum -c pi-mob-android-preview-<version>.apk.sha256
```

On macOS:

```sh
shasum -a 256 -c pi-mob-android-preview-<version>.apk.sha256
```

Open the APK on the Android device. Android may ask you to allow **Install unknown apps** for the browser or file manager used for this installation. Grant that permission only as needed and disable it afterwards if appropriate.

The current artifact is not production-signed. Android may display an unknown-developer warning. Verify the checksum and release source. A build signed with a different development key may require uninstalling the existing app, which can remove local app data.

## Pair with the host

Keep Tailscale connected on both devices.

The app accepts a private HTTPS Tailscale MagicDNS endpoint ending in `.ts.net`. Plain HTTP, loopback addresses, ordinary LAN addresses, and public Funnel-style endpoints are rejected.

Pair by either:

- scanning the QR displayed by bridge setup and verifying the host name, endpoint, protocol version, and host-ID suffix; or
- entering the displayed host name or full private HTTPS endpoint manually.

After a successful handshake, the app stores the endpoint and durable host identity for reconnects. Pair again after forgetting the host, changing installation identity, or deliberately moving to a different host.

## Available mobile workflow

The production-wired app can:

- create, open, rename, clone, stop, delete, restore, and export sessions where the corresponding host control is available;
- view live and replayed transcript activity;
- submit prompts, steer active work, queue follow-ups, and abort;
- change model and thinking/session controls exposed by Pi;
- compact a session;
- search within a chat or across saved chats;
- attach bounded images and share generated exports;
- handle Pi extension select, confirm, input, and editor requests;
- recover controller ownership;
- present uncertain command execution as `indeterminate` without automatic resubmission;
- display inline tool and subagent activity.

## Capability-aware UI

The app contains screens and models for some advanced providers. Those screens must remain gated by the host capability handshake.

The default daemon does not currently advertise the providers for:

- first-class agent supervision;
- durable attention resolution;
- host catalogue management;
- structured plans;
- context inspection;
- workspace file browsing;
- process snapshots and paged output.

Inline subagent activity is available in the transcript; that does not imply the full agent-supervision provider is wired.

Git integration is out of scope. Do not add or advertise Git status, commit, push, CI, or repository-action controls.

## Connection and recovery behaviour

- The app synchronizes durable host and session streams before sending state-changing commands.
- Applied stream cursors are acknowledged for reconnect replay.
- A lease prevents two mobile connections from mutating one session concurrently.
- Reconnect does not imply that an uncertain command is safe to run again.
- Unknown forward-compatible durable events should not destroy a healthy connection.
- Known-event projection failures should eventually surface a bounded degraded state; this observability improvement remains planned.

## Notifications

The app works without Firebase configuration. Pairing, chat, and bridge control do not require push notifications.

FCM notifications require both:

1. Android Firebase configuration supplied at build time; and
2. a host bridge configured with a valid FCM service account.

Do not commit service-account credentials. Notification content is intended to be status-only.

## Local data

The app stores paired-host metadata, installation identity, local drafts, preferences, and bounded reconnectable projections. It does not store provider credentials or a repository copy.

Uninstalling the preview or clearing app storage may remove pairing information, drafts, and local presentation state. Host-side durable Pi and bridge state remains on the Mac.

## iOS

The iOS source project is not a distributed product. There is no supported App Store, TestFlight, IPA, or sideload release.

## Development

```sh
cd apps/mobile
flutter pub get
flutter analyze --no-fatal-infos
flutter test
flutter build apk --release
```

The repository pins the Flutter version used by CI. A successful local release build is still a preview artifact until production identity and signing are configured.

## Before calling a feature shipped

A Flutter widget or protocol model is not enough. Verify that:

1. the normal daemon constructs the provider;
2. `hello.accepted` advertises its capability;
3. the coordinator handles the real responses and durable events;
4. a widget or integration test exercises the user path;
5. public documentation lists the capability as production-wired.

## Related documentation

- [Project status and roadmap](../../docs/PROJECT_STATUS.md)
- [Host bridge guide](../../packages/bridge/README.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Protocol](../../docs/PROTOCOL.md)
- [Privacy](../../docs/PRIVACY.md)
