/// Mobile canonical session-event repository.
///
/// This module backs the canonical session-event log delivered by the bridge.
/// The repository is a pure cache
/// of canonical events plus a single last-applied-sequence row per
/// session. The cache is intentionally disposable: a `resetCache`
/// call clears the row set and the next synchronizer replay rebuilds
/// the projection from the backend canonical event log.
///
/// Implementation notes:
///   * The repository uses raw `sqlite3` access (no Drift query
///     builder) because the schema is local to this file and the
///     rewrite slice deliberately avoids regenerating
///     `app_database.g.dart`. Drift's executor would also require a
///     `QueryExecutorUser` shim just to call `runCustom`.
///   * One repository instance per session. Construction is cheap
///     (the SQLite `Database` handle is the only persistent state).
///   * All writes use `INSERT OR IGNORE` on the unique `(session_id,
///     sequence)` index so a duplicate replay never produces a
///     duplicate row.
///
/// Schema:
///   * `canonical_session_events(row_id PK, event_id UNIQUE,
///     session_id, sequence, type, occurred_at, payload_json,
///     stored_at)`
///   * `canonical_session_sequence(session_id PK, last_sequence,
///     last_event_id, updated_at)`
library;

import 'dart:async';
import 'dart:convert';

import 'package:sqlite3/sqlite3.dart';

import 'canonical_event.dart';

class CanonicalEventRepository {
  CanonicalEventRepository({
    required this.sessionId,
    required Database database,
  }) : _db = database,
       _ownsDatabase = false;

  /// Convenience constructor used by tests. The repository owns the
  /// in-memory database and closes it on [close].
  factory CanonicalEventRepository.inMemory(String sessionId) =>
      CanonicalEventRepository._owning(
        sessionId: sessionId,
        database: sqlite3.openInMemory(),
      );

  CanonicalEventRepository._owning({
    required this.sessionId,
    required Database database,
  }) : _db = database,
       _ownsDatabase = true;

  final String sessionId;
  final Database _db;
  final bool _ownsDatabase;
  bool _schemaReady = false;

  /// Ensures the canonical event schema exists. Safe to call from
  /// beforeOpen on a host app database; the underlying `CREATE TABLE
  /// IF NOT EXISTS` statement is idempotent.
  Future<void> ensureSchema() async {
    if (_schemaReady) return;
    _exec(
      'CREATE TABLE IF NOT EXISTS canonical_session_events('
      'row_id INTEGER PRIMARY KEY AUTOINCREMENT,'
      'event_id TEXT NOT NULL,'
      'session_id TEXT NOT NULL,'
      'sequence INTEGER NOT NULL,'
      'type TEXT NOT NULL,'
      'occurred_at TEXT NOT NULL,'
      'payload_json TEXT NOT NULL,'
      'stored_at TEXT NOT NULL'
      ')',
    );
    _exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS canonical_session_events_seq '
      'ON canonical_session_events(session_id, sequence)',
    );
    _exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS canonical_session_events_id '
      'ON canonical_session_events(event_id)',
    );
    _exec(
      'CREATE TABLE IF NOT EXISTS canonical_session_sequence('
      'session_id TEXT PRIMARY KEY,'
      'last_sequence INTEGER NOT NULL,'
      'last_event_id TEXT NOT NULL,'
      'updated_at TEXT NOT NULL'
      ')',
    );
    _schemaReady = true;
  }

  /// Persists one canonical event to the durable cache. Returns the
  /// stored event with the assigned row id. The write is idempotent
  /// on `(session_id, sequence)`: a duplicate sequence for the same
  /// session returns the existing row without modification.
  Future<StoredCanonicalEvent?> lookupBySequence(int sequence) async {
    await ensureSchema();
    final rows = _db.select(
      'SELECT row_id, event_id, session_id, sequence, type, occurred_at, '
      'payload_json FROM canonical_session_events '
      'WHERE session_id = ? AND sequence = ? LIMIT 1',
      <Object?>[sessionId, sequence],
    );
    if (rows.isEmpty) return null;
    return _toStored(rows.first);
  }

  Future<StoredCanonicalEvent> append(CanonicalSessionEvent event) async {
    if (event.sessionId != sessionId) {
      throw ArgumentError.value(
        event.sessionId,
        'event.sessionId',
        'wrong session',
      );
    }
    await ensureSchema();
    final existing = await lookupBySequence(event.sequence);
    if (existing != null) {
      return existing;
    }
    final storedAt = DateTime.now().toUtc().toIso8601String();
    _db.execute(
      'INSERT OR IGNORE INTO canonical_session_events'
      '(event_id, session_id, sequence, type, occurred_at, payload_json, stored_at) '
      'VALUES(?, ?, ?, ?, ?, ?, ?)',
      <Object?>[
        event.eventId,
        event.sessionId,
        event.sequence,
        event.type.name,
        event.occurredAt.toUtc().toIso8601String(),
        jsonEncode(event.payload),
        storedAt,
      ],
    );
    _db.execute(
      'INSERT INTO canonical_session_sequence'
      '(session_id, last_sequence, last_event_id, updated_at) '
      'VALUES(?, ?, ?, ?) '
      'ON CONFLICT(session_id) DO UPDATE SET '
      'last_sequence = MAX(canonical_session_sequence.last_sequence, excluded.last_sequence), '
      'last_event_id = CASE WHEN excluded.last_sequence >= canonical_session_sequence.last_sequence '
      'THEN excluded.last_event_id ELSE canonical_session_sequence.last_event_id END, '
      'updated_at = excluded.updated_at',
      <Object?>[event.sessionId, event.sequence, event.eventId, storedAt],
    );
    final inserted = await lookupBySequence(event.sequence);
    if (inserted == null) {
      throw StateError('canonical_session_events insert did not return row_id');
    }
    return inserted;
  }

  /// Returns every cached event with `sequence > after`, in strict
  /// ascending sequence order.
  Future<List<StoredCanonicalEvent>> readAfter(int after, {int? limit}) async {
    await ensureSchema();
    final cap = limit ?? 1024;
    final rows = _db.select(
      'SELECT row_id, event_id, session_id, sequence, type, occurred_at, '
      'payload_json FROM canonical_session_events '
      'WHERE session_id = ? AND sequence > ? '
      'ORDER BY sequence ASC LIMIT ?',
      <Object?>[sessionId, after, cap],
    );
    return rows.map(_toStored).toList(growable: false);
  }

  /// Returns the highest sequence the repository has durably stored
  /// for this session. Zero when no canonical events have been
  /// observed yet.
  Future<int> latestSequence() async {
    await ensureSchema();
    final rows = _db.select(
      'SELECT last_sequence FROM canonical_session_sequence WHERE session_id = ?',
      <Object?>[sessionId],
    );
    if (rows.isEmpty) return 0;
    return rows.first['last_sequence']! as int;
  }

  /// Drops every canonical event row for this session. The
  /// synchronizer calls this after detecting a gap or protocol error
  /// so the next replay rebuilds the projection from the backend.
  Future<void> resetCache() async {
    await ensureSchema();
    _db.execute(
      'DELETE FROM canonical_session_events WHERE session_id = ?',
      <Object?>[sessionId],
    );
    _db.execute(
      'DELETE FROM canonical_session_sequence WHERE session_id = ?',
      <Object?>[sessionId],
    );
  }

  /// Total cached event count. Useful for diagnostics and tests.
  Future<int> count() async {
    await ensureSchema();
    final rows = _db.select(
      'SELECT COUNT(*) AS c FROM canonical_session_events WHERE session_id = ?',
      <Object?>[sessionId],
    );
    return rows.first['c']! as int;
  }

  /// Closes the underlying SQLite handle when the repository owns it.
  /// No-op for repositories constructed with an external Database.
  Future<void> close() async {
    if (_ownsDatabase) {
      try {
        _db.close();
      } catch (_) {
        // best-effort close
      }
    }
  }

  void _exec(String sql) => _db.execute(sql);

  StoredCanonicalEvent _toStored(Row row) {
    final payloadJson = row['payload_json']! as String;
    final payload = jsonDecode(payloadJson);
    Map<String, Object?> payloadMap;
    if (payload is Map) {
      payloadMap = Map<String, Object?>.from(payload);
    } else {
      payloadMap = const <String, Object?>{};
    }
    final event = CanonicalSessionEvent(
      eventId: row['event_id']! as String,
      sessionId: row['session_id']! as String,
      sequence: row['sequence']! as int,
      type: _typeFromName(row['type']! as String),
      occurredAt: DateTime.parse(row['occurred_at']! as String).toUtc(),
      payload: payloadMap,
    );
    return StoredCanonicalEvent(rowId: row['row_id']! as int, event: event);
  }

  CanonicalEventType _typeFromName(String name) {
    for (final value in CanonicalEventType.values) {
      if (value.name == name) return value;
    }
    throw StateError('unknown canonical event type in cache: $name');
  }
}

/// In-memory representation of a stored canonical event. The reducer
/// uses only the `event`; the row id is included for diagnostic
/// messages.
class StoredCanonicalEvent {
  const StoredCanonicalEvent({required this.rowId, required this.event});

  final int rowId;
  final CanonicalSessionEvent event;
}
