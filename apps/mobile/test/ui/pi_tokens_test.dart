/// M16-06 / M16-07 design-token tests.
///
/// Locks the spacing/radius scale, the duration buckets, the motion
/// resolver, and the curve primitives so widget migrations stay aligned
/// with the token contract.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/ui/theme/pi_tokens.dart';

void main() {
  group('PiSpacing', () {
    test('defines the seven-step scale in expected order', () {
      expect(PiSpacing.none, equals(0));
      expect(PiSpacing.xs, equals(4));
      expect(PiSpacing.sm, equals(8));
      expect(PiSpacing.md, equals(12));
      expect(PiSpacing.lg, equals(16));
      expect(PiSpacing.xl, equals(24));
      expect(PiSpacing.xxl, equals(32));
      expect(PiSpacing.values, <double>[0, 4, 8, 12, 16, 24, 32]);
    });

    test('every value is unique and strictly increasing past 0', () {
      final seen = <double>{};
      for (final v in PiSpacing.values) {
        expect(seen.add(v), isTrue, reason: 'duplicate spacing value: $v');
      }
      for (var i = 1; i < PiSpacing.values.length; i++) {
        expect(
          PiSpacing.values[i] > PiSpacing.values[i - 1],
          isTrue,
          reason: 'non-monotonic at $i',
        );
      }
    });
  });

  group('PiRadius', () {
    test('sm < md < lg < pill', () {
      expect(PiRadius.sm, lessThan(PiRadius.md));
      expect(PiRadius.md, lessThan(PiRadius.lg));
      expect(PiRadius.lg, lessThan(PiRadius.pill));
    });

    test('pill is large enough to render a circular avatar', () {
      expect(PiRadius.pill, greaterThanOrEqualTo(100));
    });
  });

  group('PiDuration', () {
    test('short < medium < long', () {
      expect(
        PiDuration.short.inMilliseconds,
        lessThan(PiDuration.medium.inMilliseconds),
      );
      expect(
        PiDuration.medium.inMilliseconds,
        lessThan(PiDuration.long.inMilliseconds),
      );
    });
  });

  group('PiMotion', () {
    test('resolveFor returns base when motion is allowed', () {
      expect(
        PiMotion.resolveFor(PiDuration.medium, reducedMotion: false),
        equals(PiDuration.medium),
      );
    });

    test('resolveFor collapses to zero when reduced motion is requested', () {
      expect(
        PiMotion.resolveFor(PiDuration.short, reducedMotion: true),
        equals(Duration.zero),
      );
      expect(
        PiMotion.resolveFor(PiDuration.long, reducedMotion: true),
        equals(Duration.zero),
      );
    });

    testWidgets('resolve picks up disableAnimations from MediaQuery', (
      tester,
    ) async {
      late Duration captured;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              captured = PiMotion.resolve(context, PiDuration.medium);
              return const SizedBox.shrink();
            },
          ),
        ),
      );
      expect(captured, equals(PiDuration.medium));

      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: const MediaQueryData(disableAnimations: true),
            child: Builder(
              builder: (context) {
                captured = PiMotion.resolve(context, PiDuration.medium);
                return const SizedBox.shrink();
              },
            ),
          ),
        ),
      );
      expect(captured, equals(Duration.zero));
    });
  });

  group('PiCurve', () {
    test('passes through when motion is allowed', () {
      expect(
        PiCurve.resolveFor(PiCurve.decelerate, reducedMotion: false),
        same(PiCurve.decelerate),
      );
    });

    test('collapses to Curves.linear under reduced motion', () {
      final collapsed = PiCurve.resolveFor(
        PiCurve.decelerate,
        reducedMotion: true,
      );
      expect(collapsed, equals(Curves.linear));
    });

    testWidgets('resolve reads disableAnimations from MediaQuery', (
      tester,
    ) async {
      late Curve captured;
      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: const MediaQueryData(disableAnimations: true),
            child: Builder(
              builder: (context) {
                captured = PiCurve.resolve(context, PiCurve.decelerate);
                return const SizedBox.shrink();
              },
            ),
          ),
        ),
      );
      expect(captured, equals(Curves.linear));
    });
  });
}
