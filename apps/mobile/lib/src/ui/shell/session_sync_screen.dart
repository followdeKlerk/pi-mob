import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../theme/pi_theme.dart';
import 'motion_primitives.dart';

/// Compact synchronization gate. Session names, identifiers, and actions stay
/// hidden until every durable chat history is ready for local-first browsing.
///
/// M14 — the card now also reports which chat is syncing right now, the
/// running throughput in events/second, and a derived ETA so the user has a
/// truthful view of progress when chats are larger than usual.
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
    final currentName = coordinator.historySyncCurrentSessionName;
    final remaining = coordinator.historySyncRemaining;
    final elapsed = coordinator.historySyncElapsed;
    final eta = coordinator.historySyncEta;
    final throughput = coordinator.historySyncEventsPerSecond;
    final connectionPhase = coordinator.phase;

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
                            : _bootMessage(connectionPhase),
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
                        const SizedBox(height: PiSpacing.xs),
                        _SyncMetricsRow(
                          currentName: currentName,
                          remaining: remaining,
                          elapsed: elapsed,
                          eta: eta,
                          throughput: throughput,
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

  static String _bootMessage(ConnectionPhase phase) {
    switch (phase) {
      case ConnectionPhase.unpaired:
      case ConnectionPhase.probing:
      case ConnectionPhase.connecting:
      case ConnectionPhase.handshaking:
        return 'Connecting to the bridge so your chat history can sync…';
      case ConnectionPhase.synchronizing:
      case ConnectionPhase.ready:
      case ConnectionPhase.degraded:
      case ConnectionPhase.disconnected:
      case ConnectionPhase.hostUnreachable:
      case ConnectionPhase.incompatible:
      case ConnectionPhase.hostDraining:
      case ConnectionPhase.background:
      case ConnectionPhase.rePairRequired:
        return 'Preparing your chat history so opening a chat '
            'is immediate and works through reconnects.';
    }
  }
}

/// Truthful throughput + ETA strip below the progress bar.
class _SyncMetricsRow extends StatelessWidget {
  const _SyncMetricsRow({
    required this.currentName,
    required this.remaining,
    required this.elapsed,
    required this.eta,
    required this.throughput,
  });

  final String? currentName;
  final int remaining;
  final Duration elapsed;
  final Duration? eta;
  final double throughput;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final chatLine = currentName == null
        ? 'Preparing the next chat…'
        : 'Now syncing: $currentName';
    final remainingLine = remaining <= 0
        ? 'Last chat'
        : '$remaining chat${remaining == 1 ? '' : 's'} remaining';
    final elapsedLabel = _formatDuration(elapsed);
    final etaLabel = eta == null ? 'calculating…' : '~${_formatDuration(eta!)}';
    final rateLabel = throughput <= 0
        ? '— events/s'
        : '${throughput.toStringAsFixed(1)} events/s';
    return DefaultTextStyle.merge(
      style: theme.textTheme.labelSmall?.copyWith(
        color: colors.onSurfaceVariant,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            chatLine,
            key: const Key('chat-sync-current-chat'),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 4),
          Wrap(
            spacing: PiSpacing.md,
            runSpacing: 2,
            children: [
              Text(remainingLine, key: const Key('chat-sync-remaining')),
              Text(
                'Elapsed $elapsedLabel',
                key: const Key('chat-sync-elapsed'),
              ),
              Text('ETA $etaLabel', key: const Key('chat-sync-eta')),
              Text(rateLabel, key: const Key('chat-sync-throughput')),
            ],
          ),
        ],
      ),
    );
  }

  static String _formatDuration(Duration value) {
    if (value.inSeconds < 1) return '${value.inMilliseconds} ms';
    final minutes = value.inMinutes;
    final seconds = value.inSeconds % 60;
    if (minutes == 0) return '${value.inSeconds}s';
    if (minutes < 60) return '${minutes}m ${seconds}s';
    final hours = minutes ~/ 60;
    final remMinutes = minutes % 60;
    return '${hours}h ${remMinutes}m';
  }
}
