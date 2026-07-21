import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../connection/connection_coordinator.dart';
import '../../search/global_search_controller.dart';
import '../../search/search_hits.dart';
import '../../search/search_source.dart';
import '../theme/pi_theme.dart';
import '../theme/pi_tokens.dart';

/// Opens the global search sheet bound to the active host's search index.
///
/// The sheet is intentionally non-modal — the chat behind it stays
/// visible so the user can keep typing if they decide the answer is in the
/// current transcript. Tapping a result selects the matching chat and the
/// optional callback can be used by tests / callers that want to drive
/// further navigation (e.g. a precise scroll anchor once the reducer
/// surfaces one).
Future<void> showGlobalSearch(
  BuildContext context,
  ConnectionCoordinator coordinator, {
  void Function(SearchHit hit)? onResultTap,
  ValueChanged<String>? onQueryChanged,
}) {
  final controller = coordinator.globalSearchController;
  controller.reset();
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheetContext) {
      return GlobalSearchSheet(
        coordinator: coordinator,
        onResultTap: onResultTap,
        onQueryChanged: onQueryChanged,
      );
    },
  );
}

class GlobalSearchSheet extends StatefulWidget {
  const GlobalSearchSheet({
    required this.coordinator,
    this.onResultTap,
    this.onQueryChanged,
    super.key,
  });

  final ConnectionCoordinator coordinator;
  final void Function(SearchHit hit)? onResultTap;
  final ValueChanged<String>? onQueryChanged;

  @override
  State<GlobalSearchSheet> createState() => _GlobalSearchSheetState();
}

class _GlobalSearchSheetState extends State<GlobalSearchSheet> {
  late final TextEditingController _input;
  late final FocusNode _focus;
  late final GlobalSearchController _search;

  @override
  void initState() {
    super.initState();
    _input = TextEditingController();
    _focus = FocusNode();
    _search = widget.coordinator.globalSearchController;
    _search.addListener(_onSearchChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _focus.requestFocus();
    });
  }

  @override
  void dispose() {
    _search.removeListener(_onSearchChanged);
    _search.cancel();
    _input.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _onSearchChanged() {
    if (mounted) setState(() {});
  }

  void _onChanged(String value) {
    _search.setQuery(value);
    widget.onQueryChanged?.call(value);
  }

  void _handleTap(SearchHit hit) {
    final coordinator = widget.coordinator;
    coordinator.globalSearchController.cancel();
    unawaited(coordinator.selectSession(hit.sessionId));
    widget.onResultTap?.call(hit);
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final sheetHeight = MediaQuery.sizeOf(context).height * .86;
    return SafeArea(
      child: SizedBox(
        height: sheetHeight,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                PiSpacing.lg,
                PiSpacing.sm,
                PiSpacing.lg,
                PiSpacing.sm,
              ),
              child: TextField(
                key: const Key('global-search-input'),
                controller: _input,
                focusNode: _focus,
                autofocus: true,
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  labelText: 'Search every chat',
                  border: OutlineInputBorder(),
                ),
                onChanged: _onChanged,
              ),
            ),
            if (_search.query.length >= kGlobalSearchMinQueryLength)
              _SearchToolbar(
                query: _search.query,
                results: _search.results,
                phase: _search.phase,
                error: _search.error,
                onClear: () {
                  _input.clear();
                  _onChanged('');
                  _focus.requestFocus();
                },
              ),
            Expanded(
              child: _SearchBody(
                phase: _search.phase,
                query: _search.query,
                results: _search.results,
                error: _search.error,
                onTap: _handleTap,
              ),
            ),
            Container(
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(PiRadius.md),
              ),
              padding: const EdgeInsets.symmetric(
                horizontal: PiSpacing.lg,
                vertical: PiSpacing.sm,
              ),
              margin: const EdgeInsets.symmetric(
                horizontal: PiSpacing.lg,
                vertical: PiSpacing.sm,
              ),
              child: Text(
                'Search covers chat names, your prompts, assistant answers, '
                'reasoning summaries, and tool names. Files and branches '
                'arrive in a future release.',
                style: theme.textTheme.bodySmall,
                key: const Key('global-search-footnote'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SearchToolbar extends StatelessWidget {
  const _SearchToolbar({
    required this.query,
    required this.results,
    required this.phase,
    required this.error,
    required this.onClear,
  });

  final String query;
  final SearchResults results;
  final GlobalSearchPhase phase;
  final String? error;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final label = switch (phase) {
      GlobalSearchPhase.searching => 'Searching…',
      GlobalSearchPhase.error => 'Search failed: ${error ?? 'unknown error'}',
      GlobalSearchPhase.cancelled => 'Search cancelled',
      GlobalSearchPhase.results =>
        results.hits.isEmpty
            ? 'No matches for "$query"'
            : '${results.hits.length} match${results.hits.length == 1 ? '' : 'es'}',
      GlobalSearchPhase.idle => 'Type to search every chat',
    };
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: PiSpacing.lg,
        vertical: PiSpacing.xs,
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              key: const Key('global-search-status'),
              style: theme.textTheme.bodySmall,
            ),
          ),
          if (results.truncated)
            const _Pill(label: 'Refine for more', icon: Icons.tune_rounded),
          IconButton(
            key: const Key('global-search-clear'),
            tooltip: 'Clear',
            onPressed: onClear,
            icon: const Icon(Icons.close_rounded),
          ),
        ],
      ),
    );
  }
}

class _SearchBody extends StatelessWidget {
  const _SearchBody({
    required this.phase,
    required this.query,
    required this.results,
    required this.error,
    required this.onTap,
  });

  final GlobalSearchPhase phase;
  final String query;
  final SearchResults results;
  final String? error;
  final void Function(SearchHit hit) onTap;

  @override
  Widget build(BuildContext context) {
    if (query.trim().isEmpty) {
      return const Center(
        child: Text('Search chat names, prompts, and answers'),
      );
    }
    if (phase == GlobalSearchPhase.searching && results.hits.isEmpty) {
      return const Center(
        key: Key('global-search-loading'),
        child: SizedBox.square(
          dimension: 24,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      );
    }
    if (phase == GlobalSearchPhase.error && results.hits.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(PiSpacing.lg),
          child: Text(error ?? 'Search failed', textAlign: TextAlign.center),
        ),
      );
    }
    if (results.hits.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(PiSpacing.lg),
          child: Text(
            'No matches for "$query"',
            key: const Key('global-search-empty'),
            textAlign: TextAlign.center,
          ),
        ),
      );
    }
    return ListView.separated(
      key: const Key('global-search-results'),
      padding: const EdgeInsets.symmetric(vertical: PiSpacing.xs),
      itemCount: results.hits.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, index) {
        final hit = results.hits[index];
        return _ResultTile(hit: hit, onTap: () => onTap(hit));
      },
    );
  }
}

class _ResultTile extends StatelessWidget {
  const _ResultTile({required this.hit, required this.onTap});

  final SearchHit hit;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListTile(
      key: Key('global-search-hit-${hit.eventId}'),
      onTap: onTap,
      leading: Text(
        searchSourceGlyph(hit.source),
        style: theme.textTheme.titleMedium,
      ),
      title: Text(
        hit.sessionName,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: theme.textTheme.titleSmall,
      ),
      subtitle: Text(
        hit.snippet,
        maxLines: 3,
        overflow: TextOverflow.ellipsis,
        style: theme.textTheme.bodySmall,
      ),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          _Pill(
            label: searchSourceLabel(hit.source),
            icon: Icons.label_outline,
          ),
          const SizedBox(height: PiSpacing.xs),
          IconButton(
            key: Key('global-search-copy-${hit.eventId}'),
            tooltip: 'Copy match',
            icon: const Icon(Icons.copy_outlined, size: 18),
            onPressed: () {
              Clipboard.setData(ClipboardData(text: hit.summary));
            },
          ),
        ],
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.label, required this.icon});

  final String label;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: PiSpacing.sm,
        vertical: PiSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: theme.colorScheme.secondaryContainer,
        borderRadius: BorderRadius.circular(PiRadius.sm),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: theme.colorScheme.onSecondaryContainer),
          const SizedBox(width: PiSpacing.xs),
          Text(
            label,
            style: theme.textTheme.labelSmall?.copyWith(
              color: theme.colorScheme.onSecondaryContainer,
            ),
          ),
        ],
      ),
    );
  }
}
