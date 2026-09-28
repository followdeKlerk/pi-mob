## Runtime

The normal daemon launches one supervised Pi RPC process per mobile session. Pi configuration, environment, session paths, and raw RPC remain on the host. The app communicates only through the stable bridge protocol.

## State and identity

Bridge session IDs are the mobile-facing identity. Pi session references are private to the bridge. The bridge persists commands and canonical events before delivery, so reconnect replay and live delivery share one ordered event stream.

## Recovery and boundaries

A restarted process is not assumed to have completed an in-flight action. Reconcile from Pi session history where possible; otherwise mark the outcome indeterminate and require explicit recovery. Keep request frames, output, attachments, and diagnostics bounded. Never expose host paths, credentials, or raw RPC to mobile clients.

## Capabilities and distribution

Advertise only capabilities constructed by the normal daemon and covered by the mobile path and integration tests. Main targets `0.0.3-alpha.1`; no matching release assets are published. The download history and verified capabilities are documented in [Project status](../../../docs/PROJECT_STATUS.md).
