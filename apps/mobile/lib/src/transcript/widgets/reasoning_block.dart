/// Collapsible reasoning block for the transcript.
///
/// Active reasoning (`[ReasoningPhase.active]`) is always expanded so the
/// user can follow along with the stream; completed reasoning
/// (`[ReasoningPhase.completed]`) is collapsed by default but exposes a
/// chevron to expand on demand. The default expansion state comes from
/// [ReasoningViewData.isExpandedByDefault]; the user can override it by
/// tapping the header.
///
/// The widget is intentionally stateful so the user's manual toggle is
/// preserved across rebuilds triggered by data refreshes.
///
/// Presentation: reasoning is **visually secondary** to the final answer.
/// The widget renders edge-to-edge with a thin left accent stripe (primary
/// while active, outlineVariant once completed) and a faint tinted
/// background. There is no card chrome.
library;

import 'package:flutter/material.dart';

import 'view_data/reasoning_view_data.dart';

/// Reasoning-block widget. Construct via [ReasoningBlock.forViewData].
class ReasoningBlock extends StatefulWidget {
  const ReasoningBlock._({required this.data, super.key});

  /// Builds a reasoning block from a [ReasoningViewData]. The widget key
  /// defaults to a value derived from [ReasoningViewData.reasoningId] so
  /// the framework can reuse the existing [Element] across rebuilds.
  factory ReasoningBlock.forViewData(ReasoningViewData data, {Key? key}) =>
      ReasoningBlock._(
        key: key ?? ValueKey('reasoning-${data.reasoningId}'),
        data: data,
      );

  /// View-data describing the reasoning block.
  final ReasoningViewData data;

  @override
  State<ReasoningBlock> createState() => _ReasoningBlockState();
}

class _ReasoningBlockState extends State<ReasoningBlock> {
  late bool _userExpanded;

  @override
  void initState() {
    super.initState();
    _userExpanded = widget.data.isExpandedByDefault;
  }

  @override
  void didUpdateWidget(covariant ReasoningBlock oldWidget) {
    super.didUpdateWidget(oldWidget);
    // When the block transitions to a non-default phase we re-anchor the
    // expansion to the data so the user's manual toggle does not fight
    // the lifecycle.
    if (oldWidget.data.phase != widget.data.phase) {
      _userExpanded = widget.data.isExpandedByDefault;
    }
  }

  bool get _expanded => _userExpanded;
  ReasoningViewData get _data => widget.data;
  ColorScheme get _colors => Theme.of(context).colorScheme;
  TextTheme get _text => Theme.of(context).textTheme;

  /// Horizontal inset (logical pixels) shared with the final answer so the
  /// prose edges align across the transcript.
  static const double _contentInset = 16;

  /// Width of the left accent stripe. Wide enough to read at a glance but
  /// narrow enough to stay restrained against 200% text scaling.
  static const double _accentWidth = 3;

  @override
  Widget build(BuildContext context) {
    final active = _data.phase == ReasoningPhase.active;
    final phaseLabel = _data.phaseLabel;
    final scheme = _colors;
    final text = _text;
    final accent = active ? scheme.primary : scheme.outlineVariant;
    final background = active
        ? scheme.primaryContainer.withValues(alpha: 0.18)
        : scheme.surfaceContainerHighest.withValues(alpha: 0.45);
    return Semantics(
      container: true,
      label: '$phaseLabel: ${_data.summary}',
      child: Card(
        margin: EdgeInsets.zero,
        elevation: 0,
        color: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: background,
            // Subtle right-side hairline divider separating consecutive
            // reasoning blocks; cheaper than a full Container/Card.
            border: Border(
              left: BorderSide(color: accent, width: _accentWidth),
              right: BorderSide(color: scheme.outlineVariant),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              InkWell(
                key: const Key('reasoning-header'),
                onTap: () => setState(() => _userExpanded = !_userExpanded),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(_contentInset, 10, 8, 10),
                  child: Row(
                    children: [
                      Icon(
                        active ? Icons.psychology : Icons.lightbulb_outline,
                        color: accent,
                        size: 18,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              phaseLabel,
                              style: text.titleSmall?.copyWith(
                                color: active
                                    ? scheme.primary
                                    : scheme.onSurfaceVariant,
                                fontWeight: active
                                    ? FontWeight.w600
                                    : FontWeight.w500,
                              ),
                            ),
                            if (_data.summary.isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.only(top: 2),
                                child: Text(
                                  _data.summary,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: text.bodySmall?.copyWith(
                                    color: scheme.onSurfaceVariant,
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                      if (active)
                        SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: scheme.primary,
                          ),
                        ),
                      if (active) const SizedBox(width: 6),
                      Icon(
                        _expanded ? Icons.expand_less : Icons.expand_more,
                        size: 18,
                        color: scheme.onSurfaceVariant,
                      ),
                    ],
                  ),
                ),
              ),
              if (_expanded) _stepsList(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _stepsList() {
    if (_data.steps.isEmpty) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(_contentInset, 0, _contentInset, 12),
        child: Text(
          'No steps recorded',
          style: _text.bodySmall?.copyWith(color: _colors.onSurfaceVariant),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(_contentInset, 0, _contentInset, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Divider(height: 12, thickness: 1, color: _colors.outlineVariant),
          for (final step in _data.steps)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '• ',
                    style: _text.bodyMedium?.copyWith(
                      color: _colors.onSurfaceVariant,
                    ),
                  ),
                  Expanded(
                    child: Text(
                      step,
                      style: _text.bodyMedium?.copyWith(
                        color: _colors.onSurfaceVariant,
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
