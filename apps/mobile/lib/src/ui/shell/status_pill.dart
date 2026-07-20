/// Compact status pills used across the M16 product surface.
///
/// A [StatusPill] always renders three things together:
///
///   * An icon (so status never depends on color alone).
///   * A short text label (so screen readers announce the same fact).
///   * A tokenized foreground/background pair drawn from [PiSemanticColors]
///     (so light/dark themes and high-contrast preferences land for free).
///
/// The widget is intentionally narrow (default 6dp vertical padding, 8dp
/// horizontal) and pairs with [SessionBadges] / [StatusDot] in the rest of
/// the product shell. It supports a dense mode that drops the background
/// fill and reduces the horizontal padding to 4dp — appropriate for row
/// meta-lines on the session list.
library;

import 'package:flutter/material.dart';

import '../theme/pi_semantic_colors.dart';
import '../../domain/mobile_state.dart';
import '../theme/pi_tokens.dart';

/// Visual tone of a [StatusPill]. Each tone maps to a stable semantic
/// color pair from [PiSemanticColors] and a small icon vocabulary that the
/// caller picks.
enum StatusPillTone {
  /// Neutral — neither positive nor negative; the default for "ready" /
  /// "idle" / "connected" facts.
  neutral,

  /// Positive — completion, success, ready.
  positive,

  /// Caution — degraded, retrying, waiting.
  caution,

  /// Negative — failed, indeterminate, crashed.
  negative,

  /// Informational — purely descriptive, e.g. queued, running.
  info,
}

class StatusPill extends StatelessWidget {
  const StatusPill({
    required this.label,
    required this.tone,
    this.icon,
    this.dense = false,
    super.key,
  });

  final String label;
  final StatusPillTone tone;
  final IconData? icon;
  final bool dense;

  _StatusPalette _palette(PiSemanticColors semantic, ColorScheme scheme) {
    switch (tone) {
      case StatusPillTone.neutral:
        return _StatusPalette(
          foreground: scheme.onSurfaceVariant,
          background: scheme.surfaceContainerHigh,
        );
      case StatusPillTone.positive:
        return _StatusPalette(
          foreground: semantic.onSuccessContainer,
          background: semantic.successContainer,
        );
      case StatusPillTone.caution:
        return _StatusPalette(
          foreground: semantic.onWarningContainer,
          background: semantic.warningContainer,
        );
      case StatusPillTone.negative:
        return _StatusPalette(
          foreground: semantic.onCriticalContainer,
          background: semantic.criticalContainer,
        );
      case StatusPillTone.info:
        return _StatusPalette(
          foreground: semantic.onInfoContainer,
          background: semantic.infoContainer,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final semantic = context.piSemanticColors;
    final scheme = theme.colorScheme;
    final palette = _palette(semantic, scheme);
    return Semantics(
      label: label,
      excludeSemantics: true,
      container: true,
      child: Container(
        padding: EdgeInsets.symmetric(
          horizontal: dense ? PiSpacing.xs : PiSpacing.sm,
          vertical: dense ? PiSpacing.none : PiSpacing.xs,
        ),
        decoration: BoxDecoration(
          color: palette.background,
          borderRadius: BorderRadius.circular(PiRadius.sm),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon, size: dense ? 12 : 14, color: palette.foreground),
              SizedBox(width: dense ? PiSpacing.xs : PiSpacing.sm),
            ],
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style:
                    (dense
                            ? theme.textTheme.labelSmall
                            : theme.textTheme.labelMedium)
                        ?.copyWith(
                          color: palette.foreground,
                          fontWeight: FontWeight.w600,
                        ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusPalette {
  const _StatusPalette({required this.foreground, required this.background});
  final Color foreground;
  final Color background;
}

/// Stable mapping from internal session runtime states (the values emitted by
/// the bridge on the session stream) to a [StatusPill] configuration.
///
/// Keeps the session list, host dashboard, queue, and settings surfaces
/// visually consistent: every "Working / Needs your input / Crashed" fact
/// renders as the same icon + label + tone regardless of where it appears.
class SessionStatePill extends StatelessWidget {
  const SessionStatePill({
    required this.runtimeState,
    this.dense = true,
    super.key,
  });

  final String runtimeState;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    return StatusPill(
      label: sessionStateLabel(runtimeState),
      tone: _toneFor(runtimeState),
      icon: _iconFor(runtimeState),
      dense: dense,
    );
  }

  static StatusPillTone _toneFor(String state) => switch (state) {
    'crashed' ||
    'crash_loop' ||
    'indeterminate' ||
    'provider_interrupted' => StatusPillTone.negative,
    'waiting_for_input' ||
    'retry_wait' ||
    'compacting' => StatusPillTone.caution,
    'running' => StatusPillTone.info,
    'idle' || 'stopped' => StatusPillTone.positive,
    _ => StatusPillTone.neutral,
  };

  static IconData? _iconFor(String state) => switch (state) {
    'crashed' || 'crash_loop' => Icons.error_outline,
    'indeterminate' => Icons.help_outline,
    'provider_interrupted' => Icons.cloud_off,
    'waiting_for_input' => Icons.priority_high,
    'retry_wait' => Icons.schedule,
    'compacting' => Icons.compress,
    'running' => Icons.bolt,
    'idle' => Icons.check_circle_outline,
    'stopped' => Icons.pause_circle_outline,
    _ => Icons.chat_bubble_outline,
  };
}
