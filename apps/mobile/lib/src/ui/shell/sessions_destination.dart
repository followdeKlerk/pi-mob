import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../../domain/mobile_state.dart';
import '../theme/pi_theme.dart';
import 'workspace_session_panel.dart';

/// Body for the Sessions destination.
///
/// The visible surface is a single vertically scrollable hub headed by a
/// concise product-title + connection-state summary so the user has a clear
/// product identity before tapping into the session/workspace rows. All
/// session/workspace affordances are delegated to the existing
/// [WorkspaceSessionPanel] so the M10–M15 sessions flows and keys remain
/// intact.
class SessionsDestination extends StatelessWidget {
  const SessionsDestination({required this.coordinator, super.key});

  final ConnectionCoordinator coordinator;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    return KeyedSubtree(
      key: const Key('workspace-session-scroll'),
      child: ListView(
        key: const Key('sessions-destination-scroll'),
        padding: const EdgeInsets.fromLTRB(
          PiSpacing.lg,
          PiSpacing.md,
          PiSpacing.lg,
          PiSpacing.xl,
        ),
        children: [
          Text(
            'Pi on your phone',
            key: const Key('sessions-product-title'),
            style: theme.textTheme.headlineSmall?.copyWith(
              color: colors.onSurface,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: PiSpacing.xs),
          Text(
            'Choose a folder in your home, then open or create a named session.',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: colors.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: PiSpacing.lg),
          _StatusSummary(coordinator: coordinator),
          const SizedBox(height: PiSpacing.lg),
          WorkspaceSessionPanel(coordinator: coordinator),
        ],
      ),
    );
  }
}

class _StatusSummary extends StatelessWidget {
  const _StatusSummary({required this.coordinator});

  final ConnectionCoordinator coordinator;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final semantic = context.piSemanticColors;
    final phase = coordinator.phase;
    final ready = coordinator.isReady;
    final offline =
        phase.name == 'hostUnreachable' ||
        phase.name == 'disconnected' ||
        phase.name == 'unpaired';
    final indicator = ready
        ? semantic.connectionReady
        : offline
        ? semantic.connectionOffline
        : semantic.connectionDegraded;
    final label = ready
        ? 'Connected to ${coordinator.hostDisplayName ?? coordinator.hostId ?? "host"}'
        : offline
        ? 'Not connected — pair or reconnect from the Host tab.'
        : 'Connecting… (${phase.name})';
    return Container(
      key: const Key('sessions-status-summary'),
      padding: const EdgeInsets.all(PiSpacing.md),
      decoration: BoxDecoration(
        color: colors.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(PiRadius.md),
        border: Border.all(color: colors.outlineVariant),
      ),
      child: Row(
        children: [
          _Dot(color: indicator),
          const SizedBox(width: PiSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  label,
                  style: theme.textTheme.titleSmall?.copyWith(
                    color: colors.onSurface,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: PiSpacing.xs),
                Text(
                  coordinator.hostDisplayName == null
                      ? 'Pair a Pi host to manage sessions on the go.'
                      : 'Last activity: ${sessionStateLabel(coordinator.selectedRuntimeState ?? 'idle')}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
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

class _Dot extends StatelessWidget {
  const _Dot({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 12,
      height: 12,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}
