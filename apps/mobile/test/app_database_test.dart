import 'package:drift/drift.dart' hide isNull, isNotNull;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/domain/mobile_state.dart';

const hostId = '11111111-1111-4111-8111-111111111111';

void main() {
  late AppDatabase db;
  final now = DateTime.utc(2026);

  setUp(() => db = AppDatabase.withExecutor(NativeDatabase.memory()));
  tearDown(() => db.close());

  test('creates schema and bootstrap installation metadata', () async {
    expect(await db.allHosts(), isEmpty);
    final metadata = await db.select(db.metadataEntries).get();
    expect(metadata, hasLength(1));
    expect(metadata.single.protocolMajor, 1);
  });

  test(
    'generation reset clears reconstructible cache but preserves draft',
    () async {
      const host = '11111111-1111-4111-8111-111111111111';
      await db.upsertHost(
        HostEntriesCompanion.insert(
          hostId: host,
          endpoint: 'https://host.example',
          displayName: 'Host',
          generation: '22222222-2222-4222-8222-222222222222',
          connectionState: 'ready',
          capabilitiesJson: '[]',
        ),
      );
      await db
          .into(db.sessionEntries)
          .insert(
            SessionEntriesCompanion.insert(
              sessionId: '33333333-3333-4333-8333-333333333333',
              hostId: host,
              name: 'Diagnostic',
              runtimeState: 'idle',
            ),
          );
      await db
          .into(db.draftEntries)
          .insert(
            DraftEntriesCompanion.insert(
              hostId: host,
              sessionId: '33333333-3333-4333-8333-333333333333',
              draftText: const Value('never send automatically'),
              pendingCommandId: const Value(
                '44444444-4444-4444-8444-444444444444',
              ),
              pendingPayloadJson: const Value(
                '{"message":"never send automatically"}',
              ),
              pendingState: const Value('uncertain'),
              updatedAt: now,
            ),
          );
      await db.insertEvent(
        eventId: '55555555-5555-4555-8555-555555555555',
        hostId: host,
        streamId: 'session:33333333-3333-4333-8333-333333333333',
        cursor: '9007199254740993',
        type: 'assistant.delta',
        payloadJson: '{}',
        occurredAt: now,
      );
      await db.resetHostCaches(host);
      await db.quarantinePendingCommands(host);

      expect(await db.select(db.cachedEvents).get(), isEmpty);
      expect(await db.select(db.sessionEntries).get(), isEmpty);
      final drafts = await db.allDrafts();
      expect(drafts, hasLength(1));
      expect(drafts.single.draftText, 'never send automatically');
      expect(drafts.single.pendingCommandId, isNull);
      expect(drafts.single.pendingPayloadJson, isNull);
      expect(drafts.single.pendingState, isNull);
    },
  );

  test(
    'snapshot replacement is atomic and supports arbitrary decimal cursor',
    () async {
      const host = '11111111-1111-4111-8111-111111111111';
      const stream = 'host:11111111-1111-4111-8111-111111111111';
      await db.insertEvent(
        eventId: '55555555-5555-4555-8555-555555555555',
        hostId: host,
        streamId: stream,
        cursor: '9007199254740993',
        type: 'host.state',
        payloadJson: '{}',
        occurredAt: now,
      );
      await db.replaceWithSnapshot(
        streamId: stream,
        hostId: host,
        baselineCursor: '999999999999999999999999999999',
        snapshotId: '66666666-6666-4666-8666-666666666666',
        payloadJson: '{"ready":true}',
        receivedAt: now,
      );
      expect(await db.select(db.cachedEvents).get(), isEmpty);
      final cursor = await db.select(db.streamCursors).getSingle();
      expect(cursor.lastContiguousCursor, '999999999999999999999999999999');
      expect(
        (await db.select(db.snapshotEntries).getSingle()).payloadJson,
        '{"ready":true}',
      );
    },
  );

  test('saveDraft roundtrips the selected delivery mode per session', () async {
    const idleSession = '22222222-2222-4222-8222-222222222222';
    const runningSession = '33333333-3333-4333-8333-333333333333';
    const otherSession = '44444444-4444-4444-8444-444444444444';

    // Default is implicit `immediate`; absence is a valid persisted state for
    // older clients and must not block newer writes.
    await db.saveDraft(
      hostId: hostId,
      sessionId: idleSession,
      text: 'send now',
      pendingCommandId: null,
      pendingPayloadJson: null,
      pendingState: null,
      updatedAt: now,
    );
    final defaults = await db.draft(hostId, idleSession);
    expect(defaults, isNotNull);
    expect(defaults!.selectedDeliveryMode, isNull);

    // Explicit steer / follow_up persist using the protocol wire names so
    // older readers still see a valid token.
    await db.saveDraft(
      hostId: hostId,
      sessionId: runningSession,
      text: 'redirect',
      pendingCommandId: null,
      pendingPayloadJson: null,
      pendingState: null,
      updatedAt: now,
      selectedDeliveryMode: DeliveryMode.steer,
    );
    await db.saveDraft(
      hostId: hostId,
      sessionId: otherSession,
      text: 'queue this',
      pendingCommandId: null,
      pendingPayloadJson: null,
      pendingState: null,
      updatedAt: now,
      selectedDeliveryMode: DeliveryMode.followUp,
    );

    final steered = await db.draft(hostId, runningSession);
    final queued = await db.draft(hostId, otherSession);
    expect(steered!.selectedDeliveryMode, 'steer');
    expect(queued!.selectedDeliveryMode, 'follow_up');

    // Switching mode on the same row overwrites the prior value.
    await db.saveDraft(
      hostId: hostId,
      sessionId: otherSession,
      text: 'queue this',
      pendingCommandId: null,
      pendingPayloadJson: null,
      pendingState: null,
      updatedAt: now.add(const Duration(seconds: 1)),
      selectedDeliveryMode: DeliveryMode.immediate,
    );
    final cleared = await db.draft(hostId, otherSession);
    expect(cleared!.selectedDeliveryMode, 'immediate');
  });
}
