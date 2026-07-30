# Privacy

pi-mob is designed to keep development work on a host you control. The Android app is a reconnectable control and presentation client, not the authority for repositories, provider credentials, Pi processes, or durable session state.

## Data that stays on the host

- repositories and working trees;
- provider credentials and the captured login environment;
- Pi processes and Pi-owned session files;
- durable command and event journals;
- attachment bytes and generated exports;
- full tool output unless a selected mobile view requests a bounded projection;
- host-side notification credentials.

## Data stored on the phone

- paired-host endpoint and identity metadata;
- installation identity used by the protocol;
- local prompt drafts and mobile preferences;
- bounded cached session and transcript projections needed for reconnectable views;
- attachment selections before upload;
- push token when notifications are configured.

The app does not store provider API keys or a copy of the repository.

## Data sent between phone and host

The private protocol may carry:

- prompts, steering messages, and follow-ups entered on the phone;
- bounded transcript, tool, subagent, session, and command projections;
- selected attachments and requested exports;
- lease, cursor, pairing, and capability metadata;
- raw Pi RPC commands and responses when the raw RPC surface is used.

Raw RPC is intentionally generic. A user can request information that curated mobile screens would not normally display, so raw RPC should be treated as an advanced trusted-owner surface.

## Notifications

Notifications are optional. The intended payload is status-only and excludes prompts, answers, source paths, repository content, credentials, and raw tool output.

FCM requires:

- host-side service-account configuration;
- Firebase Android configuration in the app build;
- the device push token registered with the bridge.

Push delivery necessarily involves the configured push provider. Do not enable it when that external delivery path is unacceptable.

## Logs and diagnostics

Logs and fixtures must not contain:

- credentials or private keys;
- environment values;
- device or push tokens;
- private host paths;
- prompts, answers, transcripts, or source content;
- unbounded tool output.

Operational diagnostics should use bounded categories, identifiers, counts, durations, and redacted failure information.

## Network exposure

The bridge binds to loopback and is intended to be reachable only through a private Tailscale Serve route. Public listeners and Tailscale Funnel are unsupported.

Tailscale account, tailnet, device, DNS, and traffic handling remain subject to Tailscale's own configuration and policies.

## Deletion and retention

- Local app data is removed according to Android application-data behaviour, including uninstall or explicit clearing.
- Durable bridge state remains on the host until removed through lifecycle operations or direct host administration.
- Attachments and exports use host-managed bounded retention and sweep behaviour.
- Pi-owned sessions remain subject to Pi's own storage and deletion behaviour.

## User responsibilities

Protect the Mac, Android device, Tailscale account, tailnet membership, and host filesystem with appropriate operating-system controls. Review exports before sharing them through the Android share sheet.

pi-mob does not provide cloud backup, public sharing links, multi-user authorization, or remote credential management.
