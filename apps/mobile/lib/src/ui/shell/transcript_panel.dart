import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../../transcript/widgets/transcript_view.dart';
import '../theme/pi_theme.dart';

/// Transcript surface as composed on the Activity destination. The
/// stream-keyed `TranscriptEventView` is the sole presentation path for
/// conversational and tool activity, including truncation metadata attached
/// to its originating tool card.
///
/// R12 — Per-chat scroll position is mobile-authoritative. When the
/// selected session changes, the panel reads the persisted tuple from
/// the coordinator and passes `(offset, followMode)` into the inner
/// `TranscriptEventView`/`TranscriptView` so the transcript jumps back
/// to where the user left it instead of the latest tail. User-initiated
/// scroll changes flush back through `onScrollPersist` to the
/// coordinator, which value-coalesces (no Timer / Future.delayed —
/// see FIELD_GUIDE §R11) and writes the row immediately.
class TranscriptPanel extends StatefulWidget {
  const TranscriptPanel({required this.coordinator, super.key});

  final ConnectionCoordinator coordinator;

  @override
  State<TranscriptPanel> createState() => _TranscriptPanelState();
}

class _TranscriptPanelState extends State<TranscriptPanel> {
  String? _streamKey;
  int? _restoredOffset;
  bool _restoredFollow = true;
  bool _restoredLoaded = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _loadPersisted();
  }

  Future<void> _loadPersisted() async {
    final coordinator = widget.coordinator;
    final sessionId = coordinator.selectedSessionId;
    if (sessionId == null) return;
    final streamKey = 'session:$sessionId';
    if (streamKey == _streamKey && _restoredLoaded) return;
    _streamKey = streamKey;
    final persisted = await coordinator.chatScrollPositionFor(sessionId);
    if (!mounted) return;
    setState(() {
      _restoredLoaded = true;
      if (persisted == null) {
        _restoredOffset = null;
        _restoredFollow = true;
      } else {
        _restoredOffset = persisted.scrollOffset;
        _restoredFollow = persisted.followMode;
      }
    });
  }

  Future<void> _onPersist(int offset, bool followMode) async {
    final sessionId = widget.coordinator.selectedSessionId;
    if (sessionId == null) return;
    await widget.coordinator.recordChatScrollPosition(
      sessionId: sessionId,
      scrollOffset: offset,
      followMode: followMode,
    );
  }

  @override
  Widget build(BuildContext context) {
    final coordinator = widget.coordinator;
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
            onScrollPersist: _onPersist,
            initialScrollOffset: _restoredLoaded ? _restoredOffset : null,
            initialFollowMode: _restoredLoaded ? _restoredFollow : true,
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
