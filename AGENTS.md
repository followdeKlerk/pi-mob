# Agent instructions

## Read this first

The canonical project status is [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md). Read it before proposing features, changing capability claims, or treating an isolated provider implementation as shipped behaviour.

Recommended order:

1. `docs/PROJECT_STATUS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/PROTOCOL.md`
4. `packages/bridge/README.md`
5. `apps/mobile/README.md`
6. the implementation and tests for the path being changed

The dated rectification and daemon-incident reports under `docs/` are historical evidence snapshots. They are not current branch instructions.

## Product status

Pi Mob is a public repository with unsupported alpha preview binaries. Treat `docs/PROJECT_STATUS.md` as the authority for capabilities, planned work, and release scope. Do not add mutable roadmap priorities to this file.

## Product boundaries

- The host owns repositories, provider credentials, Pi processes, and durable session state.
- The Android app is a reconnectable mobile control and presentation surface.
- The bridge owns durable delivery, controller leases, bounded host operations, and process supervision.
- Pi retains its normal execution model; the bridge does not impose a default host policy extension.
- Private Tailscale Serve exposure is supported. Public listeners and Funnel are not.
- Multi-user tenancy is not part of the product.

### Git is out of scope

Do not implement, wire, advertise, or add roadmap work for Git status, commit, push, CI summaries, or repository actions.

Experimental Git-related modules may be removed in a focused cleanup after confirming that shared protocol and test dependencies are unaffected. Do not expand them.

## Capability discipline

Use these terms precisely:

- **Production-wired:** constructed by the normal daemon and reachable from the released mobile path.
- **Implemented, not production-wired:** code or UI exists, but the default daemon does not supply the provider required to advertise it.
- **Planned:** accepted remaining work.
- **Out of scope:** intentionally not planned.

A schema, service class, widget, or isolated test does not prove a production feature. For a capability to be called shipped, verify all of the following:

1. the normal daemon constructs its provider;
2. `hello.accepted` advertises it;
3. the mobile app exercises it;
4. an integration test covers the actual construction path;
5. documentation and release metadata claim no more than that test proves.

## Working method

1. Inspect the current implementation before editing.
2. Separate confirmed behaviour, inference, and proposed design.
3. Prefer small, reviewable changes with focused tests.
4. Preserve durable command, replay, lease, and indeterminate-state guarantees.
5. Keep private paths, environment values, credentials, transcripts, and tool output out of logs and fixtures.
6. Do not solve listener-readiness problems by merely increasing a timeout.
7. Do not silently swallow a newly introduced degraded state; make it bounded and observable.
8. Update `docs/PROJECT_STATUS.md` whenever production wiring or accepted roadmap scope changes.

## Validation

Run the pinned toolchain from repository configuration (`package.json`, `VERSION`, and Flutter project files). At minimum for bridge or protocol work:
```sh
bun install --frozen-lockfile
bun run typecheck
bun run schema:check
bun run fixtures:check
bun test
bun run build
```

For mobile-facing changes:

```sh
cd apps/mobile
flutter analyze --no-fatal-infos
flutter test
```

For documentation-only changes:

```sh
bun run docs:check
```

Record any unavailable toolchain or host-only validation explicitly. Never invent successful output.
