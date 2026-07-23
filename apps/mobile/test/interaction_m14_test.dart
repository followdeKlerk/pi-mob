import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/domain/interaction_state.dart';
import 'package:pi_mob/src/interaction/interaction_panel.dart';

void main() {
  testWidgets('queue is inspectable removable clearable and scales to 200%', (
    tester,
  ) async {
    String? removed;
    var cleared = false;
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(2)),
          child: Scaffold(
            body: FollowUpQueuePanel(
              items: const [
                FollowUpItem(
                  queueItemId: 'q1',
                  position: 1,
                  message: 'first follow-up',
                  attachmentIds: ['a'],
                ),
              ],
              onRemove: (id) => removed = id,
              onClear: () => cleared = true,
            ),
          ),
        ),
      ),
    );
    expect(find.text('Queued follow-ups (1/10)'), findsOneWidget);
    await tester.tap(find.byTooltip('Remove queued follow-up 1'));
    expect(removed, 'q1');
    await tester.tap(find.byKey(const Key('queue-clear')));
    expect(cleared, isTrue);
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'input dialog focuses, responds, and expired text remains copyable but unsendable',
    (tester) async {
      String? captured;
      var now = DateTime.utc(2026);
      final dialog = ExtensionDialogState(
        dialogId: 'd1',
        method: ExtensionDialogMethod.input,
        title: 'Question',
        expiresAt: now.add(const Duration(minutes: 1)),
        placeholder: 'Answer',
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ExtensionDialogPanel(
              dialog: dialog,
              now: () => now,
              onRespond:
                  ({String? value, bool? confirmed, bool cancelled = false}) {
                    captured = value;
                  },
            ),
          ),
        ),
      );
      await tester.pump();
      expect(FocusManager.instance.primaryFocus?.hasFocus, isTrue);
      await tester.enterText(
        find.byKey(const Key('extension-dialog-input')),
        'typed answer',
      );
      await tester.tap(find.byKey(const Key('extension-dialog-submit')));
      expect(captured, 'typed answer');
      expect(find.text('typed answer'), findsOneWidget);
      now = now.add(const Duration(minutes: 2));
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ExtensionDialogPanel(
              dialog: dialog,
              now: () => now,
              onRespond:
                  ({String? value, bool? confirmed, bool cancelled = false}) {},
            ),
          ),
        ),
      );
      expect(
        find.text('Expired. Text remains available to copy.'),
        findsOneWidget,
      );
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const Key('extension-dialog-submit')),
            )
            .onPressed,
        isNull,
      );
    },
  );
  test('wire models bound and preserve canonical identity', () {
    final item = FollowUpItem.fromWire({
      'queueItemId': 'q',
      'position': 2,
      'message': 'm',
      'attachmentIds': ['a'],
    });
    expect(item.position, 2);
    final dialog = ExtensionDialogState.fromWire({
      'dialogId': 'd',
      'method': 'select',
      'title': 'Pick',
      'expiresAt': '2026-01-01T00:00:00Z',
      'options': ['one'],
    });
    expect(dialog.method, ExtensionDialogMethod.select);
    expect(dialog.options, ['one']);
  });
}
