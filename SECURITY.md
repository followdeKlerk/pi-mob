# Security policy

## Supported versions

pi-mob is a private alpha. Security fixes are applied to the current `main` development line. No released version currently carries a long-term support commitment.

The bridge preview artifact is unsigned and may change without compatibility guarantees. Android release APKs require an operator-supplied non-debug signer. Verify checksums and release provenance before installing either artifact.

## Report a vulnerability

Use GitHub's private vulnerability-reporting feature for this repository.

Do not disclose vulnerabilities, credentials, exploit details, private host information, transcripts, or source content in public issues.

Include only the minimum reproduction information needed. Wait for a private response before sharing sensitive logs or artifacts.

## Security model

pi-mob is designed for one owner operating devices inside a private Tailscale network.

### Intended protections

- The bridge binds to loopback.
- Private remote reachability is provided by Tailscale Serve.
- Host identity can be pinned during pairing and reconnect.
- Protocol envelopes and bounded payloads are validated.
- State-changing commands are durably recorded before dispatch.
- Semantic command IDs reduce duplicate mutation risk.
- Controller leases prevent conflicting mobile mutations.
- Slow-consumer buffering, request rate, replay payloads, attachments, and output are bounded.
- Provider credentials, repositories, and authoritative Pi state remain on the host.

### Not provided

- Public Internet hardening.
- Tailscale Funnel support.
- Multi-user authorization, roles, or tenancy.
- An operating-system sandbox around Pi or its tools.
- Protection from a compromised owner account, host, phone, tailnet, Pi extension, or provider credential.
- Exactly-once execution inside Pi or external tools.
- A security boundary between raw RPC and the owner. Raw RPC is an advanced trusted-owner surface.

Pi runs with the owner's normal execution model and captured login environment. A custom extension supplied by the operator executes with the host user's authority.

## Out-of-scope Git surface

Git integration is not part of the product roadmap. Do not report the absence of Git status, commit, push, CI summaries, or repository controls as a security defect. Security issues in unused experimental Git modules are still welcome when they affect the shipped build, shared dependencies, or repository tooling.

## Sensitive information

Never submit these in public reports:

- API keys, private keys, service-account JSON, or environment values;
- device or push tokens;
- private Tailscale names, host IDs, or installation IDs when avoidable;
- prompts, answers, transcripts, raw tool output, or repository content;
- private filesystem paths;
- unredacted production databases or Pi session files.

Use bounded synthetic fixtures whenever possible.

## Current hardening gaps

The project status document tracks operational gaps that may have security implications, including:

- Mandatory code-signed and notarized bridge distributable (currently unsigned).
- Bind-loopback-before-history-recovery: today the listener is bound after the runtime has reconciled bulk external history, so a misconfigured peer could observe that work in flight.

These items are tracked in [Project status and roadmap](docs/PROJECT_STATUS.md) (`Planned` and `Out of scope`) and elaborated in [Privacy](docs/PRIVACY.md) and [Architecture](docs/ARCHITECTURE.md).
