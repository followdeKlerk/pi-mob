import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/controls/controls.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('unavailable phase with no auto toggle renders unsupported', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        RetryControls(
          data: const RetryViewData(phase: RetryPhase.unavailable),
          callbacks: const RetryCallbacks(),
        ),
      ),
    );
    expect(find.byKey(const Key('unsupported-control-state')), findsOneWidget);
  });

  testWidgets('scheduled phase shows countdown and abort button', (
    tester,
  ) async {
    var aborted = false;
    var autoToggled = false;
    await tester.pumpWidget(
      _wrap(
        RetryControls(
          data: const RetryViewData(
            phase: RetryPhase.scheduled,
            autoRetry: true,
            remaining: Duration(seconds: 12),
            attempt: 1,
            maximumAttempts: 3,
            failureMessage: 'provider error',
          ),
          callbacks: RetryCallbacks(
            onAbort: () => aborted = true,
            onAutoRetryChanged: (v) => autoToggled = v,
          ),
        ),
      ),
    );
    expect(find.text('Retrying in 12s'), findsOneWidget);
    expect(find.text('Attempt 1 of 3'), findsOneWidget);
    expect(find.text('provider error'), findsOneWidget);
    await tester.tap(find.byKey(const Key('abort-retry')));
    expect(aborted, isTrue);
    // Toggling auto retry.
    await tester.tap(find.byKey(const Key('auto-retry-toggle')));
    expect(autoToggled, isFalse);
  });

  testWidgets('idle phase shows no abort button', (tester) async {
    await tester.pumpWidget(
      _wrap(
        RetryControls(
          data: const RetryViewData(phase: RetryPhase.idle, autoRetry: true),
          callbacks: RetryCallbacks(onAbort: () {}, onAutoRetryChanged: (_) {}),
        ),
      ),
    );
    expect(find.byKey(const Key('abort-retry')), findsNothing);
    expect(find.text('No retry pending'), findsOneWidget);
  });
}
