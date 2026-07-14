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

  @override
  Widget build(BuildContext context) {
    final active = _data.phase == ReasoningPhase.active;
    final phaseLabel = _data.phaseLabel;
    final accent = active ? _colors.primary : _colors.outline;
    return Semantics(
      container: true,
      label: '$phaseLabel: ${_data.summary}',
      child: Card(
        margin: const EdgeInsets.symmetric(vertical: 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            InkWell(
              key: const Key('reasoning-header'),
              onTap: () => setState(() => _userExpanded = !_userExpanded),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
                child: Row(
                  children: [
                    Icon(
                      active ? Icons.psychology : Icons.lightbulb_outline,
                      color: accent,
                      size: 18,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(phaseLabel, style: _text.titleSmall),
                          if (_data.summary.isNotEmpty)
                            Text(
                              _data.summary,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: _text.bodySmall,
                            ),
                        ],
                      ),
                    ),
                    if (active)
                      const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    Icon(
                      _expanded ? Icons.expand_less : Icons.expand_more,
                      size: 18,
                    ),
                  ],
                ),
              ),
            ),
            if (_expanded) _stepsList(),
          ],
        ),
      ),
    );
  }

  Widget _stepsList() {
    if (_data.steps.isEmpty) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
        child: Text('No steps recorded', style: _text.bodySmall),
      );
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Divider(height: 1),
          const SizedBox(height: 6),
          for (final step in _data.steps)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('• '),
                  Expanded(child: Text(step, style: _text.bodyMedium)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
