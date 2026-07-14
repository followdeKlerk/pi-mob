/// Compact tests for [ReasoningBlock].
///
/// Coverage:
///
///   * Active reasoning is shown expanded by default with a live spinner
///     and no visible chevron collapse affordance.
///   * Completed reasoning is collapsed by default and the steps list is
///     hidden until the user taps the header.
///   * The user's manual toggle survives data refreshes that do not
///     change the lifecycle phase.
///   * When the lifecycle phase transitions (e.g. active -> completed),
///     the expansion state re-anchors to the new default.
///   * The widget exposes a single semantic container with the phase
///     label and the summary.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/transcript/widgets/reasoning_block.dart';
import 'package:pi_mob/src/transcript/widgets/view_data/reasoning_view_data.dart';

ReasoningViewData _reasoning({
  required ReasoningPhase phase,
  String summary = 'Chain of thought',
  List<String> steps = const <String>[
    'inspect code',
    'form hypothesis',
    'verify',
  ],
}) => ReasoningViewData(
  reasoningId: 'r-${phase.name}',
  phase: phase,
  summary: summary,
  steps: steps,
);

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('active reasoning is expanded by default with spinner', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        ReasoningBlock.forViewData(_reasoning(phase: ReasoningPhase.active)),
      ),
    );
    expect(find.text('Reasoning in progress'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    // Steps list visible immediately.
    expect(find.text('inspect code'), findsOneWidget);
    expect(find.byKey(const Key('reasoning-header')), findsOneWidget);
  });

  testWidgets('completed reasoning is collapsed by default', (tester) async {
    await tester.pumpWidget(
      _wrap(
        ReasoningBlock.forViewData(_reasoning(phase: ReasoningPhase.completed)),
      ),
    );
    expect(find.text('Reasoning'), findsOneWidget);
    expect(find.text('inspect code'), findsNothing);
    // No spinner in completed phase.
    expect(find.byType(CircularProgressIndicator), findsNothing);
    // Expand on tap.
    await tester.tap(find.byKey(const Key('reasoning-header')));
    await tester.pump();
    expect(find.text('inspect code'), findsOneWidget);
  });

  testWidgets(
    'manual toggle survives non-phase data refresh of the same widget',
    (tester) async {
      final key = GlobalKey();
      await tester.pumpWidget(
        _wrap(
          ReasoningBlock.forViewData(
            const ReasoningViewData(
              reasoningId: 'r1',
              phase: ReasoningPhase.completed,
              summary: 'planned',
              steps: <String>['a', 'b', 'c'],
            ),
            key: key,
          ),
        ),
      );
      await tester.tap(find.byKey(const Key('reasoning-header')));
      await tester.pump();
      expect(find.text('a'), findsOneWidget);

      // Refresh with new content but same phase + key; expansion must persist.
      await tester.pumpWidget(
        _wrap(
          ReasoningBlock.forViewData(
            const ReasoningViewData(
              reasoningId: 'r1',
              phase: ReasoningPhase.completed,
              summary: 'replanned',
              steps: <String>['x', 'y', 'z'],
            ),
            key: key,
          ),
        ),
      );
      expect(find.text('x'), findsOneWidget);
      expect(find.text('a'), findsNothing);
    },
  );

  testWidgets(
    'phase transition (active -> completed) re-anchors to collapsed',
    (tester) async {
      final key = GlobalKey();
      Widget build(ReasoningViewData data) =>
          _wrap(ReasoningBlock.forViewData(data, key: key));

      await tester.pumpWidget(
        build(
          const ReasoningViewData(
            reasoningId: 'r2',
            phase: ReasoningPhase.active,
            summary: '',
          ),
        ),
      );
      // Active is expanded; user forced collapse.
      await tester.tap(find.byKey(const Key('reasoning-header')));
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      // Phase flips to completed -> expansion re-anchors to default.
      await tester.pumpWidget(
        build(
          const ReasoningViewData(
            reasoningId: 'r2',
            phase: ReasoningPhase.completed,
            summary: 'done',
            steps: <String>['final'],
          ),
        ),
      );
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.text('final'), findsNothing);
    },
  );

  testWidgets('semantics label announces phase and summary', (tester) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(
      _wrap(
        ReasoningBlock.forViewData(
          const ReasoningViewData(
            reasoningId: 'r3',
            phase: ReasoningPhase.completed,
            summary: 'short summary',
          ),
        ),
      ),
    );
    expect(find.bySemanticsLabel('Reasoning: short summary'), findsOneWidget);
    handle.dispose();
  });
}
