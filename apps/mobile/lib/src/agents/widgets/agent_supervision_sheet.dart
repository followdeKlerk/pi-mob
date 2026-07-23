/// Compact multi-agent supervision sheet.
///
/// This widget renders a read-only summary of every Agent run the
/// reducer has surfaced for the currently-selected chat (and a
/// global view when no chat is selected). The sheet is intentionally
/// honest:
///
///   * Each row shows the task, model, lifecycle status, elapsed
///     time, originating chat and turn, and the latest bounded
///     meaningful output or error.
///
///   * Steer, cancel, and adopt affordances appear only when an
///     authoritative capability contract exists. Otherwise the row
///     shows an explicit "Unavailable" line that points at the
///     blocker; the widget never invents or pretends.
///
///   * Each row exposes "open transcript" and "open result" actions
///     that route to the existing transcript surface. They do not
///     issue RPC commands.
library;

import 'package:flutter/material.dart';

import '../../ui/theme/pi_theme.dart';
import '../domain/agent_supervision.dart';

/// Compact sheet that shows every supervised Agent run, plus a
/// blocker list at the bottom when the reducer observed one.
class AgentSupervisionSheet extends StatelessWidget {
  const AgentSupervisionSheet({
    required this.state,
    required this.title,
    this.now,
    this.onOpenTranscript,
    this.onOpenResult,
    super.key,
  });

  /// The projection produced by the reducer. May be empty when no
  /// Agent tool has been observed.
  final AgentSupervisionState state;

  /// Sheet title. Lets the same widget render "Selected chat" or
  /// "Global agents" without leaking that distinction into the row
  /// chrome.
  final String title;

  /// "Now" reference for elapsed-time computation. Tests pass a
  /// fixed DateTime so the rendered duration stays stable.
  final DateTime? now;

  /// Invoked when the user taps the "Open transcript" action on a
  /// row. The widget passes the originating chat id (when known)
  /// and turn id (when known).
  final void Function(String? chatId, String? turnId)? onOpenTranscript;

  /// Invoked when the user taps the "Open result" action on a row.
  /// The widget passes the originating chat id (when known).
  final void Function(String? chatId)? onOpenResult;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final text = theme.textTheme;
    final runs = state.runs;
    final blockers = state.blockers;
    final referenceNow = now ?? DateTime.now().toUtc();
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        PiSpacing.lg,
        PiSpacing.sm,
        PiSpacing.lg,
        PiSpacing.md,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: text.titleMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (state.runningCount > 0)
                _RunningBadge(count: state.runningCount),
            ],
          ),
          const SizedBox(height: PiSpacing.sm),
          if (runs.isEmpty)
            _EmptyState(text: text, colors: colors)
          else
            for (final run in runs) ...[
              AgentRunRow(
                key: ValueKey('agent-run-${run.toolCallId}'),
                run: run,
                now: referenceNow,
                onOpenTranscript: onOpenTranscript == null
                    ? null
                    : () =>
                          onOpenTranscript!(run.originChatId, run.originTurnId),
                onOpenResult: onOpenResult == null
                    ? null
                    : () => onOpenResult!(run.originChatId),
              ),
              const SizedBox(height: PiSpacing.sm),
            ],
          if (blockers.isNotEmpty) ...[
            const SizedBox(height: PiSpacing.sm),
            Text(
              'Control blockers',
              style: text.labelLarge?.copyWith(
                color: colors.onSurfaceVariant,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: PiSpacing.xs),
            for (final blocker in blockers)
              Padding(
                padding: const EdgeInsets.only(bottom: PiSpacing.xs),
                child: _BlockerLine(blocker: blocker),
              ),
          ],
        ],
      ),
    );
  }
}

/// One row in the sheet. Renders the durable Agent run state.
class AgentRunRow extends StatelessWidget {
  const AgentRunRow({
    required this.run,
    required this.now,
    this.onOpenTranscript,
    this.onOpenResult,
    super.key,
  });

  final AgentRun run;
  final DateTime now;
  final VoidCallback? onOpenTranscript;
  final VoidCallback? onOpenResult;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final text = theme.textTheme;
    final statusColor = _statusColor(run.status, colors);
    final statusLabel = run.status.label;
    return Container(
      key: const Key('agent-run-row'),
      padding: const EdgeInsets.all(PiSpacing.md),
      decoration: BoxDecoration(
        color: colors.surfaceContainerLow,
        borderRadius: BorderRadius.circular(PiRadius.md),
        border: Border.all(
          color: colors.outlineVariant.withValues(alpha: 0.65),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Icon(_statusIcon(run.status), color: statusColor, size: 16),
              const SizedBox(width: PiSpacing.sm),
              Expanded(
                child: Text(
                  run.task.isEmpty ? '(no task text)' : run.task,
                  style: text.titleSmall?.copyWith(
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: PiSpacing.sm),
              Text(
                statusLabel,
                style: text.labelMedium?.copyWith(
                  color: statusColor,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: PiSpacing.xs),
          _MetaLine(text: text, colors: colors, run: run, now: now),
          if (run.latestOutput != null && run.latestOutput!.isNotEmpty) ...[
            const SizedBox(height: PiSpacing.xs),
            _OutputPreview(
              text: text,
              colors: colors,
              content: run.latestOutput!,
            ),
          ],
          if (run.errorMessage != null && run.errorMessage!.isNotEmpty) ...[
            const SizedBox(height: PiSpacing.xs),
            _ErrorLine(text: text, colors: colors, message: run.errorMessage!),
          ],
          const SizedBox(height: PiSpacing.sm),
          _ActionRow(
            run: run,
            onOpenTranscript: onOpenTranscript,
            onOpenResult: onOpenResult,
          ),
          _CapabilityRow(run: run),
        ],
      ),
    );
  }

  Color _statusColor(AgentRunStatus status, ColorScheme scheme) {
    return switch (status) {
      AgentRunStatus.running => scheme.primary,
      AgentRunStatus.completed => scheme.primary,
      AgentRunStatus.error => scheme.error,
      AgentRunStatus.cancelled => scheme.outline,
    };
  }

  IconData _statusIcon(AgentRunStatus status) {
    return switch (status) {
      AgentRunStatus.running => Icons.hourglass_bottom,
      AgentRunStatus.completed => Icons.check_circle,
      AgentRunStatus.error => Icons.error,
      AgentRunStatus.cancelled => Icons.cancel,
    };
  }
}

class _MetaLine extends StatelessWidget {
  const _MetaLine({
    required this.text,
    required this.colors,
    required this.run,
    required this.now,
  });

  final TextTheme text;
  final ColorScheme colors;
  final AgentRun run;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final modelPart = run.model == null || run.model!.isEmpty
        ? 'no model'
        : 'model ${run.model}';
    final typePart = run.subagentType == null || run.subagentType!.isEmpty
        ? null
        : run.subagentType;
    final thinkingPart = run.thinkingLevel == null || run.thinkingLevel!.isEmpty
        ? null
        : 'thinking ${run.thinkingLevel}';
    final backgroundPart = run.backgroundRequested
        ? 'background'
        : 'foreground';
    final elapsed = _formatElapsed(run.elapsedAt(now));
    final origin = _originLabel(run);
    final typeSegment = typePart == null ? null : 'agent $typePart';
    final segments = <String>[
      backgroundPart,
      modelPart,
      ?typeSegment,
      ?thinkingPart,
      'elapsed $elapsed',
      ?origin,
    ];
    return Text(
      segments.join(' · '),
      style: text.bodySmall?.copyWith(color: colors.onSurfaceVariant),
    );
  }

  String? _originLabel(AgentRun run) {
    if (run.originChatId == null && run.originTurnId == null) return null;
    final chat = run.originChatId ?? '?';
    final turn = run.originTurnId ?? '?';
    return 'chat $chat · turn $turn';
  }
}

class _OutputPreview extends StatelessWidget {
  const _OutputPreview({
    required this.text,
    required this.colors,
    required this.content,
  });

  final TextTheme text;
  final ColorScheme colors;
  final String content;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(PiSpacing.sm),
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(PiRadius.sm),
      ),
      child: Text(
        content,
        style: text.bodySmall?.copyWith(color: colors.onSurface),
        maxLines: 4,
        overflow: TextOverflow.ellipsis,
      ),
    );
  }
}

class _ErrorLine extends StatelessWidget {
  const _ErrorLine({
    required this.text,
    required this.colors,
    required this.message,
  });

  final TextTheme text;
  final ColorScheme colors;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.error_outline, size: 14, color: colors.error),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            message,
            style: text.bodySmall?.copyWith(color: colors.error),
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

class _ActionRow extends StatelessWidget {
  const _ActionRow({
    required this.run,
    required this.onOpenTranscript,
    required this.onOpenResult,
  });

  final AgentRun run;
  final VoidCallback? onOpenTranscript;
  final VoidCallback? onOpenResult;

  @override
  Widget build(BuildContext context) {
    final hasTranscript = run.originChatId != null && run.originTurnId != null;
    final hasResult = run.latestOutput != null && run.latestOutput!.isNotEmpty;
    if (!hasTranscript && !hasResult) {
      return const SizedBox.shrink();
    }
    return Row(
      children: [
        if (hasTranscript)
          TextButton.icon(
            key: const Key('agent-run-open-transcript'),
            onPressed: onOpenTranscript,
            icon: const Icon(Icons.subject, size: 16),
            label: const Text('Open transcript'),
          ),
        if (hasResult) ...[
          const SizedBox(width: PiSpacing.xs),
          TextButton.icon(
            key: const Key('agent-run-open-result'),
            onPressed: onOpenResult,
            icon: const Icon(Icons.description_outlined, size: 16),
            label: const Text('Open result'),
          ),
        ],
      ],
    );
  }
}

class _CapabilityRow extends StatelessWidget {
  const _CapabilityRow({required this.run});

  final AgentRun run;

  @override
  Widget build(BuildContext context) {
    final caps = run.caps;
    final canSteer = caps?.canSteer ?? false;
    final canCancel = caps?.canCancel ?? false;
    final canAdopt = caps?.canAdopt ?? false;
    final hasAny = canSteer || canCancel || canAdopt;
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final text = theme.textTheme;
    if (!hasAny) {
      return Padding(
        padding: const EdgeInsets.only(top: PiSpacing.xs),
        child: Text(
          'Steer / cancel / adopt: unavailable — no authoritative contract.',
          style: text.bodySmall?.copyWith(color: colors.onSurfaceVariant),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(top: PiSpacing.xs),
      child: Wrap(
        spacing: PiSpacing.sm,
        runSpacing: PiSpacing.xs,
        children: [
          if (canSteer)
            _CapabilityPill(
              icon: Icons.fork_right,
              label: 'Steer available',
              color: colors.primary,
              source: caps?.contractSource,
            ),
          if (canCancel)
            _CapabilityPill(
              icon: Icons.cancel_outlined,
              label: 'Cancel available',
              color: colors.error,
              source: caps?.contractSource,
            ),
          if (canAdopt)
            _CapabilityPill(
              icon: Icons.move_to_inbox_outlined,
              label: 'Adopt available',
              color: colors.primary,
              source: caps?.contractSource,
            ),
        ],
      ),
    );
  }
}

class _CapabilityPill extends StatelessWidget {
  const _CapabilityPill({
    required this.icon,
    required this.label,
    required this.color,
    required this.source,
  });

  final IconData icon;
  final String label;
  final Color color;
  final String? source;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final text = theme.textTheme;
    return Tooltip(
      message: source == null ? label : '$label · contract: $source',
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: PiSpacing.sm,
          vertical: PiSpacing.xs,
        ),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(PiRadius.sm),
          border: Border.all(color: color.withValues(alpha: 0.35)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: color),
            const SizedBox(width: 4),
            Text(label, style: text.labelSmall?.copyWith(color: color)),
          ],
        ),
      ),
    );
  }
}

class _BlockerLine extends StatelessWidget {
  const _BlockerLine({required this.blocker});

  final AgentSupervisionBlocker blocker;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final text = theme.textTheme;
    return Container(
      padding: const EdgeInsets.all(PiSpacing.sm),
      decoration: BoxDecoration(
        color: colors.errorContainer.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(PiRadius.sm),
        border: Border.all(color: colors.error.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.block, size: 14, color: colors.error),
          const SizedBox(width: 6),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  blocker.kind,
                  style: text.labelSmall?.copyWith(
                    color: colors.onErrorContainer,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(
                  blocker.detail,
                  style: text.bodySmall?.copyWith(
                    color: colors.onErrorContainer,
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

class _RunningBadge extends StatelessWidget {
  const _RunningBadge({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final text = theme.textTheme;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: PiSpacing.sm,
        vertical: PiSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: colors.primary.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(PiRadius.sm),
      ),
      child: Text(
        '$count running',
        style: text.labelMedium?.copyWith(
          color: colors.primary,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.text, required this.colors});

  final TextTheme text;
  final ColorScheme colors;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(PiSpacing.md),
      decoration: BoxDecoration(
        color: colors.surfaceContainerLow,
        borderRadius: BorderRadius.circular(PiRadius.md),
        border: Border.all(color: colors.outlineVariant.withValues(alpha: 0.5)),
      ),
      child: Row(
        children: [
          Icon(Icons.smart_toy_outlined, color: colors.onSurfaceVariant),
          const SizedBox(width: PiSpacing.sm),
          Expanded(
            child: Text(
              'No Agent activity observed yet. Subagents launched from '
              'this chat will appear here as soon as the bridge reports '
              'their tool events.',
              style: text.bodySmall?.copyWith(color: colors.onSurfaceVariant),
            ),
          ),
        ],
      ),
    );
  }
}

/// Convenience entry point used by the app shell to show the sheet.
Future<void> showAgentSupervisionSheet(
  BuildContext context, {
  required AgentSupervisionState state,
  required String title,
  void Function(String? chatId, String? turnId)? onOpenTranscript,
  void Function(String? chatId)? onOpenResult,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheetContext) {
      final mq = MediaQuery.of(sheetContext);
      return SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: mq.size.height * 0.85),
          child: SingleChildScrollView(
            child: AgentSupervisionSheet(
              state: state,
              title: title,
              onOpenTranscript: onOpenTranscript,
              onOpenResult: onOpenResult,
            ),
          ),
        ),
      );
    },
  );
}

String _formatElapsed(Duration duration) {
  if (duration.inSeconds < 60) return '${duration.inSeconds}s';
  final minutes = duration.inMinutes;
  if (minutes < 60) {
    final seconds = duration.inSeconds % 60;
    return '${minutes}m ${seconds.toString().padLeft(2, '0')}s';
  }
  final hours = duration.inHours;
  final mins = duration.inMinutes % 60;
  return '${hours}h ${mins.toString().padLeft(2, '0')}m';
}
