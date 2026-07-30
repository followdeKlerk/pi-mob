# Privacy

pi-mob is designed to keep development work on a host you control. The Android app is a reconnectable control and presentation client, not the authority for repositories, provider credentials, Pi processes, or durable session state.

## Authoritative storage on the host

The bridge owns durable, host-side persistence for the items below. The phone never holds the only copy of any of them.

- repositories and working trees;
- provider credentials and the captured login environment;
- Pi processes and Pi-owned session files;
- durable command and event journals;
- attachment bytes (host-side attachment store under `stateDir/attachments`, with bounded retention);
- generated exports (host-side export store under `stateDir/exports`, with bounded retention);
- full tool output unless a selected mobile view requests a bounded projection;
- host-side notification credentials (loaded from operator-provided configuration; the bridge does not persist them beyond the running process).

## Data stored on the phone

- paired-host endpoint and identity metadata;
- installation identity used by the protocol;
- local prompt drafts, follow-up queue snapshots, and mobile preferences;
- bounded cached session and transcript projections needed for reconnectable views;
- attachment selections before upload;
- one temporary copy of a downloaded export, written into the Android system temporary directory (`getTemporaryDirectory()`) while the user opens the share sheet;
- push token when notifications are configured.

The app does not store provider API keys or a copy of the repository.

## Bytes that cross the device/host boundary

The private protocol only moves bytes across the device/host boundary through explicit, user-driven flows. Capability-aware clients gate every flow through the host's `hello.accepted.capabilities`; an absent capability surfaces a truthful "unavailable" state on the phone rather than a fabricated local result.

### Phone → host uploads (attachments)

- A user picks an image in the Android image picker. The picker sanitizes the selection before upload; the original gallery bytes are not sent as-is.
- The mobile transport POSTs the sanitized bytes as a multipart upload to `/v1/attachments` over the paired private HTTPS origin. The host enforces content-type and size limits and validates the payload before persisting it.
- The host's attachment store writes the bytes under `stateDir/attachments`, applies bounded retention, and returns an opaque `attachmentId`. The phone never receives a filesystem path.
- Upload progress is reported back to the UI; transient failures do not silently succeed.

### Host → phone downloads (exports)

- The user starts an export through a session command. The host renders the HTML to `stateDir/exports/<exportId>.html` with bounded retention governed by the host's export store.
- The mobile transport performs a single `GET /v1/exports/<exportId>` over the paired private HTTPS origin. The export id is validated as a canonical UUID; the response sets `Cache-Control: private, no-store`.
- Bytes are streamed directly into a temporary file inside the Android system temporary directory. The download is bounded; progress is reported to the UI.
- The local temporary path is handed to a registered share callback, which opens the system share sheet. The user picks the destination. pi-mob never generates a public link, never uploads the file to a remote service, and never reads or stores the bytes outside the temporary file.
- The temporary file is left to Android's normal temporary-directory lifecycle. pi-mob does not persist exports on the phone beyond this temporary copy.

### Notifications

Notifications are optional and only enabled when the host is configured with `--fcm-service-account` and the Android build contains the corresponding Firebase configuration. The handshake advertises `notifications.v1` only when a notification service is genuinely wired into the bridge; otherwise the phone shows a truthful "Notifications unavailable" state.

- The push token is registered with the bridge through the `notification.device.register` command and held alongside other device-install metadata in the durable store.
- Outbound payloads are status-only by default: a stable opaque `notificationId`, a `kind` (`settled`, `failed`, `indeterminate`, `needs_attention`, `crash_loop`), a deep link, an opaque metadata block restricted to a closed allowlist, and bounded title/body strings constructed from the status policy. Prompts, answers, source paths, repository content, credentials, and tool output are never included.
- Push delivery necessarily involves the configured push provider. Do not enable notifications when that external delivery path is unacceptable.

## Logs and diagnostics

Logs and fixtures must not contain:

- credentials or private keys;
- environment values;
- device or push tokens;
- private host paths;
- prompts, answers, transcripts, or source content;
- unbounded tool output;
- attachment or export bytes (or sha-256 digests tied to a specific user upload).

Operational diagnostics should use bounded categories, identifiers, counts, durations, and redacted failure information.

## Network exposure

The bridge binds to loopback and is intended to be reachable only through a private Tailscale Serve route. Public listeners and Tailscale Funnel are unsupported.

The mobile transport enforces a clean paired HTTPS origin (no path, no query, no fragment, no user info) before any upload or download.

Tailscale account, tailnet, device, DNS, and traffic handling remain subject to Tailscale's own configuration and policies.

## Deletion and retention

- Local app data is removed according to Android application-data behaviour, including uninstall or explicit clearing. The temporary export copy follows the Android temporary-directory lifecycle.
- Durable bridge state remains on the host until removed through lifecycle operations or direct host administration.
- Attachments and exports use host-managed bounded retention and sweep behaviour; their lifecycles are governed by the host's attachment and export stores, not the phone.
- Pi-owned sessions remain subject to Pi's own storage and deletion behaviour.

## User responsibilities

Protect the Mac, Android device, Tailscale account, tailnet membership, and host filesystem with appropriate operating-system controls. Review the export contents in the share-sheet preview before sharing it through a destination app; once a destination is chosen the export leaves the private network.

pi-mob does not provide cloud backup, public sharing links, multi-user authorization, or remote credential management.
