import 'package:flutter/material.dart';

import '../../ui/theme/pi_theme.dart';
import '../domain/recipe_activity.dart';

/// Compact, collapsed-by-default presentation of one R1 activity.
///
/// The widget intentionally exposes only the bounded projection. It never
/// receives or renders raw normalized event payloads and has no persistence or
/// coordinator dependency.
class RecipeActivityView extends StatefulWidget {
  const RecipeActivityView({required this.activity, super.key});

  final RecipeActivity activity;

  @override
  State<RecipeActivityView> createState() => _RecipeActivityViewState();
}

class _RecipeActivityViewState extends State<RecipeActivityView> {
  bool _expanded = false;

  RecipeActivity get activity => widget.activity;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final status = _statusLabel(activity.status);
    final label = activity.kind == RecipeActivityKind.tool
        ? '${activity.toolName ?? activity.title}, $status'
        : '${activity.title}, $status';
    return Semantics(
      container: true,
      label: label,
      child: Card(
        margin: const EdgeInsets.symmetric(horizontal: PiSpacing.lg, vertical: PiSpacing.xs),
        elevation: 0,
        color: scheme.surfaceContainerLow,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            InkWell(
              onTap: () => setState(() => _expanded = !_expanded),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: PiSpacing.md, vertical: PiSpacing.sm),
                child: Row(
                  children: [
                    Icon(_statusIcon(activity.status), size: 17, color: _statusColor(scheme, activity.status)),
                    const SizedBox(width: PiSpacing.sm),
                    Expanded(child: Text(activity.title, maxLines: 1, overflow: TextOverflow.ellipsis)),
                    Text(status, style: Theme.of(context).textTheme.labelSmall),
                    const SizedBox(width: PiSpacing.xs),
                    Icon(_expanded ? Icons.expand_less : Icons.expand_more, size: 18),
                  ],
                ),
              ),
            ),
            if (_expanded) _details(context),
          ],
        ),
      ),
    );
  }

  Widget _details(BuildContext context) {
    final text = Theme.of(context).textTheme.bodySmall;
    final lines = <String>[
      if (activity.kind == RecipeActivityKind.tool) 'Arguments: ${activity.arguments ?? '-'}',
      if (activity.kind == RecipeActivityKind.tool) 'Output: ${activity.output ?? '-'}',
      if (activity.errorInfo != null) 'Error: ${activity.errorInfo!.message}',
      if (activity.truncation?.isTruncated == true)
        'Output truncated: ${activity.truncation!.retainedBytes} of ${activity.truncation!.totalBytes} bytes',
    ];
    if (lines.isEmpty) lines.add('No additional details available.');
    return Padding(
      padding: const EdgeInsets.fromLTRB(PiSpacing.md, 0, PiSpacing.md, PiSpacing.md),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [for (final line in lines) Text(line, style: text)]),
    );
  }
}

String _statusLabel(RecipeActivityStatus status) => switch (status) {
  RecipeActivityStatus.pending => 'Pending',
  RecipeActivityStatus.running => 'Running',
  RecipeActivityStatus.completed => 'Completed',
  RecipeActivityStatus.failed => 'Failed',
  RecipeActivityStatus.cancelled => 'Cancelled',
};
IconData _statusIcon(RecipeActivityStatus status) => switch (status) {
  RecipeActivityStatus.pending => Icons.schedule,
  RecipeActivityStatus.running => Icons.sync,
  RecipeActivityStatus.completed => Icons.check_circle_outline,
  RecipeActivityStatus.failed => Icons.error_outline,
  RecipeActivityStatus.cancelled => Icons.cancel_outlined,
};
Color _statusColor(ColorScheme scheme, RecipeActivityStatus status) => switch (status) {
  RecipeActivityStatus.pending => scheme.onSurfaceVariant,
  RecipeActivityStatus.running => scheme.primary,
  RecipeActivityStatus.completed => scheme.tertiary,
  RecipeActivityStatus.failed => scheme.error,
  RecipeActivityStatus.cancelled => scheme.onSurfaceVariant,
};
