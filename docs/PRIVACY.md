# Privacy

Pi Mob has no application cloud backend. The supported setup runs the bridge on your host and connects the phone through private Tailscale Serve.

## Stored data

The host can store:

- OMP conversation history and host-private session references;
- bridge events, commands, leases, and registered-device rows;
- bounded JPEG or PNG attachments in `<state-dir>/attachments`;
- expiring HTML exports in `<state-dir>/exports`;
- the path to an optional Firebase service account.

The phone can store:

- subscribed chat data and drafts;
- attachments in flight and temporary exports;
- the FCM token;
- the installation credential in Android Keystore-backed storage.

Pi Mob does not include third-party analytics, telemetry, or crash reporting.

## Network traffic

Normal bridge and mobile traffic uses the configured private Tailscale route. Operators remain responsible for host and tailnet access controls. Public exposure is unsupported.

When notifications are enabled, the bridge contacts Google's OAuth and Firebase Cloud Messaging endpoints. FCM receives bounded status copy and these routing fields:

- `sessionId`
- `notificationId`
- `kind`
- `deepLink`
- `hostDisplayName`

The implementation does not put user-authored prompts or replies in FCM payloads. The host display name can identify a workspace.

## Authentication

Pairing pins the endpoint. Enrollment creates a 256-bit per-installation credential that authorizes the phone.

The bridge stores the credential as a SHA-256 hash. The phone stores the plaintext value in Android Keystore-backed storage. Application logs, fixtures, and generated reports are designed to exclude it.

The WebSocket, attachments, exports, and device registration authenticate the installation. The host operator can revoke it with `pi-mob revoke-installation`.

## Deletion

Forgetting a host removes that host's mobile cache, address, and credential. Android uninstall removes app-owned local data. A host-side device row can remain until FCM failure or operator cleanup.

The default bridge uninstall mode retains the state directory. Use `--mode=remove_state` or `--mode=full` to remove bridge state. OMP session data remains unless you also pass `--remove-omp-session-dir=true`.

Review the command output before deletion and keep a protected backup when recovery is necessary.

## Report a concern

Use GitHub private vulnerability reporting. See [SECURITY.md](../SECURITY.md).
