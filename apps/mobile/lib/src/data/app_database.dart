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
      await _ensureSearchIndexSchema();
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
      await resetSearchIndexCaches(hostId);
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
      batch.insertAll(cachedEvents, values, mode: InsertMode.insertOrIgnore);
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
      [
        hostId,
        sessionId,
        snapshotRevision,
        DateTime.now().toUtc().millisecondsSinceEpoch,
      ],
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

  // ---------------------------------------------------------------------
  // M16 bounded global search index. The mobile UI ships a global search
  // sheet that surfaces hits across every durable source the app already
  // authoritatively holds: chat names, user prompts, assistant answers,
  // reasoning summaries, and tool names / previews. The index is a
  // bounded normalized table updated transactionally from persisted
  // events so the sheet never needs to re-walk the full event journal
  // and query latency stays bounded by the per-session cap.
  //
  // The schema is created lazily in `beforeOpen` to match the existing
  // M11/M12/M13 pattern and keep the generated `.g.dart` file stable.
  // ---------------------------------------------------------------------

  static const String kCreateSearchEntries = '''
    CREATE TABLE IF NOT EXISTS search_entries (
      host_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      cursor TEXT NOT NULL,
      source TEXT NOT NULL,
      summary TEXT NOT NULL,
      tokens TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (host_id, session_id, event_id)
    )
  ''';

  static const String kCreateSearchSessionIndex = '''
    CREATE INDEX IF NOT EXISTS search_entries_session_idx
      ON search_entries(host_id, session_id)
  ''';

  Future<void> _ensureSearchIndexSchema() async {
    await customStatement(kCreateSearchEntries);
    await customStatement(kCreateSearchSessionIndex);
  }

  /// Upserts one bounded [SearchEntry] row. The summary is intentionally
  /// truncated at write time so callers cannot accidentally grow past the
  /// configured cap by passing a verbose payload. Duplicates collapse on
  /// the `(host_id, session_id, event_id)` primary key so re-indexing the
  /// same event after a reconnect or rename stays idempotent.
  Future<void> upsertSearchEntry({
    required String hostId,
    required String sessionId,
    required String eventId,
    required String cursor,
    required String source,
    required String summary,
    required String tokens,
    required DateTime occurredAt,
    required DateTime updatedAt,
  }) async {
    await _ensureSearchIndexSchema();
    await customStatement(
      'INSERT INTO search_entries '
      '(host_id, session_id, event_id, cursor, source, summary, '
      'tokens, occurred_at, updated_at) '
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) '
      'ON CONFLICT(host_id, session_id, event_id) DO UPDATE SET '
      'cursor = excluded.cursor, '
      'source = excluded.source, '
      'summary = excluded.summary, '
      'tokens = excluded.tokens, '
      'occurred_at = excluded.occurred_at, '
      'updated_at = excluded.updated_at',
      <Object?>[
        hostId,
        sessionId,
        eventId,
        cursor,
        source,
        summary,
        tokens,
        occurredAt.toUtc().toIso8601String(),
        updatedAt.toUtc().toIso8601String(),
      ],
    );
  }

  /// Bounded query: scans the persisted tokens column for any of the
  /// normalized query tokens and returns up to [limit] hits, newest first.
  /// The caller is responsible for tokenization and for keeping the
  /// summary length within [kSearchSummaryCharCap] (defined in
  /// `search_indexer.dart`).
  Future<List<Map<String, Object?>>> querySearchEntries({
    required String hostId,
    required Iterable<String> queryTokens,
    required int limit,
    Set<String>? sourceFilter,
  }) async {
    await _ensureSearchIndexSchema();
    final tokens = queryTokens
        .expand((token) => _normalizeSearchToken(token).split(' '))
        .where((token) => token.isNotEmpty)
        .toSet()
        .toList(growable: false);
    if (tokens.isEmpty || limit <= 0) {
      return const <Map<String, Object?>>[];
    }
    // Each persisted token lives in a single space-separated column so we
    // wrap it with spaces and use a `LIKE '% token %'` pattern. The
    // surrounding spaces prevent partial matches inside multi-word tokens
    // like `squirrel` from accidentally matching `squirrels`.
    final tokenClauses = List<String>.generate(
      tokens.length,
      (_) => "(' ' || tokens || ' ') LIKE ? ESCAPE '\\'",
    ).join(' AND ');
    final filterClause = sourceFilter == null || sourceFilter.isEmpty
        ? ''
        : ' AND source IN (${List<String>.generate(sourceFilter.length, (_) => '?').join(',')})';
    final variables = <Variable<Object>>[
      Variable<String>(hostId),
      for (final token in tokens)
        Variable<String>('% ${_escapeLikeLiteral(token)} %'),
      if (sourceFilter != null)
        for (final source in sourceFilter) Variable<String>(source),
    ];
    final rows = await customSelect(
      'SELECT session_id, event_id, cursor, source, summary, '
      'occurred_at, updated_at FROM search_entries '
      'WHERE host_id = ? AND '
      '$tokenClauses '
      '$filterClause '
      'ORDER BY updated_at DESC LIMIT ?',
      variables: [...variables, Variable<int>(limit)],
    ).get();
    return rows
        .map(
          (row) => <String, Object?>{
            'sessionId': row.read<String>('session_id'),
            'eventId': row.read<String>('event_id'),
            'cursor': row.read<String>('cursor'),
            'source': row.read<String>('source'),
            'summary': row.read<String>('summary'),
            'occurredAt': row.read<String>('occurred_at'),
            'updatedAt': row.read<String>('updated_at'),
          },
        )
        .toList(growable: false);
  }

  /// Removes every search row for one (host, session). Called when the
  /// chat is deleted or rebuilt from a fresh host generation so stale
  /// summaries never bleed across the global sheet.
  Future<void> removeSearchEntriesForSession({
    required String hostId,
    required String sessionId,
  }) async {
    await _ensureSearchIndexSchema();
    await customStatement(
      'DELETE FROM search_entries WHERE host_id = ? AND session_id = ?',
      <Object?>[hostId, sessionId],
    );
  }

  /// Removes every search row for the host. Called from
  /// [resetHostCaches] so the next sync starts from a clean slate.
  Future<void> resetSearchIndexCaches(String hostId) async {
    await _ensureSearchIndexSchema();
    await customStatement(
      'DELETE FROM search_entries WHERE host_id = ?',
      <Object?>[hostId],
    );
  }

  /// Total search rows for one (host, session). Used by the indexer to
  /// enforce the per-session cap without forcing a full table scan.
  Future<int> searchEntryCountForSession({
    required String hostId,
    required String sessionId,
  }) async {
    await _ensureSearchIndexSchema();
    final row = await customSelect(
      'SELECT COUNT(*) AS total FROM search_entries '
      'WHERE host_id = ? AND session_id = ?',
      variables: [Variable.withString(hostId), Variable.withString(sessionId)],
    ).getSingle();
    return row.read<int>('total');
  }

  /// Returns the oldest rows in cursor order so the indexer can trim past
  /// the per-session cap without scanning the table.
  Future<List<Map<String, Object?>>> searchEntriesOldestForSession({
    required String hostId,
    required String sessionId,
    required int limit,
  }) async {
    await _ensureSearchIndexSchema();
    final rows = await customSelect(
      'SELECT event_id, cursor FROM search_entries '
      'WHERE host_id = ? AND session_id = ? '
      'ORDER BY LENGTH(cursor) ASC, cursor ASC, updated_at ASC LIMIT ?',
      variables: [
        Variable.withString(hostId),
        Variable.withString(sessionId),
        Variable.withInt(limit),
      ],
    ).get();
    return rows
        .map(
          (row) => <String, Object?>{
            'eventId': row.read<String>('event_id'),
            'cursor': row.read<String>('cursor'),
          },
        )
        .toList(growable: false);
  }

  Future<int> searchEntryCountForHost(String hostId) async {
    await _ensureSearchIndexSchema();
    final row = await customSelect(
      'SELECT COUNT(*) AS total FROM search_entries WHERE host_id = ?',
      variables: [Variable.withString(hostId)],
    ).getSingle();
    return row.read<int>('total');
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

/// Mirrors the per-character rules the indexer uses in
/// `search_indexer.dart`'s private `_tokenize`: lowercase, keep only ASCII
/// letters, ASCII digits, and the Latin Extended blocks the indexer
/// retains, and collapse every other rune into a single separator. SQLite
/// `LIKE` wildcards (`%`, `_`) and the escape character (`\`) are therefore
/// stripped — they are not preserved as literals. This keeps the DB-level
/// LIKE clause consistent with the persisted `tokens` column regardless of
/// how the caller pre-tokenised the query.
String _normalizeSearchToken(String value) {
  if (value.isEmpty) return '';
  final lowered = value.toLowerCase();
  final buf = StringBuffer();
  var pendingSpace = false;
  for (final rune in lowered.runes) {
    final code = rune;
    final isLetterOrDigit =
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) ||
        (code >= 0x00c0 && code <= 0x024f) ||
        (code >= 0x1e00 && code <= 0x1eff) ||
        (code >= 0x30 && code <= 0x39);
    if (isLetterOrDigit) {
      if (pendingSpace) buf.write(' ');
      buf.write(String.fromCharCode(code));
      pendingSpace = false;
    } else {
      pendingSpace = true;
    }
  }
  return buf.toString().trim();
}

/// Defensively escapes the SQLite `LIKE` wildcards (`%`, `_`) plus the
/// escape character itself so any bind parameter that somehow retains those
/// characters is matched literally rather than acting as a wildcard. The
/// accompanying LIKE clause uses `ESCAPE '\'` for this to take effect.
/// After [_normalizeSearchToken] these characters are already stripped from
/// the query side, but the escape still pays off for `summary`/`tokens`
/// columns that may contain user-authored punctuation.
String _escapeLikeLiteral(String value) {
  final buf = StringBuffer();
  for (final rune in value.runes) {
    final ch = String.fromCharCode(rune);
    if (ch == r'\' || ch == '%' || ch == '_') {
      buf.write(r'\');
    }
    buf.write(ch);
  }
  return buf.toString();
}

QueryExecutor _openConnection() {
  return driftDatabase(name: 'pi_mob');
}
