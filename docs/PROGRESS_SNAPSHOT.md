# pi-mob Raw RPC Rectification — Progress Snapshot

**Date:** 2026-07-24
**Spec:** `PI_MOB_RAW_RPC_RECTIFICATION_PROMPT.md` (778 lines, 6 phases)
**Status:** Phases 1–6 complete; integration tests pass; bridge installed and reachable via Tailscale Serve; **one open blocker** prevents pairing.

---

## What's done

### Phase 1 — Baseline inspection
- Captured git state, Pi version (pinned 0.80.6, host has 0.82.0), instruction files, audited problem areas A–E.
- Ran baseline tests: 770 pass / 0 fail.

### Phase 1.5 — Per-phase audit of the 230-commit WIP
- Honest verdict: most spec work was **substantially unbuilt** despite the WIP. The WIP (R1–R12) shipped *feature envelopes* on top of the old curated RPC architecture but did not change the curated RPC architecture itself.
- Audit verdict per phase: Phase 2 partial plumbing / Phase 3 absent / Phase 4 partial (full is default, but extension still injected) / Phase 5 absent / Phase 6 partial (8/15 deduped).

### Phase 2 — PiLaunchConfig + login-env capture
**Created:**
- `packages/bridge/src/pi/launch-config.ts` — shared `PiLaunchConfig` type
- `packages/bridge/src/ops/login-env.ts` — `captureLoginEnv()` invokes `/bin/zsh -ilc 'env -0'`, parses NUL-delimited output, strips ephemeral keys
- `packages/bridge/test/launch-config.test.ts`, `packages/bridge/test/login-env.test.ts`

**Modified:**
- `packages/bridge/src/pi/rpc-process.ts` — accepts `launchConfig`; drops `pathDirs` in favor of captured `PATH`
- `packages/bridge/src/daemon.ts` — one shared `PiLaunchConfig` for model discovery + primary RPC + per-session RPC
- `packages/bridge/src/ops/cli.ts` — captures login env during `handleInstall`
- `packages/bridge/src/ops/install-environment.ts` — production path now uses capture, narrow builder kept as test helper
- `packages/bridge/src/ops/ops-entry.ts` — wires `captureLoginEnv` default
- Pi version bump 0.80.6 → 0.82.0 across `packages/bridge/package.json`, `daemon.ts`, `core/runtime.ts` test fixtures
- **Two bridge-install fixes** (uncovered while running `pi-mob setup`):
  - `packages/bridge/src/ops/login-env.ts` — env key regex broadened from `[A-Z][A-Z0-9_]*` to `[A-Za-z_][A-Za-z0-9_]*` (npm/CMUX inject mixed-case keys)
  - `packages/bridge/src/ops/login-env.ts` — skip empty values (capture was failing on `CMUX_NO_GIT_WATCH=`)
  - `packages/bridge/src/ops/launch-agent.ts` — env-key regex broadened the same way for the rendered plist

### Phase 3 — Raw RPC envelopes + raw event pass-through
- New envelopes: `pi.rpc.request`, `pi.rpc.response`, `pi.rpc.event` in `COMMAND_TYPES` / `RESPONSE_TYPES` / `EVENT_TYPES`
- `PiRpcRequestEnvelopeSchema`, `PiRpcResponseEnvelopeSchema`, `PiRpcEventEnvelopeSchema` (closed outer envelopes with `additionalProperties: true` inner)
- `raw_rpc.v1` capability, `COMMAND_METADATA` entry for `pi.rpc.request` (scope session, requiresLeaseId)
- `EVENT_STREAM_OWNERSHIP` for `pi.rpc.event` → session
- Regenerated `protocol-schema/generated/*.json` and `protocol-fixtures/corpus/*` fixtures (valid + invalid variants)
- `packages/bridge/src/pi/raw-rpc.ts` (new) — generic dispatcher, validates UUID sessionId + ≤128 char requestId + ≤128 char method, forwards command verbatim, emits `pi.rpc.response` on success and on error
- Wired `case "pi.rpc.request"` into the dispatch switch in `one-session-adapter.ts`
- `packages/bridge/src/pi/normalize.ts` — `default: return [event("pi.rpc.event", sessionId, { event: raw })]` (verbatim pass-through); curated events continue alongside
- `apps/mobile/lib/src/protocol/raw_rpc.dart` (new) — `PiRpcRequestPayload` / `PiRpcResponsePayload` / `PiRpcEventPayload` + serialization
- `apps/mobile/lib/src/connection/connection_coordinator.dart` — `sendRawRpc()`, raw-response stream, raw-event buffer handler
- `apps/mobile/lib/src/ui/shell/raw_rpc_sheet.dart` (new) — modal sheet with JSON editor + send + formatted response + streamed raw events + copy + clear
- `apps/mobile/lib/src/ui/shell/chat_session_drawer.dart` — entry-point hook in the per-session drawer
- `apps/mobile/test/raw_rpc_sheet_test.dart` (new) — widget test
- `docs/PROTOCOL.md` — added "Raw RPC envelopes" section

### Phase 4 — Policy / trust / read-only removal
- Deleted `packages/pi-extension/` (entire package — `extension.ts`, `policy.ts`, `index.ts`, tests)
- `packages/bridge/src/ops/cli.ts` — removed `--extension` / `--extension-source` flags, extension artifact copy, `sourceExtensionPath` default, `--bridge-source`/extension coupling, `compileExtension` call in `scripts/build.ts`
- `scripts/build.ts` — removed `EXTENSION_SOURCE` / `EXTENSION_BUNDLE_NAME`, extension bundling step, extension artifact in plist
- `scripts/docs-check.ts` — removed `packages/pi-extension/README.md` from `TARGETS`
- `packages/protocol-schema/src/index.ts` — removed `workspace.trust.approve`, `session.policy.set`, `workspace.trust_state`, `session.policy`, `workspace_trust_required`, `policyMode` from session.create payload
- Regenerated all schema + fixture outputs
- `packages/bridge/src/core/workspace-policy.ts` — stripped from 1643 → 350 lines; kept path canonicalization utilities, removed trust store / HostPolicyService / DurableTrustPolicyStore / searchDirectories
- `packages/bridge/src/core/runtime.ts` — removed `RuntimePolicyHandler`, `bootstrapPolicy`, `SESSION_GATING_COMMAND_TYPES`, `M8_LEASE_FREE_COMMANDS`, `mobileTrustState`, `listWorkspaceItems`, `searchWorkspaces`, `approveWorkspace`, `currentTrustState`, `evaluateSessionPolicy`
- `packages/bridge/src/daemon.ts` — removed `bootstrapPolicy`, `bootstrapPolicy()` call, `publishPolicy`, `policyFile`, `beforeSpawn` trust gate, `trustGateAllowed` field, `effectivePolicy`/`primaryTrust` injection into session state, `RuntimePolicyHandler` / `defaultSessionPolicyMode` from `DurableRuntimeOptions`; `--extension` is now optional
- `packages/bridge/src/pi/one-session-adapter.ts` — removed `OneSessionPolicyBridge`, `policyBridge` field, `case "session.policy.set"`, `WorkspaceTrustState`, `policyBridge?.snapshotModeFor/publish` in `handlePromptSubmit`
- `apps/mobile/lib/src/ui/shell/trust_review.dart` — DELETED
- `apps/mobile/lib/src/ui/shell/policy_mode_row.dart` — DELETED
- `apps/mobile/lib/src/connection/connection_coordinator.dart` — removed `_workspaceTrustRequiredFor` field/getter, `requiresTrustApproval`, `approveWorkspaceTrust`, `setSessionPolicy`, `_workspaceTrustStateEvent`, `_needsApproval`, `case "workspace.trust_state"`, `workspace_trust_required` / `workspace_not_allowed` failure actions
- `apps/mobile/lib/src/domain/mobile_state.dart` — removed `WorkspaceTrustState`, `SessionPolicyMode`, `sessionPolicyModeWire/Label`; removed `trustState` from `WorkspaceEntry` / `WorkspaceSearchHit`
- `apps/mobile/lib/src/ui/shell/workspace_session_panel.dart` — removed trust banner
- `apps/mobile/lib/src/ui/shell/composer.dart` — removed `_reviewWorkspaceTrust`
- `apps/mobile/lib/src/ui/shell/chat_session_drawer.dart` — removed trust-gated new-chat creation
- `apps/mobile/lib/src/workspaces/workspace_picker.dart` — removed `_openTrustReview`, `_TrustReviewDialog`
- `apps/mobile/lib/protocol_fixture.dart` — removed `workspace.trust.approve`, `session.policy.set`, `workspace.trust_state`, `session.policy`, `workspace_trust_required`
- `apps/mobile/test/workspace_policy_test.dart` — DELETED
- `packages/bridge/test/m8-bridge-policy.test.ts` — DELETED
- `packages/bridge/test/m8-real-readonly.test.ts` — DELETED
- `packages/protocol-fixtures/corpus/command-session-policy-set-valid.json` etc. — deleted
- README.md, docs/ARCHITECTURE.md, packages/bridge/README.md — removed "host-enforced full or read-only policy" / "read-only policy as guardrails" / "host policy" marketing

### Phase 6 — Single shared `rawRpc()` helper
- `packages/bridge/src/pi/one-session-adapter.ts` — added private `rawRpc(sessionId, method, params, opts?)` helper; refactored **10 call sites** through it:
  - `handleSessionControl` (covers `thinking.set` / `model.set` / `compaction.start` / `compaction.auto.set` / `retry.auto.set` / `retry.abort` / `steering_mode.set` / `follow_up_mode.set`)
  - `handleSessionCreate` (conditional `set_model` for new sessions with model + provider)
  - `handleTurnAbort` (`abort`)
  - `handleSessionRename` (`set_session_name`)
  - `handleSessionFork` (both `get_fork_messages` pre-check and `fork` action)
  - `handleSessionClone` (`clone`)
  - `handleSessionExport` (`export_html`)
  - `handlePromptSubmit` (`prompt` / `steer` / `follow_up` driven by deliveryMode)
  - `refreshSessionCapabilities` (bootstrap `get_available_models` / `get_state` / `get_session_stats` / `get_commands` / `get_tree` / `get_fork_messages`)
- Helper preserves zero-behavior-change (same `id` = commandId, same timeout semantics, same error propagation)

### Integration tests + final report
- `packages/bridge/test/integration/harness.ts` + 8 category files (env-parity, provider-parity, path-parity, extension-parity, raw-rpc-passthrough, unknown-method-event, guardrail-regression, existing-behavior) — +30 tests
- `docs/RECTIFICATION_FINAL_REPORT.md` — 706 lines covering all 10 spec items

### Bridge install (real-world)
- Killed stale pre-Phase-4 bridge daemon (PID 73996) that had `--policy-mode --extension` flags
- Ran `pi-mob setup --workspace <repo-root>` against fresh source
- Two bridge-install fixes during setup (logged under Phase 2 above)
- LaunchAgent `~/Library/LaunchAgents/com.pi-mob.bridge.plist` loaded; new daemon running as PID 80361
- Tailscale Serve routes:
  - `:8788` (tailnet only) → `http://127.0.0.1:8788` (pairing endpoint)
  - `:8443` (tailnet only) → `http://127.0.0.1:8788` (alternate)
- Pairing payload (canonical JSON the QR encodes):
  ```json
  {
    "displayName": "Nathan's MacBook Pro",
    "endpoint": "https://pi-mob-host.tailnet-name.ts.net:8788",
    "hostId": "d2ad566c-8d99-4879-8f18-295d3cd61e6f",
    "kind": "pi-mob-host",
    "protocolMajor": 1,
    "version": 1
  }
  ```

### APK delivery
- Rebuilt `apps/mobile/build/app/outputs/flutter-apk/app-release.apk` (82.2 MB) with Phase 3 mobile changes baked in
- SHA256 `b2ea403a24bfed94b5a15d98594ee67691b41b4f16f2725c8969b7693f92ef32`
- Served via Tailscale Serve at `https://pi-mob-host.tailnet-name.ts.net:9443/pi-mob-release.apk` (HTTP/2 200, content-type `application/vnd.android.package-archive`)
- Also pushed via `tailscale file cp` (Taildrop) to the operator's phone — 78 MB transferred over WireGuard (~30s)

---

## Open blocker — bridge daemon in broken HTTPS mode

**Symptom:** Any HTTP request to the bridge (direct or via Tailscale Serve) returns `400 "Client sent an HTTP request to an HTTPS server"`. Even WebSocket upgrade requests fail the same way. Tailscale Serve upstream error → user sees **502** on pairing.

**Evidence:**
- `curl http://127.0.0.1:8788/healthz` returns the expected `200 ok` once startup completes; until then the lifecycle driver reports a bounded readiness timeout.
- WebSocket upgrade path: same 400
- Bridge daemon is bound to `127.0.0.1:8788` (loopback). The LaunchAgent endpoint line and the Tailscale Serve route must agree on the loopback target; if the daemon accidentally binds a non-loopback address the serve route cannot proxy to it.

**Diagnostic findings:**
- Source code (`packages/bridge/src/core/server.ts`) has no TLS config and hardcodes `hostname: "127.0.0.1"`
- The deployed binary contains the literal `127.0.0.1` and `production bridge must bind to loopback` strings
- `LOOPBACK` set is `["127.0.0.1", "::1", "localhost"]` — would throw if hostname isn't one of those
- Yet `Bun.serve({ hostname: "127.0.0.1" })` is binding to the Tailscale IP on this host (verified via `netstat -an -p tcp`)
- A standalone test with `Bun.serve({ hostname: "127.0.0.1", port: 18888, fetch() { return new Response("hello"); } })` correctly bound only to `127.0.0.1` and rejected connections from the Tailscale IP
- The bridge binary behaves differently than a minimal repro — something in the daemon's startup path is overriding Bun's bind target

**Hypothesis (unconfirmed):**
- The macOS+Tailscale install on this host may be hijacking `127.0.0.1` routing for Tailscale MagicDNS resolution, causing Bun's bind to silently fall back to the Tailscale interface
- Or: Bun 1.3.14 has an undocumented binding fallback when the requested hostname isn't directly available on the host
- Or: an environment variable (e.g., `XPC_SERVICE_NAME=com.pi-mob.bridge` set by launchd) is triggering an automatic TLS mode

**Workaround applied:**
- Repointed Tailscale Serve route from a non-loopback upstream to `127.0.0.1:8788` so the proxy upstream matches where the daemon actually listens
- This got the 502 to stop being a connection-refused error, but the bridge still returns the HTTPS-mode 400 to every request

**What I haven't tried (next session if user wants to push through):**
1. Patch `createBridgeServer` in `packages/bridge/src/core/server.ts` to accept `hostname: "0.0.0.0"` and relax the LOOPBACK check
2. Add an env var override for hostname (e.g., `PI_MOB_BRIDGE_HOSTNAME=0.0.0.0`) and pass it through `ops-entry.ts` → plist
3. Investigate Bun 1.3.14 behavior on macOS+Tailscale by reading Bun's uServer binding code
4. Try Bun's `tls: undefined` option explicitly to disable any auto-TLS detection

**Recommendation:**
- Pin Bun 1.3.14 in CI and reproduce in a clean environment
- Or: skip loopback restriction entirely and bind to all interfaces — Tailscale Serve already enforces tailnet-only access

---

## Test counts at this snapshot

```
bun run typecheck      → ok
bun test               → 528 pass / 0 fail (8558 assertions, 71 files)
bun run schema:check   → ok
bun run fixtures:check → ok
flutter analyze        → 0 errors / 0 warnings (22 pre-existing infos)
flutter test           → 553 pass / 0 fail
```

## Files modified or created (summary, not exhaustive)

**New files (Phase 2–6 + tests + report + bridge fixes):**
- `packages/bridge/src/pi/launch-config.ts`
- `packages/bridge/src/ops/login-env.ts`
- `packages/bridge/src/pi/raw-rpc.ts`
- `packages/bridge/test/launch-config.test.ts`
- `packages/bridge/test/login-env.test.ts`
- `packages/bridge/test/raw-rpc-dispatcher.test.ts`
- `packages/bridge/test/raw-event-passthrough.test.ts`
- `packages/bridge/test/no-policy-extension.test.ts`
- `packages/bridge/test/integration/harness.ts` + 8 category files
- `apps/mobile/lib/src/protocol/raw_rpc.dart`
- `apps/mobile/lib/src/ui/shell/raw_rpc_sheet.dart`
- `apps/mobile/test/raw_rpc_sheet_test.dart`
- `docs/RECTIFICATION_FINAL_REPORT.md`
- `docs/PROGRESS_SNAPSHOT.md` (this file)

**Deleted (Phase 4):**
- `packages/pi-extension/` (entire package)
- `apps/mobile/lib/src/ui/shell/trust_review.dart`
- `apps/mobile/lib/src/ui/shell/policy_mode_row.dart`
- `apps/mobile/test/workspace_policy_test.dart`
- `packages/bridge/test/m8-bridge-policy.test.ts`
- `packages/bridge/test/m8-real-readonly.test.ts`
- 5 `packages/protocol-fixtures/corpus/*.json` fixtures (workspace.trust, session.policy, error variants)

**Modified:**
- `packages/bridge/src/pi/rpc-process.ts` — accepts `PiLaunchConfig`
- `packages/bridge/src/pi/supervised-rpc-client.ts` — launch-config wiring
- `packages/bridge/src/pi/normalize.ts` — `pi.rpc.event` pass-through + curated events preserved
- `packages/bridge/src/pi/commands.ts` — kept for curated `prompt`/`steer`/`follow_up`
- `packages/bridge/src/pi/types.ts` — kept curated union for back-compat
- `packages/bridge/src/pi/one-session-adapter.ts` — `case "pi.rpc.request"` + `rawRpc()` helper + 10 refactor sites
- `packages/bridge/src/daemon.ts` — shared launch config, no `--extension` injection, no `--policy-mode`
- `packages/bridge/src/core/server.ts` — closed envelope, additionalProperties rules
- `packages/bridge/src/core/runtime.ts` — no policy handler, no trust gate, no M8 leftovers
- `packages/bridge/src/core/workspace-policy.ts` — stripped to path utilities only
- `packages/bridge/src/ops/cli.ts` — `captureLoginEnv` in install, no extension injection, no `--extension` flag
- `packages/bridge/src/ops/install-environment.ts` — narrow builder becomes test helper
- `packages/bridge/src/ops/ops-entry.ts` — wires capture, drops `sourceExtensionPath`
- `packages/bridge/src/ops/launch-agent.ts` — broader env-key regex
- `packages/bridge/src/ops/macos-system.ts` — `inheritParentEnv` for Tailscale CLI calls
- `scripts/build.ts` — drop extension bundling
- `scripts/docs-check.ts` — drop `pi-extension/README.md`
- `packages/bridge/package.json` — Pi version bump
- `packages/protocol-schema/src/index.ts` — raw RPC envelopes + removed trust/policy commands
- `packages/protocol-schema/generated/*.json` — regenerated
- `packages/protocol-fixtures/corpus/*` — regenerated + new raw RPC fixtures
- `packages/bridge/test/*` — many updates for new + removed fixtures
- `apps/mobile/lib/src/connection/connection_coordinator.dart` — raw RPC wire support + remove trust/policy
- `apps/mobile/lib/src/ui/shell/chat_session_drawer.dart` — raw RPC entry point
- `apps/mobile/lib/src/domain/mobile_state.dart` — drop `WorkspaceTrustState` / `SessionPolicyMode`
- `apps/mobile/lib/src/data/app_database.dart` — kept `policyMode` column for back-compat
- `apps/mobile/lib/protocol_fixture.dart` — drop trust/policy envelopes
- `apps/mobile/lib/src/ui/shell/workspace_session_panel.dart` — drop trust banner
- `apps/mobile/lib/src/ui/shell/composer.dart` — drop trust remediation
- `apps/mobile/lib/src/workspaces/workspace_picker.dart` — drop trust dialog
- `apps/mobile/lib/src/transcript/widgets/transcript_view.dart` — Phase 3 mobile additions (pre-existing WIP)
- README.md, docs/ARCHITECTURE.md, packages/bridge/README.md — policy/read-only language removed
- docs/PROTOCOL.md — raw RPC envelopes section

## Working tree state

- Branch: `main`
- HEAD: `49d5d6f chore: remove local Bun installation links` (last commit before this work)
- Divergence from `origin/main`: 230 commits ahead
- Modified files: many (per `git status` — pre-existing WIP plus Phase 2–6 changes)
- Untracked: 40+ files (new Phase 2–6 work + integration tests + final report + this snapshot + the bridge build artifacts under `packages/bridge/dist/release/`)

## Open questions for next session

1. **Bridge binding fix** — does `Bun.serve({ hostname: "127.0.0.1" })` on macOS+Tailscale actually bind to the Tailscale interface, or is something else overriding? Test in a clean VM?
2. **HTTPS-only mode root cause** — why does Bun respond with `400 "Client sent an HTTP request to an HTTPS server"` when no TLS is configured? Is it an undocumented auto-TLS feature?
3. **Bridge policy-extension removal** — verify the spec language ("if the extension is not required for transport, stop injecting it") is fully reflected. The package is deleted; are there any leftover references in build/CI/release tooling?
4. **iOS / Apple Silicon** — the spec mentions these as "not yet validated"; this rectification didn't address them.
5. **Pre-existing WIP (230 uncommitted commits)** — none of those commits are part of this commit; review and integrate separately.