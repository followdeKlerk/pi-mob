import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../../transcript/widgets/transcript_view.dart';
import '../theme/pi_theme.dart';

/// Transcript surface as composed on the Activity destination. Keeps the
/// stream-keyed `TranscriptEventView` that the existing M10–M15 flows and
/// tests already use, plus the durable `tool.output` truncation chips.
class TranscriptPanel extends StatelessWidget {
  const TranscriptPanel({required this.coordinator, super.key});

  final ConnectionCoordinator coordinator;

  @override
  Widget build(BuildContext context) {
    final sessionId = coordinator.selectedSessionId;
    if (sessionId == null) {
      return const Card(
        key: Key('activity-empty-session'),
        child: Padding(
          padding: EdgeInsets.all(PiSpacing.md),
          child: _EmptyTranscript(),
        ),
      );
    }
    final streamId = 'session:$sessionId';
    final history = coordinator.historyFor(sessionId);
    final syncing = coordinator.isHistorySyncing(sessionId);
    final truncated = coordinator.toolOutputNotices.where(
      (item) => item.isTruncated,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (syncing)
          Semantics(
            liveRegion: true,
            label:
                'Syncing transcript, ${coordinator.historyEventCount(sessionId)} events loaded',
            child: Container(
              key: const Key('transcript-sync-indicator'),
              margin: const EdgeInsets.fromLTRB(
                PiSpacing.md,
                PiSpacing.sm,
                PiSpacing.md,
                PiSpacing.xs,
              ),
              padding: const EdgeInsets.symmetric(
                horizontal: PiSpacing.md,
                vertical: PiSpacing.sm,
              ),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primaryContainer,
                borderRadius: BorderRadius.circular(PiRadius.md),
              ),
              child: Row(
                children: [
                  const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  const SizedBox(width: PiSpacing.sm),
                  Expanded(
                    child: Text(
                      'Syncing transcript · ${coordinator.historyEventCount(sessionId)} events loaded',
                      style: Theme.of(context).textTheme.labelMedium,
                    ),
                  ),
                ],
              ),
            ),
          )
        else if (history.error != null)
          Container(
            key: const Key('transcript-sync-error'),
            margin: const EdgeInsets.fromLTRB(
              PiSpacing.md,
              PiSpacing.sm,
              PiSpacing.md,
              PiSpacing.xs,
            ),
            padding: const EdgeInsets.symmetric(
              horizontal: PiSpacing.md,
              vertical: PiSpacing.sm,
            ),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.errorContainer,
              borderRadius: BorderRadius.circular(PiRadius.md),
            ),
            child: Row(
              children: [
                const Icon(Icons.sync_problem, size: 18),
                const SizedBox(width: PiSpacing.sm),
                const Expanded(child: Text('Transcript sync paused')),
                TextButton(
                  onPressed: () => coordinator.selectSession(sessionId),
                  child: const Text('Retry'),
                ),
              ],
            ),
          ),
        if (truncated.isNotEmpty)
          for (final notice in truncated)
            ListTile(
              key: Key('tool-output-${notice.toolCallId}'),
              leading: const Icon(Icons.content_cut),
              title: const Text('Tool output truncated'),
              subtitle: Text(
                '${notice.retainedBytes} of ${notice.totalBytes} bytes retained'
                '${notice.digest == null ? '' : '\nSHA-256 ${notice.digest}'}',
              ),
            ),
        Expanded(
          child: TranscriptEventView(
            key: ValueKey(streamId),
            streamId: streamId,
            events: coordinator.transcriptEvents(sessionId),
          ),
        ),
      ],
    );
  }
}

class _EmptyTranscript extends StatelessWidget {
  const _EmptyTranscript();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    return Row(
      children: [
        Icon(Icons.chat_bubble_outline, color: colors.onSurfaceVariant),
        const SizedBox(width: PiSpacing.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'No session selected',
                style: theme.textTheme.titleSmall?.copyWith(
                  color: colors.onSurface,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: PiSpacing.xs),
              Text(
                'Head to Sessions to pick or create one. The composer will '
                'wake up the moment you select a session.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
