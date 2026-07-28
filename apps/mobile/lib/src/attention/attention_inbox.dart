import 'package:flutter/material.dart';

import 'attention_domain.dart';

/// Renders the bounded attention inbox for the active host.
///
/// The widget only consumes [AttentionState] the bridge produced via
/// `reduceAttention` — it never inspects transcript prose, never infers a
/// category the bridge did not emit, and never invents an item from a
/// guessed tool call. The closed `AttentionCategory` vocabulary drives the
/// icon and label so the UI matches the wire grammar the schema enforces.
class AttentionInbox extends StatelessWidget {
  const AttentionInbox({required this.state, required this.onOpen, super.key});

  final AttentionState state;
  final ValueChanged<AttentionItemData> onOpen;

  @override
  Widget build(BuildContext context) {
    final items = state.visible;
    final countLabel = items.isEmpty
        ? '0 items, no attention needed'
        : '${items.length} items need attention';
    return Semantics(
      container: true,
      label: 'Attention inbox',
      child: ListView.builder(
        key: const Key('attention-inbox'),
        itemCount: items.isEmpty ? 2 : items.length + 1,
        itemBuilder: (context, index) {
          if (index == 0) {
            return Semantics(
              liveRegion: true,
              label: countLabel,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Text(countLabel),
              ),
            );
          }
          if (items.isEmpty) {
            return const Center(
              child: KeyedSubtree(
                key: Key('attention-empty'),
                child: Text('No items need attention.'),
              ),
            );
          }
          final item = items[index - 1];
          return ListTile(
            key: ValueKey('attention-${item.attentionId}'),
            leading: Icon(_icon(item.category)),
            title: Text(item.summary),
            subtitle: Text(_label(item.category)),
            trailing: item.read
                ? null
                : Semantics(
                    label: 'Unread',
                    child: Icon(Icons.circle, size: 10),
                  ),
            onTap: () => onOpen(item),
          );
        },
      ),
    );
  }

  IconData _icon(AttentionCategory category) => switch (category) {
    AttentionCategory.needsInput => Icons.question_answer,
    AttentionCategory.completed => Icons.check_circle,
    AttentionCategory.failed => Icons.error,
    AttentionCategory.interrupted => Icons.warning,
    AttentionCategory.background => Icons.schedule,
  };

  String _label(AttentionCategory category) => switch (category) {
    AttentionCategory.needsInput => 'Needs your input',
    AttentionCategory.completed => 'Completed',
    AttentionCategory.failed => 'Failed',
    AttentionCategory.interrupted => 'Interrupted',
    AttentionCategory.background => 'Running in background',
  };
}
