## 1. Protect the working tree and inventory the cutover

- [x] 1.1 Capture the existing `git status` and `git diff --stat` before implementation, and verify all pre-existing uncommitted paths are recorded and unchanged.
- [x] 1.2 Inventory OMP-only references across daemon composition, CLI/install configuration, store/backend identity, diagnostics, tests, fixtures, reports, and docs; verify the inventory names each intended replacement or deliberate retention.

## 2. Restore Pi production composition

- [x] 2.1 Change the normal daemon options, CLI parsing, and install configuration from OMP executable/session inputs to the existing Pi launch configuration; verify Pi path validation and `--help` output.
- [x] 2.2 Reconnect `SupervisedRpcClient`, `resolvePiLaunchConfig`, `OneSessionPiAdapter`, Pi history reconciliation, and Pi diagnostics to the current daemon composition; verify the production-wiring integration test constructs Pi without OMP.
- [x] 2.3 Preserve current bridge session IDs, durable store state, leases, stream setup, attachment/export services, and notification construction while swapping only the execution provider; verify focused bridge runtime and session lifecycle tests.

## 3. Align backend state and behavior

- [x] 3.1 Replace OMP-only backend identity and session-reference assumptions with Pi-compatible durable values without destructive database changes; verify fresh and existing store migration tests.
- [x] 3.2 Carry current bounded request-frame, timeout, shutdown, output, redaction, and indeterminate-state safeguards into the Pi path, including the pre-existing working-tree transport edits; verify RPC boundary and fault-path tests.
- [x] 3.3 Review Pi event normalization, canonical persistence, history reconciliation, model/catalogue operations, extension responses, cancellation, and restart handling against the current mobile contract; verify focused adapter and canonical-event tests.
- [x] 3.4 Return bounded unsupported/unavailable results for operations without a Pi equivalent and ensure they are absent from capability advertisements; verify capability-report and unsupported-operation tests.

## 4. Update production proof and documentation

- [x] 4.1 Replace OMP assumptions in daemon, operations, lifecycle, capability, fixture, and release-consistency tests; verify the affected bridge test subset passes.
- [x] 4.2 Update project status, architecture, protocol, quick-start, package README, privacy, and release metadata to describe only verified Pi behavior; verify `bun run docs:check` or the repository's equivalent docs validation.
- [x] 4.3 Preserve `openspec/changes/replace-pi-runtime-with-omp` as historical evidence and verify this change's artifacts do not modify it.

## 5. Validate the restored path

- [x] 5.1 Run focused Pi bridge integration coverage for daemon startup, pairing, session create/resume, canonical replay/live delivery, attachments, exports, notifications, cancellation, restart, and indeterminate recovery; verify all tests pass.
- [ ] 5.2 Run `bun install --frozen-lockfile`, `bun run typecheck`, `bun run schema:check`, `bun run fixtures:check`, `bun test`, and `bun run build`; record any unavailable toolchain result.
- [x] 5.3 Run `cd apps/mobile && flutter analyze --no-fatal-infos && flutter test`; verify the mobile client remains protocol-compatible (both pass; analyzer reports infos only).
- [ ] 5.4 Compare final `git status` and diff against task 1.1, verify pre-existing user changes remain intact, and validate the completed OpenSpec change with `openspec validate restore-pi-runtime --type change`.
