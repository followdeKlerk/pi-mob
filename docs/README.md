# Pi Mob documentation

| Document | Purpose |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the bridge, the host, and the mobile client fit together. |
| [PROTOCOL.md](PROTOCOL.md) | The wire protocol between the bridge and the mobile client. |
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | What is production-wired, what is planned, and what is out of scope. |
| [PRIVACY.md](PRIVACY.md) | What data Pi Mob handles, where it lives, and how it is exposed. |
| [QUICKSTART.md](QUICKSTART.md) | End-to-end setup for the bridge and the Android app. |
| [RELEASE.md](RELEASE.md) | How releases are cut, signed, and published. |
| [CHANGELOG.md](../CHANGELOG.md) | User-visible release history. |
| [RUNBOOK.md](RUNBOOK.md) | Operational recovery procedures. |

Capability discipline:

- **Production-wired** — the normal daemon constructs it, the bridge handshake advertises it, the mobile app exercises it, and a focused integration test covers the actual construction path.
- **Planned** — accepted as future work.
- **Out of scope** — intentionally not planned for Pi Mob.

See `PROJECT_STATUS.md` for the canonical table.
