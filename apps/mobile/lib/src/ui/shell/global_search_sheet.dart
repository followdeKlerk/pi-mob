import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../../search/global_search_controller.dart';
import '../../search/search_hits.dart';
import '../../search/search_source.dart';
import '../theme/pi_theme.dart';

Future<void> showGlobalSearch(
  BuildContext context,
  ConnectionCoordinator coordinator, {
  VoidCallback? onResultTap,
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (_) =>
      GlobalSearchSheet(coordinator: coordinator, onResultTap: onResultTap),
);

final class GlobalSearchSheet extends StatefulWidget {
  const GlobalSearchSheet({
    required this.coordinator,
    this.onResultTap,
    super.key,
  });
  final ConnectionCoordinator coordinator;
  final VoidCallback? onResultTap;

  @override
  State<GlobalSearchSheet> createState() => _GlobalSearchSheetState();
}

final class _GlobalSearchSheetState extends State<GlobalSearchSheet> {
  late final TextEditingController _input;
  late final GlobalSearchController _controller;

  @override
  void initState() {
    super.initState();
    _input = TextEditingController();
    _controller = widget.coordinator.globalSearchController;
    _controller.addListener(_changed);
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _controller
      ..removeListener(_changed)
      ..cancel();
    _input.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final phase = _controller.phase;
    final query = _controller.query;
    final results = _controller.results;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * .82,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(PiSpacing.md),
                child: TextField(
                  key: const Key('global-search-input'),
                  controller: _input,
                  autofocus: true,
                  decoration: const InputDecoration(
                    prefixIcon: Icon(Icons.travel_explore),
                    labelText: 'Search every chat',
                    border: OutlineInputBorder(),
                  ),
                  onChanged: _controller.setQuery,
                ),
              ),
              if (phase == GlobalSearchPhase.searching)
                Padding(
                  padding: EdgeInsets.only(bottom: PiSpacing.sm),
                  child: Semantics(
                    liveRegion: true,
                    label: 'Searching',
                    child: Text('Searching…'),
                  ),
                ),
              Expanded(child: _body(query, phase, results)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _body(String query, GlobalSearchPhase phase, SearchResults results) {
    if (query.length < kGlobalSearchMinQueryLength) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(PiSpacing.xl),
          child: Text(
            'Search chat names, your prompts, assistant answers, provider reasoning summaries, and tool activity. Type at least two characters.',
            textAlign: TextAlign.center,
          ),
        ),
      );
    }
    if (phase == GlobalSearchPhase.error) {
      return Center(child: Text(_controller.error ?? 'Search is unavailable.'));
    }
    if (phase == GlobalSearchPhase.results && results.hits.isEmpty) {
      return const Center(
        child: Text(
          'No local matches. Only cached chat names, prompts, assistant answers, reasoning summaries, and tools are covered.',
        ),
      );
    }
    return ListView.separated(
      itemCount: results.hits.length + (results.truncated ? 1 : 0),
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, index) {
        if (index == results.hits.length) {
          return const ListTile(
            title: Text('More matches exist — refine your search.'),
          );
        }
        final hit = results.hits[index];
        return ListTile(
          key: Key('global-search-result-${hit.sourceKey}'),
          leading: Text(
            searchSourceGlyph(hit.source),
            semanticsLabel: searchSourceLabel(hit.source),
          ),
          title: Text(
            hit.snippet,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
          ),
          subtitle: Text(
            '${hit.sessionName} · ${searchSourceLabel(hit.source)}',
          ),
          onTap: () async {
            await widget.coordinator.selectSession(hit.sessionId);
            if (!context.mounted) return;
            Navigator.of(context).pop();
            widget.onResultTap?.call();
          },
        );
      },
    );
  }
}
