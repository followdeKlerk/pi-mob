import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/controls/controls.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('unavailable phase renders unsupported state', (tester) async {
    await tester.pumpWidget(
      _wrap(
        CompactionControls(
          data: const CompactionViewData(phase: CompactionPhase.unavailable),
          callbacks: const CompactionCallbacks(),
        ),
      ),
    );
    expect(find.byKey(const Key('unsupported-control-state')), findsOneWidget);
  });

  testWidgets('manual start fires callback, summary is shown when present', (
    tester,
  ) async {
    var started = false;
    var autoToggled = false;
    await tester.pumpWidget(
      _wrap(
        CompactionControls(
          data: const CompactionViewData(
            phase: CompactionPhase.idle,
            autoCompact: false,
            summary: 'prior summary',
          ),
          callbacks: CompactionCallbacks(
            onStart: () => started = true,
            onAutoCompactChanged: (v) => autoToggled = v,
          ),
        ),
      ),
    );
    expect(find.byKey(const Key('compaction-summary')), findsOneWidget);
    await tester.tap(find.byKey(const Key('start-compaction')));
    expect(started, isTrue);
    await tester.tap(find.byKey(const Key('auto-compaction-toggle')));
    expect(autoToggled, isTrue);
  });

  testWidgets('busy phase disables start and toggle', (tester) async {
    await tester.pumpWidget(
      _wrap(
        CompactionControls(
          data: const CompactionViewData(
            phase: CompactionPhase.summarizing,
            autoCompact: true,
          ),
          callbacks: CompactionCallbacks(
            onStart: () {},
            onAutoCompactChanged: (_) {},
          ),
        ),
      ),
    );
    final button = tester.widget<FilledButton>(
      find.byKey(const Key('start-compaction')),
    );
    expect(button.onPressed, isNull);
    final toggle = tester.widget<SwitchListTile>(
      find.byKey(const Key('auto-compaction-toggle')),
    );
    expect(toggle.onChanged, isNull);
    expect(find.text('Creating summary'), findsOneWidget);
  });
}
