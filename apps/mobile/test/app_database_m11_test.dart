import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/data/app_database.dart';

const hostA = '11111111-1111-4111-8111-111111111111';
const hostB = '22222222-2222-4222-8222-222222222222';

void main() {
  late AppDatabase db;
  setUp(() => db = AppDatabase.withExecutor(NativeDatabase.memory()));
  tearDown(() => db.close());

  group('M11 controller_states', () {
    test('upsert and read round-trips every field', () async {
      await db.upsertControllerState(
        hostId: hostA,
        sessionId: 's1',
        mode: 'controller',
        leaseId: 'lease-1',
        previousMode: 'observer',
        takeoverPending: false,
        updatedAt: DateTime.utc(2026, 1, 1),
      );
      final rows = await db.controllerStatesFor(hostA);
      expect(rows, hasLength(1));
      expect(rows.single['mode'], 'controller');
      expect(rows.single['leaseId'], 'lease-1');
      expect(rows.single['previousMode'], 'observer');
      expect(rows.single['takeoverPending'], isFalse);
    });

    test('upsert replaces prior row for the same (host, session)', () async {
      await db.upsertControllerState(
        hostId: hostA,
        sessionId: 's1',
        mode: 'observer',
        leaseId: null,
        previousMode: 'none',
        takeoverPending: false,
        updatedAt: DateTime.utc(2026, 1, 1),
      );
      await db.upsertControllerState(
        hostId: hostA,
        sessionId: 's1',
        mode: 'controller',
        leaseId: 'lease-2',
        previousMode: 'observer',
        takeoverPending: true,
        updatedAt: DateTime.utc(2026, 1, 2),
      );
      final rows = await db.controllerStatesFor(hostA);
      expect(rows, hasLength(1));
      expect(rows.single['leaseId'], 'lease-2');
      expect(rows.single['takeoverPending'], isTrue);
    });

    test('two hosts do not see each other\'s controller rows', () async {
      await db.upsertControllerState(
        hostId: hostA,
        sessionId: 's1',
        mode: 'controller',
        leaseId: 'A',
        previousMode: 'none',
        takeoverPending: false,
        updatedAt: DateTime.utc(2026),
      );
      await db.upsertControllerState(
        hostId: hostB,
        sessionId: 's1',
        mode: 'observer',
        leaseId: null,
        previousMode: 'none',
        takeoverPending: false,
        updatedAt: DateTime.utc(2026),
      );
      final aRows = await db.controllerStatesFor(hostA);
      final bRows = await db.controllerStatesFor(hostB);
      expect(aRows.single['leaseId'], 'A');
      expect(bRows.single['mode'], 'observer');
    });
  });

  group('M11 attention_states', () {
    test('upsert and read round-trip unread counts', () async {
      await db.upsertAttentionState(
        hostId: hostA,
        sessionId: 's1',
        state: 'unread',
        unreadCount: 4,
        updatedAt: DateTime.utc(2026),
      );
      final rows = await db.attentionStatesFor(hostA);
      expect(rows.single['state'], 'unread');
      expect(rows.single['unreadCount'], 4);
    });

    test('unreadCount never goes below zero via raw API', () async {
      await db.upsertAttentionState(
        hostId: hostA,
        sessionId: 's1',
        state: 'none',
        unreadCount: 0,
        updatedAt: DateTime.utc(2026),
      );
      final rows = await db.attentionStatesFor(hostA);
      expect(rows.single['unreadCount'], 0);
    });

    test('attention rows are isolated per host', () async {
      await db.upsertAttentionState(
        hostId: hostA,
        sessionId: 's1',
        state: 'needs_attention',
        unreadCount: 1,
        updatedAt: DateTime.utc(2026),
      );
      await db.upsertAttentionState(
        hostId: hostB,
        sessionId: 's1',
        state: 'background',
        unreadCount: 0,
        updatedAt: DateTime.utc(2026),
      );
      final aRows = await db.attentionStatesFor(hostA);
      final bRows = await db.attentionStatesFor(hostB);
      expect(aRows.single['state'], 'needs_attention');
      expect(bRows.single['state'], 'background');
    });
  });

  group('M11 subscription_set', () {
    test(
      'replaceSubscriptionSet overwrites the prior set atomically',
      () async {
        await db.replaceSubscriptionSet(
          hostId: hostA,
          entries: <Map<String, Object?>>[
            {
              'sessionId': 'a',
              'streamId': 'session:a',
              'detail': 'full',
              'cursor': '0',
            },
            {
              'sessionId': 'b',
              'streamId': 'session:b',
              'detail': 'summary',
              'cursor': '3',
            },
          ],
        );
        await db.replaceSubscriptionSet(
          hostId: hostA,
          entries: <Map<String, Object?>>[
            {
              'sessionId': 'c',
              'streamId': 'session:c',
              'detail': 'full',
              'cursor': '9',
            },
          ],
        );
        final rows = await db.subscriptionSetFor(hostA);
        expect(rows, hasLength(1));
        expect(rows.single['sessionId'], 'c');
        expect(rows.single['detail'], 'full');
        expect(rows.single['cursor'], '9');
      },
    );

    test('subscription_set is isolated per host', () async {
      await db.replaceSubscriptionSet(
        hostId: hostA,
        entries: <Map<String, Object?>>[
          {
            'sessionId': 'a',
            'streamId': 'session:a',
            'detail': 'full',
            'cursor': '0',
          },
        ],
      );
      await db.replaceSubscriptionSet(
        hostId: hostB,
        entries: <Map<String, Object?>>[
          {
            'sessionId': 'x',
            'streamId': 'session:x',
            'detail': 'summary',
            'cursor': '12',
          },
        ],
      );
      final aRows = await db.subscriptionSetFor(hostA);
      final bRows = await db.subscriptionSetFor(hostB);
      expect(aRows.single['sessionId'], 'a');
      expect(bRows.single['sessionId'], 'x');
      expect(bRows.single['cursor'], '12');
    });

    test('cursor survives verbatim including values above 2^53', () async {
      const big = '9007199254740993';
      await db.replaceSubscriptionSet(
        hostId: hostA,
        entries: <Map<String, Object?>>[
          {
            'sessionId': 'big',
            'streamId': 'session:big',
            'detail': 'summary',
            'cursor': big,
          },
        ],
      );
      final rows = await db.subscriptionSetFor(hostA);
      expect(rows.single['cursor'], big);
    });
  });

  group('M11 resetHostCaches drops every new table', () {
    setUp(() async {
      await db.upsertControllerState(
        hostId: hostA,
        sessionId: 's1',
        mode: 'controller',
        leaseId: 'L',
        previousMode: 'observer',
        takeoverPending: false,
        updatedAt: DateTime.utc(2026),
      );
      await db.upsertAttentionState(
        hostId: hostA,
        sessionId: 's1',
        state: 'unread',
        unreadCount: 2,
        updatedAt: DateTime.utc(2026),
      );
      await db.replaceSubscriptionSet(
        hostId: hostA,
        entries: <Map<String, Object?>>[
          {
            'sessionId': 's1',
            'streamId': 'session:s1',
            'detail': 'full',
            'cursor': '0',
          },
        ],
      );
    });

    test('resetM11Caches clears all three tables for one host', () async {
      await db.resetM11Caches(hostA);
      expect(await db.controllerStatesFor(hostA), isEmpty);
      expect(await db.attentionStatesFor(hostA), isEmpty);
      expect(await db.subscriptionSetFor(hostA), isEmpty);
    });
  });
}
