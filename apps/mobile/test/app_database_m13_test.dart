import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/domain/attachments.dart';

AttachmentRef ref(String id) => AttachmentRef(
  id: id,
  kind: AttachmentKind.imagePng,
  filename: '$id.png',
  sizeBytes: 12,
  mimeType: 'image/png',
  status: AttachmentStatus.ready,
  createdAt: DateTime.utc(2026),
  expiresAt: DateTime.utc(2026, 1, 2),
  width: 1,
  height: 1,
);

void main() {
  late AppDatabase db;
  setUp(() => db = AppDatabase.withExecutor(NativeDatabase.memory()));
  tearDown(() => db.close());

  test('attachment refs persist in order and isolate hosts/sessions', () async {
    await db.upsertLocalAttachment(
      hostId: 'h1',
      sessionId: 's1',
      ref: ref('a'),
      orderIndex: 1,
    );
    await db.upsertLocalAttachment(
      hostId: 'h1',
      sessionId: 's1',
      ref: ref('b'),
      orderIndex: 0,
    );
    expect(
      (await db.localAttachmentsFor(
        hostId: 'h1',
        sessionId: 's1',
      )).map((item) => item.id),
      ['b', 'a'],
    );
    expect(
      await db.localAttachmentsFor(hostId: 'h2', sessionId: 's1'),
      isEmpty,
    );
  });

  test(
    'remove session attachments and host cache cleanup are bounded',
    () async {
      await db.upsertLocalAttachment(
        hostId: 'h1',
        sessionId: 's1',
        ref: ref('a'),
        orderIndex: 0,
      );
      await db.upsertLocalAttachment(
        hostId: 'h1',
        sessionId: 's2',
        ref: ref('b'),
        orderIndex: 0,
      );
      await db.removeLocalAttachmentsForSession(hostId: 'h1', sessionId: 's1');
      expect(
        await db.localAttachmentsFor(hostId: 'h1', sessionId: 's1'),
        isEmpty,
      );
      expect(
        await db.localAttachmentsFor(hostId: 'h1', sessionId: 's2'),
        hasLength(1),
      );
      await db.resetM13Caches('h1');
      expect(
        await db.localAttachmentsFor(hostId: 'h1', sessionId: 's2'),
        isEmpty,
      );
    },
  );
}
