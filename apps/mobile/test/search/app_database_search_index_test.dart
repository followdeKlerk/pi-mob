import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/data/app_database.dart';

void main() {
  late AppDatabase db;
  setUp(() => db = AppDatabase.withExecutor(NativeDatabase.memory()));
  tearDown(() => db.close());

  Future<void> put(String key, String cursor, String summary) =>
      db.upsertSearchEntry(
        hostId: 'h',
        sessionId: 's',
        sourceKey: key,
        cursor: cursor,
        source: 'assistant',
        summary: summary,
        tokens: summary.toLowerCase(),
        occurredAt: DateTime.utc(2026),
        updatedAt: DateTime.utc(2026),
      );

  test('custom schema upserts logical source identity idempotently', () async {
    await put('turn|assistant|0', '9', 'First');
    await put('turn|assistant|0', '10', 'Updated');
    expect(await db.searchEntryCountForSession(hostId: 'h', sessionId: 's'), 1);
    final rows = await db.querySearchEntries(
      hostId: 'h',
      tokens: ['updated'],
      limit: 2,
    );
    expect(rows.single['cursor'], '10');
  });

  test(
    'LIKE query escapes wildcard input and preserves cursor ordering',
    () async {
      await put('one', '2', 'under_score');
      await put('two', '10', 'under_score later');
      expect(
        await db.querySearchEntries(hostId: 'h', tokens: ['%'], limit: 10),
        isEmpty,
      );
      final oldest = await db.searchEntriesOldestForSession(
        hostId: 'h',
        sessionId: 's',
        limit: 2,
      );
      expect(oldest.map((row) => row['cursor']), ['2', '10']);
    },
  );

  test('session and host reset remove bounded index rows', () async {
    await put('one', '1', 'one');
    await db.upsertSearchEntry(
      hostId: 'h',
      sessionId: 'other',
      sourceKey: 'two',
      cursor: '2',
      source: 'tool',
      summary: 'two',
      tokens: 'two',
      occurredAt: DateTime.utc(2026),
      updatedAt: DateTime.utc(2026),
    );
    await db.removeSearchEntriesForSession(hostId: 'h', sessionId: 's');
    expect(await db.searchEntryCountForHost('h'), 1);
    await db.resetSearchEntries('h');
    expect(await db.searchEntryCountForHost('h'), 0);
  });
}
