import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:pi_mob/src/attachments/attachments.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('barrel exports every widget type', () {
    final attachment = AttachmentViewData(
      id: 'x',
      kind: AttachmentKind.imagePng,
      fileName: 'x',
      byteSize: 1,
      phase: AttachmentPhase.selected,
    );
    expect(attachment.id, 'x');
    expect(attachmentIsSendable, isNotNull);
    expect(AttachmentCallbacks, isNotNull);
    expect(AttachmentActionGate, isNotNull);
    expect(NativeShareCallback, isNotNull);
    expect(NoopNativeShareCallback, isNotNull);
    expect(RecordingNativeShareCallback, isNotNull);
    expect(ShareRequest, isNotNull);
    expect(ShareResult, isNotNull);
    expect(ShareStatus, isNotNull);
    expect(HtmlExportViewData, isNotNull);
    expect(HtmlExportCallbacks, isNotNull);
  });

  test('ShareResult.isTerminal covers all closed states', () {
    expect(const ShareResult(status: ShareStatus.completed).isTerminal, isTrue);
    expect(const ShareResult(status: ShareStatus.dismissed).isTerminal, isTrue);
    expect(
      const ShareResult(status: ShareStatus.unsupported).isTerminal,
      isTrue,
    );
    expect(const ShareResult(status: ShareStatus.failed).isTerminal, isFalse);
  });

  test('HtmlExportPhase is eight members', () {
    expect(HtmlExportPhase.values, hasLength(8));
  });

  test('AttachmentPhase covers selected..removed', () {
    expect(AttachmentPhase.values, hasLength(7));
  });

  testWidgets('attachment preview renders placeholder without ImageProvider', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: AttachmentPreview(
            data: AttachmentViewData(
              id: 'p1',
              kind: AttachmentKind.imagePng,
              fileName: 'preview.png',
              byteSize: 1024,
              phase: AttachmentPhase.uploaded,
              dimensions: AttachmentDimensions(640, 480),
            ),
          ),
        ),
      ),
    );
    expect(find.text('preview.png'), findsOneWidget);
    expect(find.text('640x480'), findsOneWidget);
  });
}
