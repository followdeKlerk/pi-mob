# Build, release, and operations specification

Status: normative for MVP.

This document defines toolchain pinning, environments, CI, packaging, private distribution, installation, update, rollback, compatibility, and release evidence.

## 1. Release channels

### Development

- Local Flutter debug/profile builds.
- Bridge run from source.
- Fault injection allowed only behind explicit development/test build flag.
- Manual endpoint entry supported.
- Development database/config kept separate from release state.

### Internal

- Signed bridge release candidate.
- iOS TestFlight build.
- Signed Android release APK or private internal distribution.
- Production protocol and migration behaviour.
- Test push credentials/entitlements scoped to internal bundle IDs where possible.

### Stable personal release

- Signed/notarized macOS bridge bundle or installer artifacts where practical.
- Private TestFlight or registered-device iOS distribution.
- Signed Android release build.
- No public App Store or Play Store listing required for MVP.

## 2. Versioning

Components version independently:

```text
mobile app version
bridge version
protocol major.minor
Pi version/range
bridge database schema version
mobile database schema version
configuration schema version
```

Use semantic versioning for mobile and bridge before `1.0.0`:

- patch: fixes with no protocol/schema expansion,
- minor: backward-compatible capability/schema additions,
- major: incompatible product/protocol behaviour.

Protocol has explicit major/minor independent from app versions.

## 3. Initial pins

Verified planning baseline on 2026-07-12:

- Flutter stable family: `3.44`.
- Project pin currently selected: Flutter `3.44.4`, Dart `3.12.2`.
- Pi package: `@earendil-works/pi-coding-agent` `0.80.6`.
- Pi upstream repository: `earendil-works/pi`.
- Protocol: `1.0` before implementation corrections are finalized; all v1 corrections land before code is released.
- Android `minSdk`: 29 by deliberate product choice.
- iOS deployment target: 16.1 for Live Activities.

The scaffold checkpoint must verify that every exact toolchain artifact exists and record its checksum/ref. A planning document is not sufficient proof of an installable pin.

Bun is pinned to an exact stable version in `.tool-versions` or equivalent during scaffold. Do not use canary. Release builds compile a standalone executable so end users do not require a global Bun runtime. Bun's current platform requirements must be checked against the oldest supported host before freezing the pin.

## 4. Pin and update policy

- Exact direct dependency versions.
- Committed lockfiles.
- No blind automated major updates.
- Dependency update PRs include changelog/source review and applicable compatibility tests.
- Pi updates require RPC, session, extension, and real-binary contract tests.
- Flutter updates require Android/iOS build, golden, accessibility, lifecycle, and performance review.
- Bun updates require compiled-binary, SQLite, WebSocket, subprocess, and macOS deployment smoke tests.
- Native plugin updates require platform permission/entitlement review.

Review cadence:

- before each release candidate,
- on any major component update,
- when upstream announces breaking RPC/session/extension changes,
- at least once every three months while actively developing.

## 5. CI workflows

### Documentation/spec gate

Before scaffold:

- Markdown link check.
- Duplicate/backlog ID check.
- Normative-document index check.
- No unresolved `TBD` in a milestone marked Ready.

### Bridge

- format, lint, and typecheck,
- unit and property tests,
- protocol fixtures,
- SQLite migrations and upgrade fixtures,
- real Pi contract suite where runner credentials allow,
- compiled binary smoke test,
- macOS arm64 and x64 build strategy or explicit architecture limitation,
- secret and dependency scans.

### Mobile

- Dart format and analyze,
- unit/widget tests,
- protocol fixtures,
- goldens in pinned environment,
- integration test compile,
- Android release build,
- iOS build/signing check where CI credentials allow,
- permission and privacy manifest checks.

### Cross-component

- app/bridge protocol matrix,
- reconnect/idempotency/fault suite,
- snapshot/replay compatibility,
- release fixture against pinned Pi,
- generated schema drift check.

## 6. Branch and release policy

During early personal development:

- `main` remains buildable and documentation-consistent.
- Use short-lived feature branches once code exists.
- Milestone checkpoints merge only after their demo and exit gate pass.
- Tag checkpoint releases as `checkpoint/mN-name` or use GitHub releases with corresponding semantic versions after executable artifacts exist.

No long-lived develop branch is required.

## 7. Bridge release artifact

Release bundle contains:

```text
pi-mob-bridge executable
Pi extension package
LaunchAgent template
config template and schema documentation
migration metadata
install script
update script
rollback script
uninstall script
doctor command/help
checksums
release manifest
license notices
```

Release manifest records:

- bridge version and commit,
- protocol version,
- schema versions,
- Bun version/revision used to compile,
- supported host OS/architectures,
- exact Pi version/range,
- artifact SHA-256 checksums,
- migration compatibility,
- known limitations.

## 8. macOS installation

Installer workflow:

1. Verify supported macOS and architecture.
2. Verify Tailscale CLI/app visibility.
3. Verify Pi executable and exact version.
4. Choose/create application support directories with owner-only permissions.
5. Generate stable `hostId`.
6. Create versioned config.
7. Capture/propose explicit PATH and allowlisted environment names.
8. Install Pi extension.
9. Install LaunchAgent.
10. Start bridge and wait for readiness.
11. Configure persistent Tailscale Serve to loopback.
12. Run doctor.
13. Display QR/manual endpoint.

Installer never:

- runs bridge as root,
- configures Funnel,
- copies the complete shell environment,
- writes secrets into repository/config,
- deletes an existing database without backup.

## 9. Environment setup

Because LaunchAgents do not behave like an interactive shell:

- configure absolute Pi path,
- configure explicit PATH,
- default pass-through to safe variables such as locale and `SSH_AUTH_SOCK` only when present/approved,
- use owner-only optional env file for project/tool variables,
- prefer Pi's own credential storage for providers,
- show variable names before capture,
- never source `.zshrc`, `.bashrc`, or login profiles in the Pi RPC process.

Doctor checks executable resolution for Pi and common configured toolchain paths without printing environment values.

## 10. Update

Update is explicit and initiated on the host.

1. Download/select verified release artifact.
2. Verify checksum and manifest.
3. Check compatibility with current Pi/config/schema.
4. Run preflight doctor.
5. Stop accepting commands and drain.
6. Back up database/config.
7. Stop LaunchAgent.
8. Replace binary/extension/scripts.
9. Run migrations.
10. Start service and verify readiness.
11. Verify Serve target.
12. Retain previous artifact and backup for rollback.

The mobile app may display an update requirement but does not remotely update the bridge in MVP.

## 11. Rollback

Rollback classes:

- Binary-only: restore previous binary.
- Reversible migration: run down migration and restore binary.
- Restore-required: restore pre-update database/config backup and previous binary.

Rollback must preserve or explicitly invalidate stream generation. If state moves backwards, increment `hostGeneration` and force mobile snapshots.

Never claim rollback support for a release whose migration is not classified/tested.

## 12. Uninstall

Offer separately:

- remove service/binary only and retain data,
- remove service and bridge state,
- full removal including extensions, exports, attachments, logs, and backups.

Pi durable sessions are listed separately and are not deleted by default.

Uninstall removes Tailscale Serve configuration created by pi-mob only after verifying ownership/target.

## 13. Mobile distribution

### iOS

Initial path: TestFlight.

Required before internal release:

- stable bundle identifier,
- signing team and profiles,
- APNs entitlement,
- Live Activities entitlement/configuration,
- camera/photo permission strings,
- notification permission copy,
- privacy manifest review,
- export-compliance answers,
- TestFlight data/privacy metadata.

### Android

Initial path: signed release APK or private internal app sharing.

Required:

- stable application ID,
- release keystore stored outside repository,
- notification permission/runtime handling,
- foreground-service type/permission review,
- camera/photo picker handling,
- backup exclusion rules,
- data safety documentation even when not publicly listed,
- target SDK review at scaffold/release time.

## 14. Push setup

Push is optional/degraded until milestone C.

APNs:

- token-based provider key,
- team ID, key ID, topic,
- environment separation,
- key stored host-side.

FCM:

- HTTP v1 service account,
- project/application registration,
- credential stored host-side,
- high-priority messages reserved for user-visible urgent status and still treated as best effort.

Release evidence includes device tests; simulator-only push evidence is insufficient.

## 15. Compatibility handshake and blocking

Connection reports:

- mobile version,
- bridge version,
- protocol major/minor,
- host generation,
- Pi version,
- schema-derived capabilities.

Rules:

- protocol major mismatch: refuse.
- missing required capability: refuse affected workflow or connection as defined.
- additive unknown event: ignore safely and diagnose.
- Pi mismatch: bridge not ready for affected session start.
- mobile too old: actionable update screen.
- bridge too old: host update instructions.

## 16. Observability and release evidence

Every release candidate retains:

- CI results,
- protocol/schema diff,
- migration test report,
- real Pi contract report,
- fault-injection report,
- device matrix,
- accessibility checklist,
- performance measurements,
- doctor output with redaction,
- dependency/license report,
- known issues and rollback classification.

No external analytics service is required for MVP. Local structured diagnostics are sufficient for one owner.

## 17. Release blockers

Block release for:

- any duplicate-dispatch failure,
- replay ordering or snapshot corruption,
- database acceptance without durability,
- secret/transcript leakage in logs or notifications,
- production non-loopback listener,
- Funnel configuration,
- missing rollback classification,
- incompatible Pi accepted as ready,
- fault-injection endpoint in release build,
- inaccessible critical actions,
- unbounded memory/disk path,
- unsigned/unverifiable release artifacts where signing is expected.

## 18. Upstream watch list

Monitor:

- Pi repository/package ownership/name and RPC/session/extension docs,
- Flutter stable releases and breaking changes,
- Dart language/runtime,
- Bun compiled executable and SQLite behaviour,
- Tailscale Serve CLI/config semantics,
- Android background/foreground service rules,
- APNs/ActivityKit requirements,
- FCM HTTP v1 and message-priority behaviour,
- chosen Flutter plugins for Drift, QR, notifications, Live Activities, and app links.

A watch-list change does not automatically trigger an update; it triggers backlog review.
