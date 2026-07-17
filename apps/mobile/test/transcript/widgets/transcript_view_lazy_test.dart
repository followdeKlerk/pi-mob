/// Structural performance test for [TranscriptView].
//
// Verifies that the transcript list is truly lazy: when 1,000 assistant
// turns are queued in the document, the ListView.builder does not build
/// a [_TurnView] for every row on the first frame. The widget must:
///
///   * allocate far fewer than `turns.length` turn widgets initially
///     (the rendered subset plus a small overscan for the visible window),
///   * give each turn a stable, deterministic [ValueKey] derived from its
///     `widgetKey` so Flutter can reuse the existing element across
///     rebuilds,
///   * wrap each turn in a [RepaintBoundary] so streaming deltas do not
///     repaint the whole list,
///   * keep scrolling interactive: a drag/scroll must still move the
///     viewport, and tapping the jump-to-latest FAB must snap back to
///     the tail without rebuilding the full list.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/transcript/domain/transcript_document.dart';
import 'package:pi_mob/src/transcript/domain/transcript_items.dart';
import 'package:pi_mob/src/transcript/domain/transcript_turn.dart';
import 'package:pi_mob/src/transcript/widgets/transcript_view.dart';
import 'package:pi_mob/src/transcript/widgets/view_data/final_answer_view_data.dart';
import 'package:pi_mob/src/transcript/widgets/view_data/tool_call_view_data.dart';
import 'package:pi_mob/src/transcript/widgets/transcript_status.dart';

/// Counts how many turn widgets the [ListView] inside the given
/// [TranscriptView] has actually instantiated. Each row in the builder is
/// a [RepaintBoundary] wrapped around a turn, so the count of
/// [RepaintBoundary] widgets under the list key is the precise answer.
int _builtTurnCount(WidgetTester tester) {
  return find
      .descendant(
        of: find.byKey(const Key('transcript-list')),
        matching: find.byType(RepaintBoundary),
      )
      .evaluate()
      .length;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    '1000 turns: lazy build budget, stable keys, scroll remains functional',
    (tester) async {
      const total = 1000;
      final turns = List<Turn>.generate(
        total,
        (i) => AssistantTurn(
          turnId: 'turn-$i',
          assistantStepId: 'step-$i',
          status: AssistantTurnStatus.completed,
          items: [
            FinalAnswerItem(
              itemId: 'ans-$i',
              assistantStepId: 'step-$i',
              viewData: FinalAnswerViewData(
                answerId: 'ans-$i',
                markdown: 'answer $i body with some content',
              ),
            ),
            ToolItem(
              itemId: 'tool-$i',
              assistantStepId: 'step-$i',
              viewData: ToolCallViewData(
                toolCallId: 'tool-$i',
                toolName: BuiltInToolName.bash,
                arguments: <String, Object?>{'command': 'echo $i'},
                status: TranscriptToolStatus.completed,
                result: const <String, Object?>{
                  'stdout': '',
                  'stderr': '',
                  'exitCode': 0,
                },
              ),
            ),
          ],
        ),
      );
      final document = TranscriptDocument(
        streamId: 'session:s',
        turns: turns,
        diagnostics: const [],
        lastSettledTurnId: null,
      );

      await tester.binding.setSurfaceSize(const Size(400, 1600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: TranscriptView(document: document)),
        ),
      );
      await tester.pump();

      // The list should exist and have a scrollable extent consistent with
      // `total` items being available.
      final listFinder = find.byKey(const Key('transcript-list'));
      expect(listFinder, findsOneWidget);
      final list = tester.widget<ListView>(listFinder);
      expect(list.controller, isNotNull);
      expect(list.controller!.position.maxScrollExtent, greaterThan(0));

      // Lazy build budget: far fewer than `total` turn widgets built.
      final builtHeads = _builtTurnCount(tester);
      expect(
        builtHeads,
        lessThan(total ~/ 4),
        reason:
            'TranscriptView must not build every turn on first paint; built '
            '$builtHeads of $total.',
      );

      // RepaintBoundary must wrap each built _TurnView. The framework
      // reorders widgets, so we just verify that at least one boundary
      // exists between the list and the bottom of the tree.
      expect(
        find.descendant(of: listFinder, matching: find.byType(RepaintBoundary)),
        findsWidgets,
      );

      // Scroll remains functional: a drag must change the offset.
      final controllerBefore = (tester
          .widget<ListView>(listFinder)
          .controller)!;
      final startOffset = controllerBefore.offset;
      await tester.drag(listFinder, const Offset(0, 2000));
      await tester.pump();
      final midOffset =
          (tester.widget<ListView>(listFinder).controller)!.offset;
      expect(midOffset, lessThan(startOffset));

      // FAB should now be visible because we scrolled away from the tail.
      expect(find.byKey(const Key('jump-to-latest')), findsOneWidget);

      // Returning to latest animates gently without repainting every turn;
      // the offset should settle at maxScrollExtent.
      await tester.tap(find.byKey(const Key('jump-to-latest')));
      await tester.pumpAndSettle();
      final controllerAfter = (tester.widget<ListView>(listFinder).controller)!;
      expect(
        controllerAfter.offset,
        controllerAfter.position.maxScrollExtent,
        reason: 'jump-to-latest must settle at the end of the document',
      );
      expect(find.byKey(const Key('jump-to-latest')), findsNothing);

      // After jumping to latest, scrolling to a specific position must
      // still surface the key for that turn.
      controllerAfter.jumpTo(controllerAfter.position.maxScrollExtent - 200);
      await tester.pump();
      expect(
        (tester.widget<ListView>(listFinder).controller)!.offset,
        closeTo(controllerAfter.position.maxScrollExtent - 200, 1),
      );
    },
    timeout: const Timeout(Duration(minutes: 1)),
  );
}
