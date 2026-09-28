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
import 'package:pi_mob/src/transcript/widgets/reasoning_orb.dart';
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

  testWidgets('active reasoning is a compact collapsed Thinking row', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        ReasoningBlock.forViewData(_reasoning(phase: ReasoningPhase.active)),
      ),
    );
    expect(find.text('Thinking…'), findsOneWidget);
    expect(find.byType(ReasoningOrb), findsOneWidget);
    expect(find.text('inspect code'), findsNothing);
    expect(find.byKey(const Key('reasoning-header')), findsOneWidget);
  });

  testWidgets('completed reasoning is collapsed by default', (tester) async {
    await tester.pumpWidget(
      _wrap(
        ReasoningBlock.forViewData(_reasoning(phase: ReasoningPhase.completed)),
      ),
    );
    expect(find.text('Thinking'), findsOneWidget);
    expect(find.text('inspect code'), findsNothing);
    // The completed phase keeps the orb as a calm, deterministic check state.
    expect(find.byType(ReasoningOrb), findsOneWidget);
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
      // Active begins collapsed; the user can disclose it explicitly.
      await tester.tap(find.byKey(const Key('reasoning-header')));
      await tester.pump();
      expect(find.byType(ReasoningOrb), findsOneWidget);

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
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byType(ReasoningOrb), findsOneWidget);
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
    expect(find.bySemanticsLabel(RegExp(r'Thinking complete')), findsOneWidget);
    handle.dispose();
  });

  testWidgets(
    'empty completed reasoning visibly transitions before disappearing',
    (tester) async {
      final key = GlobalKey();
      Widget build(ReasoningPhase phase, {bool reducedMotion = false}) =>
          MaterialApp(
            home: MediaQuery(
              data: MediaQueryData(disableAnimations: reducedMotion),
              child: Scaffold(
                body: ReasoningBlock.forViewData(
                  ReasoningViewData(
                    reasoningId: 'transition',
                    phase: phase,
                    summary: '',
                  ),
                  key: key,
                ),
              ),
            ),
          );

      await tester.pumpWidget(build(ReasoningPhase.active));
      expect(find.byType(ReasoningOrb), findsOneWidget);

      await tester.pumpWidget(build(ReasoningPhase.completed));
      await tester.pump();
      expect(find.byType(AnimatedSwitcher), findsOneWidget);
      expect(find.byType(ReasoningOrb), findsWidgets);
      expect(find.byKey(const Key('reasoning-header')), findsOneWidget);

      await tester.pump(const Duration(milliseconds: 500));
      expect(find.byKey(const Key('reasoning-header')), findsNothing);

      await tester.pumpWidget(
        build(ReasoningPhase.active, reducedMotion: true),
      );
      await tester.pumpWidget(
        build(ReasoningPhase.completed, reducedMotion: true),
      );
      final switcher = tester.widget<AnimatedSwitcher>(
        find.byType(AnimatedSwitcher),
      );
      expect(switcher.duration, Duration.zero);
    },
  );
}
