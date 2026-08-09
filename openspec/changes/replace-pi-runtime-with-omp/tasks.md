## 1. OMP Contract and Baseline

- [x] 1.1 Capture the initial OMP launch, transport, session, event, model, command, and credential behavior from runtime help and probes; leave interrupted-turn recovery validation to 1.3.
- [x] 1.2 Build a disposable OMP probe that starts one session, submits a prompt, captures streaming and tool events, exercises cancellation, and records the observed lifecycle.
- [x] 1.3 Exercise OMP restart and resume behavior, including an interrupted turn, and document that completed sessions resume by path with the same OMP ID while an early killed turn leaves no recoverable session artifact and must be treated as indeterminate.
- [x] 1.4 Define the initial OMP-to-bridge command and event mapping, including unsupported `get_commands` behavior and the requirement to withhold `catalogue.v1` until the event projection is production-wired.
- [x] 1.5 Capture current Pi-backed state and protocol fixtures as migration baselines without changing released behavior.

## 2. Backend-Neutral Bridge Boundary

- [ ] 2.1 Define the backend-neutral session, command, event, lifecycle, and recovery contracts from the behavior in the OMP specs.
- [ ] 2.2 Separate backend launch/transport, supervision, session operations, command translation, event normalization, and history reconciliation responsibilities.
- [x] 2.3 Route canonical event persistence and live publication through the backend-neutral event path with persist-before-publish ordering.
- [ ] 2.4 Add unit tests for supported operations, unsupported operations, bounded payloads, lifecycle transitions, and indeterminate outcomes.

## 3. Backend-Neutral Session State

- [x] 3.1 Add durable backend identity and OMP session-reference fields without exposing backend-private values to mobile clients.
- [ ] 3.2 Add durable migration status and per-session migration outcome records.
- [ ] 3.3 Preserve stable bridge session IDs across OMP reference changes, reconnects, and daemon restarts.
- [x] 3.4 Add store migration tests for fresh sessions, existing sessions, interrupted migration, and idempotent reruns.

## 4. OMP Runtime Integration

- [x] 4.1 Implement the OMP transport client using the authoritative OMP contract and existing bounded request/lifecycle behavior.
- [ ] 4.2 Implement OMP session supervision, startup readiness, draining, crash handling, restart, and close semantics.
- [ ] 4.3 Implement OMP session create, resume, stop, delete, rename, and stable bridge-reference binding.
- [x] 4.4 Implement OMP prompt dispatch, streaming output, cancellation, and completion handling.
- [ ] 4.5 Implement OMP model discovery/selection and command catalogue integration where equivalent semantics exist.
- [ ] 4.6 Implement OMP approval, extension, or user-input interactions supported by the bridge contract.

## 5. Event Normalization and Recovery

- [ ] 5.1 Translate OMP assistant, turn, tool, retry, compaction, approval, failure, and cancellation events into canonical session events.
- [x] 5.2 Enforce existing transcript, tool-output, diagnostic, redaction, and notification bounds before persistence or publication.
- [ ] 5.3 Implement authoritative OMP turn reconciliation after bridge restart or backend exit.
- [x] 5.4 Mark sessions indeterminate when OMP cannot establish a terminal outcome and block conflicting retries until explicit recovery.
- [ ] 5.5 Add real OMP integration tests for replay/live equivalence, sequence continuity, crash recovery, cancellation, and ambiguous turns.

## 6. Pi-to-OMP Migration

- [ ] 6.1 Implement migration preflight for bridge state, Pi session inputs, OMP availability, supported formats, backup location, and capacity.
- [ ] 6.2 Implement protected, non-destructive Pi session metadata and bounded history import.
- [ ] 6.3 Import authoritative terminal turns and mark ambiguous active turns indeterminate.
- [ ] 6.4 Persist per-session migrated, archived, partial, failed, and indeterminate outcomes.
- [ ] 6.5 Make migration resumable and idempotent without duplicate OMP sessions or canonical events.
- [ ] 6.6 Add migration tests for complete, partial, malformed, interrupted, rerun, and insufficient-capacity scenarios.
- [ ] 6.7 Produce an operator-readable migration report that excludes credentials, private paths, and raw transcript content.

## 7. Production Wiring and Cutover

- [x] 7.1 Replace normal daemon Pi construction with OMP-only construction and configuration validation.
- [ ] 7.2 Derive `hello.accepted.capabilities` from constructed OMP providers and verify absent-provider behavior.
- [ ] 7.3 Update setup, lifecycle, diagnostics, release checks, and configuration documentation for OMP.
- [ ] 7.4 Run the pre-cutover migration against a protected state copy and block cutover for unresolved active sessions.
- [ ] 7.5 Verify the mobile app end to end against the OMP daemon: pairing, reconnect, session selection, leases, prompts, transcript replay, drafts, attachments, exports, notifications, models, and commands.
- [ ] 7.6 Verify the documented restore procedure using the protected pre-cutover state before enabling OMP-only release wiring.

## 8. Pi Removal and Release Acceptance

- [ ] 8.1 Remove Pi runtime imports, dependencies, launch flags, production modules, fixtures, and dead compatibility code.
- [ ] 8.2 Remove implicit reattachment of legacy Pi session files from the post-cutover daemon.
- [x] 8.3 Update project status, architecture, protocol, quick-start, package guides, privacy, and release metadata to describe only verified OMP behavior.
- [ ] 8.4 Run bridge typecheck, schema checks, fixture checks, tests, and build.
- [ ] 8.5 Run Flutter analysis and tests, then perform a release-path mobile smoke test.
- [ ] 8.6 Validate the completed OpenSpec change and confirm every requirement has implementation and verification evidence.
