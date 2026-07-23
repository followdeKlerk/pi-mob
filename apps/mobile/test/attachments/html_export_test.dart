import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:pi_mob/src/attachments/attachments.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('idle phase exposes Generate HTML start action', (tester) async {
    var started = false;
    await tester.pumpWidget(
      _wrap(
        HtmlExportProgressCard(
          data: HtmlExportViewData.idle(),
          callbacks: HtmlExportCallbacks(onStart: () => started = true),
        ),
      ),
    );
    expect(find.text('Export idle'), findsOneWidget);
    await tester.tap(find.byKey(const Key('html-export-start')));
    expect(started, isTrue);
  });

  testWidgets('downloading phase renders determinate progress + cancel', (
    tester,
  ) async {
    var cancelled = false;
    await tester.pumpWidget(
      _wrap(
        HtmlExportProgressCard(
          data: const HtmlExportViewData(
            phase: HtmlExportPhase.downloading,
            exportId: 'exp-1',
            fileName: 'session.html',
            byteSize: 10240,
            downloadedBytes: 5120,
            progressFraction: 0.5,
          ),
          callbacks: HtmlExportCallbacks(onCancel: () => cancelled = true),
        ),
      ),
    );
    expect(find.text('Downloading HTML export'), findsOneWidget);
    expect(find.text('5 / 10 KB'), findsOneWidget);
    expect(find.text('Export ID exp-1'), findsOneWidget);
    await tester.tap(find.byKey(const Key('html-export-cancel')));
    expect(cancelled, isTrue);
  });

  testWidgets('failed phase surfaces error and retry action', (tester) async {
    var retry = false;
    await tester.pumpWidget(
      _wrap(
        HtmlExportProgressCard(
          data: const HtmlExportViewData(
            phase: HtmlExportPhase.failed,
            failureMessage: 'transport closed',
          ),
          callbacks: HtmlExportCallbacks(onRetry: () => retry = true),
        ),
      ),
    );
    expect(find.text('transport closed'), findsOneWidget);
    await tester.tap(find.byKey(const Key('html-export-retry')));
    expect(retry, isTrue);
  });

  testWidgets('completed phase shows expiry footer when provided', (
    tester,
  ) async {
    final expires = DateTime.utc(2030, 1, 1, 13);
    await tester.pumpWidget(
      _wrap(
        HtmlExportProgressCard(
          data: HtmlExportViewData(
            phase: HtmlExportPhase.completed,
            exportId: 'exp-2',
            fileName: 'session.html',
            mimeType: 'text/html',
            byteSize: 2048,
            downloadedBytes: 2048,
            progressFraction: 1.0,
            downloadPath: '/tmp/session.html',
            shareAvailable: true,
            expiresAt: expires,
          ),
          callbacks: const HtmlExportCallbacks(),
        ),
      ),
    );
    expect(find.text('Export ready'), findsOneWidget);
    expect(
      find.textContaining('expires ${expires.toIso8601String()}'),
      findsOneWidget,
    );
  });

  test('HtmlExportViewData.hasExport gates on id + completed/downloaded', () {
    const completed = HtmlExportViewData(
      phase: HtmlExportPhase.completed,
      exportId: 'x',
      fileName: 's.html',
      progressFraction: 1.0,
    );
    expect(completed.hasExport, isTrue);
    const downloading = HtmlExportViewData(
      phase: HtmlExportPhase.downloading,
      exportId: 'x',
      fileName: 's.html',
    );
    expect(downloading.hasExport, isFalse);
  });

  test('copyWith clears failure when clearFailure is true', () {
    const data = HtmlExportViewData(
      phase: HtmlExportPhase.failed,
      failureMessage: 'oops',
    );
    final cleared = data.copyWith(clearFailure: true);
    expect(cleared.failureMessage, isNull);
    final kept = data.copyWith(failureMessage: 'still bad');
    expect(kept.failureMessage, 'still bad');
  });
}
