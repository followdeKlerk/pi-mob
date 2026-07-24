import 'package:flutter/material.dart';

import '../ui/theme/pi_tokens.dart';

import 'control_view_data.dart';

/// Discoverable, categorized, searchable command list for skills, prompt
/// templates, and extension commands. TUI-only commands must be excluded
/// upstream; if a command is disabled in [data] we still surface it with an
/// explicit reason rather than hiding it.
class SupportedCommandList extends StatefulWidget {
  const SupportedCommandList({
    required this.commands,
    required this.onInvoke,
    this.searchHint = 'Search commands',
    super.key,
  });

  final List<SupportedCommandData> commands;
  final ValueChanged<SupportedCommandData> onInvoke;
  final String searchHint;

  @override
  State<SupportedCommandList> createState() => _SupportedCommandListState();
}

class _SupportedCommandListState extends State<SupportedCommandList> {
  String _query = '';

  static const _order = <SupportedCommandCategory>[
    SupportedCommandCategory.skill,
    SupportedCommandCategory.template,
    SupportedCommandCategory.extension,
  ];

  Iterable<SupportedCommandData> _filtered() {
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return widget.commands;
    return widget.commands.where((c) {
      return c.title.toLowerCase().contains(q) ||
          (c.description?.toLowerCase().contains(q) ?? false) ||
          (c.invocation?.toLowerCase().contains(q) ?? false);
    });
  }

  Map<SupportedCommandCategory, List<SupportedCommandData>> _grouped() {
    final filtered = _filtered().toList();
    final grouped = <SupportedCommandCategory, List<SupportedCommandData>>{};
    for (final c in filtered) {
      grouped.putIfAbsent(c.category, () => <SupportedCommandData>[]).add(c);
    }
    return grouped;
  }

  String _categoryLabel(SupportedCommandCategory c) => switch (c) {
    SupportedCommandCategory.skill => 'Skills',
    SupportedCommandCategory.template => 'Templates',
    SupportedCommandCategory.extension => 'Extensions',
  };

  IconData _categoryIcon(SupportedCommandCategory c) => switch (c) {
    SupportedCommandCategory.skill => Icons.auto_awesome,
    SupportedCommandCategory.template => Icons.notes,
    SupportedCommandCategory.extension => Icons.extension,
  };

  @override
  Widget build(BuildContext context) {
    final grouped = _grouped();
    final total = widget.commands.length;
    final shown = grouped.values.fold<int>(0, (sum, list) => sum + list.length);
    return Semantics(
      container: true,
      label: 'Command palette',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            key: const Key('command-search'),
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.search),
              hintText: widget.searchHint,
              border: const OutlineInputBorder(),
              suffixIcon: _query.isEmpty
                  ? null
                  : IconButton(
                      key: const Key('command-search-clear'),
                      tooltip: 'Clear search',
                      icon: const Icon(Icons.close),
                      onPressed: () => setState(() => _query = ''),
                    ),
            ),
            onChanged: (value) => setState(() => _query = value),
          ),
          const SizedBox(height: 8),
          Semantics(
            liveRegion: true,
            label: shown == 0
                ? 'No matching commands. Total available: $total.'
                : 'Showing $shown of $total commands.',
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: PiSpacing.xs),
              child: Text(
                shown == 0
                    ? 'No commands match. $total available in total.'
                    : '$shown of $total shown',
                key: const Key('command-count'),
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: shown == 0
                ? Center(
                    child: total == 0
                        ? Column(
                            key: const Key('command-catalogue-unavailable'),
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.extension_off,
                                size: 32,
                                color: Theme.of(
                                  context,
                                ).colorScheme.onSurfaceVariant,
                              ),
                              const SizedBox(height: 8),
                              Text(
                                'No skills or commands are available right now.',
                                textAlign: TextAlign.center,
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'The bridge has not reported a host catalogue yet.',
                                textAlign: TextAlign.center,
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            ],
                          )
                        : Text(
                            'No commands match the current search.',
                            key: const Key('command-empty'),
                          ),
                  )
                : ListView(
                    key: const Key('command-list'),
                    children: [
                      for (final category in _order)
                        if (grouped[category] case final items?) ...[
                          Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: PiSpacing.xs,
                              vertical: PiSpacing.xs,
                            ),
                            child: Row(
                              children: [
                                Icon(_categoryIcon(category), size: 18),
                                const SizedBox(width: 6),
                                Text(
                                  _categoryLabel(category),
                                  style: Theme.of(context).textTheme.titleSmall,
                                ),
                              ],
                            ),
                          ),
                          for (final command in items)
                            _CommandTile(
                              command: command,
                              onInvoke: widget.onInvoke,
                            ),
                          const SizedBox(height: 8),
                        ],
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

class _CommandTile extends StatelessWidget {
  const _CommandTile({required this.command, required this.onInvoke});

  final SupportedCommandData command;
  final ValueChanged<SupportedCommandData> onInvoke;

  @override
  Widget build(BuildContext context) {
    final tile = ListTile(
      key: ValueKey('command-${command.id}'),
      title: Text(command.title),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (command.description != null) Text(command.description!),
          if (command.invocation != null)
            Text(
              command.invocation!,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          if (!command.enabled && command.disabledReason != null)
            Text(
              command.disabledReason!,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Theme.of(context).colorScheme.error,
              ),
            ),
        ],
      ),
      trailing: const Icon(Icons.play_arrow),
      onTap: command.enabled ? () => onInvoke(command) : null,
    );
    if (command.enabled) return tile;
    return Tooltip(
      message: command.disabledReason ?? 'Command not supported here',
      child: tile,
    );
  }
}
