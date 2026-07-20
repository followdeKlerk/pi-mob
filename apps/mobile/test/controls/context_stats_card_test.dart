import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/controls/controls.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('null values show Unknown and avoid zero', (tester) async {
    await tester.pumpWidget(
      _wrap(const ContextStatsCard(data: ContextStatsViewData())),
    );
    expect(find.text('Unknown'), findsNWidgets(3));
    // No progress bar without a context fraction.
    expect(find.byKey(const Key('context-usage')), findsNothing);
  });

  testWidgets('renders fraction with advisory copy at 200% text scale', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(2.0)),
          child: const ContextStatsCard(
            data: ContextStatsViewData(
              sessionTokens: 12345,
              contextTokens: 75000,
              contextWindowTokens: 100000,
              costUsd: 0.0042,
            ),
          ),
        ),
      ),
    );
    expect(find.byKey(const Key('context-usage')), findsOneWidget);
    expect(find.textContaining('high'), findsOneWidget);
    expect(
      find.textContaining('estimates, not a spending cap'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('full context surfaces nearly-full advisory', (tester) async {
    await tester.pumpWidget(
      _wrap(
        const ContextStatsCard(
          data: ContextStatsViewData(
            contextTokens: 95000,
            contextWindowTokens: 100000,
          ),
        ),
      ),
    );
    expect(find.textContaining('nearly full'), findsOneWidget);
  });

  testWidgets('unavailable nulls produce advisory without progress', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        const ContextStatsCard(data: ContextStatsViewData(sessionTokens: 0)),
      ),
    );
    expect(find.textContaining('Context estimate unavailable'), findsOneWidget);
  });
}
