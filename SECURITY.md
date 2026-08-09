# Security policy

## Support

Pi Mob provides unsupported alpha preview binaries. Security fixes target the current `main` line. The bridge preview is unsigned. The Android APK uses an external preview signing key, not a production distribution signer.

Verify release checksums and provenance before installation.

## Report a vulnerability

Use GitHub private vulnerability reporting for this repository. Do not put credentials, exploits, private host details, transcripts, or source content in public issues.

Include the minimum reproduction data. Use synthetic data when possible.

## Security boundary

Pi Mob is designed for one owner on a private Tailscale network. The supported setup provides these protections:

- The bridge binds to loopback and uses private Tailscale Serve for remote access.
- The bridge authenticates installations and validates bounded protocol payloads.
- The host records state-changing commands before dispatch.
- Controller leases limit conflicting mobile writes.
- Provider credentials, repositories, and authoritative OMP state stay on the host.

Pi Mob does not provide:

- public Internet or Tailscale Funnel hardening;
- multi-user authorization;
- an operating-system sandbox around OMP;
- protection from a compromised owner device, account, tailnet, extension, or credential;
- exactly-once execution inside OMP or external tools.

OMP runs with the owner's normal execution model and captured login environment. Operator extensions run with the host user's authority.

Git product actions are out of scope. See [Project status](docs/PROJECT_STATUS.md) for the current scope and planned signing work. See [Privacy](docs/PRIVACY.md) for data handling.
