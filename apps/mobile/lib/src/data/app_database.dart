import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';
import 'package:uuid/uuid.dart';

import '../domain/attachments.dart';
import '../domain/mobile_state.dart' hide StreamCursor;
import '../domain/session_tree.dart';

part 'app_database.g.dart';

/// Mobile installation metadata. One row per installation.
class MetadataEntries extends Table {
  TextColumn get installationId => text()();
  TextColumn get platform => text()();
  TextColumn get appVersion => text()();
  IntColumn get protocolMajor => integer()();
  IntColumn get protocolMinor => integer()();
  DateTimeColumn get firstSeenAt => dateTime()();
  DateTimeColumn get lastSeenAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {installationId};
}

/// Paired hosts with stable host ID and mutable generation.
class HostEntries extends Table {
  TextColumn get hostId => text()();
  TextColumn get endpoint => text()();
  TextColumn get displayName => text()();
  TextColumn get generation => text()();
  TextColumn get connectionState => text()();
  TextColumn get bridgeVersion => text().nullable()();
  TextColumn get piVersion => text().nullable()();
  TextColumn get protocolVersion => text().nullable()();
  TextColumn get capabilitiesJson => text()();
  DateTimeColumn get lastSeenAt => dateTime().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {hostId};
}

/// Per-stream cursor (last contiguous, host generation aware).
class StreamCursors extends Table {
  TextColumn get streamId => text()();
  TextColumn get hostId => text()();
  TextColumn get lastContiguousCursor => text()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {streamId};
}

/// Session summary cache (no Pi paths).
class SessionEntries extends Table {
  TextColumn get sessionId => text()();
  TextColumn get hostId => text()();
  TextColumn get workspaceId => text().nullable()();
  TextColumn get name => text()();
  TextColumn get runtimeState => text()();
  TextColumn get policyMode => text().nullable()();
  TextColumn get modelSummary => text().nullable()();
  TextColumn get thinkingLevel => text().nullable()();
  IntColumn get queueCount => integer().withDefault(const Constant(0))();
  DateTimeColumn get lastActivityAt => dateTime().nullable()();
  TextColumn get unreadState => text().nullable()();
  TextColumn get controllerState => text().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {sessionId};
}

/// Rolling normalized journal cache. Cursors stored as canonical decimal strings
/// so values above JavaScript-safe integers remain exact.
class CachedEvents extends Table {
  TextColumn get eventId => text()();
  TextColumn get hostId => text()();
  TextColumn get streamId => text()();
  TextColumn get cursor => text()();
  TextColumn get type => text()();
  TextColumn get payloadJson => text()();
  DateTimeColumn get occurredAt => dateTime()();
  DateTimeColumn get storedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {eventId};

  @override
  List<Set<Column<Object>>> get uniqueKeys => [
    {streamId, cursor},
  ];
}

/// Snapshot cache keyed by stream ID. Snapshots replace the live cache
/// atomically and are kept bounded.
class SnapshotEntries extends Table {
  TextColumn get streamId => text()();
  TextColumn get hostId => text()();
  TextColumn get baselineCursor => text()();
  TextColumn get snapshotId => text()();
  TextColumn get payloadJson => text()();
  DateTimeColumn get receivedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {streamId};
}

/// Unsent drafts persist across host generation resets and app restarts.
class DraftEntries extends Table {
  TextColumn get hostId => text()();
  TextColumn get sessionId => text()();
  TextColumn get draftText => text().withDefault(const Constant(''))();
  TextColumn get localAttachmentRefsJson =>
      text().withDefault(const Constant('[]'))();
  TextColumn get selectedDeliveryMode => text().nullable()();
  TextColumn get pendingCommandId => text().nullable()();
  TextColumn get pendingPayloadJson => text().nullable()();
  TextColumn get pendingState => text().nullable()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {hostId, sessionId};
}

@DriftDatabase(
  tables: [
    MetadataEntries,
    HostEntries,
    StreamCursors,
    SessionEntries,
    CachedEvents,
    SnapshotEntries,
    DraftEntries,
  ],
)
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(_openConnection());

  AppDatabase.withExecutor(super.executor);

  @override
  int get schemaVersion => 1;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (m) async {
      await m.createAll();
    },
    beforeOpen: (details) async {
      await customStatement('PRAGMA foreign_keys = ON');
      await _ensureM11Schema();
      await _ensureM12Schema();
      await _ensureM13Schema();
      await _ensureHistorySyncSchema();
      if (details.wasCreated) {
        await batch((b) {
          b.insert(
            metadataEntries,
            MetadataEntriesCompanion.insert(
              installationId: _bootstrapInstallationId(),
              platform: 'unknown',
              appVersion: '0.0.0',
              protocolMajor: 1,
              protocolMinor: 0,
              firstSeenAt: DateTime.now().toUtc(),
              lastSeenAt: DateTime.now().toUtc(),
            ),
          );
        });
      }
    },
  );

  /// Persists a host and atomically preserves drafts.
  Future<void> upsertHost(HostEntriesCompanion host) async {
    await transaction(() async {
      await into(hostEntries).insertOnConflictUpdate(host);
    });
  }

  /// Replaces every host-generated record (cursors, cached events, snapshots,
  /// session summaries) but keeps drafts. Drafts survive host generation reset.
  Future<void> resetHostCaches(String hostId) async {
    await transaction(() async {
      await (delete(
        cachedEvents,
      )..where((row) => row.hostId.equals(hostId))).go();
      await (delete(
        streamCursors,
      )..where((row) => row.hostId.equals(hostId))).go();
      await (delete(
        snapshotEntries,
      )..where((row) => row.hostId.equals(hostId))).go();
      await (delete(
        sessionEntries,
      )..where((row) => row.hostId.equals(hostId))).go();
      await resetM11Caches(hostId);
      await resetM12Caches(hostId);
      await resetM13Caches(hostId);
      await customStatement(
        'DELETE FROM session_history_sync WHERE host_id = ?',
        [hostId],
      );
    });
  }

  /// Deletes the host row itself. Use this for explicit forget-host actions;
  /// the cached host records must be cleared first via [resetHostCaches] so
  /// the transaction is consistent.
  Future<void> deleteHost(String hostId) async {
    await (delete(hostEntries)..where((row) => row.hostId.equals(hostId))).go();
  }

  /// Quarantines commands accepted under an old host generation while keeping
  /// the user's draft text available for deliberate resubmission.
  Future<void> quarantinePendingCommands(String hostId) async {
    await transaction(() async {
      await (update(
        draftEntries,
      )..where((row) => row.hostId.equals(hostId))).write(
        const DraftEntriesCompanion(
          pendingCommandId: Value(null),
          pendingPayloadJson: Value(null),
          pendingState: Value(null),
        ),
      );
    });
  }

  /// Atomic snapshot replacement: drop cached events at or below baseline and
  /// write the new snapshot. Returns true on success.
  Future<bool> replaceWithSnapshot({
    required String streamId,
    required String hostId,
    required String baselineCursor,
    required String snapshotId,
    required String payloadJson,
    required DateTime receivedAt,
  }) async {
    return transaction(() async {
      // A snapshot replaces the reconstructible stream cache. Cursor values
      // remain decimal text because they may exceed SQLite's signed int64.
      await (delete(
        cachedEvents,
      )..where((row) => row.streamId.equals(streamId))).go();
      await into(snapshotEntries).insertOnConflictUpdate(
        SnapshotEntriesCompanion.insert(
          streamId: streamId,
          hostId: hostId,
          baselineCursor: baselineCursor,
          snapshotId: snapshotId,
          payloadJson: payloadJson,
          receivedAt: receivedAt,
        ),
      );
      await into(streamCursors).insertOnConflictUpdate(
        StreamCursorsCompanion.insert(
          streamId: streamId,
          hostId: hostId,
          lastContiguousCursor: baselineCursor,
          updatedAt: receivedAt,
        ),
      );
      return true;
    });
  }

  /// Inserts a journal event, rejecting duplicates. The unique constraint
  /// (streamId, cursor) prevents duplicate rows even under racing writers.
  Future<int> insertEvent({
    required String eventId,
    required String hostId,
    required String streamId,
    required String cursor,
    required String type,
    required String payloadJson,
    required DateTime occurredAt,
  }) async {
    return into(cachedEvents).insert(
      CachedEventsCompanion.insert(
        eventId: eventId,
        hostId: hostId,
        streamId: streamId,
        cursor: cursor,
        type: type,
        payloadJson: payloadJson,
        occurredAt: occurredAt,
        storedAt: DateTime.now().toUtc(),
      ),
      mode: InsertMode.insertOrIgnore,
    );
  }

  /// Inserts one history page in a single transaction. History rows do not
  /// advance the live stream cursor until the complete page chain is durable.
  Future<void> insertHistoryEvents(Iterable<StreamEventState> events) async {
    final values = events
        .map(
          (event) => CachedEventsCompanion.insert(
            eventId: event.eventId,
            hostId: event.hostId,
            streamId: event.streamId,
            cursor: event.cursor.value,
            type: event.type,
            payloadJson: event.payloadJson,
            occurredAt: event.occurredAt,
            storedAt: DateTime.now().toUtc(),
          ),
        )
        .toList(growable: false);
    if (values.isEmpty) return;
    await batch((batch) {
      batch.insertAll(
        cachedEvents,
        values,
        mode: InsertMode.insertOrIgnore,
      );
    });
  }

  /// Advances the last-contiguous cursor for a stream iff the event extended it.
  Future<void> advanceCursor({
    required String streamId,
    required String hostId,
    required String cursor,
  }) async {
    await transaction(() async {
      final existing = await (select(
        streamCursors,
      )..where((row) => row.streamId.equals(streamId))).getSingleOrNull();
      final incoming = BigInt.parse(cursor);
      final current = existing == null
          ? BigInt.zero
          : BigInt.parse(existing.lastContiguousCursor);
      if (existing == null || current < incoming) {
        await into(streamCursors).insertOnConflictUpdate(
          StreamCursorsCompanion.insert(
            streamId: streamId,
            hostId: hostId,
            lastContiguousCursor: cursor,
            updatedAt: DateTime.now().toUtc(),
          ),
        );
      }
    });
  }

  /// Inserts an event and advances its cursor in one local transaction.
  Future<void> persistEvent(StreamEventState event) async {
    await transaction(() async {
      await into(cachedEvents).insert(
        CachedEventsCompanion.insert(
          eventId: event.eventId,
          hostId: event.hostId,
          streamId: event.streamId,
          cursor: event.cursor.value,
          type: event.type,
          payloadJson: event.payloadJson,
          occurredAt: event.occurredAt,
          storedAt: DateTime.now().toUtc(),
        ),
        mode: InsertMode.insertOrIgnore,
      );
      await into(streamCursors).insertOnConflictUpdate(
        StreamCursorsCompanion.insert(
          streamId: event.streamId,
          hostId: event.hostId,
          lastContiguousCursor: event.cursor.value,
          updatedAt: DateTime.now().toUtc(),
        ),
      );

      // Keep complete local transcripts for normal sessions while retaining a
      // high defensive ceiling for pathological streams.
      final old =
          await (select(cachedEvents)
                ..where((row) => row.streamId.equals(event.streamId))
                ..orderBy([(row) => OrderingTerm.desc(row.storedAt)])
                ..limit(100000, offset: 100000))
              .get();
      if (old.isNotEmpty) {
        await (delete(
          cachedEvents,
        )..where((row) => row.eventId.isIn(old.map((e) => e.eventId)))).go();
      }
    });
  }

  Future<void> upsertSessionState(SessionState session) async {
    await into(sessionEntries).insertOnConflictUpdate(
      SessionEntriesCompanion.insert(
        sessionId: session.sessionId,
        hostId: session.hostId,
        workspaceId: Value(session.workspaceId),
        name: session.name,
        runtimeState: session.runtimeState,
        policyMode: Value(session.policyMode),
        modelSummary: Value(session.modelSummary),
        thinkingLevel: Value(session.thinkingLevel),
        queueCount: Value(session.queueCount),
        lastActivityAt: Value(session.lastActivityAt),
        unreadState: Value(session.unreadState),
        controllerState: Value(session.controllerState),
      ),
    );
  }

  Future<void> saveDraft({
    required String hostId,
    required String sessionId,
    required String text,
    required String? pendingCommandId,
    required String? pendingPayloadJson,
    required String? pendingState,
    required DateTime updatedAt,
    DeliveryMode? selectedDeliveryMode,
    List<String> localAttachmentRefsJson = const <String>[],
  }) async {
    await into(draftEntries).insertOnConflictUpdate(
      DraftEntriesCompanion.insert(
        hostId: hostId,
        sessionId: sessionId,
        draftText: Value(text),
        localAttachmentRefsJson: Value(jsonEncode(localAttachmentRefsJson)),
        selectedDeliveryMode: selectedDeliveryMode == null
            ? const Value.absent()
            : Value(deliveryModeWire(selectedDeliveryMode)),
        pendingCommandId: Value(pendingCommandId),
        pendingPayloadJson: Value(pendingPayloadJson),
        pendingState: Value(pendingState),
        updatedAt: updatedAt,
      ),
    );
  }

  Future<String?> cursor(String streamId) async =>
      (await (select(
            streamCursors,
          )..where((row) => row.streamId.equals(streamId))).getSingleOrNull())
          ?.lastContiguousCursor;

  Future<DraftEntry?> draft(String hostId, String sessionId) =>
      (select(draftEntries)..where(
            (row) =>
                row.hostId.equals(hostId) & row.sessionId.equals(sessionId),
          ))
          .getSingleOrNull();

  Future<List<StreamCursor>> cursorsForHost(String hostId) =>
      (select(streamCursors)..where((row) => row.hostId.equals(hostId))).get();

  Future<List<CachedEvent>> eventsForHost(String hostId) =>
      (select(cachedEvents)
            ..where((row) => row.hostId.equals(hostId))
            ..orderBy([(row) => OrderingTerm.asc(row.storedAt)]))
          .get();

  Future<List<SnapshotEntry>> snapshotsForHost(String hostId) => (select(
    snapshotEntries,
  )..where((row) => row.hostId.equals(hostId))).get();

  Future<String> installationIdentifier() async =>
      (await (select(metadataEntries)..limit(1)).getSingle()).installationId;

  Future<List<HostEntry>> allHosts() => select(hostEntries).get();
  Future<List<SessionEntry>> allSessions() => select(sessionEntries).get();
  Future<List<DraftEntry>> allDrafts() => select(draftEntries).get();

  Future<void> _ensureHistorySyncSchema() async {
    await customStatement('''
      CREATE TABLE IF NOT EXISTS session_history_sync (
        host_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        snapshot_revision TEXT NOT NULL,
        completed_at INTEGER NOT NULL,
        PRIMARY KEY (host_id, session_id)
      )
    ''');
  }

  Future<String?> historySyncRevision(String hostId, String sessionId) async {
    final row = await customSelect(
      'SELECT snapshot_revision FROM session_history_sync '
      'WHERE host_id = ? AND session_id = ?',
      variables: [Variable<String>(hostId), Variable<String>(sessionId)],
    ).getSingleOrNull();
    return row?.read<String>('snapshot_revision');
  }

  Future<void> saveHistorySyncRevision({
    required String hostId,
    required String sessionId,
    required String snapshotRevision,
  }) async {
    await customStatement(
      'INSERT INTO session_history_sync '
      '(host_id, session_id, snapshot_revision, completed_at) '
      'VALUES (?, ?, ?, ?) ON CONFLICT(host_id, session_id) DO UPDATE SET '
      'snapshot_revision = excluded.snapshot_revision, '
      'completed_at = excluded.completed_at',
      [hostId, sessionId, snapshotRevision, DateTime.now().toUtc().millisecondsSinceEpoch],
    );
  }

  // ---------------------------------------------------------------------
  // M11 multi-session support: per-session controller state, attention
  // badges, and the active subscription set. Implemented as raw SQL so the
  // generated .g.dart file does not need to be regenerated for the new
  // tables; the table layout is created lazily in `beforeOpen` below.
  // ---------------------------------------------------------------------

  static const String kCreateControllerStates = '''
    CREATE TABLE IF NOT EXISTS controller_states (
      host_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      lease_id TEXT,
      previous_mode TEXT NOT NULL,
      takeover_pending INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (host_id, session_id)
    )
  ''';

  static const String kCreateAttentionStates = '''
    CREATE TABLE IF NOT EXISTS attention_states (
      host_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      state TEXT NOT NULL,
      unread_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (host_id, session_id)
    )
  ''';

  static const String kCreateSubscriptionSet = '''
    CREATE TABLE IF NOT EXISTS subscription_set (
      host_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      stream_id TEXT NOT NULL,
      detail TEXT NOT NULL,
      cursor TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (host_id, session_id)
    )
  ''';

  Future<void> _ensureM11Schema() async {
    await customStatement(kCreateControllerStates);
    await customStatement(kCreateAttentionStates);
    await customStatement(kCreateSubscriptionSet);
  }

  /// Upserts one per-session controller state row.
  Future<void> upsertControllerState({
    required String hostId,
    required String sessionId,
    required String mode,
    required String? leaseId,
    required String previousMode,
    required bool takeoverPending,
    required DateTime updatedAt,
  }) async {
    await customStatement(
      'INSERT OR REPLACE INTO controller_states '
      '(host_id, session_id, mode, lease_id, previous_mode, '
      'takeover_pending, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      <Object?>[
        hostId,
        sessionId,
        mode,
        leaseId,
        previousMode,
        takeoverPending ? 1 : 0,
        updatedAt.toUtc().toIso8601String(),
      ],
    );
  }

  Future<List<Map<String, Object?>>> controllerStatesFor(String hostId) async {
    return customSelect(
      'SELECT session_id, mode, lease_id, previous_mode, takeover_pending, '
      'updated_at FROM controller_states WHERE host_id = ?',
      variables: [Variable.withString(hostId)],
    ).get().then(
      (rows) => rows
          .map(
            (row) => <String, Object?>{
              'sessionId': row.read<String>('session_id'),
              'mode': row.read<String>('mode'),
              'leaseId': row.readNullable<String>('lease_id'),
              'previousMode': row.read<String>('previous_mode'),
              'takeoverPending': row.read<int>('takeover_pending') == 1,
              'updatedAt': row.read<String>('updated_at'),
            },
          )
          .toList(growable: false),
    );
  }

  /// Upserts one attention row. The `state` is the wire value
  /// (`none`, `unread`, `needs_attention`, `background`).
  Future<void> upsertAttentionState({
    required String hostId,
    required String sessionId,
    required String state,
    required int unreadCount,
    required DateTime updatedAt,
  }) async {
    await customStatement(
      'INSERT OR REPLACE INTO attention_states '
      '(host_id, session_id, state, unread_count, updated_at) '
      'VALUES (?, ?, ?, ?, ?)',
      <Object?>[
        hostId,
        sessionId,
        state,
        unreadCount,
        updatedAt.toUtc().toIso8601String(),
      ],
    );
  }

  Future<List<Map<String, Object?>>> attentionStatesFor(String hostId) async {
    return customSelect(
      'SELECT session_id, state, unread_count, updated_at '
      'FROM attention_states WHERE host_id = ?',
      variables: [Variable.withString(hostId)],
    ).get().then(
      (rows) => rows
          .map(
            (row) => <String, Object?>{
              'sessionId': row.read<String>('session_id'),
              'state': row.read<String>('state'),
              'unreadCount': row.read<int>('unread_count'),
              'updatedAt': row.read<String>('updated_at'),
            },
          )
          .toList(growable: false),
    );
  }

  /// Replaces the entire subscription set for the host atomically.
  Future<void> replaceSubscriptionSet({
    required String hostId,
    required List<Map<String, Object?>> entries,
  }) async {
    await transaction(() async {
      await customStatement(
        'DELETE FROM subscription_set WHERE host_id = ?',
        <Object?>[hostId],
      );
      for (var i = 0; i < entries.length; i++) {
        final row = entries[i];
        await customStatement(
          'INSERT INTO subscription_set '
          '(host_id, session_id, stream_id, detail, cursor, position) '
          'VALUES (?, ?, ?, ?, ?, ?)',
          <Object?>[
            hostId,
            row['sessionId'],
            row['streamId'],
            row['detail'],
            row['cursor'],
            i,
          ],
        );
      }
    });
  }

  Future<List<Map<String, Object?>>> subscriptionSetFor(String hostId) async {
    return customSelect(
      'SELECT session_id, stream_id, detail, cursor, position '
      'FROM subscription_set WHERE host_id = ? ORDER BY position ASC',
      variables: [Variable.withString(hostId)],
    ).get().then(
      (rows) => rows
          .map(
            (row) => <String, Object?>{
              'sessionId': row.read<String>('session_id'),
              'streamId': row.read<String>('stream_id'),
              'detail': row.read<String>('detail'),
              'cursor': row.read<String>('cursor'),
            },
          )
          .toList(growable: false),
    );
  }

  Future<void> _ensureM13Schema() async {
    await customStatement('''
      CREATE TABLE IF NOT EXISTS local_attachments (
        host_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        attachment_id TEXT NOT NULL,
        ref_json TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        PRIMARY KEY(host_id, session_id, attachment_id)
      )
    ''');
  }

  Future<void> upsertLocalAttachment({
    required String hostId,
    required String sessionId,
    required AttachmentRef ref,
    required int orderIndex,
  }) async {
    await _ensureM13Schema();
    await customStatement(
      'INSERT OR REPLACE INTO local_attachments(host_id,session_id,attachment_id,ref_json,order_index) VALUES(?,?,?,?,?)',
      <Object?>[
        hostId,
        sessionId,
        ref.id,
        jsonEncode(ref.toJson()),
        orderIndex,
      ],
    );
  }

  Future<List<AttachmentRef>> localAttachmentsFor({
    required String hostId,
    required String sessionId,
  }) async {
    await _ensureM13Schema();
    final rows = await customSelect(
      'SELECT ref_json FROM local_attachments WHERE host_id=? AND session_id=? ORDER BY order_index',
      variables: [Variable.withString(hostId), Variable.withString(sessionId)],
    ).get();
    return rows
        .map(
          (row) => AttachmentRef.fromJson(
            Map<String, Object?>.from(
              jsonDecode(row.read<String>('ref_json')) as Map,
            ),
          ),
        )
        .toList(growable: false);
  }

  Future<void> removeLocalAttachmentsForSession({
    required String hostId,
    required String sessionId,
  }) async {
    await _ensureM13Schema();
    await customStatement(
      'DELETE FROM local_attachments WHERE host_id=? AND session_id=?',
      <Object?>[hostId, sessionId],
    );
  }

  Future<void> resetM13Caches(String hostId) async {
    await _ensureM13Schema();
    await customStatement(
      'DELETE FROM local_attachments WHERE host_id=?',
      <Object?>[hostId],
    );
  }

  Future<void> _ensureM12Schema() async {
    await customStatement('''
      CREATE TABLE IF NOT EXISTS session_tree_nodes (
        host_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        name TEXT NOT NULL,
        parent_session_id TEXT,
        fork_origin_entry_id TEXT,
        lineage TEXT NOT NULL,
        lifecycle TEXT NOT NULL,
        deleted_at TEXT,
        purge_after TEXT,
        repair_reason TEXT,
        PRIMARY KEY(host_id, session_id)
      )
    ''');
    await customStatement(
      'CREATE INDEX IF NOT EXISTS session_tree_parent_idx ON session_tree_nodes(host_id,parent_session_id)',
    );
  }

  Future<void> upsertSessionTreeNode({
    required String hostId,
    required SessionTreeNode node,
  }) async {
    await _ensureM12Schema();
    await customStatement(
      'INSERT OR REPLACE INTO session_tree_nodes(host_id,session_id,name,parent_session_id,fork_origin_entry_id,lineage,lifecycle,deleted_at,purge_after,repair_reason) VALUES(?,?,?,?,?,?,?,?,?,?)',
      <Object?>[
        hostId,
        node.sessionId,
        node.name,
        node.parentSessionId,
        node.forkOriginEntryId,
        node.lineage.name,
        node.lifecycle.name,
        node.deletedAt?.toUtc().toIso8601String(),
        node.purgeAfter?.toUtc().toIso8601String(),
        node.repairReason,
      ],
    );
  }

  Future<List<SessionTreeNode>> sessionTreeNodes(String hostId) async {
    await _ensureM12Schema();
    return customSelect(
      'SELECT session_id,name,parent_session_id,fork_origin_entry_id,lineage,lifecycle,deleted_at,purge_after,repair_reason FROM session_tree_nodes WHERE host_id=?',
      variables: [Variable.withString(hostId)],
    ).get().then(
      (rows) => rows
          .map(
            (row) => SessionTreeNode(
              sessionId: row.read<String>('session_id'),
              name: row.read<String>('name'),
              parentSessionId: row.readNullable<String>('parent_session_id'),
              forkOriginEntryId: row.readNullable<String>(
                'fork_origin_entry_id',
              ),
              lineage: SessionLineageKind.values.byName(
                row.read<String>('lineage'),
              ),
              lifecycle: SessionLifecycleState.values.byName(
                row.read<String>('lifecycle'),
              ),
              deletedAt: DateTime.tryParse(
                row.readNullable<String>('deleted_at') ?? '',
              ),
              purgeAfter: DateTime.tryParse(
                row.readNullable<String>('purge_after') ?? '',
              ),
              repairReason: row.readNullable<String>('repair_reason'),
            ),
          )
          .toList(growable: false),
    );
  }

  Future<void> resetM12Caches(String hostId) async {
    await _ensureM12Schema();
    await customStatement(
      'DELETE FROM session_tree_nodes WHERE host_id = ?',
      <Object?>[hostId],
    );
  }

  /// Drops every M11 row for the host. Called from `resetHostCaches`.
  Future<void> resetM11Caches(String hostId) async {
    await customStatement(
      'DELETE FROM controller_states WHERE host_id = ?',
      <Object?>[hostId],
    );
    await customStatement(
      'DELETE FROM attention_states WHERE host_id = ?',
      <Object?>[hostId],
    );
    await customStatement(
      'DELETE FROM subscription_set WHERE host_id = ?',
      <Object?>[hostId],
    );
  }
}

String _bootstrapInstallationId() => const Uuid().v4().toLowerCase();

QueryExecutor _openConnection() {
  return driftDatabase(name: 'pi_mob');
}
