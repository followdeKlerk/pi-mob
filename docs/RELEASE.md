# Build, release, and operations specification

Status: normative for MVP.

This document defines environments, CI, packaging, private distribution, installation, update, rollback, compatibility, and release evidence. Exact baseline versions and source references are also recorded in [`TOOLCHAIN.md`](TOOLCHAIN.md).

## 1. Release channels

### Development

- Flutter debug/profile builds.
- Bridge run from pinned source toolchain.
- Separate development state/config.
- Fault injection enabled only by explicit test/development build.
- Manual endpoint entry available.

### Internal release candidate

- Compiled bridge artifact using production limits/config semantics.
- iOS TestFlight build.
- Signed Android release APK/private internal distribution.
- Real Pi, device, lifecycle, migration, and rollback evidence.
- Test push credentials separated from stable credentials where possible.

### Stable personal release

- Signed/notarized macOS bridge installer/artifacts where practical.
- Private TestFlight or registered-device iOS distribution.
- Signed Android release build.
- No public App Store or Play Store listing required for MVP.

## 2. Independent versions

Track independently:

```text
mobile app semantic version
bridge semantic version
protocol major.minor
Pi exact version/tested range
bridge database schema version
mobile database schema version
configuration schema version
release manifest version
```

Before `1.0.0`:

- patch: compatible fixes,
- minor: additive compatible features/capabilities,
- major: incompatible application behaviour.

Protocol compatibility follows its own major/minor rules.

## 3. Frozen initial baseline

Verified/selected on 2026-07-12:

```text
Flutter: 3.44.4 stable, release ref ad70ec4
Dart: 3.12.2 bundled with selected Flutter
Bun: 1.3.14 stable, release ref 0d9b296
Pi: @earendil-works/pi-coding-agent 0.80.6 exact
Pi upstream: earendil-works/pi
Protocol: 1.0
macOS bridge minimum: 13.0
Android minSdk: 29
 iOS deployment target: 16.1
```

M1 still records platform archive checksums, exact Xcode/iOS SDK, Android compile/target SDK, AGP, Gradle, JDK, and supported bridge architecture artifacts after real builds pass.

The earlier Catalina/macOS 10.15 bridge claim is obsolete: pinned Bun requires macOS 13 or later.

## 4. Deterministic Bun release build

Release builds use a standalone executable so the user does not manage a global Bun runtime.

Bun compiled executables currently auto-load nearby `.env` and `bunfig.toml` unless disabled. Production build MUST disable both:

```text
bun build --compile \
  --no-compile-autoload-dotenv \
  --no-compile-autoload-bunfig \
  ...
```

Runtime configuration comes only from:

- explicit versioned `config.toml`,
- Pi's supported provider credential storage,
- owner-approved Keychain/secrets files,
- explicit allowlisted environment configuration.

Release smoke tests prove an adjacent `.env` or `bunfig.toml` cannot alter bridge behaviour.

## 5. Pin and dependency policy

- Exact direct dependencies.
- Committed lockfiles.
- Pinned stable toolchains; no canary/floating latest.
- No blind automated major updates.
- Dependency updates include source/changelog/security/license review.
- Pi update requires RPC/session/extension/real-binary contract suite.
- Flutter update requires build, golden, accessibility, lifecycle, and performance review.
- Bun update requires compiled executable, autoload, SQLite, WebSocket, subprocess, and macOS smoke tests.
- Native plugin update requires permission/entitlement/background/privacy review.

Review before every release candidate, on major upstream change, and at least every three months during active development.

## 6. Required pin/build files in M1

```text
.tool-versions or equivalent
pubspec.lock
bun.lock
exact package.json versions
Flutter/Dart version declaration
protocol/schema generated-artifact manifest
bridge build metadata generator
release manifest schema
```

Build metadata records version, revision, source commit, protocol/schema versions, architecture, and artifact checksum.

## 7. CI workflows

### Documentation/spec

- Markdown links.
- Duplicate backlog/decision IDs.
- Normative index.
- Protocol command/event catalogue drift.
- Generated schema/fixture drift.
- No unresolved blocking `TBD` in Ready/Active checkpoint.

### Bridge

- format/lint/typecheck,
- unit/property/fuzz tests,
- protocol fixtures,
- SQLite migration/upgrade/restore fixtures,
- real pinned Pi contract suite,
- compiled executable smoke test,
- adjacent `.env`/`bunfig.toml` non-autoload test,
- macOS architecture artifact tests,
- secret/dependency/license scans.

### Mobile

- Dart format/analyze/unit/widget tests,
- protocol fixture parity,
- pinned-environment goldens,
- integration test compile/run,
- Android release build,
- iOS build/signing check where credentials permit,
- permission/privacy/backup manifest checks.

### Cross-component

- protocol compatibility matrix,
- reconnect/idempotency/controller/queue fault suite,
- replay/snapshot/generation compatibility,
- real Pi release fixture,
- install/update/rollback smoke suite.

## 8. Branch/checkpoint policy

- `main` remains documentation-consistent and, after scaffold, buildable.
- Use short-lived branches once code exists.
- A backlog checkpoint lands only after its demo and exit criteria pass.
- No long-lived `develop` branch required.
- Tag executable checkpoints/releases after artifacts exist.

## 9. Bridge release bundle

```text
pi-mob-bridge executable
Pi extension package
LaunchAgent template
config template/schema
migration metadata
install/update/rollback/uninstall scripts
doctor command/help
checksums/release manifest
license notices
known issues/release notes
```

Manifest records:

- bridge/source/protocol/schema/config versions,
- Flutter/Bun/Pi versions and relevant revisions,
- supported macOS versions/architectures,
- artifact SHA-256,
- migration and rollback classification,
- required capabilities,
- known limitations.

## 10. macOS installation

Supported floor: macOS 13.0.

Installer:

1. Verify OS and architecture.
2. Verify Tailscale visibility/MagicDNS/Serve prerequisites.
3. Verify exact Pi executable/version.
4. Create owner-only application support/state/secrets/log directories.
5. Generate stable host ID.
6. Write versioned config.
7. Propose explicit PATH and allowlisted environment names.
8. Install Pi extension.
9. Install user LaunchAgent.
10. Start bridge and wait for readiness.
11. Configure persistent Serve to loopback.
12. Run doctor.
13. Display QR/manual endpoint.

Installer MUST NOT:

- run bridge as root,
- configure Funnel,
- copy complete shell environment,
- source interactive startup files,
- write secrets to Git/config/normal logs,
- delete or replace state without verified backup,
- overwrite unrelated Serve routes.

## 11. Environment setup

LaunchAgents do not inherit the interactive terminal environment.

Configure:

- absolute Pi path,
- explicit PATH,
- approved locale/`SSH_AUTH_SOCK` and other allowlisted names,
- owner-only optional tool environment file,
- Pi's own provider credential stores.

Never launch Pi through `zsh -lc`, `bash -lc`, `.zshrc`, `.bashrc`, or a login shell. Doctor verifies executable resolution without printing values.

## 12. Update

Host-initiated explicit flow:

1. Select/download release.
2. Verify checksum/signature/manifest.
3. Check Pi/config/schema/platform compatibility.
4. Run preflight doctor.
5. Drain/reject new commands.
6. Back up database/config and retain old artifact.
7. Stop LaunchAgent.
8. Replace binary/extension/scripts.
9. Run classified migrations.
10. Start and verify readiness.
11. Verify Serve target and doctor.
12. Retain rollback material.

Mobile may explain update requirement but cannot update bridge remotely in MVP.

## 13. Rollback

Classify every release:

- `binary_only`,
- `reversible_migration`,
- `restore_required`.

Rollback restores corresponding artifact/state. If durable state moves backwards, increment `hostGeneration` so mobile discards stream caches and snapshots again.

Do not claim rollback until tested for that release.

## 14. Uninstall

Offer explicit variants:

1. Remove service/binary, retain bridge state.
2. Remove service and bridge state.
3. Full bridge removal including extension, attachments, exports, logs, and backups.

Pi durable sessions are listed separately and retained by default. Remove only pi-mob-owned Serve configuration after target verification.

## 15. iOS distribution

Initial path: TestFlight/private registered-device distribution.

Before internal release:

- stable bundle ID,
- signing team/profiles,
- APNs and Live Activities configuration,
- camera/photo/notification purpose strings,
- privacy manifest,
- backup/file-protection verification,
- export-compliance/TestFlight privacy metadata,
- real-device lifecycle/accessibility tests.

## 16. Android distribution

Initial path: signed release APK/private internal distribution.

Before internal release:

- stable application ID,
- release keystore outside repository,
- current target/compile SDK decision,
- notification/foreground-service permission/type review,
- camera/photo picker,
- backup exclusion rules,
- data-safety documentation,
- real-device lifecycle/accessibility tests.

## 17. Push setup

Push is degraded/optional until M15.

APNs:

- token key, team ID, key ID, topic,
- environment separation,
- host-side protected credential.

FCM:

- HTTP v1 service account/project registration,
- host-side protected credential,
- high priority only for user-visible urgent status,
- still treated as best effort.

Real-device evidence is required; simulator-only evidence is insufficient.

## 18. Compatibility handshake

Connection reports:

```text
mobile version
bridge version
protocol major/minor
host generation
Pi version
schema-derived capabilities and limits
```

Rules:

- protocol major mismatch: refuse,
- missing required capability: refuse affected workflow/connection,
- additive unknown optional event: ignore safely/diagnose,
- Pi mismatch: bridge/session not ready,
- mobile/bridge too old: actionable update UX,
- state rollback/restore: new host generation and snapshots.

## 19. Release evidence

Every candidate retains:

- CI results,
- protocol/schema diff,
- migration/restore report,
- real Pi contract report,
- fault-injection matrix,
- install/update/rollback report,
- device matrix,
- accessibility checklist,
- performance/resource measurements,
- redacted doctor output,
- dependency/license/security report,
- known issues and rollback classification.

No external analytics service is required for one-owner MVP.

## 20. Release blockers

Block release for:

- duplicate dispatch,
- replay/snapshot/generation corruption,
- acceptance without durable commit,
- controller dual ownership,
- removed queue item dispatch,
- automatic rerun of indeterminate action,
- secret/transcript leakage in logs/notifications/artifacts,
- non-loopback production listener or Funnel,
- adjacent `.env`/`bunfig.toml` affecting compiled bridge,
- incompatible Pi accepted as ready,
- missing rollback classification,
- release fault endpoint/control,
- inaccessible critical action,
- unbounded memory/disk/queue/output path,
- unsupported/unsigned/unverifiable artifact.

## 21. Upstream watch list

Monitor without automatic adoption:

- Pi repository/package and RPC/session/extension changes,
- Flutter/Dart stable and breaking changes,
- Bun runtime/compiled executable/SQLite/platform floors,
- Tailscale Serve semantics,
- Android foreground/background rules,
- APNs/ActivityKit requirements,
- FCM HTTP v1/priority behaviour,
- selected Flutter native plugins.

Any material change triggers backlog/decision review before update.
