# Security and privacy model

Status: normative for MVP.

This document records the actual single-user threat model, controls, accepted risks, and review triggers. It must not imply protections the product does not provide.

## 1. Security posture

`pi-mob` is a private remote control surface for a coding agent that intentionally runs with the host user's permissions.

For MVP:

- Tailscale is the sole connection-authentication boundary.
- The bridge has no account, password, bearer token, pairing secret, or biometric gate.
- The bridge binds to loopback and is exposed only through Tailscale Serve.
- The owner controls every tailnet node and accepts the risk of an already-authorized malicious node.
- Workspace trust controls project resource loading; it is not an OS sandbox.
- Read-only mode is a product guardrail enforced through Pi tool hooks; it is not a complete sandbox.

## 2. Assets

Protect:

- provider API keys and OAuth material,
- push-provider credentials and device tokens,
- repositories and uncommitted work,
- host shell credentials and SSH agent access,
- Pi durable sessions,
- prompts, reasoning, responses, tool output, and attachments,
- bridge database and configuration,
- workspace trust approvals,
- exports and local mobile cache,
- operational logs and diagnostics.

## 3. Trust boundaries

### Tailnet boundary

Traffic reaching the Tailscale Serve origin is considered owner-authorized for MVP. Funnel and public listeners are forbidden.

### Mobile/bridge boundary

All input is untrusted structurally even within the tailnet. The bridge validates schemas, sizes, states, leases, attachment content, and idempotency before acting.

### Bridge/Pi boundary

Pi output is trusted as upstream protocol data only after strict JSONL parsing and schema normalization. Tool content remains potentially hostile for rendering/logging.

### Pi/host boundary

Pi and its tools execute with the user account's permissions. This is the highest-risk boundary and is deliberately accepted for trusted workspaces.

### Provider boundary

Prompt and repository-derived content may be sent to configured LLM providers according to Pi/provider configuration. `pi-mob` does not change provider privacy terms.

## 4. Threats and controls

### Public exposure

Threat: bridge accidentally exposed to LAN or public internet.

Controls:

- production listener must be loopback,
- installer configures Tailscale Serve only,
- Funnel is rejected,
- readiness and doctor verify listener/Serve target,
- QR refuses loopback, wildcard, plain LAN, or Funnel endpoints,
- tests fail production startup on non-loopback binding.

### Unauthorized tailnet node

Threat: another authorized tailnet node connects.

MVP position: accepted owner-managed risk. The product does not claim per-device authorization.

Recommended operator control: keep the tailnet private and remove devices that are no longer controlled. Application-layer authentication becomes mandatory before multi-user or less-trusted tailnets.

### Stolen unlocked phone

Threat: attacker can read cached content and control sessions.

MVP position: accepted. No biometric app gate.

Controls:

- OS screen lock and data protection,
- no provider credentials on phone,
- exclude cache from cloud backup where supported,
- status-only notifications,
- forget-host and clear-local-data actions,
- no automatic offline command send.

### Compromised host

Threat: attacker can access repositories, provider credentials, Pi sessions, and bridge state.

MVP position: outside application protection. Host security is foundational.

Controls:

- never run bridge as root,
- owner-only state/secrets permissions,
- no secrets in repository or normal logs,
- explicit update/rollback,
- dependency and secret scanning.

### Malicious project resources

Threat: repository Pi settings/extensions/context alter agent or execute code.

Controls:

- discover trust-bearing resources before Pi starts,
- fingerprint relative names/content,
- explicit approval on first use or change,
- show changed categories/files,
- read-only option,
- no claim that trust equals sandboxing.

### Malicious prompt or model output

Threat: prompt injection causes harmful tool actions.

Controls:

- visible tool cards,
- trusted-workspace approval,
- read-only mode,
- abort,
- no silent automatic rerun after crash,
- optional future sandbox profiles.

MVP does not introduce per-command confirmations in Full mode.

### Path traversal and symlink escape

Threat: workspace picker or upload/export paths escape expected directories.

Controls:

- canonicalize configured roots and candidates,
- reject picker symlink resolution outside roots,
- use opaque IDs and bridge-generated random filenames,
- never concatenate user filenames into storage paths,
- keep attachments/exports outside workspaces,
- test traversal, Unicode normalization, case, and symlink races.

Full-mode shell commands can still access outside the workspace because no OS sandbox is claimed.

### Malformed/oversized messages

Threat: memory exhaustion, parser bugs, or slow-consumer pressure.

Controls:

- schema validation,
- 1 MiB JSON envelope cap,
- bounded tool chunks and queues,
- disabled WebSocket compression in v1,
- 8 MiB outbound buffer cap,
- slow-client disconnect and replay,
- property/fuzz testing.

### Duplicate side effects

Threat: reconnect/resend executes a command twice.

Controls:

- client command ID,
- canonical payload hash,
- transaction before acceptance,
- same ID/same payload returns existing state,
- same ID/different payload rejects,
- running-at-crash becomes indeterminate and is never auto-repeated.

### Stale or conflicting clients

Threat: two app instances mutate one session.

Controls:

- one controller lease per session,
- explicit takeover,
- lease expiry and reconnect grace,
- stale connection generation rejected,
- session command serialization.

This is concurrency safety, not identity security.

### Attachment attacks

Threat: spoofed MIME, malformed image, decompression bomb, metadata leakage.

Controls:

- mobile metadata stripping/resizing,
- host magic-byte and decoder validation,
- dimension and byte limits,
- private random storage path,
- SHA-256 digest,
- expiry/cleanup,
- no attachment bytes in logs,
- JPEG/PNG only in v1.

### Export leakage

Threat: export becomes public or remains indefinitely.

Controls:

- explicit user action,
- host-generated export,
- opaque short-lived download ID,
- same private Tailscale origin,
- 24-hour expiry,
- no public share links,
- clear warning that OS sharing moves data outside the tailnet.

### Notification leakage

Threat: lock-screen reveals source code or prompt content.

Controls:

- status/session/host only by default,
- optional generic preview,
- no file paths, prompts, answers, reasoning, commands, or tool output,
- no mutating notification actions,
- token removal on permanent rejection.

### Log leakage

Threat: diagnostics capture secrets or transcript content.

Controls:

- metadata-only structured logs,
- path IDs or root-relative paths,
- bounded redacted stderr,
- no full environment dumps,
- no query strings,
- redaction tests,
- diagnostic report allowlist.

### Shell-environment contamination

Threat: shell startup emits text into Pi RPC stdout, hangs, or injects unexpected configuration.

Controls:

- spawn Pi directly, not through login/interactive shell,
- absolute executable,
- explicit PATH,
- allowlisted environment pass-through,
- optional owner-only env file,
- stdout reserved for JSONL and stderr for diagnostics.

### Database corruption or disk full

Threat: command accepted without durable state or replay loss.

Controls:

- WAL and foreign keys,
- transaction before acceptance,
- readiness failure for unwritable DB,
- fail closed for new commands,
- integrity checks,
- online backups,
- deterministic fault tests,
- explicit repair path.

### Supply-chain compromise

Controls:

- exact direct dependency pins,
- committed lockfiles,
- dependency/license audit,
- minimum release age where supported,
- secret scanning,
- signed/reproducible release metadata where practical,
- review Pi, Flutter, Bun, plugin, and native dependency changes,
- no automatic bridge updater.

## 5. Secrets

### Host-only

- Pi provider credentials/OAuth.
- APNs private key and metadata.
- FCM service account.
- optional tool environment secrets.
- notification device tokens.

Storage order:

1. macOS Keychain adapter when practical.
2. Owner-only secrets directory outside repository.
3. Owner-only environment file explicitly configured.

Never store secrets in `config.toml`, Git, logs, events, exports, QR payload, or mobile cache.

### Mobile

Mobile may store platform push tokens and non-secret host endpoints. Keychain/Keystore-backed storage is used for platform-sensitive values. No provider credentials are accepted.

## 6. Privacy classification

| Class | Examples | Mobile | Normal logs | Notification |
|---|---|---|---|---|
| Public metadata | app/protocol version | Yes | Yes | No need |
| Private metadata | session title, host name | Yes | Redacted/IDs preferred | Allowed by default |
| Transcript | prompts, answers | Rolling cache | No | No |
| Reasoning | model reasoning | Rolling cache | No | No |
| Tool content | commands/output/diffs | Capped cache | No | No |
| Source content | file reads/uploads | Limited presentation/cache | No | No |
| Credentials | API/push/private keys | Never | Never | Never |

## 7. Mobile data protection

- Use platform application sandbox.
- Apply iOS file-protection attributes appropriate for access after first unlock while background reconciliation is expected.
- Disable iCloud backup for reconstructible database/cache/attachments where supported.
- Disable Android Auto Backup for sensitive/reconstructible application data or define explicit exclusion rules.
- Use secure storage for small platform tokens/preferences that merit it.
- Do not add custom full-database encryption in MVP; revisit if the unlocked-device threat model changes.
- Consider obscuring app-switcher snapshots only if it does not break usability; this is a release review item.

## 8. Operational incident actions

### Lost phone

1. Remove the device from Tailscale.
2. Remove/disable its push registration from the host CLI if available.
3. Optionally rotate push provider registrations.
4. Review recent command metadata.

### Compromised host

1. Disconnect host from Tailscale.
2. Revoke provider and push credentials.
3. Preserve logs/database for investigation without sharing transcript content unnecessarily.
4. Reinstall host and bridge from trusted artifacts.
5. Treat restored workspace trust approvals as suspect unless verified.

### Accidental public Serve/Funnel configuration

1. Stop bridge/Serve.
2. Verify Funnel and listener state.
3. Review connection/command metadata.
4. Rotate credentials if exposure is plausible.
5. Run doctor and restore loopback-only Serve.

## 9. Accepted risks

Explicitly accepted for MVP:

- unlocked stolen phone access,
- compromised host access,
- malicious authorized tailnet node,
- Full-mode Pi access to host-user permissions,
- prompt injection within trusted workspaces,
- screenshots or user-initiated exports leaving protected storage,
- push delivery failures,
- some daemonized grandchildren escaping process-group cleanup,
- provider-side data handling according to provider terms.

## 10. Security release gates

Before MVP release:

- production non-loopback bind is impossible through normal configuration,
- Funnel detection exists,
- secret/log redaction tests pass,
- command idempotency and lease races pass,
- traversal/symlink tests pass,
- attachment malformed/dimension tests pass,
- database-full fails closed,
- release artifact contains no test credentials or fault endpoints,
- mobile backup exclusions are verified,
- exported diagnostics contain no transcript or secrets,
- dependency and license audits pass.

## 11. Mandatory review triggers

A new security design is required before:

- multi-user/shared bridge,
- public internet access,
- third-party tailnet users,
- mobile provider credentials,
- public sharing links,
- remote terminal/file editor,
- app-store public release with analytics/crash reporting,
- handling untrusted repositories as a safety claim,
- executing Pi under a privileged service account.
