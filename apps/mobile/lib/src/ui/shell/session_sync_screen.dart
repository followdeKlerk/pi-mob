import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../../domain/mobile_state.dart';
import '../theme/pi_theme.dart';
import 'motion_primitives.dart';

/// Sessions-first synchronization gate. Chats are local-first after this
/// screen completes, so opening one never starts a transcript download.
class SessionSyncScreen extends StatelessWidget {
  const SessionSyncScreen({required this.coordinator, super.key});

  final ConnectionCoordinator coordinator;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final sessions = coordinator.sessions.toList()
      ..sort(
        (a, b) => (b.lastActivityAt ?? DateTime(0)).compareTo(
          a.lastActivityAt ?? DateTime(0),
        ),
      );
    final ready = coordinator.historyGateComplete;
    final error = coordinator.historyGateError;
    final total = coordinator.historySyncTotal;
    final completed = coordinator.historySyncCompleted;

    return SafeArea(
      child: Column(
        key: const Key('session-sync-screen'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              PiSpacing.lg,
              PiSpacing.lg,
              PiSpacing.lg,
              PiSpacing.md,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  ready ? 'Chats are ready' : 'Syncing chats',
                  style: theme.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: PiSpacing.xs),
                Text(
                  ready
                      ? 'Transcripts are stored on this device. Choose a chat.'
                      : error != null
                      ? 'Sync paused. Your existing local data is safe.'
                      : 'Keeping transcripts available before opening chat${total == 1 ? '' : 's'}.',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: PiSpacing.md),
                if (!ready && error == null) ...[
                  MotionProgressBar(
                    key: const Key('all-chat-sync-progress'),
                    value: total == 0 ? null : coordinator.historySyncProgress,
                    minHeight: 4,
                  ),
                  const SizedBox(height: PiSpacing.sm),
                  Text(
                    total == 0
                        ? 'Preparing session index…'
                        : '$completed of $total chats synced',
                    style: theme.textTheme.labelMedium?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                ],
                if (error != null) ...[
                  Container(
                    padding: const EdgeInsets.all(PiSpacing.md),
                    decoration: BoxDecoration(
                      color: colors.errorContainer,
                      borderRadius: BorderRadius.circular(PiRadius.md),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.sync_problem, size: 20),
                        const SizedBox(width: PiSpacing.sm),
                        const Expanded(
                          child: Text('Could not finish syncing chats'),
                        ),
                        TextButton(
                          key: const Key('retry-all-chat-sync'),
                          onPressed: coordinator.isReady
                              ? coordinator.retryHistoryGate
                              : null,
                          child: const Text('Retry'),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: sessions.isEmpty
                ? Center(
                    child: Text(
                      ready ? 'No saved chats yet' : 'Discovering chats…',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                  )
                : ListView.builder(
                    key: const Key('sync-session-list'),
                    padding: const EdgeInsets.all(PiSpacing.sm),
                    itemCount: sessions.length,
                    itemBuilder: (context, index) {
                      final session = sessions[index];
                      final current =
                          coordinator.historySyncCurrentSessionId ==
                          session.sessionId;
                      return ListTile(
                        key: Key('sync-session-${session.sessionId}'),
                        enabled: ready,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(PiRadius.md),
                        ),
                        leading: current
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: MotionSpinner(
                                  strokeWidth: 2,
                                  dimension: 20,
                                  label: 'Syncing chat history',
                                ),
                              )
                            : Icon(
                                ready
                                    ? Icons.check_circle_outline
                                    : Icons.chat_bubble_outline,
                                size: 20,
                                color: ready
                                    ? colors.primary
                                    : colors.onSurfaceVariant,
                              ),
                        title: Text(
                          _title(session),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        subtitle: session.workspaceId == null
                            ? null
                            : Text(
                                session.workspaceId!,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                        trailing: ready
                            ? const Icon(Icons.chevron_right)
                            : null,
                        onTap: ready
                            ? () => coordinator.takeControl(session.sessionId)
                            : null,
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }

  String _title(SessionState session) {
    final value = session.name.trim();
    return value.isEmpty ? 'Untitled chat' : value;
  }
}
