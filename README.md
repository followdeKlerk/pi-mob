# Pi Mob

> **Alpha software:** Pi Mob is an unsupported preview. Compatibility and distribution can change.

Pi Mob lets you control local OMP sessions from an Android phone. A bridge runs on your Mac and exposes them through private Tailscale Serve.

The host keeps repositories, credentials, OMP processes, and session state. Pi Mob has no cloud backend.

## Start

Read the [quick start](docs/QUICKSTART.md). The current preview includes a macOS x64 bridge and an Android APK. Optional notifications use Firebase Cloud Messaging.

## Docs

- [Project status](docs/PROJECT_STATUS.md)
- [Quick start](docs/QUICKSTART.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Protocol](docs/PROTOCOL.md)
- [Privacy](docs/PRIVACY.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

Package guides: [Android](apps/mobile/README.md), [bridge](packages/bridge/README.md), and [protocol schema](packages/protocol-schema/README.md).

## Boundary

The supported path is a loopback bridge exposed through private Tailscale Serve. Public listeners, Tailscale Funnel, multi-user tenancy, and Git product actions are out of scope.
