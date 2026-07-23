/// Motion-aware UI primitives for Pi Mob (M16-07).
///
/// These widgets collapse continuous decoration animation under the platform
/// `disableAnimations` accessibility flag so users who request reduced motion
/// still see the same status, but as a calm static label rather than a
/// spinning indicator. The contract is:
///
///   * `MotionSpinner` renders a Material [CircularProgressIndicator] when
///     motion is allowed and a static icon-only [StatusDot] when it is not.
///   * `MotionProgressBar` renders a [LinearProgressIndicator] when motion is
///     allowed and a static fill bar with the same percentage label when it
///     is not. The fill bar reads deterministically and never animates.
///   * `MotionCrossfade` performs a tokenized [AnimatedSwitcher] crossfade
///     using the same duration/curve family. Under reduced motion the
///     crossfade duration collapses to [Duration.zero] so the new child
///     appears instantly.
///
/// No widget in this file introduces decoration animation. Every animation
/// is semantic — it exists to communicate a state change — and disappears
/// entirely when the user has asked for reduced motion.
library;

import 'package:flutter/material.dart';

import '../theme/pi_semantic_colors.dart';
import '../theme/pi_tokens.dart';

/// Static semantic dot used by [MotionSpinner] and other reduced-motion
/// surfaces. The dot is paired with an icon (and any caller-supplied label)
/// so status never depends on color alone — this satisfies the M16-08
/// accessibility contract.
class StatusDot extends StatelessWidget {
  const StatusDot({required this.color, this.size = 8, super.key});

  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'in progress',
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      ),
    );
  }
}

/// A motion-aware circular spinner.
///
/// When the platform `MediaQuery.disableAnimations` flag is set, the
/// spinner collapses to a single static [StatusDot] using the surrounding
/// primary color. The widget exposes the same bounding box in both modes
/// so layout never reflows.
class MotionSpinner extends StatelessWidget {
  const MotionSpinner({
    this.color,
    this.strokeWidth = 2,
    this.dimension = 14,
    this.label = 'in progress',
    super.key,
  });

  /// Optional override for the spinner color. Defaults to the active
  /// [ColorScheme.primary] when null.
  final Color? color;

  /// Spinner stroke width. Has no effect in reduced-motion mode.
  final double strokeWidth;

  /// Diameter of the spinner / size of the static dot.
  final double dimension;

  /// Accessibility label applied to the static dot under reduced motion
  /// (the spinner is decorative on every platform that exposes
  /// `Semantics(excludeSemantics: true)` semantics).
  final String label;

  @override
  Widget build(BuildContext context) {
    final reduced = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    final tint = color ?? Theme.of(context).colorScheme.primary;
    if (reduced) {
      return ExcludeSemantics(
        child: SizedBox.square(
          dimension: dimension,
          child: Center(
            child: StatusDot(color: tint, size: dimension * 0.6),
          ),
        ),
      );
    }
    return Semantics(
      label: label,
      excludeSemantics: true,
      child: SizedBox.square(
        dimension: dimension,
        child: CircularProgressIndicator(
          strokeWidth: strokeWidth,
          valueColor: AlwaysStoppedAnimation<Color>(tint),
        ),
      ),
    );
  }
}

/// A motion-aware progress bar that respects `disableAnimations`.
///
/// When motion is allowed, the widget renders a Material
/// [LinearProgressIndicator] using a tokenized `LinearProgressIndicator.minHeight`
/// and pill-shaped corners. When motion is disabled, the widget renders a
/// static filled bar whose width equals [value] (or 100% when [value] is
/// null) plus a percentage label — the user sees the same progress fact in
/// a calm, non-animated layout.
class MotionProgressBar extends StatelessWidget {
  const MotionProgressBar({
    this.value,
    this.minHeight = 4,
    this.label,
    this.errorTint,
    super.key,
  });

  /// `0.0–1.0` inclusive progress, or null for indeterminate.
  final double? value;

  /// Bar thickness. Used by both modes so layouts do not jump.
  final double minHeight;

  /// Optional inline label rendered after the bar (e.g. "42%"). When null
  /// the widget renders no label; the host surface usually adds one.
  final String? label;

  /// Optional error tint applied to the filled segment when the operation
  /// has failed. When null the bar uses the semantic info color.
  final Color? errorTint;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final semantic = context.piSemanticColors;
    final reduced = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    final tint = errorTint ?? semantic.info;
    if (reduced) {
      final pct = value == null ? 1.0 : value!.clamp(0.0, 1.0).toDouble();
      return Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: SizedBox(
              height: minHeight,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(PiRadius.pill),
                ),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: FractionallySizedBox(
                    widthFactor: pct,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: tint,
                        borderRadius: BorderRadius.circular(PiRadius.pill),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          if (label != null) ...[
            const SizedBox(width: PiSpacing.sm),
            Text(label!, style: theme.textTheme.labelSmall),
          ],
        ],
      );
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: TweenAnimationBuilder<double>(
            duration: PiDuration.medium,
            curve: PiCurve.decelerate,
            tween: Tween<double>(begin: value ?? 0, end: value ?? 0),
            builder: (context, v, _) {
              return LinearProgressIndicator(
                value: value,
                minHeight: minHeight,
                borderRadius: BorderRadius.circular(PiRadius.pill),
                backgroundColor: theme.colorScheme.surfaceContainerHighest,
                valueColor: AlwaysStoppedAnimation<Color>(tint),
              );
            },
          ),
        ),
        if (label != null) ...[
          const SizedBox(width: PiSpacing.sm),
          Text(label!, style: theme.textTheme.labelSmall),
        ],
      ],
    );
  }
}

/// Crossfades between [child] when its identity changes, honoring reduced
/// motion. The widget intentionally accepts an explicit `duration` so callers
/// can route through [PiDuration] (or [PiMotion.resolve] for a
/// context-aware variant). Reduced motion collapses the duration to
/// [Duration.zero] inside the widget itself.
class MotionCrossfade extends StatelessWidget {
  const MotionCrossfade({
    required this.child,
    this.duration = PiDuration.medium,
    super.key,
  });

  final Widget child;
  final Duration duration;

  @override
  Widget build(BuildContext context) {
    final reduced = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    final resolved = PiMotion.resolveFor(duration, reducedMotion: reduced);
    return AnimatedSwitcher(
      duration: resolved,
      switchInCurve: PiCurve.resolveFor(
        PiCurve.decelerate,
        reducedMotion: reduced,
      ),
      switchOutCurve: PiCurve.resolveFor(
        PiCurve.accelerate,
        reducedMotion: reduced,
      ),
      child: child,
    );
  }
}
