import 'dart:async';

import 'package:flutter/material.dart';

import '../ui/theme/pi_tokens.dart';
import '../ui/shell/motion_primitives.dart';

import '../connection/connection_coordinator.dart';
import '../domain/mobile_state.dart';

/// Bottom-sheet workspace picker.
///
/// Hard rules enforced by the UI:
///   * Only server-reported entries are selectable. The mobile client never
///     synthesizes a root, an ID, or a relative path, which is what makes it
///     structurally impossible to select something "outside the root".
///   * Search results come exclusively from `workspace.search` responses.
///     No local completion is offered, so a user cannot fall back to a
///     freeform root path.
///   * Unavailable workspaces render an explicit reason and remain visible
///     but disabled.
class WorkspacePicker extends StatefulWidget {
  const WorkspacePicker({
    required this.coordinator,
    required this.onSelect,
    required this.onCancel,
    super.key,
  });

  final ConnectionCoordinator coordinator;
  final void Function(WorkspaceEntry entry) onSelect;
  final VoidCallback onCancel;

  @override
  State<WorkspacePicker> createState() => _WorkspacePickerState();
}

class _WorkspacePickerState extends State<WorkspacePicker> {
  late final TextEditingController _searchController;
  Timer? _searchDebounce;

  @override
  void initState() {
    super.initState();
    _searchController = TextEditingController(
      text: widget.coordinator.workspaceSearch.query,
    );
    widget.coordinator.addListener(_coordinatorChanged);
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    widget.coordinator.removeListener(_coordinatorChanged);
    _searchController.dispose();
    super.dispose();
  }

  void _coordinatorChanged() {
    if (!mounted) return;
    // Only resync the field when the query drifts, so a typing user is never
    // yanked mid-character.
    final remoteQuery = widget.coordinator.workspaceSearch.query;
    if (_searchController.text != remoteQuery) {
      _searchController.value = TextEditingValue(
        text: remoteQuery,
        selection: TextSelection.collapsed(offset: remoteQuery.length),
      );
    }
    setState(() {});
  }

  void _onQueryChanged(String value) {
    _searchDebounce?.cancel();
    if (value.trim().isEmpty) {
      unawaited(widget.coordinator.searchWorkspaces(''));
      return;
    }
    _searchDebounce = Timer(const Duration(milliseconds: 200), () {
      unawaited(widget.coordinator.searchWorkspaces(value));
    });
  }

  @override
  Widget build(BuildContext context) {
    final coordinator = widget.coordinator;
    final colors = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final search = coordinator.workspaceSearch;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(PiSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Choose a folder',
                    key: const Key('workspace-picker-title'),
                    style: text.headlineSmall,
                  ),
                ),
                IconButton(
                  key: const Key('workspace-picker-close'),
                  tooltip: 'Close',
                  onPressed: widget.onCancel,
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              'Folders are indexed by your host under ${coordinator.workspaces.isEmpty ? 'your home folder' : coordinator.workspaces.first.rootLabel}. Select one as Pi’s working directory.',
              key: const Key('workspace-picker-guardrail-note'),
              style: text.bodySmall?.copyWith(color: colors.onSurfaceVariant),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const Key('workspace-search-field'),
              controller: _searchController,
              decoration: InputDecoration(
                labelText: 'Filter indexed folders',
                hintText: 'e.g. mobile, docs',
                prefixIcon: const Icon(Icons.search),
                border: const OutlineInputBorder(),
                suffixIcon: search.isActive
                    ? IconButton(
                        key: const Key('workspace-search-cancel'),
                        tooltip: 'Cancel search',
                        onPressed: coordinator.cancelWorkspaceSearch,
                        icon: const Icon(Icons.close),
                      )
                    : null,
              ),
              onChanged: _onQueryChanged,
              onSubmitted: (value) {
                _searchDebounce?.cancel();
                unawaited(coordinator.searchWorkspaces(value));
              },
            ),
            const SizedBox(height: 12),
            Flexible(
              child: search.query.trim().isEmpty
                  ? _RecentList(
                      coordinator: coordinator,
                      onSelect: widget.onSelect,
                    )
                  : _SearchResults(
                      coordinator: coordinator,
                      onSelect: widget.onSelect,
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RecentList extends StatelessWidget {
  const _RecentList({
    required this.coordinator,
    required this.onSelect,
  });

  final ConnectionCoordinator coordinator;
  final void Function(WorkspaceEntry entry) onSelect;

  @override
  Widget build(BuildContext context) {
    final entries = coordinator.workspaces;
    if (entries.isEmpty) {
      return const Center(
        key: Key('workspace-picker-empty'),
        child: Text('No indexed folders reported by host'),
      );
    }
    return ListView.separated(
      key: const Key('workspace-recent-list'),
      shrinkWrap: true,
      itemCount: entries.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, index) {
        final entry = entries[index];
        return _WorkspaceTile(
          entry: entry,
          onSelect: onSelect,
        );
      },
    );
  }
}

class _SearchResults extends StatelessWidget {
  const _SearchResults({
    required this.coordinator,
    required this.onSelect,
  });

  final ConnectionCoordinator coordinator;
  final void Function(WorkspaceEntry entry) onSelect;

  @override
  Widget build(BuildContext context) {
    final search = coordinator.workspaceSearch;
    if (search.isActive) {
      return Padding(
        key: Key('workspace-searching-indicator'),
        padding: const EdgeInsets.symmetric(vertical: PiSpacing.xl),
        child: const Center(
          child: MotionSpinner(label: 'Searching workspaces'),
        ),
      );
    }
    if (search.phase == WorkspaceSearchPhase.error) {
      return Padding(
        key: const Key('workspace-search-error'),
        padding: const EdgeInsets.all(PiSpacing.lg),
        child: Text(search.error ?? 'Search failed'),
      );
    }
    if (search.phase == WorkspaceSearchPhase.cancelled) {
      return const Padding(
        key: Key('workspace-search-cancelled'),
        padding: EdgeInsets.symmetric(vertical: PiSpacing.xl),
        child: Center(child: Text('Search cancelled. Results discarded.')),
      );
    }
    if (search.hits.isEmpty) {
      return const Padding(
        key: Key('workspace-search-empty'),
        padding: EdgeInsets.symmetric(vertical: PiSpacing.xl),
        child: Center(child: Text('No matching indexed folders.')),
      );
    }
    return ListView.separated(
      key: const Key('workspace-search-results'),
      shrinkWrap: true,
      itemCount: search.hits.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, index) {
        final hit = search.hits[index];
        final synthesized = WorkspaceEntry(
          workspaceId: hit.workspaceId,
          displayName: hit.displayName,
          rootLabel: hit.rootLabel,
          relativePath: hit.relativePath,
          repositoryMarker: null,
          lastUsedAt: null,
          availability: hit.availability,
          fingerprint: hit.fingerprint,
          policyVersion: hit.policyVersion,
          manifest: const <WorkspaceResource>[],
        );
        return _WorkspaceTile(
          entry: synthesized,
          onSelect: onSelect,
        );
      },
    );
  }
}

class _WorkspaceTile extends StatelessWidget {
  const _WorkspaceTile({
    required this.entry,
    required this.onSelect,
  });

  final WorkspaceEntry entry;
  final void Function(WorkspaceEntry entry) onSelect;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final canSelect = entry.isSelectable;
    final unavailable = entry.availability != WorkspaceAvailability.available;
    return ListTile(
      key: Key('workspace-tile-${entry.workspaceId}'),
      enabled: canSelect || !unavailable,
      onTap: canSelect ? () => onSelect(entry) : null,
      title: Text(entry.displayName, style: text.bodyLarge),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Root: ${entry.rootLabel} · ${entry.relativePath}',
            key: Key('workspace-tile-path-${entry.workspaceId}'),
          ),
          if (entry.repositoryMarker != null)
            Text('Marker: ${entry.repositoryMarker}'),
          if (unavailable)
            Text(
              'Unavailable on host',
              key: Key('workspace-tile-unavailable-${entry.workspaceId}'),
              style: text.bodySmall?.copyWith(color: colors.error),
            ),
        ],
      ),
      trailing: canSelect
          ? const Icon(Icons.chevron_right)
          : const Icon(Icons.do_not_disturb_on),
    );
  }
}

