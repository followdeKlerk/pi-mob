# Privacy

Pi Mob has no cloud backend. The bridge runs on the host, and the phone connects through private Tailscale Serve.

## Stored data

The host can store:

- OMP conversation history and host-private session references;
- bridge events, commands, leases, and device rows;
- bounded attachments and expiring HTML exports;
- the path to an optional Firebase service-account file.

The phone can store subscribed chat data, drafts, temporary files, the FCM token, and its installation credential in Android Keystore-backed storage.

Pi Mob has no analytics, telemetry, or crash reporting.

## Network traffic

Normal traffic uses the configured private Tailscale route. Operators control host and tailnet access.

When notifications are enabled, the bridge sends bounded status data to Firebase Cloud Messaging. Payloads contain routing fields and status text, not user prompts or replies.

## Authentication and deletion

Pairing identifies the endpoint. Enrollment creates a 256-bit installation credential. The bridge stores its SHA-256 hash, and the phone stores the plaintext credential in Android Keystore-backed storage.

Uninstalling the app removes app-owned data. The default bridge uninstall mode keeps the state directory. Use `--mode=remove_state` or `--mode=full` to remove it. OMP session data needs the separate `--remove-omp-session-dir=true` option.

## Report a concern

Use [GitHub private vulnerability reporting](../SECURITY.md). See [SECURITY.md](../SECURITY.md) for the reporting boundary.
