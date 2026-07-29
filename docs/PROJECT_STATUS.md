# Project status and roadmap

_Last verified against `main`: 29 July 2026._

pi-mob is a **working private alpha** for operating Pi coding-agent sessions from an Android phone through a Mac that you control. The durable transport, raw Pi RPC path, multi-session host adapter, pairing flow, and mobile chat surface are implemented. The project is not yet a production-ready or generally supported release.

This document is the canonical description of what is wired into the normal daemon, what exists only as implementation scaffolding, and what remains before beta.

## Status labels

- **Production-wired** — constructed by the normal daemon and reachable from the shipped mobile flow.
- **Implemented, not production-wired** — code, schemas, or UI exist, but the default daemon does not supply the provider required to advertise or operate the feature.
- **Planned** — accepted remaining work.
- **Out of scope** — intentionally not planned.

## Production-wired today

### Host and transport

- Loopback-only Bun bridge intended to be exposed privately through Tailscale Serve.
- Versioned JSON protocol over one WebSocket per host.
- Host identity verification during pairing and reconnect.
- Durable host and session streams with canonical cursors.
- Durable state-changing commands with semantic idempotency.
- Controller leases that prevent conflicting mobile mutations.
- Explicit `indeterminate` outcomes when execution cannot be proven after interruption.
- Backpressure, rate limiting, bounded payloads, and schema validation.
- Owner login-environment capture so Pi sees the user's normal PATH and provider configuration.

### Pi execution

- Generic `raw_rpc.v1` transport with no Pi method allowlist.
- Curated mobile controls for common Pi session operations.
- Multiple durable sessions with independent Pi RPC clients.
- Bounded host process capacity and session lifecycle supervision.
- Import and projection of existing Pi session history.
- Persistent follow-up queues, local drafts, attachments, exports, and extension interaction requests.

### Android application

- QR and manual pairing to a private `.ts.net` HTTPS endpoint.
- Saved chats and new-session creation.
- Live and replayed transcripts.
- Prompt, steer, follow-up, abort, model, compact, clone, export, and controller-recovery flows.
- Transcript search and cross-chat search.
- Explicit recovery UI for uncertain command completion.
- Inline tool and subagent activity presentation.

### Optional configuration that is wired

- FCM status notifications when the host is supplied a valid service-account configuration and the Android build contains Firebase configuration.
- Explicit custom Pi extension loading when the operator supplies an extension path.
- Shallow workspace discovery when explicit search roots are supplied to the daemon.

## Implemented but not production-wired

The repository contains protocol, bridge-service, tests, and mobile UI work for the capabilities below. The default `runDaemon()` construction does not currently inject their provider implementations into `DurableBridgeRuntime`, so they are not advertised by a normal host launch and must not be presented as shipped features.

- Authoritative agent supervision snapshots and actions.
- Durable attention projection and resolution.
- Host command and skill catalogue management.
- Structured plan summaries.
- Context inspection and context mutations.
- Workspace file browsing and file-content search.
- Authoritative process snapshots and paged process output.

Inline subagent activity in the transcript is production-wired. It is not equivalent to the unwired first-class agent-supervision provider.

## Out of scope

### Git integration

pi-mob will **not implement Git features**. Git status, commit, push, CI-provider summaries, repository actions, and related mobile controls are outside the product roadmap.

Existing experimental Git-related modules, schemas, tests, or UI remnants should not be production-wired or marketed. They may be removed in a focused cleanup after confirming that no shared protocol or test dependency relies on them.

### Other non-goals

- Public Internet exposure or Tailscale Funnel.
- Multi-user authorization or team tenancy.
- Hosting provider credentials on the phone.
- Replacing a full terminal, editor, or desktop IDE.
- Cloud synchronization of repositories or durable Pi state.

## Known gaps and risks

### 1. Listener readiness still depends on startup work

The original quadratic historical-projection bug was fixed, and full SQLite integrity checking was removed from ordinary startup. However, the daemon still discovers and imports external session history and starts Pi RPC before it binds the loopback server.

Large or malformed histories can therefore delay host reachability. History import still reads complete JSONL files synchronously and commits each pending tail as one transaction.

### 2. Advanced providers are not integrated

The mobile and protocol surfaces are ahead of production daemon wiring. Tests of isolated providers do not prove that a released daemon advertises and operates them.

### 3. Projection failures can be silent

The mobile connection layer now protects a healthy connection from individual durable-event projection failures. That improves compatibility, but known-event parsing failures are currently swallowed without a bounded diagnostic or visible degraded-state signal.

### 4. Release hardening is incomplete

- Android uses preview identity/signing.
- macOS artifacts are unsigned and not notarized.
- Apple Silicon has not been validated for release.
- iOS is not distributed.
- Version metadata still contains internal milestone values in several places.
- End-to-end validation currently depends heavily on the development host and synthetic integration tests.

## Roadmap to beta

Work is ordered by reliability impact rather than feature count.

### P0 — Prove the default product path

1. Add an integration test that launches the real daemon, connects through the real WebSocket server, records `hello.accepted.capabilities`, and exercises every capability claimed as production-wired.
2. Make release documentation and generated manifests derive their capability claims from that tested production construction.
3. Add a repeatable end-to-end Android-to-host smoke procedure covering pairing, session creation, prompt submission, reconnect, replay, stop, and restart.

### P0 — Make startup independently reachable

1. Bind the loopback server after lightweight store recovery, before external-history synchronization.
2. Expose explicit phases such as `starting`, `initializing_history`, and `ready` rather than one undifferentiated readiness result.
3. Import history in bounded batches with durable checkpoints.
4. Yield between batches so health checks and connected clients remain responsive.
5. Add interruption and restart tests using approximately 20 sessions and 50,000 events.

### P0 — Make degradation observable

1. Preserve tolerant handling for unknown forward-compatible events.
2. Emit a bounded, redacted diagnostic for malformed known-event projections.
3. Surface a host or session degraded-state indicator without disconnecting a healthy socket.
4. Add regression tests proving later events still project after one bad event.

### P1 — Wire the mobile-native providers that matter

Recommended order:

1. Attention inbox.
2. Command and skill catalogue.
3. Agent supervision.
4. Structured plans.
5. Context inspection.
6. Workspace file browsing and process output only if they remain useful after real mobile use.

Each provider is complete only when it is constructed by the normal daemon, advertised in the handshake, exercised through the mobile app, and covered by a production-wiring integration test.

### P1 — Release and operational hardening

- Replace placeholder Android identity and configure production signing.
- Define upgrade compatibility and local-data migration expectations.
- Align application, bridge, manifest, and release versions.
- Validate and package Apple Silicon support, or clearly keep it unsupported.
- Add notarization/signing and a safer macOS installation path.
- Improve lifecycle diagnostics and operator-facing recovery instructions.

### P2 — Product polish

- Reduce dense diagnostic language in ordinary mobile states.
- Improve accessibility and small-screen handling for long tool and subagent output.
- Add a simple first-run explanation of host ownership, Tailscale, and controller leases.
- Refine notification preferences once the FCM path has been exercised in ordinary use.

## Definition of beta

pi-mob can be called beta when:

- the default daemon binds promptly and remains reachable during history initialization;
- the documented capability list is generated from a tested production construction;
- restart, reconnect, replay, duplicate-command, and indeterminate-command behaviour pass end-to-end tests;
- no advertised feature depends only on an unwired provider or test fixture;
- Android and host artifacts have consistent versions and a documented upgrade path;
- supported platforms, signing status, limitations, and recovery procedures are accurate.

## Historical documents

The dated rectification and incident reports under `docs/` preserve investigation history. They are evidence snapshots, not current status documents. When a historical report conflicts with this file or current production code, use this file for product status and inspect the implementation for final authority.
