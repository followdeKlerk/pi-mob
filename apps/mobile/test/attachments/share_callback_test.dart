import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:pi_mob/src/attachments/attachments.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

HtmlExportViewData _completed() => HtmlExportViewData(
  phase: HtmlExportPhase.completed,
  exportId: 'exp-share-1',
  fileName: 'session.html',
  mimeType: 'text/html',
  byteSize: 4096,
  downloadedBytes: 4096,
  progressFraction: 1.0,
  shareAvailable: true,
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('disabled share button when export not ready', (tester) async {
    await tester.pumpWidget(
      _wrap(
        HtmlExportShareSheet(
          data: const HtmlExportViewData(phase: HtmlExportPhase.idle),
          shareCallback: const NoopNativeShareCallback(),
        ),
      ),
    );
    final button = tester.widget<Widget>(
      find.byKey(const Key('html-export-share-open')),
    );
    expect(button, isA<FilledButton>());
    expect((button as FilledButton).onPressed, isNull);
    expect(
      find.byKey(const Key('html-export-share-privacy-warning')),
      findsOneWidget,
    );
  });

  testWidgets(
    'share click routes through abstract callback and surfaces result',
    (tester) async {
      final recorder = RecordingNativeShareCallback(
        responder: (_) async =>
            const ShareResult(status: ShareStatus.dismissed),
      );
      Object? lastResult;
      await tester.pumpWidget(
        _wrap(
          HtmlExportShareSheet(
            data: _completed(),
            shareCallback: recorder,
            onShareResult: (result) => lastResult = result,
          ),
        ),
      );
      expect(
        find.byKey(const Key('html-export-share-privacy-warning')),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('html-export-share-open')));
      await tester.pumpAndSettle();
      expect(recorder.requests, hasLength(1));
      final request = recorder.requests.single;
      expect(request.exportId, 'exp-share-1');
      expect(request.fileName, 'session.html');
      expect(request.mimeType, 'text/html');
      expect(request.byteSize, 4096);
      expect((lastResult as ShareResult?)?.status, ShareStatus.dismissed);
    },
  );

  testWidgets('noop share callback reports unsupported when invoked', (
    tester,
  ) async {
    final noop = const NoopNativeShareCallback();
    final result = await noop.share(
      ShareRequest(exportId: 'x', fileName: 'a.html', mimeType: 'text/html'),
    );
    expect(result.status, ShareStatus.unsupported);
    expect(result.isTerminal, isTrue);
  });

  test('ShareRequest.toJson omits free text payloads while preserving ids', () {
    const request = ShareRequest(
      exportId: 'exp-9',
      fileName: 'a.html',
      mimeType: 'text/html',
      byteSize: 100,
      localPath: '/tmp/a.html',
      text: 'unused',
    );
    final json = request.toJson();
    expect(json['exportId'], 'exp-9');
    expect(json['fileName'], 'a.html');
    expect(json['hasText'], isTrue);
    expect(json.containsKey('text'), isFalse);
  });

  testWidgets('completed without shareAvailable disables button', (
    tester,
  ) async {
    final data = _completed().copyWith(shareAvailable: false);
    await tester.pumpWidget(
      _wrap(
        HtmlExportShareSheet(
          data: data,
          shareCallback: const NoopNativeShareCallback(),
        ),
      ),
    );
    final button = tester.widget<Widget>(
      find.byKey(const Key('html-export-share-open')),
    );
    expect(button, isA<FilledButton>());
    expect((button as FilledButton).onPressed, isNull);
  });
}
