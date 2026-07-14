import 'package:flutter/material.dart';

import 'session_view_data.dart';

/// Fast, dense session switcher. Renders at most
/// [SessionSwitcherViewData.maxVisible] rows. When truncated, it exposes a
/// "Show all" affordance; the widget itself does not paginate.
class SessionSwitcher extends StatelessWidget {
  const SessionSwitcher({
    required this.data,
    required this.callbacks,
    super.key,
  });

  final SessionSwitcherViewData data;
  final SessionSwitcherCallbacks callbacks;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final sessions = data.sessions;
    final visible = sessions.take(data.maxVisible).toList();
    final overflow = sessions.length - visible.length;
    return Semantics(
      container: true,
      label: 'Session switcher. ${sessions.length} sessions available.',
      child: Card(
        key: const Key('session-switcher'),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child: Row(
                  children: [
                    Icon(Icons.swap_horiz, color: theme.colorScheme.primary),
                    const SizedBox(width: 8),
                    Text(
                      'Switch session',
                      style: theme.textTheme.titleMedium,
                      key: const Key('session-switcher-title'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 4),
              for (final session in visible)
                _SwitcherRow(
                  session: session,
                  isForeground: session.sessionId == data.foregroundSessionId,
                  callbacks: callbacks,
                ),
              if (overflow > 0)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  child: TextButton.icon(
                    key: const Key('session-switcher-overflow'),
                    onPressed: callbacks.onOpenFullList,
                    icon: const Icon(Icons.more_horiz),
                    label: Text('Show $overflow more'),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SwitcherRow extends StatelessWidget {
  const _SwitcherRow({
    required this.session,
    required this.isForeground,
    required this.callbacks,
  });

  final SessionSummaryData session;
  final bool isForeground;
  final SessionSwitcherCallbacks callbacks;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final canTake = !session.isController;
    return ListTile(
      key: Key('switcher-row-${session.sessionId}'),
      dense: true,
      leading: Stack(
        clipBehavior: Clip.none,
        children: [
          CircleAvatar(
            radius: 14,
            backgroundColor: isForeground
                ? colors.primaryContainer
                : colors.surfaceContainerHighest,
            child: Text(
              session.displayName.isEmpty
                  ? '?'
                  : session.displayName.characters.first.toUpperCase(),
              style: TextStyle(
                fontSize: 12,
                color: isForeground
                    ? colors.onPrimaryContainer
                    : colors.onSurfaceVariant,
              ),
            ),
          ),
          if (session.isUnread)
            Positioned(
              right: -4,
              top: -4,
              child: Container(
                key: Key('switcher-unread-${session.sessionId}'),
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: colors.primary,
                  shape: BoxShape.circle,
                  border: Border.all(color: colors.surface, width: 2),
                ),
              ),
            ),
        ],
      ),
      title: Text(
        session.displayName,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Text(
        session.workspaceLabel ?? 'Detached',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: canTake
          ? IconButton(
              key: Key('switcher-take-${session.sessionId}'),
              tooltip: 'Take control of ${session.displayName}',
              icon: const Icon(Icons.ads_click),
              onPressed: () => callbacks.onTakeControl?.call(session),
            )
          : const Icon(Icons.check),
      selected: isForeground,
      onTap: isForeground ? null : () => callbacks.onSwitch?.call(session),
    );
  }
}
