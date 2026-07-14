import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:pi_mob/src/attachments/attachments.dart';

/// 200% text-scale + reduced motion accessibility sweep for the M13
/// attachment/export surfaces.
Widget _wrap(Widget child, {double textScale = 1.0}) => MaterialApp(
  home: MediaQuery(
    data: MediaQueryData(textScaler: TextScaler.linear(textScale)),
    child: Scaffold(body: child),
  ),
);

AttachmentViewData _selected() => AttachmentViewData(
  id: 'ax',
  kind: AttachmentKind.imageJpeg,
  fileName: 'very-long-file-name-with-detail-and-tags.jpg',
  byteSize: 4096,
  phase: AttachmentPhase.selected,
  dimensions: const AttachmentDimensions(4032, 3024),
  digest: 'sha256:0123456789abcdef',
  expiresAt: DateTime.utc(2030, 1, 1, 12, 30),
);

AttachmentViewData _failed() => AttachmentViewData(
  id: 'fx',
  kind: AttachmentKind.imageJpeg,
  fileName: 'failed-upload.jpg',
  byteSize: 16 * 1024,
  phase: AttachmentPhase.failed,
  failureMessage: 'transport reset',
  uploadedBytes: 4096,
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('attachment chip at 200% renders without overflow', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        AttachmentChip(
          data: _selected(),
          callbacks: const AttachmentCallbacks(
            onRemove: _noop,
            onReplace: _noop,
            onPreviewTap: _noop,
          ),
        ),
        textScale: 2.0,
      ),
    );
    expect(tester.takeException(), isNull);
    // Semantics label is preserved at 200% text scaling.
    expect(
      find.bySemanticsLabel(RegExp(r'sha256:0123456789abcdef')),
      findsOneWidget,
    );
  });

  testWidgets('upload progress at 200% keeps retry/replace/remove usable', (
    tester,
  ) async {
    var retried = false;
    var replaced = false;
    var removed = false;
    await tester.pumpWidget(
      _wrap(
        AttachmentUploadProgress(
          data: _failed(),
          callbacks: AttachmentCallbacks(
            onRetry: (_) => retried = true,
            onReplace: (_) => replaced = true,
            onRemove: (_) => removed = true,
          ),
        ),
        textScale: 2.0,
      ),
    );
    expect(tester.takeException(), isNull);
    await tester.tap(find.byKey(const ValueKey('attachment-retry-fx')));
    await tester.tap(
      find.byKey(const ValueKey('attachment-replace-upload-fx')),
    );
    await tester.tap(find.byKey(const ValueKey('attachment-remove-upload-fx')));
    expect(retried, isTrue);
    expect(replaced, isTrue);
    expect(removed, isTrue);
  });

  testWidgets('HTML export + share at 200% remains reachable', (tester) async {
    final recorder = RecordingNativeShareCallback();
    final data = HtmlExportViewData(
      phase: HtmlExportPhase.completed,
      exportId: 'exp-200',
      fileName: 'session-with-a-very-long-name.html',
      mimeType: 'text/html',
      byteSize: 32 * 1024,
      downloadedBytes: 32 * 1024,
      progressFraction: 1.0,
      shareAvailable: true,
      downloadPath: '/tmp/session.html',
      expiresAt: DateTime.utc(2030, 1, 1, 14),
    );
    await tester.pumpWidget(
      _wrap(
        Column(
          children: [
            HtmlExportProgressCard(
              data: data,
              callbacks: const HtmlExportCallbacks(),
            ),
            HtmlExportShareSheet(data: data, shareCallback: recorder),
          ],
        ),
        textScale: 2.0,
      ),
    );
    expect(tester.takeException(), isNull);
    await tester.tap(find.byKey(const Key('html-export-share-open')));
    await tester.pumpAndSettle();
    expect(recorder.requests, hasLength(1));
  });

  testWidgets('semantics labels mention digest + expiry at 200%', (
    tester,
  ) async {
    final handler = tester.ensureSemantics();
    await tester.pumpWidget(
      _wrap(
        AttachmentSurface(
          data: AttachmentSurfaceData(attachments: [_selected()]),
          callbacks: const AttachmentCallbacks(),
          now: DateTime.utc(2030, 1, 1, 12),
        ),
        textScale: 2.0,
      ),
    );
    final node = tester.getSemantics(
      find.bySemanticsLabel(RegExp(r'sha256:0123456789abcdef')),
    );
    expect(node.label, contains('Digest sha256:0123456789abcdef'));
    expect(
      node.label,
      contains('expires ${DateTime.utc(2030, 1, 1, 12, 30).toIso8601String()}'),
    );
    handler.dispose();
  });
}

void _noop(String _) {}
