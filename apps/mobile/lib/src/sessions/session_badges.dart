import 'package:flutter/material.dart';

import 'session_view_data.dart';

/// Small reusable badge for a session. Combines attention / stopped / deleted
/// / background / unread state with explicit icons and accessibility labels.
/// The widget never derives badge state from the row; the upstream reducer
/// hands us [SessionAttention] and [SessionBackground] already classified.
class SessionBadges extends StatelessWidget {
  const SessionBadges({required this.session, this.dense = false, super.key});

  final SessionSummaryData session;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final children = <Widget>[];
    switch (session.attention) {
      case SessionAttention.attention:
        children.add(_AttentionBadge(session: session, dense: dense));
      case SessionAttention.stopped:
        children.add(_StoppedBadge(dense: dense));
      case SessionAttention.deleted:
        children.add(_DeletedBadge(dense: dense));
      case SessionAttention.none:
        break;
    }
    if (session.isUnread) {
      children.add(_UnreadBadge(count: session.unreadCount, dense: dense));
    } else if (session.isBackground) {
      children.add(_BackgroundBadge(dense: dense));
    }
    if (session.isController) {
      children.add(_ControllerBadge(dense: dense));
    }
    if (session.hasUnsavedDraft) {
      children.add(_DraftBadge(dense: dense));
    }
    if (children.isEmpty) return const SizedBox.shrink();
    return Wrap(
      key: const Key('session-badges'),
      spacing: 4,
      runSpacing: 4,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: children,
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({
    required this.label,
    required this.icon,
    required this.background,
    required this.foreground,
    required this.semanticLabel,
    this.dense = false,
    this.keyValue,
  });

  final String label;
  final IconData icon;
  final Color background;
  final Color foreground;
  final String semanticLabel;
  final bool dense;
  final Key? keyValue;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: semanticLabel,
      excludeSemantics: true,
      child: Container(
        key: keyValue,
        padding: EdgeInsets.symmetric(
          horizontal: dense ? 6 : 8,
          vertical: dense ? 2 : 4,
        ),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(dense ? 4 : 12),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: dense ? 12 : 14, color: foreground),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(
                color: foreground,
                fontSize: dense ? 11 : 12,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AttentionBadge extends StatelessWidget {
  const _AttentionBadge({required this.session, required this.dense});
  final SessionSummaryData session;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return _Pill(
      keyValue: const Key('session-badge-attention'),
      label: 'Needs attention',
      icon: Icons.priority_high,
      background: colors.errorContainer,
      foreground: colors.onErrorContainer,
      semanticLabel: 'Needs attention: ${session.displayName}',
      dense: dense,
    );
  }
}

class _StoppedBadge extends StatelessWidget {
  const _StoppedBadge({required this.dense});
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return _Pill(
      keyValue: const Key('session-badge-stopped'),
      label: 'Stopped',
      icon: Icons.stop_circle_outlined,
      background: colors.secondaryContainer,
      foreground: colors.onSecondaryContainer,
      semanticLabel: 'Session stopped',
      dense: dense,
    );
  }
}

class _DeletedBadge extends StatelessWidget {
  const _DeletedBadge({required this.dense});
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return _Pill(
      keyValue: const Key('session-badge-deleted'),
      label: 'Deleted',
      icon: Icons.delete_outline,
      background: colors.surfaceContainerHighest,
      foreground: colors.onSurfaceVariant,
      semanticLabel: 'Session in trash; restore to re-attach',
      dense: dense,
    );
  }
}

class _UnreadBadge extends StatelessWidget {
  const _UnreadBadge({required this.count, required this.dense});
  final int count;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final text = count > 99 ? '99+' : '$count';
    return _Pill(
      keyValue: const Key('session-badge-unread'),
      label: text,
      icon: Icons.notifications_active,
      background: colors.primary,
      foreground: colors.onPrimary,
      semanticLabel: '$count unread events',
      dense: dense,
    );
  }
}

class _BackgroundBadge extends StatelessWidget {
  const _BackgroundBadge({required this.dense});
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return _Pill(
      keyValue: const Key('session-badge-background'),
      label: 'Background',
      icon: Icons.cloud_off,
      background: colors.surfaceContainerHighest,
      foreground: colors.onSurfaceVariant,
      semanticLabel: 'Session is running in the background',
      dense: dense,
    );
  }
}

class _ControllerBadge extends StatelessWidget {
  const _ControllerBadge({required this.dense});
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return _Pill(
      keyValue: const Key('session-badge-controller'),
      label: 'Controller',
      icon: Icons.spatial_audio_off,
      background: colors.tertiaryContainer,
      foreground: colors.onTertiaryContainer,
      semanticLabel: 'You are the controller for this session',
      dense: dense,
    );
  }
}

class _DraftBadge extends StatelessWidget {
  const _DraftBadge({required this.dense});
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return _Pill(
      keyValue: const Key('session-badge-draft'),
      label: 'Draft',
      icon: Icons.edit_note,
      background: colors.tertiaryContainer,
      foreground: colors.onTertiaryContainer,
      semanticLabel: 'Has unsent draft preserved across observers',
      dense: dense,
    );
  }
}
