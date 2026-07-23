import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../theme/pi_theme.dart';
import 'motion_primitives.dart';

/// Compact synchronization gate. Session names, identifiers, and actions stay
/// hidden until every durable chat history is ready for local-first browsing.
class SessionSyncScreen extends StatelessWidget {
  const SessionSyncScreen({required this.coordinator, super.key});

  final ConnectionCoordinator coordinator;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final ready = coordinator.historyGateComplete;
    final error = coordinator.historyGateError;
    final total = coordinator.historySyncTotal;
    final completed = coordinator.historySyncCompleted;

    return SafeArea(
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(PiSpacing.lg),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: Card(
              key: const Key('session-sync-screen'),
              child: Padding(
                padding: const EdgeInsets.all(PiSpacing.xl),
                child: Semantics(
                  container: true,
                  liveRegion: true,
                  label: error != null
                      ? 'Chat synchronization failed'
                      : ready
                      ? 'Chats are ready'
                      : total == 0
                      ? 'Syncing chats'
                      : 'Syncing chats, $completed of $total complete',
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        error != null
                            ? Icons.sync_problem
                            : ready
                            ? Icons.check_circle_outline
                            : Icons.sync,
                        size: 36,
                        color: error != null ? colors.error : colors.primary,
                      ),
                      const SizedBox(height: PiSpacing.md),
                      Text(
                        ready ? 'Chats are ready' : 'Syncing chats',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.headlineSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: PiSpacing.xs),
                      Text(
                        error != null
                            ? 'Sync paused. Your existing local data is safe.'
                            : ready
                            ? 'Your local chat history is ready.'
                            : 'Preparing your chat history so opening a chat '
                                  'is immediate and works through reconnects.',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: PiSpacing.lg),
                      if (!ready && error == null) ...[
                        MotionProgressBar(
                          key: const Key('all-chat-sync-progress'),
                          value: total == 0
                              ? null
                              : coordinator.historySyncProgress,
                          minHeight: 4,
                        ),
                        const SizedBox(height: PiSpacing.sm),
                        Text(
                          total == 0
                              ? 'Preparing chats…'
                              : '$completed of $total chats synced',
                          key: const Key('chat-sync-progress-label'),
                          textAlign: TextAlign.center,
                          style: theme.textTheme.labelMedium?.copyWith(
                            color: colors.onSurfaceVariant,
                          ),
                        ),
                      ],
                      if (error != null)
                        Container(
                          key: const Key('chat-sync-error'),
                          padding: const EdgeInsets.all(PiSpacing.md),
                          decoration: BoxDecoration(
                            color: colors.errorContainer,
                            borderRadius: BorderRadius.circular(PiRadius.md),
                          ),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                'Could not finish syncing chats',
                                style: theme.textTheme.titleSmall?.copyWith(
                                  color: colors.onErrorContainer,
                                ),
                              ),
                              const SizedBox(height: PiSpacing.sm),
                              TextButton.icon(
                                key: const Key('retry-all-chat-sync'),
                                onPressed: coordinator.isReady
                                    ? coordinator.retryHistoryGate
                                    : null,
                                icon: const Icon(Icons.refresh),
                                label: const Text('Retry'),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
