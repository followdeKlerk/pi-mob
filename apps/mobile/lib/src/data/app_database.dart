import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';
import 'package:uuid/uuid.dart';

import '../domain/mobile_state.dart' hide StreamCursor;

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

      // The diagnostic cache is intentionally bounded. A later restart with a
      // compacted prefix requests an atomic bridge snapshot rather than
      // pretending the remaining suffix is complete.
      final old =
          await (select(cachedEvents)
                ..where((row) => row.streamId.equals(event.streamId))
                ..orderBy([(row) => OrderingTerm.desc(row.storedAt)])
                ..limit(100000, offset: 500))
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
  }) async {
    await into(draftEntries).insertOnConflictUpdate(
      DraftEntriesCompanion.insert(
        hostId: hostId,
        sessionId: sessionId,
        draftText: Value(text),
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
}

String _bootstrapInstallationId() => const Uuid().v4().toLowerCase();

QueryExecutor _openConnection() {
  return driftDatabase(name: 'pi_mob');
}
