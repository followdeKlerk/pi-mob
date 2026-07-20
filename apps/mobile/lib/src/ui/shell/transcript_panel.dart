import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../../transcript/widgets/transcript_view.dart';
import '../theme/pi_theme.dart';

/// Transcript surface as composed on the Activity destination. The
/// stream-keyed `TranscriptEventView` is the sole presentation path for
/// conversational and tool activity, including truncation metadata attached
/// to its originating tool card.
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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          child: TranscriptEventView(
            key: ValueKey(streamId),
            streamId: streamId,
            events: coordinator.transcriptEvents(sessionId),
            onEditUserMessage: coordinator.updateDraft,
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
