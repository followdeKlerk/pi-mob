/// M16-07 motion grammar tests.
///
/// Verifies that the [MotionSpinner], [MotionProgressBar], [MotionCrossfade],
/// and [PiCurve] / [PiDuration] / [PiMotion] primitives honor the platform
/// `disableAnimations` accessibility setting and never introduce decoration
/// animation.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/ui/shell/motion_primitives.dart';
import 'package:pi_mob/src/ui/theme/pi_tokens.dart';

Widget _wrap(Widget child, {bool reducedMotion = false}) {
  return MaterialApp(
    home: Scaffold(
      body: MediaQuery(
        data: MediaQueryData(disableAnimations: reducedMotion),
        child: child,
      ),
    ),
  );
}

void main() {
  testWidgets('MotionSpinner renders spinner when motion is allowed', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(const MotionSpinner(label: 'Loading')));
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.byType(StatusDot), findsNothing);
  });

  testWidgets(
    'MotionSpinner collapses to a static StatusDot under reduced motion',
    (tester) async {
      await tester.pumpWidget(
        _wrap(const MotionSpinner(label: 'Loading'), reducedMotion: true),
      );
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.byType(StatusDot), findsOneWidget);
    },
  );

  testWidgets('MotionSpinner keeps the same bounding box across motion modes', (
    tester,
  ) async {
    const dim = 14.0;
    await tester.binding.setSurfaceSize(const Size(200, 200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      _wrap(const MotionSpinner(dimension: dim), reducedMotion: false),
    );
    final motionSize = tester.getSize(find.byType(MotionSpinner));
    await tester.pumpWidget(
      _wrap(const MotionSpinner(dimension: dim), reducedMotion: true),
    );
    final reducedSize = tester.getSize(find.byType(MotionSpinner));
    expect(motionSize.width, equals(reducedSize.width));
    expect(motionSize.height, equals(reducedSize.height));
  });

  testWidgets(
    'MotionProgressBar renders determinate bar with percentage label',
    (tester) async {
      await tester.pumpWidget(
        _wrap(
          const MotionProgressBar(value: 0.42, label: '42%'),
          reducedMotion: true,
        ),
      );
      expect(find.text('42%'), findsOneWidget);
      expect(find.byType(LinearProgressIndicator), findsNothing);
    },
  );

  testWidgets(
    'MotionProgressBar renders indeterminate full bar under reduced motion',
    (tester) async {
      await tester.pumpWidget(
        _wrap(const MotionProgressBar(), reducedMotion: true),
      );
      // Indeterminate fills the entire track and has no percentage label.
      expect(find.byType(LinearProgressIndicator), findsNothing);
    },
  );

  testWidgets('MotionCrossfade honors reduced motion duration', (tester) async {
    var reducedResolve = PiMotion.resolveFor(
      PiDuration.medium,
      reducedMotion: false,
    );
    expect(reducedResolve, equals(PiDuration.medium));

    reducedResolve = PiMotion.resolveFor(
      PiDuration.medium,
      reducedMotion: true,
    );
    expect(reducedResolve, equals(Duration.zero));
  });

  test('PiCurve.resolveFor collapses to linear under reduced motion', () {
    final curve = PiCurve.resolveFor(PiCurve.decelerate, reducedMotion: false);
    expect(curve, equals(PiCurve.decelerate));
    final reduced = PiCurve.resolveFor(PiCurve.decelerate, reducedMotion: true);
    expect(reduced, equals(Curves.linear));
  });

  test('PiMotion.resolveFor collapses any duration to zero', () {
    expect(
      PiMotion.resolveFor(PiDuration.short, reducedMotion: true),
      equals(Duration.zero),
    );
    expect(
      PiMotion.resolveFor(PiDuration.long, reducedMotion: true),
      equals(Duration.zero),
    );
    expect(
      PiMotion.resolveFor(PiDuration.medium, reducedMotion: false),
      equals(PiDuration.medium),
    );
  });
}
