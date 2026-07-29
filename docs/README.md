# Documentation map

Start with the documents in this order.

## Current authority

- [Project status and roadmap](PROJECT_STATUS.md) — canonical production-wiring status, known gaps, non-goals, and ordered work to beta.
- [Architecture](ARCHITECTURE.md) — component ownership, trust boundaries, startup path, and capability-provider model.
- [Protocol](PROTOCOL.md) — durable delivery, streams, leases, raw RPC, capability advertisement, and compatibility rules.

When documentation and code disagree, inspect the production daemon construction and executable protocol schemas. A provider class or mobile widget is not proof that a feature is shipped.

## Installation and operation

- [Host bridge guide](../packages/bridge/README.md) — macOS prerequisites, setup, lifecycle, readiness, pairing, and current limitations.
- [Mobile app guide](../apps/mobile/README.md) — Android preview installation, pairing, available controls, and development.

## Product policy

- [Privacy](PRIVACY.md) — where data lives and what may reach the phone.
- [Security policy](../SECURITY.md) — supported trust model and private vulnerability reporting.
- [Contributing](../CONTRIBUTING.md) — validation, capability discipline, and documentation expectations.
- [Changelog](../CHANGELOG.md) — notable unreleased product changes.

## Package contracts

- [Protocol schema package](../packages/protocol-schema/README.md)
- [Protocol fixture package](../packages/protocol-fixtures/README.md)

## Coding-agent entry point

Coding agents must begin with [`AGENTS.md`](../AGENTS.md). It defines the current objective, product boundaries, capability proof requirements, Git non-goal, and validation expectations.

## Historical evidence

The following dated documents preserve investigation and implementation history. They may mention obsolete branches, blockers, test counts, paths, host observations, or next steps. They are not current project status.

- [Bridge daemon startup busy-loop investigation](BRIDGE_DAEMON_BUSY_LOOP.md)
- [Raw RPC rectification progress snapshot](PROGRESS_SNAPSHOT.md)
- [Raw RPC rectification final report](RECTIFICATION_FINAL_REPORT.md)

Use historical reports for root-cause context only. Use [PROJECT_STATUS.md](PROJECT_STATUS.md) for the current roadmap and production boundary.

## Documentation rules

1. Label features as **production-wired**, **implemented but not production-wired**, **planned**, or **out of scope**.
2. Do not market capabilities that the normal daemon does not advertise.
3. Keep Git integration out of product claims and roadmap work.
4. Keep confirmed measurements separate from hypotheses.
5. Update the status document whenever production construction or accepted scope changes.
6. Run `bun run docs:check` after changing relative links.
