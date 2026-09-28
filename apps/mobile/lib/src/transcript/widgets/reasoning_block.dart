/// Compact, progressively disclosed model reasoning.
///
/// The surface follows the mobile pattern used by Claude and coding agents:
/// one quiet Thinking row above the answer, collapsed by default, with the
/// provider-supplied summary available on demand. It never claims to expose
/// private or complete chain-of-thought.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../ui/theme/pi_theme.dart';
import '../../ui/shell/motion_primitives.dart';
import 'view_data/reasoning_view_data.dart';
import 'reasoning_orb.dart';

class ReasoningBlock extends StatefulWidget {
  const ReasoningBlock._({required this.data, super.key});

  factory ReasoningBlock.forViewData(ReasoningViewData data, {Key? key}) =>
      ReasoningBlock._(
        key: key ?? ValueKey('reasoning-${data.reasoningId}'),
        data: data,
      );

  final ReasoningViewData data;

  @override
  State<ReasoningBlock> createState() => _ReasoningBlockState();
}

class _ReasoningBlockState extends State<ReasoningBlock> {
  late bool _expanded;
  bool _showTerminalTransition = false;
  Timer? _terminalTransitionTimer;

  @override
  void initState() {
    super.initState();
    _expanded = widget.data.isExpandedByDefault;
  }

  @override
  void didUpdateWidget(covariant ReasoningBlock oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.data.phase != widget.data.phase) {
      _expanded = widget.data.isExpandedByDefault;
      if (oldWidget.data.phase == ReasoningPhase.active &&
          widget.data.phase != ReasoningPhase.active &&
          widget.data.summary.trim().isEmpty &&
          widget.data.steps.isEmpty) {
        _showTerminalTransition = true;
        _terminalTransitionTimer?.cancel();
        _terminalTransitionTimer = Timer(PiDuration.medium, () {
          if (mounted) setState(() => _showTerminalTransition = false);
        });
      }
    }
  }

  @override
  void dispose() {
    _terminalTransitionTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final data = widget.data;
    final active = data.phase == ReasoningPhase.active;
    if (!active &&
        !_showTerminalTransition &&
        data.summary.trim().isEmpty &&
        data.steps.isEmpty) {
      return const SizedBox.shrink();
    }
    final colors = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final label = active ? 'Thinking…' : 'Thinking';

    return Semantics(
      container: true,
      button: true,
      expanded: _expanded,
      label: active ? 'Thinking in progress' : 'Thinking complete',
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: PiSpacing.lg,
          vertical: PiSpacing.xs,
        ),
        child: Material(
          color: colors.surfaceContainerLow,
          borderRadius: BorderRadius.circular(PiRadius.sm),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              InkWell(
                key: const Key('reasoning-header'),
                borderRadius: BorderRadius.circular(PiRadius.sm),
                onTap: () => setState(() => _expanded = !_expanded),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: 48),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: PiSpacing.md,
                      vertical: PiSpacing.sm,
                    ),
                    child: Row(
                      children: [
                        MotionCrossfade(
                          child: Row(
                            key: ValueKey(active),
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              ReasoningOrb(active: active, size: 30),
                              const SizedBox(width: PiSpacing.sm),
                            ],
                          ),
                        ),
                        Expanded(
                          child: Text(
                            label,
                            style: text.labelLarge?.copyWith(
                              color: colors.onSurfaceVariant,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                        AnimatedRotation(
                          turns: _expanded ? .5 : 0,
                          duration: PiMotion.resolve(context, PiDuration.short),
                          curve: PiCurve.decelerate,
                          child: Icon(
                            Icons.keyboard_arrow_down_rounded,
                            size: 20,
                            color: colors.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              if (_expanded) _details(context),
            ],
          ),
        ),
      ),
    );
  }

  Widget _details(BuildContext context) {
    final data = widget.data;
    final colors = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final summary = data.summary.trim();
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        PiSpacing.md,
        PiSpacing.none,
        PiSpacing.md,
        PiSpacing.md,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Divider(height: PiSpacing.md, color: colors.outlineVariant),
          if (summary.isNotEmpty)
            SelectableText(
              summary,
              style: text.bodySmall?.copyWith(
                color: colors.onSurfaceVariant,
                height: 1.45,
              ),
            ),
          if (summary.isNotEmpty && data.steps.isNotEmpty)
            const SizedBox(height: PiSpacing.md),
          for (var index = 0; index < data.steps.length; index++)
            Padding(
              padding: const EdgeInsets.only(bottom: PiSpacing.sm),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    constraints: const BoxConstraints(
                      minWidth: 24,
                      minHeight: 24,
                    ),
                    padding: const EdgeInsets.all(PiSpacing.xs),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: colors.surfaceContainerHighest,
                      shape: BoxShape.circle,
                    ),
                    child: Text(
                      '${index + 1}',
                      style: text.labelSmall?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                  ),
                  const SizedBox(width: PiSpacing.sm),
                  Expanded(
                    child: Text(
                      data.steps[index],
                      style: text.bodySmall?.copyWith(
                        color: colors.onSurfaceVariant,
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
