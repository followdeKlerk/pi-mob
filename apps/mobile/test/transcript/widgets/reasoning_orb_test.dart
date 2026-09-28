import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/domain/prompt_send_lifecycle.dart';
import 'package:pi_mob/src/transcript/widgets/reasoning_orb.dart';

void main() {
  testWidgets(
    'active orb paints in a bounded canvas and repaints without layout',
    (tester) async {
      await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: ReasoningOrb(active: true))),
      );

      expect(find.byType(ReasoningOrb), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(ReasoningOrb),
          matching: find.byType(CustomPaint),
        ),
        findsOneWidget,
      );
      expect(tester.getSize(find.byType(ReasoningOrb)), const Size(30, 30));
      await tester.pump(const Duration(milliseconds: 200));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('completed orb remains present as a calm deterministic state', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: ReasoningOrb(active: false, size: 80)),
      ),
    );

    expect(find.byType(ReasoningOrb), findsOneWidget);
    // The painter clamps decorative size and cannot consume the disclosure row.
    expect(tester.getSize(find.byType(ReasoningOrb)), const Size(48, 48));
    await tester.pump(const Duration(seconds: 1));
    expect(tester.takeException(), isNull);
  });

  test('public tool labels select the corresponding upstream mode', () {
    const running = PromptSendStatus(phase: PromptSendPhase.running);
    expect(
      orbActivityFor(
        status: running,
        runtimeState: 'running',
        activeToolName: 'read',
      ),
      const OrbActivity(label: 'Read', mode: OrbMode.globe),
    );
    expect(
      orbActivityFor(
        status: running,
        runtimeState: 'running',
        activeToolName: 'ffgrep',
      ),
      const OrbActivity(label: 'Search', mode: OrbMode.globe),
    );
    expect(
      orbActivityFor(
        status: running,
        runtimeState: 'running',
        activeToolName: 'write',
      ),
      const OrbActivity(label: 'Write', mode: OrbMode.ribbon),
    );
    expect(
      orbActivityFor(
        status: running,
        runtimeState: 'running',
        activeToolName: null,
      ),
      const OrbActivity(label: 'Thinking', mode: OrbMode.orbits),
    );
  });

  testWidgets('all orb modes remain bounded at compact reduced motion size', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MediaQuery(
        data: MediaQueryData(
          disableAnimations: true,
          textScaler: TextScaler.linear(2),
        ),
        child: MaterialApp(
          home: SizedBox(
            width: 320,
            height: 220,
            child: OrbCanvas(mode: OrbMode.morph, size: 180),
          ),
        ),
      ),
    );
    expect(find.byType(OrbCanvas), findsOneWidget);
    expect(find.byType(CustomPaint), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('reduced motion still renders the active orb without animation', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(disableAnimations: true),
          child: Scaffold(body: ReasoningOrb(active: true)),
        ),
      ),
    );

    expect(find.byType(ReasoningOrb), findsOneWidget);
    expect(
      find.descendant(
        of: find.byType(ReasoningOrb),
        matching: find.byType(CustomPaint),
      ),
      findsOneWidget,
    );
    await tester.pump(const Duration(seconds: 2));
    expect(tester.takeException(), isNull);
  });
}
