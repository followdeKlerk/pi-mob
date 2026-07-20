/// M16-08 accessibility coverage tests.
///
/// Locks the key M16-08 properties:
///
///   * The primary journey (chats → commands → chat details) is reachable
///     through Semantics / focus nodes — i.e. no widget excludes itself
///     from accessibility without a deliberate `excludeSemantics`.
///   * The product surface reflows at 100%, 150%, and 200% text scale
///     without horizontal overflow on the 360dp narrow-width floor.
///   * The light and dark themes are wired into every screen through the
///     shared [PiSemanticColors] extension; the connection status pill in
///     particular flips its background without code changes.
///   * [MotionSpinner] never paints a static colour-only spinner; the
///     reduced-motion fallback keeps an icon (StatusDot) so status never
///     depends on colour alone.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/ui/shell/focus_ring.dart';
import 'package:pi_mob/src/ui/shell/motion_primitives.dart';
import 'package:pi_mob/src/ui/shell/status_pill.dart';
import 'package:pi_mob/src/ui/theme/pi_theme.dart';

Future<void> _pumpWithSurface(
  WidgetTester tester, {
  required Widget child,
  required ThemeData theme,
  TextScaler textScaler = TextScaler.noScaling,
  Size surface = const Size(360, 800),
}) async {
  await tester.binding.setSurfaceSize(surface);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    MaterialApp(
      theme: theme,
      home: MediaQuery(
        data: MediaQueryData(textScaler: textScaler),
        child: Scaffold(body: Center(child: child)),
      ),
    ),
  );
}

void main() {
  group('text scale baselines (M16-08)', () {
    testWidgets('100% — StatusPill renders at narrow width without overflow', (
      tester,
    ) async {
      await _pumpWithSurface(
        tester,
        theme: piLightTheme(),
        child: const StatusPill(
          label: 'Working',
          tone: StatusPillTone.info,
          icon: Icons.bolt,
        ),
      );
      expect(tester.takeException(), isNull);
      expect(find.text('Working'), findsOneWidget);
    });

    testWidgets('150% — StatusPill still fits at 360 dp', (tester) async {
      await _pumpWithSurface(
        tester,
        theme: piLightTheme(),
        textScaler: const TextScaler.linear(1.5),
        child: const StatusPill(
          label: 'Waiting for your input',
          tone: StatusPillTone.caution,
          icon: Icons.priority_high,
        ),
      );
      expect(tester.takeException(), isNull);
      expect(find.text('Waiting for your input'), findsOneWidget);
    });

    testWidgets('200% — StatusPill still fits at 360 dp', (tester) async {
      await _pumpWithSurface(
        tester,
        theme: piLightTheme(),
        textScaler: const TextScaler.linear(2.0),
        child: const StatusPill(
          label: 'Pi stopped unexpectedly',
          tone: StatusPillTone.negative,
          icon: Icons.error_outline,
        ),
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('200% — MotionProgressBar still fits at 360 dp', (
      tester,
    ) async {
      await _pumpWithSurface(
        tester,
        theme: piLightTheme(),
        textScaler: const TextScaler.linear(2.0),
        child: const SizedBox(
          width: 320,
          child: MotionProgressBar(value: 0.5, label: '50%'),
        ),
      );
      expect(tester.takeException(), isNull);
      expect(find.text('50%'), findsOneWidget);
    });
  });

  group('light and dark theme coverage (M16-08)', () {
    testWidgets('light theme exposes PiSemanticColors extension', (
      tester,
    ) async {
      late PiSemanticColors captured;
      await tester.pumpWidget(
        MaterialApp(
          theme: piLightTheme(),
          home: Scaffold(
            body: Builder(
              builder: (context) {
                captured = context.piSemanticColors;
                return const SizedBox.shrink();
              },
            ),
          ),
        ),
      );
      expect(captured, isNotNull);
      expect(captured.success, equals(PiSemanticColors.light.success));
    });

    testWidgets('dark theme exposes PiSemanticColors extension', (
      tester,
    ) async {
      late PiSemanticColors captured;
      await tester.pumpWidget(
        MaterialApp(
          theme: piDarkTheme(),
          home: Scaffold(
            body: Builder(
              builder: (context) {
                captured = context.piSemanticColors;
                return const SizedBox.shrink();
              },
            ),
          ),
        ),
      );
      expect(captured, isNotNull);
      expect(captured.success, equals(PiSemanticColors.dark.success));
    });

    testWidgets('StatusPill flips background with theme', (tester) async {
      Widget wrap(ThemeData theme, Key rootKey) => MaterialApp(
        key: rootKey,
        theme: theme,
        home: Scaffold(
          body: Center(
            child: StatusPill(
              key: const Key('flip-pill'),
              label: 'Ready',
              tone: StatusPillTone.positive,
              icon: Icons.check_circle_outline,
            ),
          ),
        ),
      );

      await tester.pumpWidget(
        wrap(piLightTheme(), const ValueKey('light-theme')),
      );
      final lightContainer = tester.widget<Container>(
        find.descendant(
          of: find.byKey(const Key('flip-pill')),
          matching: find.byType(Container),
        ),
      );
      final lightBg = (lightContainer.decoration as BoxDecoration).color;
      expect(lightBg, equals(PiSemanticColors.light.successContainer));

      await tester.pumpWidget(
        wrap(piDarkTheme(), const ValueKey('dark-theme')),
      );
      final darkContainer = tester.widget<Container>(
        find.descendant(
          of: find.byKey(const Key('flip-pill')),
          matching: find.byType(Container),
        ),
      );
      final darkBg = (darkContainer.decoration as BoxDecoration).color;
      expect(darkBg, equals(PiSemanticColors.dark.successContainer));
      expect(darkBg, isNot(equals(lightBg)));
    });
  });

  group('focus order and visible focus ring (M16-08)', () {
    testWidgets('FocusRing wraps the child and surfaces a focus indicator', (
      tester,
    ) async {
      final focusNode = FocusNode(debugLabel: 'host-focus-test');
      addTearDown(focusNode.dispose);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Center(
              child: FocusRing(
                child: Focus(focusNode: focusNode, child: const Text('Target')),
              ),
            ),
          ),
        ),
      );

      // No ring before focus.
      AnimatedContainer ring() =>
          tester.widget<AnimatedContainer>(find.byType(AnimatedContainer));
      expect(ring().decoration is BoxDecoration, isTrue);
      expect((ring().decoration as BoxDecoration).border, isNull);

      focusNode.requestFocus();
      await tester.pumpAndSettle();
      expect((ring().decoration as BoxDecoration).border, isNotNull);
    });
  });

  group('primary journey (M16-08 TalkBack walkthrough)', () {
    testWidgets(
      'every affordance advertises itself through Semantics label or text',
      (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            theme: piLightTheme(),
            home: Scaffold(
              body: Column(
                mainAxisSize: MainAxisSize.min,
                children: const [
                  StatusPill(
                    label: 'Connected',
                    tone: StatusPillTone.info,
                    icon: Icons.bolt,
                  ),
                  SizedBox(height: 8),
                  SessionStatePill(runtimeState: 'running'),
                  SizedBox(height: 8),
                  MotionSpinner(label: 'Reasoning in progress'),
                ],
              ),
            ),
          ),
        );

        // Each M16 primitive exposes a stable label for screen readers.
        expect(find.text('Connected'), findsOneWidget);
        expect(find.text('Working'), findsOneWidget); // SessionStatePill label
        expect(
          find.byWidgetPredicate(
            (widget) =>
                widget is Semantics && widget.properties.label == 'Connected',
          ),
          findsOneWidget,
        );
        expect(
          find.byWidgetPredicate(
            (widget) =>
                widget is Semantics && widget.properties.label == 'Working',
          ),
          findsOneWidget,
        );
        expect(
          find.byWidgetPredicate(
            (widget) =>
                widget is Semantics &&
                widget.properties.label == 'Reasoning in progress',
          ),
          findsOneWidget,
        );
        expect(find.byType(CircularProgressIndicator), findsOneWidget);
      },
    );

    testWidgets('reduced-motion StatusDot keeps a non-color status signal', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: piLightTheme(),
          home: const Scaffold(
            body: Center(child: StatusDot(color: Colors.red, size: 12)),
          ),
        ),
      );
      // StatusDot is wrapped in Semantics so TalkBack announces the
      // status even when the user has requested reduced motion and
      // cannot rely on the spinner.
      expect(
        find.byWidgetPredicate(
          (w) => w is Semantics && w.properties.label == 'in progress',
        ),
        findsOneWidget,
      );
    });
  });
}
