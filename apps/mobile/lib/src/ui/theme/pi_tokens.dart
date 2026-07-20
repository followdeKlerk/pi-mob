/// Design tokens for the Pi Mob surface.
///
/// These values are intentionally small, immutable, and free of any
/// framework coupling so they can be referenced from widgets, tests, and
/// any future non-Flutter consumer without dragging Material along.
///
/// Naming follows a calm, four-step rhythm (xs/sm/md/lg/xl/xxl) so the
/// intent of every constant reads at a glance. Durations are split into
/// three buckets; pass them through [PiMotion.resolve] to honor the
/// platform's reduced-motion preference.
library;

import 'package:flutter/widgets.dart';

/// Spacing scale in logical pixels.
///
/// The scale is dense enough for cards, list rows, and dialog padding
/// without falling into the trap of one-off magic numbers throughout the
/// app.
class PiSpacing {
  const PiSpacing._();

  /// 0 logical pixels — explicit "no gap" sentinel that keeps multi-axis
  /// tokenized padding readable (for example `EdgeInsets.fromLTRB(
  /// PiSpacing.md, PiSpacing.none, PiSpacing.md, PiSpacing.md)`).
  static const double none = 0;

  /// 4 logical pixels — minimum gap, used for chip padding and tight rows.
  static const double xs = 4;

  /// 8 logical pixels — the default inter-element gap.
  static const double sm = 8;

  /// 12 logical pixels — gap between major card sections.
  static const double md = 12;

  /// 16 logical pixels — page padding baseline.
  static const double lg = 16;

  /// 24 logical pixels — section dividers and sheet padding.
  static const double xl = 24;

  /// 32 logical pixels — used sparingly for top-of-page breathing room.
  static const double xxl = 32;

  /// All spacing values in declaration order. Useful for tests and for any
  /// code that wants to enumerate the scale (e.g. dev tooling).
  static const List<double> values = <double>[none, xs, sm, md, lg, xl, xxl];
}

/// Corner radius scale.
///
/// Pi Mob aims for calm, low-chrome surfaces; the radius scale is short on
/// purpose. Most cards and inputs use [md]; pills and chip-like surfaces use
/// [pill].
class PiRadius {
  const PiRadius._();

  /// 6 logical pixels — inline chips and status pills.
  static const double sm = 6;

  /// 10 logical pixels — cards, dialogs, inputs (the default).
  static const double md = 10;

  /// 16 logical pixels — bottom sheets and prominent containers.
  static const double lg = 16;

  /// Fully rounded — used for circular avatars and pill badges.
  static const double pill = 999;
}

/// Duration buckets for Pi Mob animations.
///
/// Three buckets cover all current motion: short hovers/press feedback,
/// medium state changes, long entry/exit. Always resolve via
/// [PiMotion.resolve] so the platform's reduced-motion preference is
/// honored.
class PiDuration {
  const PiDuration._();

  /// 150 ms — hovers, ripples, button press feedback.
  static const Duration short = Duration(milliseconds: 150);

  /// 250 ms — toggle changes, segmented button selection, dialog fades.
  static const Duration medium = Duration(milliseconds: 250);

  /// 400 ms — entry/exit transitions for sheets and full-screen routes.
  static const Duration long = Duration(milliseconds: 400);
}

/// Curve tokens for Pi Mob animations.
///
/// Curves are tokenized alongside [PiDuration] so motion calls in widget
/// code can share a single set of named timings without re-declaring
/// Material's [Curves] constants. Use [PiMotion.resolve] / [resolveFor]
/// to swap the active curve for [Curves.linear] when reduced motion is
/// on, which collapses continuous animation to a single instant update.
class PiCurve {
  const PiCurve._();

  /// Standard acceleration curve for entry animations.
  static const Curve emphasized = Curves.easeInOutCubicEmphasized;

  /// Gentle deceleration curve for exits.
  static const Curve decelerate = Curves.easeOutCubic;

  /// Acceleration curve used when content moves toward its final position.
  static const Curve accelerate = Curves.easeInCubic;

  /// Returns [curve] when animations are allowed, otherwise
  /// [Curves.linear] so transitions still resolve instantly without any
  /// visible easing.
  static Curve resolve(BuildContext context, Curve curve) {
    final reduced = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    return resolveFor(curve, reducedMotion: reduced);
  }

  /// Pure variant of [resolve] for tests and non-widget callers.
  static Curve resolveFor(Curve curve, {required bool reducedMotion}) {
    return reducedMotion ? Curves.linear : curve;
  }
}

/// Resolves an animation duration while honoring the platform's
/// reduced-motion preference.
///
/// When the surrounding [MediaQuery] reports that animations are disabled
/// (either via system settings or accessibility services) the returned
/// duration collapses to [Duration.zero] so widgets still update but do so
/// without motion. The function is total — it never throws and never
/// returns null — so callers can use it inline without null checks.
class PiMotion {
  const PiMotion._();

  /// Returns [base] when animations are allowed, otherwise [Duration.zero].
  ///
  /// Pass the build [context] so the helper can read the ambient
  /// [MediaQuery]. Outside a widget tree, or in unit tests, use
  /// [resolveFor] and supply the reduced-motion flag explicitly.
  static Duration resolve(BuildContext context, Duration base) {
    final reduced = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    return resolveFor(base, reducedMotion: reduced);
  }

  /// Pure variant of [resolve] for tests and non-widget callers.
  ///
  /// Set [reducedMotion] to true to simulate the platform accessibility
  /// setting without needing a [BuildContext].
  static Duration resolveFor(Duration base, {required bool reducedMotion}) {
    return reducedMotion ? Duration.zero : base;
  }
}
