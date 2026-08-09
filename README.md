# Pi Mob

> [!WARNING]
> **Alpha software:** Pi Mob is an unsupported preview. Compatibility and distribution can change.

Pi Mob connects an Android phone to OMP on your Mac. A local bridge supervises OMP sessions and exposes them through private Tailscale Serve.

The host keeps repositories, provider credentials, OMP processes, and durable session state. Pi Mob has no application cloud backend.

## Start

Use the [quick start](docs/QUICKSTART.md) to install and pair the preview. The released bridge target is macOS x64. The mobile release is an Android APK.

## Documentation

- [Project status](docs/PROJECT_STATUS.md) is the canonical capability and scope map.
- [Quick start](docs/QUICKSTART.md) covers installation and pairing.
- [Architecture](docs/ARCHITECTURE.md) describes the components and trust boundary.
- [Protocol](docs/PROTOCOL.md) describes compatibility and message flow.
- [Privacy](docs/PRIVACY.md) describes data handling.
- [Security](SECURITY.md) gives the threat model and private reporting path.
- [Contributing](CONTRIBUTING.md) gives development and release checks.
- [Changelog](CHANGELOG.md) records preview releases.

Package guides:

- [Android app](apps/mobile/README.md)
- [Bridge](packages/bridge/README.md)
- [Protocol schema and fixtures](packages/protocol-schema/README.md)

## Supported boundary

The supported setup uses a loopback bridge listener and private Tailscale Serve. Public listeners, Tailscale Funnel, multi-user tenancy, and Git product actions are out of scope.

When notifications are enabled, bounded status metadata is sent through Firebase Cloud Messaging. FCM payloads do not include user-authored chat content. See [Privacy](docs/PRIVACY.md).

Current release details and capability evidence are in [Project status](docs/PROJECT_STATUS.md).
