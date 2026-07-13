# M7/M8 implementation handoff

Date: 2026-07-13
Branch: `m1-m2-scaffold`
Base M6 commit: `303fccc`

## Objective

Complete and close M7 (macOS install, Serve pairing, doctor) and M8 (workspace trust/read-only policy), then update status to M9 and commit.

## Implemented

### M7

- Portable x64 release bundle with relative manifest/checksum paths, daemon, compiled operations CLI, policy extension, config/plist templates, licenses, relocation verification, and hostile autoload checks.
- Owner-only install paths/config/environment and user LaunchAgent generation.
- Production argv-only launchctl/Tailscale drivers, readiness polling, atomic replacement, lifecycle update/rollback/uninstall hooks.
- Strict private endpoint/Funnel guards and unrelated Serve route preservation.
- Standards-compliant QR generation plus real mobile camera scanner and manual/forget/re-pair flow.
- Doctor/report with strict redaction plus optional live DB integrity/process/listener probes.
- Update/rollback generation handling and uninstall Pi-session preservation.

### M8

- Canonical roots, stable UUID-shaped IDs, bounded/cancellable search, symlink/traversal rejection, root-relative mobile paths.
- Recursive trust manifest hashing for pinned `.pi` and `.agents/skills` resources; symlinks fail closed.
- Durable trust/policy tables, explicit approval, invalidation, and trust-before-spawn checks.
- Runtime workspace DTOs aligned with mobile; search candidates carry fingerprint/manifest and can be approved.
- Durable exact turn policy snapshots using declared `session.policy` events.
- Real pinned Pi `0.80.6` extension hooks block mutating/unknown tools in read-only mode; file-backed next-turn policy source.
- Real Pi integration test proves read-only blocks write before execution and Full permits it.
- Mobile workspace picker, trust review, policy selector, persistent read-only indicator, and explicit “not an OS sandbox” wording.

## Final verification

- Full `bun run all` passed after the final implementation and documentation edits.
- Bridge and Pi-extension typechecks passed.
- Bridge suite: 261 tests; Pi extension: 248 tests; mobile: 68 tests.
- Real pinned-Pi contract and read-only integration tests passed.
- Portable release build, hostile autoload checks, security scan, formatting, and diff check passed.
- M7/M8 summaries and machine-readable evidence are committed with the implementation.

## Result

M7 and M8 are closed in `BACKLOG.md`; M9 is READY. The release evidence explicitly distinguishes deterministic clean-root/production-driver rehearsal from unperformed destructive mutation of the developer's live Tailscale and LaunchAgent state.

## Review findings already addressed

- LaunchAgent now accepts non-path locale values while enforcing path-valued env entries.
- Install now requires lifecycle driver and performs launchd/readiness/Serve verification.
- Update stops before backup and backs up/restores daemon, extension, plist, env, config, DB.
- Search candidate approval now carries real fingerprint/policy/manifest.
- Trust is rechecked synchronously immediately before `Bun.spawn`.
- Adapter publishes the exact durable turn snapshot before prompt dispatch.
- Release manifest/plist is portable and includes compiled ops + extension.

## Known caution

Do not claim a destructive live Tailscale/launchctl clean-account test was run unless it actually is. The repository has deterministic production-driver rehearsal and current-host build/runtime evidence; describe that distinction explicitly.
