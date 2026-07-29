# Raw RPC rectification — historical final report

> **Archived report from 24 July 2026.** This document summarizes the completed rectification but is not the current product status or roadmap. Use [Project status and roadmap](PROJECT_STATUS.md).

## Executive summary

The rectification changed pi-mob from a bridge built around a curated Pi command subset and bridge-owned policy assumptions into a durable mobile transport that can preserve Pi's normal execution model.

The work established:

- one shared owner login-environment contract for model discovery and Pi processes;
- generic raw Pi RPC request, response, and event transport;
- removal of the default bridge-owned policy extension and mobile trust ceremony;
- a shared adapter helper for direct Pi RPC mappings;
- cross-language protocol fixtures and integration coverage.

Those changes remain foundational and are production-wired in the current durable core.

## Root causes corrected

### Environment mismatch

Model discovery and runtime process launch previously used different environment construction. That could make a provider or executable appear available during discovery but unavailable when Pi actually ran.

The fix introduced a shared `PiLaunchConfig` populated from a sanitized owner login shell and reused by model discovery, primary RPC, and per-session RPC.

### Default policy-extension injection

The bridge previously injected its own policy extension into Pi and exposed bridge-owned trust/read-only workflows.

The default extension package and workflow were removed. Pi now runs with its normal execution model. Operators may still supply an explicit custom extension.

### Curated RPC limitation

A hand-maintained command mapping prevented the mobile bridge from exposing new or extension-defined Pi methods until pi-mob added bespoke support.

The fix added `raw_rpc.v1` with bounded outer validation and no Pi method allowlist. Raw upstream events are retained alongside curated mobile projections.

### Repeated direct-RPC plumbing

Common direct Pi mappings duplicated transport lookup, request construction, correlation, and timeout behaviour.

A shared adapter helper now carries the common contract while bridge-owned durable orchestration remains in dedicated handlers.

## Durable guarantees preserved

The rectification retained pi-mob's core guarantees:

- command acceptance commits before dispatch;
- semantic command IDs provide idempotent replay behaviour;
- conflicting reuse is rejected;
- controller leases protect session mutations;
- uncertain post-crash execution becomes `indeterminate` rather than being run again automatically;
- durable events replay after reconnect.

Raw RPC is intentionally generic, but it still passes through the durable command and lease machinery.

## Follow-on findings

Later integration exposed additional issues not fully addressed by the rectification itself:

- historical recipe projection could approach quadratic work during startup;
- full SQLite integrity verification blocked ordinary startup;
- the daemon bound its listener only after external-history work and Pi startup;
- cumulative tool progress was incorrectly accumulated as deltas;
- mobile event projection could demote healthy connections on a single forward-compatible payload;
- subagent output could amplify and render poorly.

The quadratic projection and ordinary integrity-scan issues were fixed. Tool-progress, connection-tolerance, workspace, and subagent presentation fixes also landed. Bind-first startup, checkpointed history import, and projection-degradation observability remain open.

## Current capability boundary

The current production daemon wires:

- durable streams and commands;
- controller leases;
- raw RPC;
- the multi-session Pi adapter;
- attachments and exports;
- optional FCM notifications;
- optional explicit workspace search roots and custom Pi extensions.

The repository contains additional providers for attention, first-class agent supervision, catalogues, plans, context, file browsing, and process output. Those providers are not currently injected by the normal daemon and must not be marketed as shipped.

Git integration is intentionally out of scope. Existing experimental Git-related code is not part of the roadmap.

## Current completion criteria

The rectification itself is complete. pi-mob as a product is not beta-complete until:

1. production capability claims are proven by a real daemon/WebSocket integration test;
2. listener binding is independent of bulk history synchronization;
3. history import is bounded, checkpointed, interruption-safe, and observable;
4. malformed known-event projections create bounded degraded-state diagnostics without destroying healthy connections;
5. selected optional providers are production-wired end to end;
6. release identity, signing, platform support, and upgrade behaviour are aligned.

## Validation

Use current repository commands rather than historical test counts:

```sh
bun install --frozen-lockfile
bun run all
```

Focused checks:

```sh
bun run typecheck
bun run schema:check
bun run fixtures:check
bun test
bun run build
cd apps/mobile && flutter analyze --no-fatal-infos && flutter test
```

Historical pass counts and host-specific installation observations remain in repository history. They should not be repeated as current validation evidence unless the checks are rerun against the current commit.
