# Security policy

Pi Mob is an unsupported alpha preview. Security fixes target `main`. The bridge preview is unsigned, and the Android APK uses an external preview signing key.

Verify release checksums and provenance before installation.

## Report a vulnerability

Use GitHub private vulnerability reporting. Do not put credentials, exploits, private host details, transcripts, or source content in public issues.

Include the smallest reproduction that proves the problem. Use synthetic data when possible.

## Boundary

Pi Mob is for one owner on a private Tailscale network. The bridge binds to loopback, authenticates installations, validates bounded payloads, and records state-changing commands before dispatch.

Pi Mob does not provide public Internet or Funnel hardening, multi-user authorization, an operating-system sandbox around OMP, or protection from a compromised owner device, tailnet, extension, or credential.

OMP uses the owner's normal execution model and login environment. Extensions run with the host user's authority. Exactly-once execution inside OMP or external tools is not guaranteed.

See [Privacy](docs/PRIVACY.md) and [Project status](docs/PROJECT_STATUS.md).
