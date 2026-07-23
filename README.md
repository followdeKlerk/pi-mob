# pi-mob

A private mobile control surface for [Pi](https://github.com/earendil-works/pi) coding-agent sessions running on a host you control.

> **Status: pre-release.** pi-mob is under active development and is not yet a supported public release.

## What it does

- Connects a Flutter mobile app to a local Bun bridge over a private Tailscale network.
- Lets you create, observe, steer, queue, and stop Pi sessions without putting repositories or provider credentials on the phone.
- Keeps command delivery durable and reconnect-safe; uncertain work is shown as indeterminate rather than silently repeated.
- Supports trusted workspaces, host-enforced read-only policy, bounded attachments, exports, and privacy-preserving status notifications.

## Architecture

```text
Mobile app → private HTTPS/WebSocket → loopback Bun bridge → Pi RPC → host workspace
```

The host remains authoritative for repositories, Pi processes, credentials, and durable session state. The mobile app is a reconnectable control and presentation client.

## Requirements

- macOS host with Bun and a supported Pi installation
- Flutter toolchain for mobile development
- Tailscale on the host and mobile device

## Development

```sh
bun install
bun run typecheck
bun test
cd apps/mobile && flutter analyze && flutter test
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Protocol](docs/PROTOCOL.md)
- [Privacy](docs/PRIVACY.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Package documentation](apps/mobile/README.md)

## License

[MIT](LICENSE)
