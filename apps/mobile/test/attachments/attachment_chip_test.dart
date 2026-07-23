import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:pi_mob/src/attachments/attachments.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('renders kind label, byte summary, and remove action', (
    tester,
  ) async {
    String? removedId;
    String? previewedId;
    await tester.pumpWidget(
      _wrap(
        AttachmentChip(
          data: AttachmentViewData(
            id: 'a1',
            kind: AttachmentKind.imagePng,
            fileName: 'photo.png',
            byteSize: 2048,
            phase: AttachmentPhase.uploaded,
            dimensions: const AttachmentDimensions(800, 600),
            digest: 'sha256:abcd',
            expiresAt: DateTime.utc(2030),
          ),
          callbacks: AttachmentCallbacks(
            onRemove: (id) => removedId = id,
            onPreviewTap: (id) => previewedId = id,
          ),
        ),
      ),
    );
    expect(find.text('photo.png'), findsOneWidget);
    expect(find.text('2 KB, 800 by 600'), findsOneWidget);
    expect(find.text('Uploaded'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('attachment-remove-a1')));
    expect(removedId, 'a1');
    await tester.tap(find.byKey(const ValueKey('attachment-chip-a1')));
    expect(previewedId, 'a1');
  });

  testWidgets('failed phase surfaces error message', (tester) async {
    await tester.pumpWidget(
      _wrap(
        AttachmentChip(
          data: AttachmentViewData(
            id: 'a2',
            kind: AttachmentKind.imageJpeg,
            fileName: 'broken.jpg',
            byteSize: 16 * 1024,
            phase: AttachmentPhase.failed,
            failureMessage: 'digest mismatch',
          ),
          callbacks: const AttachmentCallbacks(),
        ),
      ),
    );
    expect(find.textContaining('digest mismatch'), findsOneWidget);
  });

  testWidgets('replace fires callback with attachment id', (tester) async {
    String? replaced;
    await tester.pumpWidget(
      _wrap(
        AttachmentChip(
          data: AttachmentViewData(
            id: 'a3',
            kind: AttachmentKind.imagePng,
            fileName: 'a.png',
            byteSize: 1024,
            phase: AttachmentPhase.selected,
          ),
          callbacks: AttachmentCallbacks(onReplace: (id) => replaced = id),
        ),
      ),
    );
    await tester.tap(find.byKey(const ValueKey('attachment-replace-a3')));
    expect(replaced, 'a3');
  });

  testWidgets('action gate disables remove and replace when locked', (
    tester,
  ) async {
    var called = false;
    await tester.pumpWidget(
      _wrap(
        AttachmentChip(
          data: AttachmentViewData(
            id: 'a4',
            kind: AttachmentKind.imagePng,
            fileName: 'locked.png',
            byteSize: 1024,
            phase: AttachmentPhase.selected,
          ),
          callbacks: AttachmentCallbacks(
            onRemove: (_) => called = true,
            onReplace: (_) => called = true,
            onPreviewTap: (_) => called = true,
          ),
          onActionGate: const AttachmentActionGate(
            remove: true,
            replace: true,
            preview: true,
            reason: 'busy',
          ),
        ),
      ),
    );
    final removeButton = tester.widget<IconButton>(
      find.byKey(const ValueKey('attachment-remove-a4')),
    );
    expect(removeButton.onPressed, isNull);
    final replaceButton = tester.widget<IconButton>(
      find.byKey(const ValueKey('attachment-replace-a4')),
    );
    expect(replaceButton.onPressed, isNull);
    expect(called, isFalse);
  });

  test('AttachmentActionGate.allows respects boolean fields', () {
    const gate = AttachmentActionGate(remove: true);
    expect(gate.allows(AttachmentAction.remove), isFalse);
    expect(gate.allows(AttachmentAction.replace), isTrue);
  });

  test('attachmentKindFromMime maps known and unknown mime types', () {
    expect(attachmentKindFromMime('image/jpeg'), AttachmentKind.imageJpeg);
    expect(attachmentKindFromMime('image/png'), AttachmentKind.imagePng);
    expect(attachmentKindFromMime('image/webp'), AttachmentKind.unknownImage);
    expect(
      attachmentKindFromMime('application/octet-stream'),
      AttachmentKind.genericFile,
    );
    expect(attachmentKindFromMime(null), AttachmentKind.genericFile);
  });
}
