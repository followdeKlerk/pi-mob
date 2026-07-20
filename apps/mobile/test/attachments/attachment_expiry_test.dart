import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:pi_mob/src/attachments/attachments.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('formats remaining time under one minute as seconds', (
    tester,
  ) async {
    final now = DateTime.utc(2030, 1, 1, 12);
    await tester.pumpWidget(
      _wrap(
        AttachmentExpiryIndicator(
          data: AttachmentViewData(
            id: 'e1',
            kind: AttachmentKind.imagePng,
            fileName: 'soon.png',
            byteSize: 1024,
            phase: AttachmentPhase.uploaded,
            expiresAt: now.add(const Duration(seconds: 45)),
          ),
          now: now,
        ),
      ),
    );
    expect(find.text('Expires in 45s'), findsOneWidget);
  });

  testWidgets('formats remaining time under one hour as minutes and seconds', (
    tester,
  ) async {
    final now = DateTime.utc(2030);
    await tester.pumpWidget(
      _wrap(
        AttachmentExpiryIndicator(
          data: AttachmentViewData(
            id: 'e2',
            kind: AttachmentKind.imagePng,
            fileName: 'h.png',
            byteSize: 1024,
            phase: AttachmentPhase.uploaded,
            expiresAt: now.add(const Duration(minutes: 4, seconds: 5)),
          ),
          now: now,
        ),
      ),
    );
    expect(find.text('Expires in 4m 5s'), findsOneWidget);
  });

  testWidgets('formats remaining time over an hour with hour + minutes', (
    tester,
  ) async {
    final now = DateTime.utc(2030);
    await tester.pumpWidget(
      _wrap(
        AttachmentExpiryIndicator(
          data: AttachmentViewData(
            id: 'e3',
            kind: AttachmentKind.imagePng,
            fileName: 'long.png',
            byteSize: 1024,
            phase: AttachmentPhase.uploaded,
            expiresAt: now.add(const Duration(hours: 2, minutes: 7)),
          ),
          now: now,
        ),
      ),
    );
    expect(find.text('Expires in 2h 7m'), findsOneWidget);
  });

  testWidgets('expired state shows Expired label and dismiss action', (
    tester,
  ) async {
    final now = DateTime.utc(2030, 1, 1, 12);
    var dismissed = false;
    await tester.pumpWidget(
      _wrap(
        AttachmentExpiryIndicator(
          data: AttachmentViewData(
            id: 'e4',
            kind: AttachmentKind.imagePng,
            fileName: 'gone.png',
            byteSize: 1024,
            phase: AttachmentPhase.expired,
            expiresAt: now.subtract(const Duration(seconds: 1)),
          ),
          now: now,
          onExpireAcknowledged: () => dismissed = true,
        ),
      ),
    );
    expect(find.text('Expired'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('attachment-expiry-ack-e4')));
    expect(dismissed, isTrue);
  });

  test(
    'attachmentIsSendable enforces expiry, removal, and zero-byte guards',
    () {
      final now = DateTime.utc(2030);
      final healthy = AttachmentViewData(
        id: 'h',
        kind: AttachmentKind.imagePng,
        fileName: 'h.png',
        byteSize: 1024,
        phase: AttachmentPhase.uploaded,
        expiresAt: now.add(const Duration(minutes: 5)),
      );
      expect(attachmentIsSendable(healthy, now), isTrue);
      final expired = healthy.copyWith(phase: AttachmentPhase.expired);
      expect(attachmentIsSendable(expired, now), isFalse);
      final removed = healthy.copyWith(removed: true);
      expect(attachmentIsSendable(removed, now), isFalse);
      final zeroByte = healthy.copyWith(); // pass
      // zero byte is a separate synthesised entry:
      final zero = AttachmentViewData(
        id: 'z',
        kind: AttachmentKind.imagePng,
        fileName: 'z.png',
        byteSize: 0,
        phase: AttachmentPhase.uploaded,
        expiresAt: now.add(const Duration(minutes: 5)),
      );
      expect(attachmentIsSendable(zero, now), isFalse);
      expect(zeroByte.id, 'h');
    },
  );
}
