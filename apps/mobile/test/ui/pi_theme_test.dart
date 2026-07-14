import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/ui/theme/pi_theme.dart';

/// WCAG 2.2 contrast ratio between two sRGB colors.
double _contrastRatio(Color foreground, Color background) {
  final fg = _relativeLuminance(foreground);
  final bg = _relativeLuminance(background);
  final lighter = fg > bg ? fg : bg;
  final darker = fg > bg ? bg : fg;
  return (lighter + 0.05) / (darker + 0.05);
}

double _relativeLuminance(Color color) {
  double channel(double v) {
    final s = v / 255.0;
    return s <= 0.03928
        ? s / 12.92
        : math.pow((s + 0.055) / 1.055, 2.4).toDouble();
  }

  final r = channel(color.r * 255.0);
  final g = channel(color.g * 255.0);
  final b = channel(color.b * 255.0);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/// Hue angle in degrees [0, 360) computed from sRGB.
double _hueAngle(Color color) {
  final r = color.r;
  final g = color.g;
  final b = color.b;
  final maxC = math.max(r, math.max(g, b));
  final minC = math.min(r, math.min(g, b));
  final delta = maxC - minC;
  if (delta < 0.001) return 0;
  double h;
  if (maxC == r) {
    h = ((g - b) / delta) % 6;
  } else if (maxC == g) {
    h = (b - r) / delta + 2;
  } else {
    h = (r - g) / delta + 4;
  }
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

/// Shortest arc between two hue angles, in degrees [0, 180].
double _hueDistance(double a, double b) {
  final diff = (a - b).abs() % 360;
  return diff > 180 ? 360 - diff : diff;
}

Widget _wrapWithTheme(ThemeData theme) {
  return MaterialApp(
    theme: theme,
    home: Builder(
      builder: (context) => Scaffold(
        body: Text(
          'probe',
          style: TextStyle(color: Theme.of(context).colorScheme.primary),
        ),
      ),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('pi tokens', () {
    test('spacing values are positive, ordered, and finite', () {
      expect(PiSpacing.xs, greaterThan(0));
      expect(PiSpacing.values, hasLength(6));
      for (var i = 1; i < PiSpacing.values.length; i++) {
        expect(
          PiSpacing.values[i],
          greaterThan(PiSpacing.values[i - 1]),
          reason: 'spacing must be strictly increasing',
        );
      }
    });

    test('radius values are positive and the pill is large enough', () {
      expect(PiRadius.sm, greaterThan(0));
      expect(PiRadius.md, greaterThan(PiRadius.sm));
      expect(PiRadius.lg, greaterThan(PiRadius.md));
      expect(PiRadius.pill, greaterThanOrEqualTo(100));
    });

    test('duration buckets are positive and ordered', () {
      expect(PiDuration.short.inMilliseconds, greaterThan(0));
      expect(PiDuration.medium, greaterThan(PiDuration.short));
      expect(PiDuration.long, greaterThan(PiDuration.medium));
    });

    test('PiMotion.resolveFor honors reduced motion', () {
      expect(
        PiMotion.resolveFor(PiDuration.short, reducedMotion: false),
        PiDuration.short,
      );
      expect(
        PiMotion.resolveFor(PiDuration.long, reducedMotion: true),
        Duration.zero,
      );
    });

    testWidgets('PiMotion.resolve collapses to zero when motion is disabled', (
      tester,
    ) async {
      late Duration captured;
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
      expect(captured, Duration.zero);
    });

    testWidgets('PiMotion.resolve returns base when motion is enabled', (
      tester,
    ) async {
      late Duration captured;
      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: const MediaQueryData(disableAnimations: false),
            child: Builder(
              builder: (context) {
                captured = PiMotion.resolve(context, PiDuration.medium);
                return const SizedBox.shrink();
              },
            ),
          ),
        ),
      );
      expect(captured, PiDuration.medium);
    });
  });

  group('pi theme constructors', () {
    testWidgets('light theme uses Material 3 and light brightness', (
      tester,
    ) async {
      final theme = piLightTheme();
      expect(theme.useMaterial3, isTrue);
      expect(theme.brightness, Brightness.light);
      await tester.pumpWidget(_wrapWithTheme(theme));
      final ctx = tester.element(find.text('probe'));
      expect(Theme.of(ctx).brightness, Brightness.light);
      expect(Theme.of(ctx).colorScheme.primary, isA<Color>());
    });

    testWidgets('dark theme uses Material 3 and dark brightness', (
      tester,
    ) async {
      final theme = piDarkTheme();
      expect(theme.useMaterial3, isTrue);
      expect(theme.brightness, Brightness.dark);
      await tester.pumpWidget(_wrapWithTheme(theme));
      final ctx = tester.element(find.text('probe'));
      expect(Theme.of(ctx).brightness, Brightness.dark);
    });

    testWidgets('light theme exposes light PiSemanticColors', (tester) async {
      PiSemanticColors? captured;
      await tester.pumpWidget(
        MaterialApp(
          theme: piLightTheme(),
          home: Builder(
            builder: (context) {
              captured = context.piSemanticColors;
              return const SizedBox.shrink();
            },
          ),
        ),
      );
      expect(captured, isNotNull);
      expect(captured!.success, PiSemanticColors.light.success);
    });

    testWidgets('dark theme exposes dark PiSemanticColors', (tester) async {
      PiSemanticColors? captured;
      await tester.pumpWidget(
        MaterialApp(
          theme: piDarkTheme(),
          home: Builder(
            builder: (context) {
              captured = context.piSemanticColors;
              return const SizedBox.shrink();
            },
          ),
        ),
      );
      expect(captured, isNotNull);
      expect(captured!.success, PiSemanticColors.dark.success);
      expect(
        captured!.success,
        isNot(equals(PiSemanticColors.light.success)),
        reason: 'dark and light success tones must differ',
      );
    });

    test('card, input, button, and nav bar themes are configured', () {
      final theme = piLightTheme();
      expect(theme.cardTheme.shape, isA<RoundedRectangleBorder>());
      expect(theme.inputDecorationTheme.filled, isTrue);
      expect(theme.filledButtonTheme.style, isNotNull);
      expect(theme.outlinedButtonTheme.style, isNotNull);
      expect(theme.navigationBarTheme.backgroundColor, isA<Color>());
      expect(theme.navigationBarTheme.height, greaterThan(0));
    });

    test('surfaces are calm — not pure white or pure black', () {
      final light = piLightTheme().colorScheme;
      final dark = piDarkTheme().colorScheme;
      expect(_relativeLuminance(light.surface), greaterThan(0.85));
      expect(_relativeLuminance(light.surface), lessThan(0.99));
      expect(_relativeLuminance(dark.surface), greaterThan(0.005));
      expect(_relativeLuminance(dark.surface), lessThan(0.20));
    });
  });

  group('PiSemanticColors contrast', () {
    test('light solid pairs (onColor over color) meet WCAG AA', () {
      const s = PiSemanticColors.light;
      expect(_contrastRatio(s.onSuccess, s.success), greaterThanOrEqualTo(4.5));
      expect(_contrastRatio(s.onWarning, s.warning), greaterThanOrEqualTo(4.5));
      expect(
        _contrastRatio(s.onCritical, s.critical),
        greaterThanOrEqualTo(4.5),
      );
      expect(_contrastRatio(s.onInfo, s.info), greaterThanOrEqualTo(4.5));
    });

    test('light container pairs (onContainer over container) meet WCAG AA', () {
      const s = PiSemanticColors.light;
      expect(
        _contrastRatio(s.onSuccessContainer, s.successContainer),
        greaterThanOrEqualTo(4.5),
      );
      expect(
        _contrastRatio(s.onWarningContainer, s.warningContainer),
        greaterThanOrEqualTo(4.5),
      );
      expect(
        _contrastRatio(s.onCriticalContainer, s.criticalContainer),
        greaterThanOrEqualTo(4.5),
      );
      expect(
        _contrastRatio(s.onInfoContainer, s.infoContainer),
        greaterThanOrEqualTo(4.5),
      );
    });

    test('dark container pairs (onContainer over container) meet WCAG AA', () {
      const s = PiSemanticColors.dark;
      expect(
        _contrastRatio(s.onSuccessContainer, s.successContainer),
        greaterThanOrEqualTo(4.5),
      );
      expect(
        _contrastRatio(s.onWarningContainer, s.warningContainer),
        greaterThanOrEqualTo(4.5),
      );
      expect(
        _contrastRatio(s.onCriticalContainer, s.criticalContainer),
        greaterThanOrEqualTo(4.5),
      );
      expect(
        _contrastRatio(s.onInfoContainer, s.infoContainer),
        greaterThanOrEqualTo(4.5),
      );
    });

    test('semantic statuses are hue-distinct (light)', () {
      const s = PiSemanticColors.light;
      final hues = <String, double>{
        'success': _hueAngle(s.success),
        'warning': _hueAngle(s.warning),
        'critical': _hueAngle(s.critical),
        'info': _hueAngle(s.info),
      };
      final names = hues.keys.toList();
      for (var i = 0; i < names.length; i++) {
        for (var j = i + 1; j < names.length; j++) {
          expect(
            _hueDistance(hues[names[i]]!, hues[names[j]]!),
            greaterThanOrEqualTo(20),
            reason:
                '${names[i]} (${hues[names[i]]!.toStringAsFixed(0)}deg) and '
                '${names[j]} (${hues[names[j]]!.toStringAsFixed(0)}deg) '
                'must be hue-distinct',
          );
        }
      }
    });

    test('semantic container backgrounds are hue-distinct (light)', () {
      const s = PiSemanticColors.light;
      final hues = <String, double>{
        'successContainer': _hueAngle(s.successContainer),
        'warningContainer': _hueAngle(s.warningContainer),
        'criticalContainer': _hueAngle(s.criticalContainer),
        'infoContainer': _hueAngle(s.infoContainer),
      };
      final names = hues.keys.toList();
      for (var i = 0; i < names.length; i++) {
        for (var j = i + 1; j < names.length; j++) {
          expect(
            _hueDistance(hues[names[i]]!, hues[names[j]]!),
            greaterThanOrEqualTo(15),
            reason:
                '${names[i]} and ${names[j]} must be hue-distinct even in pale form',
          );
        }
      }
    });

    test('connection phase colors are hue-distinct (light)', () {
      const s = PiSemanticColors.light;
      final ready = _hueAngle(s.connectionReady);
      final degraded = _hueAngle(s.connectionDegraded);
      final offline = _hueAngle(s.connectionOffline);
      expect(_hueDistance(ready, degraded), greaterThanOrEqualTo(40));
      expect(_hueDistance(degraded, offline), greaterThanOrEqualTo(15));
      expect(_hueDistance(ready, offline), greaterThanOrEqualTo(40));
    });

    test(
      'connection phase colors carry AA contrast against their on-color',
      () {
        const s = PiSemanticColors.light;
        expect(
          _contrastRatio(s.onSuccess, s.connectionReady),
          greaterThanOrEqualTo(4.5),
        );
        expect(
          _contrastRatio(s.onWarning, s.connectionDegraded),
          greaterThanOrEqualTo(4.5),
        );
        expect(
          _contrastRatio(s.onCritical, s.connectionOffline),
          greaterThanOrEqualTo(4.5),
        );
      },
    );
  });

  group('PiSemanticColors lerp', () {
    test('lerping at t=0 returns the start variant', () {
      const start = PiSemanticColors.light;
      const end = PiSemanticColors.dark;
      final lerped = start.lerp(end, 0.0);
      expect(lerped.success, start.success);
      expect(lerped.warning, start.warning);
      expect(lerped.connectionOffline, start.connectionOffline);
    });

    test('lerping at t=1 returns the end variant', () {
      const start = PiSemanticColors.light;
      const end = PiSemanticColors.dark;
      final lerped = start.lerp(end, 1.0);
      expect(lerped.success, end.success);
      expect(lerped.warning, end.warning);
      expect(lerped.connectionOffline, end.connectionOffline);
    });

    test('equality and hashCode honor every field', () {
      const a = PiSemanticColors.light;
      const b = PiSemanticColors.light;
      expect(a, equals(b));
      expect(a.hashCode, b.hashCode);
      const c = PiSemanticColors.dark;
      expect(a, isNot(equals(c)));
    });
  });

  group('BuildContext.piSemanticColors', () {
    testWidgets('falls back to light when extension is missing', (
      tester,
    ) async {
      late PiSemanticColors resolved;
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(useMaterial3: true),
          home: Builder(
            builder: (context) {
              resolved = context.piSemanticColors;
              return const SizedBox.shrink();
            },
          ),
        ),
      );
      expect(resolved.success, PiSemanticColors.light.success);
    });
  });
}
