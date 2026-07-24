// R12 — Per-chat scroll position + follow mode persistence.
//
// These tests pin the mobile-authoritative table layout created lazily
// in `AppDatabase.beforeOpen` and the upsert/select/reset contract. The
// transcript restoration path is exercised end-to-end in
// `transcript_view_r12_test.dart`; the database-only contract lives here
// so a schema drift cannot silently regress the projection.

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/data/app_database.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('R12 chat_scroll_positions persistence', () {
    late AppDatabase database;
    const hostId = '11111111-1111-4111-8111-111111111111';
    const sessionId = '22222222-2222-4222-8222-222222222222';

    setUp(() {
      database = AppDatabase.withExecutor(NativeDatabase.memory());
    });

    tearDown(() async {
      await database.close();
    });

    test('absent row returns null from chatScrollPositionFor', () async {
      final result = await database.chatScrollPositionFor(
        hostId: hostId,
        sessionId: sessionId,
      );
      expect(result, isNull);
    });

    test(
      'upsert then read returns the persisted offset + follow mode',
      () async {
        await database.upsertChatScrollPosition(
          hostId: hostId,
          sessionId: sessionId,
          scrollOffset: 256,
          followMode: false,
          updatedAt: DateTime.utc(2026, 7, 23, 12, 0, 0),
        );
        final result = await database.chatScrollPositionFor(
          hostId: hostId,
          sessionId: sessionId,
        );
        expect(result, isNotNull);
        expect(result!['scrollOffset'], 256);
        expect(result['followMode'], isFalse);
      },
    );

    test('upsert overwrites the existing row', () async {
      await database.upsertChatScrollPosition(
        hostId: hostId,
        sessionId: sessionId,
        scrollOffset: 0,
        followMode: true,
        updatedAt: DateTime.utc(2026, 7, 23, 12, 0, 0),
      );
      await database.upsertChatScrollPosition(
        hostId: hostId,
        sessionId: sessionId,
        scrollOffset: 1024,
        followMode: false,
        updatedAt: DateTime.utc(2026, 7, 23, 12, 1, 0),
      );
      final result = await database.chatScrollPositionFor(
        hostId: hostId,
        sessionId: sessionId,
      );
      expect(result!['scrollOffset'], 1024);
      expect(result['followMode'], isFalse);
    });

    test('negative offsets are clamped to zero', () async {
      await database.upsertChatScrollPosition(
        hostId: hostId,
        sessionId: sessionId,
        scrollOffset: -50,
        followMode: true,
        updatedAt: DateTime.utc(2026, 7, 23, 12, 0, 0),
      );
      final result = await database.chatScrollPositionFor(
        hostId: hostId,
        sessionId: sessionId,
      );
      expect(result!['scrollOffset'], 0);
    });

    test('distinct (host, session) rows are independent', () async {
      const otherSession = '33333333-3333-4333-8333-333333333333';
      await database.upsertChatScrollPosition(
        hostId: hostId,
        sessionId: sessionId,
        scrollOffset: 100,
        followMode: true,
        updatedAt: DateTime.utc(2026, 7, 23, 12, 0, 0),
      );
      await database.upsertChatScrollPosition(
        hostId: hostId,
        sessionId: otherSession,
        scrollOffset: 200,
        followMode: false,
        updatedAt: DateTime.utc(2026, 7, 23, 12, 0, 0),
      );
      final first = await database.chatScrollPositionFor(
        hostId: hostId,
        sessionId: sessionId,
      );
      final second = await database.chatScrollPositionFor(
        hostId: hostId,
        sessionId: otherSession,
      );
      expect(first!['scrollOffset'], 100);
      expect(first['followMode'], isTrue);
      expect(second!['scrollOffset'], 200);
      expect(second['followMode'], isFalse);
    });

    test('resetChatScrollPositions clears only the matching host', () async {
      const otherHost = '44444444-4444-4444-8444-444444444444';
      await database.upsertChatScrollPosition(
        hostId: hostId,
        sessionId: sessionId,
        scrollOffset: 100,
        followMode: true,
        updatedAt: DateTime.utc(2026, 7, 23, 12, 0, 0),
      );
      await database.upsertChatScrollPosition(
        hostId: otherHost,
        sessionId: sessionId,
        scrollOffset: 200,
        followMode: true,
        updatedAt: DateTime.utc(2026, 7, 23, 12, 0, 0),
      );
      await database.resetChatScrollPositions(hostId);
      final cleared = await database.chatScrollPositionFor(
        hostId: hostId,
        sessionId: sessionId,
      );
      final kept = await database.chatScrollPositionFor(
        hostId: otherHost,
        sessionId: sessionId,
      );
      expect(cleared, isNull);
      expect(kept!['scrollOffset'], 200);
    });

    test('resetHostCaches also clears scroll positions for the host', () async {
      await database.upsertChatScrollPosition(
        hostId: hostId,
        sessionId: sessionId,
        scrollOffset: 100,
        followMode: true,
        updatedAt: DateTime.utc(2026, 7, 23, 12, 0, 0),
      );
      await database.resetHostCaches(hostId);
      final result = await database.chatScrollPositionFor(
        hostId: hostId,
        sessionId: sessionId,
      );
      expect(result, isNull);
    });
  });
}
