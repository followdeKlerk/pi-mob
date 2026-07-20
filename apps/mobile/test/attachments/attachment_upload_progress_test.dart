import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:pi_mob/src/attachments/attachments.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

AttachmentViewData _data({
  AttachmentPhase phase = AttachmentPhase.uploading,
  double? fraction,
  String? failure,
}) => AttachmentViewData(
  id: 'up1',
  kind: AttachmentKind.imageJpeg,
  fileName: 'progress.jpg',
  byteSize: 4096,
  phase: phase,
  progressFraction: fraction,
  uploadedBytes: (fraction ?? 0.5) ~/ 1 == 0
      ? (4096 * (fraction ?? 0.5)).round()
      : 2048,
  failureMessage: failure,
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('uploading with fraction renders determinate progress + bytes', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        AttachmentUploadProgress(
          data: _data(fraction: 0.5),
          callbacks: const AttachmentCallbacks(),
        ),
      ),
    );
    expect(find.text('Uploading'), findsOneWidget);
    expect(find.textContaining('KB'), findsOneWidget);
    final progress = tester.widget<AttachmentUploadProgress>(
      find.byType(AttachmentUploadProgress),
    );
    expect(progress.data.progressFraction, 0.5);
    final bar = tester.widget<LinearProgressIndicator>(
      find.byType(LinearProgressIndicator),
    );
    expect(bar.value, 0.5);
  });

  testWidgets('failed phase exposes retry/replace/remove actions', (
    tester,
  ) async {
    String? retryId;
    String? replaceId;
    String? removeId;
    await tester.pumpWidget(
      _wrap(
        AttachmentUploadProgress(
          data: _data(phase: AttachmentPhase.failed, failure: 'network'),
          callbacks: AttachmentCallbacks(
            onRetry: (id) => retryId = id,
            onReplace: (id) => replaceId = id,
            onRemove: (id) => removeId = id,
          ),
        ),
      ),
    );
    expect(find.text('network'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('attachment-retry-up1')));
    await tester.tap(
      find.byKey(const ValueKey('attachment-replace-upload-up1')),
    );
    await tester.tap(
      find.byKey(const ValueKey('attachment-remove-upload-up1')),
    );
    expect(retryId, 'up1');
    expect(replaceId, 'up1');
    expect(removeId, 'up1');
  });

  testWidgets('uploaded phase hides retry row', (tester) async {
    await tester.pumpWidget(
      _wrap(
        AttachmentUploadProgress(
          data: _data(phase: AttachmentPhase.uploaded, fraction: 1.0),
          callbacks: const AttachmentCallbacks(),
        ),
      ),
    );
    expect(find.byKey(const ValueKey('attachment-retry-up1')), findsNothing);
    expect(find.text('Uploading'), findsOneWidget);
  });

  testWidgets('indeterminate when uploading without fraction', (tester) async {
    final data = AttachmentViewData(
      id: 'up2',
      kind: AttachmentKind.imagePng,
      fileName: 'ind.png',
      byteSize: 1024,
      phase: AttachmentPhase.uploading,
    );
    await tester.pumpWidget(
      _wrap(
        AttachmentUploadProgress(
          data: data,
          callbacks: const AttachmentCallbacks(),
        ),
      ),
    );
    expect(
      find.byKey(const ValueKey('attachment-progress-bar-up2')),
      findsOneWidget,
    );
    final bar = tester.widget<LinearProgressIndicator>(
      find.byType(LinearProgressIndicator),
    );
    expect(bar.value, isNull);
  });
}
