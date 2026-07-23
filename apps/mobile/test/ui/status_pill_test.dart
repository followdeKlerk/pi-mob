/// M16-02 information-density tests for [StatusPill] and
/// [SessionStatePill].
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/ui/shell/status_pill.dart';
import 'package:pi_mob/src/ui/theme/pi_theme.dart';

Widget _wrap(Widget child, {ThemeData? theme}) {
  return MaterialApp(
    theme: theme ?? piLightTheme(),
    home: Scaffold(body: Center(child: child)),
  );
}

void main() {
  group('StatusPill', () {
    testWidgets('renders label and icon together', (tester) async {
      await tester.pumpWidget(
        _wrap(
          const StatusPill(
            label: 'Working',
            tone: StatusPillTone.info,
            icon: Icons.bolt,
          ),
        ),
      );
      expect(find.text('Working'), findsOneWidget);
      expect(find.byIcon(Icons.bolt), findsOneWidget);
    });

    testWidgets('hides the icon when none is provided', (tester) async {
      await tester.pumpWidget(
        _wrap(const StatusPill(label: 'Ready', tone: StatusPillTone.positive)),
      );
      expect(find.text('Ready'), findsOneWidget);
      expect(find.byType(Icon), findsNothing);
    });

    testWidgets('applies semantic colors in light theme', (tester) async {
      await tester.pumpWidget(
        _wrap(
          const StatusPill(
            label: 'Ready',
            tone: StatusPillTone.positive,
            icon: Icons.check_circle_outline,
          ),
          theme: piLightTheme(),
        ),
      );
      final container = tester.widget<Container>(find.byType(Container).first);
      final decoration = container.decoration as BoxDecoration;
      expect(decoration.color, isNotNull);
    });

    testWidgets('applies semantic colors in dark theme', (tester) async {
      await tester.pumpWidget(
        _wrap(
          const StatusPill(
            label: 'Failed',
            tone: StatusPillTone.negative,
            icon: Icons.error_outline,
          ),
          theme: piDarkTheme(),
        ),
      );
      expect(find.text('Failed'), findsOneWidget);
      final container = tester.widget<Container>(find.byType(Container).first);
      final decoration = container.decoration as BoxDecoration;
      expect(decoration.color, isNotNull);
    });

    testWidgets('dense mode reduces horizontal padding', (tester) async {
      await tester.pumpWidget(
        _wrap(
          const StatusPill(
            label: 'Idle',
            tone: StatusPillTone.neutral,
            dense: true,
          ),
        ),
      );
      final container = tester.widget<Container>(find.byType(Container).first);
      final padding = container.padding as EdgeInsets;
      expect(padding.horizontal, lessThan(PiSpacing.sm * 2));
    });

    testWidgets('exposes the label through Semantics', (tester) async {
      await tester.pumpWidget(
        _wrap(const StatusPill(label: 'Working', tone: StatusPillTone.info)),
      );
      // The label is wrapped in a Semantics widget so screen readers
      // announce the same fact as the visual label.
      expect(
        find.byWidgetPredicate(
          (w) =>
              w is Semantics &&
              (w.properties.label == 'Working' ||
                  (w.properties.label?.contains('Working') ?? false)),
        ),
        findsWidgets,
      );
    });
  });

  group('SessionStatePill', () {
    testWidgets('maps "running" to info tone with bolt icon', (tester) async {
      await tester.pumpWidget(
        _wrap(const SessionStatePill(runtimeState: 'running')),
      );
      expect(find.text('Working'), findsOneWidget);
      expect(find.byIcon(Icons.bolt), findsOneWidget);
    });

    testWidgets('maps "crashed" to negative tone with error icon', (
      tester,
    ) async {
      await tester.pumpWidget(
        _wrap(const SessionStatePill(runtimeState: 'crashed')),
      );
      expect(find.text('Pi stopped unexpectedly'), findsOneWidget);
      expect(find.byIcon(Icons.error_outline), findsOneWidget);
    });

    testWidgets('maps "waiting_for_input" to caution tone with priority icon', (
      tester,
    ) async {
      await tester.pumpWidget(
        _wrap(const SessionStatePill(runtimeState: 'waiting_for_input')),
      );
      expect(find.text('Needs your input'), findsOneWidget);
      expect(find.byIcon(Icons.priority_high), findsOneWidget);
    });

    testWidgets('maps "idle" to positive tone with check icon', (tester) async {
      await tester.pumpWidget(
        _wrap(const SessionStatePill(runtimeState: 'idle')),
      );
      expect(find.text('Ready'), findsOneWidget);
      expect(find.byIcon(Icons.check_circle_outline), findsOneWidget);
    });

    testWidgets('falls back to neutral for unknown states', (tester) async {
      await tester.pumpWidget(
        _wrap(const SessionStatePill(runtimeState: 'exotic_state')),
      );
      // Label falls back to the state name with underscores replaced.
      expect(find.text('exotic state'), findsOneWidget);
    });

    testWidgets('renders at 200% text scale without overflow', (tester) async {
      await tester.binding.setSurfaceSize(const Size(360, 800));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          theme: piLightTheme(),
          home: Scaffold(
            body: MediaQuery(
              data: const MediaQueryData(textScaler: TextScaler.linear(2.0)),
              child: const Center(
                child: SessionStatePill(runtimeState: 'running'),
              ),
            ),
          ),
        ),
      );
      // No overflow exception is enough — verify the label is still found.
      expect(find.text('Working'), findsOneWidget);
    });
  });
}
