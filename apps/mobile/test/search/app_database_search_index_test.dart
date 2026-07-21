import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/search/search_indexer.dart';

const hostId = '11111111-1111-4111-8111-111111111111';
const sessionA = '22222222-2222-4222-8222-222222222222';
const sessionB = '33333333-3333-4333-8333-333333333333';

void main() {
  late AppDatabase db;
  setUp(() => db = AppDatabase.withExecutor(NativeDatabase.memory()));
  tearDown(() => db.close());

  group('search_entries schema', () {
    test('is created lazily without regenerating drift code', () async {
      await db
          .customSelect(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='search_entries'",
          )
          .get();
      final rows = await db
          .customSelect(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='search_entries'",
          )
          .get();
      expect(rows, isNotEmpty);
    });

    test(
      'round-trips every column and supports upsert by primary key',
      () async {
        await db.upsertSearchEntry(
          hostId: hostId,
          sessionId: sessionA,
          eventId: 'ev-1',
          cursor: '42',
          source: 'user_prompt',
          summary: 'Where did the squirrel go?',
          tokens: 'squirrel',
          occurredAt: DateTime.utc(2026, 1, 1),
          updatedAt: DateTime.utc(2026, 1, 1),
        );
        var rows = await db.querySearchEntries(
          hostId: hostId,
          queryTokens: const ['squirrel'],
          limit: 10,
        );
        expect(rows, hasLength(1));
        expect(rows.single['sessionId'], sessionA);
        expect(rows.single['cursor'], '42');
        expect(rows.single['source'], 'user_prompt');

        // Upsert replaces prior row instead of duplicating it.
        await db.upsertSearchEntry(
          hostId: hostId,
          sessionId: sessionA,
          eventId: 'ev-1',
          cursor: '43',
          source: 'user_prompt',
          summary: 'Where did the squirrel go this time?',
          tokens: 'squirrel',
          occurredAt: DateTime.utc(2026, 1, 1),
          updatedAt: DateTime.utc(2026, 1, 2),
        );
        rows = await db.querySearchEntries(
          hostId: hostId,
          queryTokens: const ['squirrel'],
          limit: 10,
        );
        expect(rows, hasLength(1));
        expect(rows.single['cursor'], '43');
        expect(rows.single['summary'], 'Where did the squirrel go this time?');
      },
    );

    test('query honors the per-query hit ceiling', () async {
      for (var i = 0; i < 12; i++) {
        await db.upsertSearchEntry(
          hostId: hostId,
          sessionId: sessionA,
          eventId: 'ev-$i',
          cursor: '$i',
          source: 'assistant',
          summary: 'shared keyword in row $i',
          tokens: 'shared keyword row $i',
          occurredAt: DateTime.utc(2026, 1, 1),
          updatedAt: DateTime.utc(2026, 1, 1, 0, 0, i),
        );
      }
      final rows = await db.querySearchEntries(
        hostId: hostId,
        queryTokens: const ['shared'],
        limit: 5,
      );
      expect(rows, hasLength(5));
    });

    test('source filter narrows results to one source family', () async {
      await db.upsertSearchEntry(
        hostId: hostId,
        sessionId: sessionA,
        eventId: 'ev-u',
        cursor: '1',
        source: 'user_prompt',
        summary: 'tell me about tokenizers',
        tokens: 'tokenizers',
        occurredAt: DateTime.utc(2026, 1, 1),
        updatedAt: DateTime.utc(2026, 1, 1),
      );
      await db.upsertSearchEntry(
        hostId: hostId,
        sessionId: sessionA,
        eventId: 'ev-a',
        cursor: '2',
        source: 'assistant',
        summary: 'tokenizers split text into pieces',
        tokens: 'tokenizers split text pieces',
        occurredAt: DateTime.utc(2026, 1, 1),
        updatedAt: DateTime.utc(2026, 1, 1),
      );
      final rows = await db.querySearchEntries(
        hostId: hostId,
        queryTokens: const ['tokenizers'],
        limit: 10,
        sourceFilter: const {'assistant'},
      );
      expect(rows, hasLength(1));
      expect(rows.single['eventId'], 'ev-a');
    });

    test('removeSearchEntriesForSession isolates the right host', () async {
      await db.upsertSearchEntry(
        hostId: hostId,
        sessionId: sessionA,
        eventId: 'ev-1',
        cursor: '1',
        source: 'chat',
        summary: 'First chat',
        tokens: 'first chat',
        occurredAt: DateTime.utc(2026, 1, 1),
        updatedAt: DateTime.utc(2026, 1, 1),
      );
      await db.upsertSearchEntry(
        hostId: 'other-host',
        sessionId: sessionA,
        eventId: 'ev-2',
        cursor: '1',
        source: 'chat',
        summary: 'Other host',
        tokens: 'other host',
        occurredAt: DateTime.utc(2026, 1, 1),
        updatedAt: DateTime.utc(2026, 1, 1),
      );
      await db.removeSearchEntriesForSession(
        hostId: hostId,
        sessionId: sessionA,
      );
      expect(
        await db.searchEntryCountForSession(
          hostId: hostId,
          sessionId: sessionA,
        ),
        0,
      );
      expect(
        await db.searchEntryCountForSession(
          hostId: 'other-host',
          sessionId: sessionA,
        ),
        1,
      );
    });
  });

  group('search indexer', () {
    test('resetHostCaches also drops search_entries for the host', () async {
      await db.upsertHost(
        HostEntriesCompanion.insert(
          hostId: hostId,
          endpoint: 'https://host.example',
          displayName: 'host',
          generation: 'gen-1',
          connectionState: 'ready',
          capabilitiesJson: '[]',
        ),
      );
      await db.upsertSearchEntry(
        hostId: hostId,
        sessionId: sessionA,
        eventId: 'ev-1',
        cursor: '1',
        source: 'chat',
        summary: 'first chat',
        tokens: 'first chat',
        occurredAt: DateTime.utc(2026, 1, 1),
        updatedAt: DateTime.utc(2026, 1, 1),
      );
      await db.resetHostCaches(hostId);
      expect(await db.searchEntryCountForHost(hostId), 0);
    });

    test(
      'searchEntryCountForSession and oldest cursor ordering drive the cap',
      () async {
        for (var i = 0; i < 12; i++) {
          await db.upsertSearchEntry(
            hostId: hostId,
            sessionId: sessionA,
            eventId: 'ev-$i',
            cursor: '$i',
            source: 'assistant',
            summary: 'wordy chat row $i',
            tokens: 'wordy chat row $i',
            occurredAt: DateTime.utc(2026, 1, 1),
            updatedAt: DateTime.utc(2026, 1, 1),
          );
        }
        expect(
          await db.searchEntryCountForSession(
            hostId: hostId,
            sessionId: sessionA,
          ),
          12,
        );
        final oldest = await db.searchEntriesOldestForSession(
          hostId: hostId,
          sessionId: sessionA,
          limit: 2,
        );
        expect(oldest, hasLength(2));
        expect(oldest.first['cursor'], '0');
        expect(oldest.last['cursor'], '1');
      },
    );

    test('kSearchSummaryCharCap matches the documented ceiling', () {
      expect(kSearchSummaryCharCap, 240);
    });
  });

  group('B-cap enforcement', () {
    test('effectivePerSessionCap never exceeds the per-host ceiling', () {
      expect(
        effectivePerSessionCap(override: 10000),
        lessThanOrEqualTo(kSearchEntriesPerHostCap),
      );
    });
  });

  group('session scoping', () {
    test('queries are scoped to the host', () async {
      await db.upsertSearchEntry(
        hostId: hostId,
        sessionId: sessionA,
        eventId: 'a',
        cursor: '1',
        source: 'chat',
        summary: 'apple pie',
        tokens: 'apple pie',
        occurredAt: DateTime.utc(2026, 1, 1),
        updatedAt: DateTime.utc(2026, 1, 1),
      );
      await db.upsertSearchEntry(
        hostId: 'other',
        sessionId: sessionB,
        eventId: 'b',
        cursor: '1',
        source: 'chat',
        summary: 'apple sauce',
        tokens: 'apple sauce',
        occurredAt: DateTime.utc(2026, 1, 1),
        updatedAt: DateTime.utc(2026, 1, 1),
      );
      final rows = await db.querySearchEntries(
        hostId: hostId,
        queryTokens: const ['apple'],
        limit: 10,
      );
      expect(rows, hasLength(1));
      expect(rows.single['eventId'], 'a');
    });
  });
}
