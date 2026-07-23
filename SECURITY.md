# Security Policy

## Supported versions

Security fixes are applied to the current development branch before the first public release.

## Reporting a vulnerability

Please use GitHub's private vulnerability-reporting feature for this repository. Do not disclose vulnerabilities, credentials, or exploit details in public issues.

## Security model

pi-mob is designed for a single owner operating a private Tailscale network. The bridge binds to loopback and the host remains responsible for repository, Pi, and credential security. The app does not provide multi-user authorization, public-network exposure, or an OS sandbox.

Never submit secrets, private keys, device tokens, transcripts, or source content in reports unless requested through a private channel.
