# M7 Summary — macOS install, Serve pairing, and doctor

M7 turns the supervised bridge into a relocatable x64 macOS release with owner-only installation, a user LaunchAgent, private Tailscale Serve management, QR/manual pairing, diagnostics, and explicit lifecycle operations.

## Delivered

- Portable release bundle: compiled daemon and operations CLI, loadable Pi policy extension, relative manifest/checksums, licenses, config/plist templates, architecture and migration metadata.
- Strict install configuration with absolute Pi/workspace/session/extension paths, explicit PATH, allowlisted environment, protected optional env file, 0700 directories, and 0600 files.
- User-domain `launchctl` bootstrap/enable/kickstart/print/bootout, loopback readiness polling, and no shell wrappers.
- Persistent Tailscale Serve adapter that accepts only the owned loopback target, preserves unrelated routes, rejects Funnel/public/wildcard/plain-LAN endpoints, and removes only the exact owned route.
- Standards-compliant level-M QR encoding, Pi `/mobile` command, real Flutter camera scanning, strict confirmation, manual endpoint recovery, and forget/re-pair.
- Doctor probes for versions/config/Serve/database integrity/backups/Pi/environment/process/listener/storage/push, with strict path/credential/content redaction.
- Explicit update, backup, migration, verification, rollback and generation-reset classes; uninstall variants stop service/remove owned Serve while retaining Pi sessions by default.

## Evidence

- [`docs/evidence/m7-install-doctor-report.json`](docs/evidence/m7-install-doctor-report.json)
- `m7-release-build.test.ts`: portable copy verification, checksums, x64 architecture, compiled artifact isolation.
- `m7-install-lifecycle.test.ts`, `m7-ops-cli.test.ts`, `m7-macos-system.test.ts`: permissions, service argv, Serve preservation, update/rollback/uninstall.
- `m7-serve-pairing-doctor.test.ts` and mobile `pairing_test.dart`: QR round-trip, endpoint rejection, redacted doctor, camera/manual recovery.
- Compiled daemon still ignores adjacent `.env` and `bunfig.toml`.

## Environment note

The repository runs a hermetic clean-root lifecycle rehearsal and verifies the real macOS x64 toolchain, user launchd domain, Tailscale backend/MagicDNS availability, compiled artifacts, and production argv. It deliberately does **not** mutate the developer's existing LaunchAgent or Tailscale Serve routes during CI. The production drivers and a clean-account runbook are executable, but destructive live route/reboot rehearsal remains an operator release ceremony.
