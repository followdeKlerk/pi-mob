import 'package:flutter/material.dart';

import '../domain/command_catalogue.dart';
import '../ui/theme/pi_tokens.dart';

class CommandPalette extends StatefulWidget {
  const CommandPalette({
    required this.catalogue,
    required this.onCopy,
    required this.onInsert,
    this.searchHint = 'Search commands',
    super.key,
  });

  final CommandCatalogue catalogue;
  final ValueChanged<CommandCatalogueEntry> onCopy;
  final ValueChanged<CommandCatalogueEntry> onInsert;
  final String searchHint;

  @override
  State<CommandPalette> createState() => _CommandPaletteState();
}

class _CommandPaletteState extends State<CommandPalette> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final sections = widget.catalogue.grouped(_query);
    final total = widget.catalogue.entries.length;
    final shown = sections.fold<int>(
      0,
      (sum, item) => sum + item.entries.length,
    );
    return Semantics(
      container: true,
      label: 'Command palette',
      child: ListView(
        key: const Key('command-palette-list'),
        padding: EdgeInsets.zero,
        children: [
          if (widget.catalogue.unavailableReason != null ||
              widget.catalogue.reloadRequired)
            _PaletteNotice(
              unavailableReason: widget.catalogue.unavailableReason,
              reloadRequired: widget.catalogue.reloadRequired,
            ),
          TextField(
            key: const Key('command-palette-search'),
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.search),
              hintText: widget.searchHint,
              border: const OutlineInputBorder(),
            ),
            onChanged: (value) => setState(() => _query = value),
          ),
          const SizedBox(height: PiSpacing.sm),
          Text(
            shown == 0
                ? 'No commands match. $total available in total.'
                : '$shown of $total shown',
            key: const Key('command-palette-count'),
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: PiSpacing.sm),
          if (shown == 0)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: PiSpacing.xl),
              child: Center(
                child: Text(
                  'No commands match the current search.',
                  key: Key('command-palette-empty'),
                ),
              ),
            )
          else
            for (final section in sections) ...[
              Padding(
                padding: const EdgeInsets.symmetric(vertical: PiSpacing.xs),
                child: Text(
                  section.label,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
              ),
              for (final entry in section.entries)
                _CommandPaletteTile(
                  entry: entry,
                  onCopy: widget.onCopy,
                  onInsert: widget.onInsert,
                ),
              const SizedBox(height: PiSpacing.sm),
            ],
        ],
      ),
    );
  }
}

class _PaletteNotice extends StatelessWidget {
  const _PaletteNotice({this.unavailableReason, required this.reloadRequired});

  final String? unavailableReason;
  final bool reloadRequired;

  @override
  Widget build(BuildContext context) {
    final items = <String>[
      ?unavailableReason,
      if (reloadRequired)
        'Reload Pi to refresh commands, tools, and MCP availability.',
    ];
    return Padding(
      padding: const EdgeInsets.only(bottom: PiSpacing.sm),
      child: Material(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(PiRadius.md),
        child: Padding(
          padding: const EdgeInsets.all(PiSpacing.sm),
          child: Text(items.join('\n')),
        ),
      ),
    );
  }
}

class _CommandPaletteTile extends StatelessWidget {
  const _CommandPaletteTile({
    required this.entry,
    required this.onCopy,
    required this.onInsert,
  });

  final CommandCatalogueEntry entry;
  final ValueChanged<CommandCatalogueEntry> onCopy;
  final ValueChanged<CommandCatalogueEntry> onInsert;

  @override
  Widget build(BuildContext context) {
    return Card(
      key: ValueKey('command-palette-${entry.id}'),
      child: Padding(
        padding: const EdgeInsets.all(PiSpacing.sm),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(entry.title, style: Theme.of(context).textTheme.titleSmall),
            if (entry.description != null) ...[
              const SizedBox(height: PiSpacing.xs),
              Text(entry.description!),
            ],
            if (entry.invocation != null) ...[
              const SizedBox(height: PiSpacing.xs),
              SelectableText(
                entry.invocation!,
                key: ValueKey('command-invocation-${entry.id}'),
              ),
            ],
            if (entry.unavailableReason != null) ...[
              const SizedBox(height: PiSpacing.xs),
              Text(
                entry.unavailableReason!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context).colorScheme.error,
                ),
              ),
            ],
            const SizedBox(height: PiSpacing.sm),
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                OutlinedButton.icon(
                  key: ValueKey('command-copy-${entry.id}'),
                  onPressed: entry.invocation == null
                      ? null
                      : () => onCopy(entry),
                  icon: const Icon(Icons.copy_all_outlined),
                  label: const Text('Copy'),
                ),
                const SizedBox(height: PiSpacing.xs),
                FilledButton.tonalIcon(
                  key: ValueKey('command-insert-${entry.id}'),
                  onPressed: entry.available && entry.invocation != null
                      ? () => onInsert(entry)
                      : null,
                  icon: const Icon(Icons.keyboard_arrow_down_rounded),
                  label: Text(
                    entry.reloadRequired
                        ? 'Insert after reload'
                        : 'Insert without sending',
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
