# M12 Summary — Session tree, fork, clone, delete, and restore

M12 adds durable session lineage and explicit, recoverable lifecycle operations without conflating fork and clone semantics.

## Delivered

- Durable parent/fork-origin lineage, deterministic fallback names, direct-child pagination, bounded Pi tree/fork-message snapshots, and accessible lazy tree rendering.
- Upstream-confirmed eligible fork selection, distinct fork/clone confirmation flows, and real pinned Pi `fork`, `clone`, `get_tree`, `get_fork_messages`, and `set_session_name` RPC mappings.
- Extension cancellation handling that leaves the original session unchanged and creates no child.
- New-session mapping, lineage metadata, and durable snapshot state committed before adapter success returns.
- Explicit active-turn abort and queued-prompt cancellation intent before soft delete; process stop and durable seven-day recovery state.
- Restore deadline enforcement, visible `delete_failed` repair state, repeat-delete repair path, and separately guarded irreversible purge.
- Non-reusable tombstones retained after purge, with purged sessions excluded from normal lists/tree pages.
- Mobile persisted tree projection, draft-preserving lifecycle commands, restore/purge UX, typed `DELETE` confirmation, semantics, and 200% text-scale coverage.

## Evidence

- `docs/evidence/m12-lifecycle-fixture-matrix.json`
- `packages/bridge/test/m12-session-lifecycle.test.ts`
- `packages/bridge/test/m12-tree-store.test.ts`
- `apps/mobile/test/session_tree_test.dart`
- `apps/mobile/test/app_database_m12_test.dart`
- `apps/mobile/test/session_tree/session_tree_widgets_test.dart`
- M12 scenarios in `apps/mobile/test/connection_coordinator_test.dart`
- Root `bun run all`: all typecheck, bridge, real pinned-Pi, fixture, extension, Flutter, schema, documentation, security, and release-build gates passed.
