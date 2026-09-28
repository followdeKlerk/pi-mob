import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../theme/pi_theme.dart';
import 'composer.dart';
import 'pi_brand_mark.dart';
import 'transcript_panel.dart';
import '../../transcript/widgets/reasoning_orb.dart';
import '../../domain/prompt_send_lifecycle.dart';

/// Body for the Activity destination — focused transcript + bottom composer.
///
/// The structure is intentionally simple: a stretch transcript on top of a
/// fixed-bottom composer card. With no active session, the empty state opens
/// the saved-chat drawer; drafts remain durable across switches and reconnects.
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

  /// Invoked when the user opens saved chats from the empty state.
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
    return LayoutBuilder(
      builder: (context, constraints) => Column(
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
            color: theme.scaffoldBackgroundColor,
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
                child: ConstrainedBox(
                  constraints: BoxConstraints(
                    maxHeight: constraints.maxHeight * .6,
                  ),
                  child: SingleChildScrollView(
                    child: _ActivityWorkingSurface(
                      coordinator: coordinator,
                      draftController: draftController,
                      onOpenDialog: onOpenDialog,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ActivityWorkingSurface extends StatelessWidget {
  const _ActivityWorkingSurface({
    required this.coordinator,
    required this.draftController,
    required this.onOpenDialog,
  });

  final ConnectionCoordinator coordinator;
  final TextEditingController draftController;
  final VoidCallback onOpenDialog;

  bool get _active {
    final phase = coordinator.promptSendStatus.phase;
    return coordinator.canAbort ||
        const <PromptSendPhase>{
          PromptSendPhase.acquiringControl,
          PromptSendPhase.submitting,
        }.contains(phase) ||
        const <String>{
          'running',
          'waiting_for_input',
          'retry_wait',
          'compacting',
          'finishing',
        }.contains(coordinator.selectedEffectiveRuntimeState);
  }

  @override
  Widget build(BuildContext context) {
    final activity = orbActivityFor(
      status: coordinator.promptSendStatus,
      runtimeState: coordinator.selectedEffectiveRuntimeState,
      activeToolName: coordinator.selectedActiveToolName,
    );
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 460),
      reverseDuration: const Duration(milliseconds: 360),
      switchInCurve: Curves.easeOutCubic,
      switchOutCurve: Curves.easeInCubic,
      layoutBuilder: (currentChild, previousChildren) => Stack(
        alignment: Alignment.bottomCenter,
        children: <Widget>[
          ...previousChildren,
          if (currentChild != null) currentChild,
        ],
      ),
      child: _active
          ? _WorkingOrb(
              key: ValueKey<String>('working-orb-${activity.mode.name}'),
              coordinator: coordinator,
              activity: activity,
              onOpenDialog: onOpenDialog,
            )
          : Composer(
              key: const Key('activity-composer'),
              coordinator: coordinator,
              draftController: draftController,
              onOpenDialog: onOpenDialog,
            ),
    );
  }
}

class _WorkingOrb extends StatelessWidget {
  const _WorkingOrb({
    required this.coordinator,
    required this.activity,
    required this.onOpenDialog,
    super.key,
  });

  final ConnectionCoordinator coordinator;
  final OrbActivity activity;
  final VoidCallback onOpenDialog;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final stopEnabled = coordinator.canAbort;
    return Card(
      key: const Key('working-orb-surface'),
      color: colors.surfaceContainerLowest,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(PiRadius.lg),
        side: BorderSide(color: colors.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          PiSpacing.md,
          PiSpacing.sm,
          PiSpacing.md,
          PiSpacing.md,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            SizedBox(
              height: 156,
              child: OrbCanvas(mode: activity.mode, size: 156),
            ),
            Semantics(
              liveRegion: true,
              label: activity.label,
              child: Text(
                activity.label,
                key: const Key('working-orb-activity-label'),
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.titleMedium?.copyWith(
                  color: colors.onSurface,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const SizedBox(height: PiSpacing.sm),
            if (coordinator.selectedDialog != null) ...[
              OutlinedButton.icon(
                key: const Key('open-extension-dialog'),
                onPressed: onOpenDialog,
                icon: const Icon(Icons.open_in_new, size: 18),
                label: const Text('Open request'),
              ),
              const SizedBox(height: PiSpacing.xs),
            ],
            KeyedSubtree(
              key: const Key('send-button'),
              child: FilledButton.icon(
                key: const Key('stop-orb-action'),
                onPressed: stopEnabled ? () => coordinator.abort() : null,
                icon: const Icon(Icons.stop_rounded),
                label: const Text('Stop'),
              ),
            ),
          ],
        ),
      ),
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
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: ListView(
          shrinkWrap: true,
          key: const Key('activity-empty-state'),
          children: [
            const SizedBox(height: PiSpacing.xl),
            const Center(child: PiBrandMark(size: 80)),
            const SizedBox(height: PiSpacing.md),
            Text(
              'Make room for an idea.',
              textAlign: TextAlign.center,
              style: theme.textTheme.headlineSmall?.copyWith(
                color: colors.onSurface,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: PiSpacing.sm),
            Text(
              'No active session',
              textAlign: TextAlign.center,
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: PiSpacing.sm),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: PiSpacing.xl),
              child: Text(
                'Open your chats to continue a conversation or start a new one. '
                'Your draft stays safe across switches and reconnects.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
            ),
            const SizedBox(height: PiSpacing.xl),
            Center(
              child: FilledButton.icon(
                key: const Key('activity-empty-go-sessions'),
                onPressed: onGoToSessions,
                icon: const Icon(Icons.menu_rounded),
                label: const Text('Open chats'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
