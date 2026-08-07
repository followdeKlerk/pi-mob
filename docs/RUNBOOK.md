# Pi Mob Runbook

## Canonical session events

The canonical transcript is stored in `canonical_session_events` in the bridge state database. The mobile app applies replay and live events by sequence.

Before a backup or repair:

1. Stop the bridge daemon.
2. Copy the state directory to a protected location.
3. Do not copy credentials, private endpoints, transcripts, or raw Pi payloads into tickets.

## Sequence gaps

A `complete: false` replay or a mobile sequence-gap diagnostic means the client must request replay from its last applied sequence. If the cursor is older than retained data, restore the bridge database backup and reconnect the mobile app.

## Integrity checks

The canonical store has an internal, read-only integrity check for session sequence metadata and payload JSON. There is not yet a supported operator CLI for this check. Until one exists, use `PRAGMA integrity_check;` with the bridge stopped, and treat any failure as a repair incident. Do not delete or rewrite rows before making a backup.

## Bounded legacy maintenance

`compactLegacyEvents` removes acknowledged legacy rows in bounded transactions. Each batch is limited to 1,000 rows and 4 MiB. The daemon uses only acknowledgements from non-revoked, non-expired installation credentials. It never removes rows from `canonical_session_events`.

The daemon starts this maintenance after it binds the listener. It waits 25 ms between progressing batches and 15 minutes when no progress is possible. Failures go to the redacting logger and do not disconnect healthy clients. Look for the `legacy-event-compaction` diagnostic or `legacy-event-compaction-failed` log event when investigating retention.
## Diagnostics

Raw Pi notifications are support diagnostics only. They do not determine transcript state. Export only sanitized counts and event-type summaries unless a support procedure explicitly requires a protected payload export.

The diagnostics database is separate from the canonical event database. If it cannot open, the bridge can continue, but the condition must be recorded and repaired before investigating event-shape problems.

## Storage and retention

There is no automatic canonical-event retention job yet. Keep the state database and backups until a supported retention policy exists. Do not remove rows while a client may still use its sequence cursor. After an approved migration, clients must perform a full session rebuild from an approved backup or migration source.

## Migration status

The canonical transcript path is the released mobile authority. Legacy mobile caches/history synchronization and the bridge recipe projection remain for compatibility. Do not remove these paths or their tables until parity tests and older-host migration coverage are complete.
