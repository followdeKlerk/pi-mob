import 'package:flutter/material.dart';

import 'attention_domain.dart';

class AttentionInbox extends StatelessWidget {
  const AttentionInbox({required this.state, required this.onOpen, super.key});
  final AttentionState state;
  final ValueChanged<AttentionItemData> onOpen;

  @override
  Widget build(BuildContext context) {
    final items = state.visible;
    if (items.isEmpty) {
      return const Center(
        child: Text('No items need attention.', key: Key('attention-empty')),
      );
    }
    return ListView.builder(
      key: const Key('attention-inbox'),
      itemCount: items.length,
      itemBuilder: (context, index) {
        final item = items[index];
        return ListTile(
          key: ValueKey('attention-${item.attentionId}'),
          leading: Icon(_icon(item.category)),
          title: Text(item.summary),
          subtitle: Text(_label(item.category)),
          trailing: item.read ? null : const Icon(Icons.circle, size: 10),
          onTap: () => onOpen(item),
        );
      },
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
