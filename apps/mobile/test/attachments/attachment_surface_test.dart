import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:pi_mob/src/attachments/attachments.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('renders chips, hides removed, surfaces full-count warning', (
    tester,
  ) async {
    final now = DateTime.utc(2030);
    await tester.pumpWidget(
      _wrap(
        AttachmentSurface(
          data: AttachmentSurfaceData(
            attachments: [
              AttachmentViewData(
                id: 's1',
                kind: AttachmentKind.imageJpeg,
                fileName: 'one.jpg',
                byteSize: 1024,
                phase: AttachmentPhase.uploaded,
              ),
              AttachmentViewData(
                id: 's2',
                kind: AttachmentKind.imagePng,
                fileName: 'two.png',
                byteSize: 2048,
                phase: AttachmentPhase.removed,
              ),
              AttachmentViewData(
                id: 's3',
                kind: AttachmentKind.imagePng,
                fileName: 'three.png',
                byteSize: 2048,
                phase: AttachmentPhase.uploaded,
              ),
              AttachmentViewData(
                id: 's4',
                kind: AttachmentKind.imagePng,
                fileName: 'four.png',
                byteSize: 2048,
                phase: AttachmentPhase.uploaded,
              ),
            ],
            maxAttachmentCount: 4,
          ),
          callbacks: const AttachmentCallbacks(),
          now: now,
        ),
      ),
    );
    expect(find.text('one.jpg'), findsOneWidget);
    expect(find.text('two.png'), findsNothing);
    expect(find.text('three.png'), findsOneWidget);
    expect(find.text('Maximum 4 attachments reached'), findsOneWidget);
  });

  testWidgets('shows upload progress row for failed attachments', (
    tester,
  ) async {
    final now = DateTime.utc(2030);
    await tester.pumpWidget(
      _wrap(
        AttachmentSurface(
          data: AttachmentSurfaceData(
            attachments: [
              AttachmentViewData(
                id: 'sx',
                kind: AttachmentKind.imagePng,
                fileName: 'broken.png',
                byteSize: 4096,
                phase: AttachmentPhase.failed,
                failureMessage: 'digest mismatch',
              ),
            ],
          ),
          callbacks: AttachmentCallbacks(onRetry: (_) {}),
          now: now,
        ),
      ),
    );
    expect(find.text('digest mismatch'), findsOneWidget);
    expect(find.byKey(const ValueKey('attachment-retry-sx')), findsOneWidget);
  });

  testWidgets('unavailable reason replaces the entire surface', (tester) async {
    await tester.pumpWidget(
      _wrap(
        AttachmentSurface(
          data: const AttachmentSurfaceData(
            attachments: <AttachmentViewData>[],
            unavailableReason: 'host does not allow attachments',
          ),
          callbacks: const AttachmentCallbacks(),
          now: DateTime.utc(2030),
        ),
      ),
    );
    expect(
      find.textContaining('host does not allow attachments'),
      findsOneWidget,
    );
    expect(
      find.byKey(const Key('attachment-surface-full-warning')),
      findsNothing,
    );
  });

  testWidgets('expiry acknowledgement propagates with attachment id', (
    tester,
  ) async {
    final now = DateTime.utc(2030, 1, 1, 12);
    String? ack;
    await tester.pumpWidget(
      _wrap(
        AttachmentSurface(
          data: AttachmentSurfaceData(
            attachments: [
              AttachmentViewData(
                id: 'exp1',
                kind: AttachmentKind.imagePng,
                fileName: 'old.png',
                byteSize: 1024,
                phase: AttachmentPhase.expired,
                expiresAt: now.subtract(const Duration(seconds: 5)),
              ),
            ],
          ),
          callbacks: const AttachmentCallbacks(),
          now: now,
          onExpireAcknowledged: (id) => ack = id,
        ),
      ),
    );
    await tester.tap(find.byKey(const ValueKey('attachment-expiry-ack-exp1')));
    expect(ack, 'exp1');
  });

  test('AttachmentSurfaceData.isFull and live count are bounded', () {
    final data = AttachmentSurfaceData(
      attachments: [
        AttachmentViewData(
          id: 'a',
          kind: AttachmentKind.imageJpeg,
          fileName: 'a.jpg',
          byteSize: 1,
          phase: AttachmentPhase.uploaded,
        ),
        AttachmentViewData(
          id: 'b',
          kind: AttachmentKind.imageJpeg,
          fileName: 'b.jpg',
          byteSize: 1,
          phase: AttachmentPhase.removed,
        ),
      ],
      maxAttachmentCount: 2,
    );
    expect(data.isFull, isTrue);
    expect(data.liveAttachmentCount, 1);
  });
}
