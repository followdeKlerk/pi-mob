import 'package:flutter/material.dart';

import 'session_view_data.dart';

/// Capacity/no-victim messaging. M11 caps the number of active sessions at
/// three. When the cap is reached and the upstream reducer finds no
/// eligible LRU victim, the widget surfaces an explicit no-victim message
/// and offers the user the option to inspect or manually save a session.
class SessionCapacityNotice extends StatelessWidget {
  const SessionCapacityNotice({
    required this.capacity,
    this.onDismiss,
    this.onInspectCandidate,
    this.onSaveDraft,
    super.key,
  });

  final SessionCapacityState capacity;
  final VoidCallback? onDismiss;
  final VoidCallback? onInspectCandidate;
  final VoidCallback? onSaveDraft;

  String _noVictimMessage() {
    if (capacity.eligibleEviction.isEmpty) {
      return 'All three sessions have unsaved work. Wait for a session to '
          'idle, or save a draft manually before opening another.';
    }
    return 'All three sessions are running. Stop or detach one before '
        'opening another.';
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final hasCandidate = capacity.hasEvictionCandidate;
    return Semantics(
      container: true,
      liveRegion: true,
      label:
          'Capacity reached. ${capacity.active} of ${capacity.maximum} '
          'active sessions.',
      child: Container(
        key: const Key('session-capacity-notice'),
        margin: const EdgeInsets.symmetric(vertical: 8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: colors.errorContainer,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.error_outline, color: colors.onErrorContainer),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Three-session limit reached',
                    style: text.titleSmall?.copyWith(
                      color: colors.onErrorContainer,
                    ),
                    key: const Key('session-capacity-title'),
                  ),
                ),
                IconButton(
                  key: const Key('session-capacity-dismiss'),
                  tooltip: 'Dismiss',
                  onPressed: onDismiss,
                  icon: Icon(Icons.close, color: colors.onErrorContainer),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              hasCandidate
                  ? 'The least-recently-used idle session will be evicted to '
                        'make room. Their unsaved draft is preserved.'
                  : _noVictimMessage(),
              style: text.bodySmall?.copyWith(color: colors.onErrorContainer),
              key: const Key('session-capacity-message'),
            ),
            const SizedBox(height: 4),
            Text(
              'M11 enforces a hard cap of ${capacity.maximum} active sessions '
              'per host installation.',
              style: text.bodySmall?.copyWith(color: colors.onErrorContainer),
            ),
            if (hasCandidate || capacity.eligibleEviction.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 4,
                children: [
                  if (hasCandidate)
                    FilledButton.tonalIcon(
                      key: const Key('session-capacity-inspect'),
                      onPressed: onInspectCandidate,
                      icon: const Icon(Icons.preview),
                      label: const Text('Inspect LRU candidate'),
                    ),
                  if (capacity.eligibleEviction.isNotEmpty)
                    FilledButton.tonalIcon(
                      key: const Key('session-capacity-save'),
                      onPressed: onSaveDraft,
                      icon: const Icon(Icons.save_outlined),
                      label: const Text('Save a draft first'),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
