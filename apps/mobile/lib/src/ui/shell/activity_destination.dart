import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../theme/pi_theme.dart';
import 'composer.dart';
import 'transcript_panel.dart';

/// Body for the Activity destination — focused transcript + bottom composer.
///
/// The structure is intentionally simple: a stretch transcript on top of a
/// fixed-bottom composer card. The empty state nudges the user to the
/// Sessions tab when there is no active session, which mirrors the M15
/// "draft retention" rule (composer is only useful once a session exists).
///
/// Both children are still keyed exactly as before
/// (`activity-empty-state`, `composer-card`, and the inner transcript events
/// stream key), so existing widget tests and downstream callers don't have
/// to change anything.
class ActivityDestination extends StatelessWidget {
  const ActivityDestination({
    required this.coordinator,
    required this.draftController,
    required this.onOpenDialog,
    required this.onGoToSessions,
    super.key,
  });

  final ConnectionCoordinator coordinator;
  final TextEditingController draftController;
  final VoidCallback onOpenDialog;

  /// Invoked when the user taps the empty-state "Browse sessions" button.
  /// Lets the parent shell flip the destination without coupling the
  /// destination to the shell's state object directly.
  final VoidCallback onGoToSessions;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final sessionId = coordinator.selectedSessionId;
    if (sessionId == null) {
      return Padding(
        padding: const EdgeInsets.all(PiSpacing.lg),
        child: _ActivityEmpty(onGoToSessions: onGoToSessions),
      );
    }
    return Column(
      key: const Key('activity-destination-body'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          child: TranscriptPanel(
            key: const Key('activity-transcript'),
            coordinator: coordinator,
          ),
        ),
        Material(
          color: theme.colorScheme.surface,
          elevation: 0,
          child: SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                PiSpacing.md,
                PiSpacing.sm,
                PiSpacing.md,
                PiSpacing.md,
              ),
              child: Composer(
                key: const Key('activity-composer'),
                coordinator: coordinator,
                draftController: draftController,
                onOpenDialog: onOpenDialog,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _ActivityEmpty extends StatelessWidget {
  const _ActivityEmpty({required this.onGoToSessions});

  final VoidCallback onGoToSessions;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    return ListView(
      key: const Key('activity-empty-state'),
      children: [
        const SizedBox(height: PiSpacing.xl),
        Icon(Icons.chat_bubble_outline, size: 56, color: colors.primary),
        const SizedBox(height: PiSpacing.md),
        Text(
          'No active session',
          textAlign: TextAlign.center,
          style: theme.textTheme.headlineSmall?.copyWith(
            color: colors.onSurface,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: PiSpacing.sm),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: PiSpacing.xl),
          child: Text(
            'Head to the Sessions tab to pick or create one. Your draft is '
            'kept safe across sessions and reconnects.',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: colors.onSurfaceVariant,
            ),
          ),
        ),
        const SizedBox(height: PiSpacing.xl),
        Center(
          child: FilledButton.tonalIcon(
            key: const Key('activity-empty-go-sessions'),
            onPressed: onGoToSessions,
            icon: const Icon(Icons.list_alt),
            label: const Text('Browse sessions'),
          ),
        ),
      ],
    );
  }
}
