import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/domain/session_tree.dart';

void main() {
  late AppDatabase db;
  setUp(() => db = AppDatabase.withExecutor(NativeDatabase.memory()));
  tearDown(() => db.close());

  test('tree rows persist lineage lifecycle and host isolation', () async {
    final node = SessionTreeNode(
      sessionId: 'child',
      name: 'Fork',
      parentSessionId: 'parent',
      forkOriginEntryId: 'entry-1',
      lineage: SessionLineageKind.fork,
      lifecycle: SessionLifecycleState.softDeleted,
      deletedAt: DateTime.utc(2026, 7, 14),
      purgeAfter: DateTime.utc(2026, 7, 21),
    );
    await db.upsertSessionTreeNode(hostId: 'h1', node: node);
    final rows = await db.sessionTreeNodes('h1');
    expect(rows.single.sessionId, 'child');
    expect(rows.single.parentSessionId, 'parent');
    expect(rows.single.lineage, SessionLineageKind.fork);
    expect(rows.single.lifecycle, SessionLifecycleState.softDeleted);
    expect(await db.sessionTreeNodes('h2'), isEmpty);
  });

  test('reset M12 cache removes only requested host', () async {
    const node = SessionTreeNode(sessionId: 's', name: 'S');
    await db.upsertSessionTreeNode(hostId: 'h1', node: node);
    await db.upsertSessionTreeNode(hostId: 'h2', node: node);
    await db.resetM12Caches('h1');
    expect(await db.sessionTreeNodes('h1'), isEmpty);
    expect(await db.sessionTreeNodes('h2'), hasLength(1));
  });
}
