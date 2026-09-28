## Context

The current branch's normal daemon constructs `OmpSession`, while the bridge adapter and much of the process/RPC machinery remain under `packages/bridge/src/pi/`. The existing mobile protocol is backend-neutral in practice, but current daemon, operations, store, tests, and documentation contain OMP-specific configuration and identity assumptions. The working tree also contains unrelated uncommitted changes that must be preserved.

## Goals / Non-Goals

**Goals:**

- Make Pi the sole backend constructed by the normal daemon.
- Preserve current bridge/mobile behavior and bridge-scoped session identity.
- Reuse the existing Pi RPC and supervision path rather than introduce a new abstraction hierarchy.
- Keep backend-specific state private and capability claims honest.
- Provide a rollback-safe, testable change with no implementation edits to the user's existing dirty files.

**Non-Goals:**

- Supporting Pi and OMP concurrently through a runtime selector.
- Migrating Pi sessions to OMP or preserving OMP-only session artifacts.
- Rewriting the mobile protocol or making Flutter understand Pi raw RPC.
- Expanding Git or other out-of-scope product features.

## Decisions

1. **Restore Pi at the composition root.** Change the normal daemon and operator configuration back to Pi executable/session inputs, using the surviving `SupervisedRpcClient` and `OneSessionPiAdapter` path. This is smaller and safer than retaining OMP construction behind a selector. The alternative—reverting the entire OMP commit—would discard unrelated current bridge/mobile improvements.

2. **Keep the mobile contract unchanged.** Preserve canonical event persistence, replay, leases, commands, and HTTP attachment/export behavior. Backend translation remains inside the bridge. Rewriting Flutter for backend vocabulary is rejected because it increases scope without improving the released contract.

3. **Use Pi's existing session identity and history model.** Keep bridge session IDs as the mobile identity while restoring Pi launch/session-directory handling and existing JSONL reconciliation. OMP backend-reference fields and migration-only behavior should be removed or made neutral only where required by the current durable schema; no Pi-to-OMP migration is part of this change.

4. **Preserve bounded transport behavior.** Carry forward the current request-size, attachment, output, timeout, shutdown, and indeterminate-state safeguards into the Pi path. The current uncommitted changes to `packages/bridge/src/pi/rpc-process.ts` and related files are treated as inputs and must be reviewed, not overwritten.

5. **Update production proof, not just unit fixtures.** Replace OMP assumptions in daemon construction tests, operations/install tests, capability reports, and documentation. Add or retain an integration test that starts the normal daemon composition path with Pi and verifies the baseline handshake and session flow.

6. **Treat the existing OMP migration change as historical context.** Do not modify or archive `openspec/changes/replace-pi-runtime-with-omp`; this change supersedes its production direction without deleting its evidence. The new plan is implemented independently on the current branch.

## Risks / Trade-offs

- **Pi and OMP event shapes differ** → reuse Pi normalization and verify canonical event mappings with focused contract tests; do not claim parity without evidence.
- **Current store schema contains OMP-specific backend fields** → preserve durable data needed by current code, but define Pi values explicitly and test fresh and existing databases; avoid destructive schema rewrites.
- **Current OMP-oriented tests and install config may be broad** → change only production-path assumptions and keep unrelated bridge/mobile tests intact.
- **Working-tree edits may overlap bridge transport files** → capture status/diff before implementation, avoid wholesale checkout/reset, and resolve each overlap intentionally.
- **Existing Pi history may contain active or ambiguous turns** → retain the established indeterminate/reconciliation behavior and require explicit recovery rather than silently retrying.

## Migration Plan

1. Freeze the current working-tree boundary and record the existing diff; do not reset or overwrite it.
2. Inventory OMP-only production imports, CLI/configuration, store identity fields, tests, fixtures, reports, and docs.
3. Restore Pi daemon composition using the existing Pi supervisor, launch configuration, adapter, and history reconciliation.
4. Normalize backend identity/configuration and remove only OMP-required assumptions from the normal path.
5. Update production-wiring, capability, operations, and RPC tests; add regression coverage for the current dirty transport changes where needed.
6. Run focused bridge tests, then the repository validation commands and mobile checks required by `AGENTS.md`.
7. Verify the daemon can start without OMP, pair a mobile client, create/resume a session, stream canonical events, and handle restart/indeterminate state.

Rollback is a source-level revert of this restoration change or deployment of the prior known-good Pi-backed revision. No in-process backend selector is added.
