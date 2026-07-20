import 'package:flutter/material.dart';

import '../ui/theme/pi_tokens.dart';

import 'session_badges.dart';
import 'session_capacity_notice.dart';
import 'session_view_data.dart';

/// Paginated, searchable, filterable, sortable session list. Coordinator-
/// free: it renders exactly what [SessionListViewData.page] says to render
/// and routes every interaction through [SessionListCallbacks]. It does not
/// re-implement search, filter, or sort; the upstream reducer owns those.
class SessionListView extends StatefulWidget {
  const SessionListView({
    required this.data,
    required this.callbacks,
    required this.capacity,
    this.searchHint = 'Search sessions',
    super.key,
  });

  final SessionListViewData data;
  final SessionListCallbacks callbacks;
  final SessionCapacityState capacity;
  final String searchHint;

  @override
  State<SessionListView> createState() => _SessionListViewState();
}

class _SessionListViewState extends State<SessionListView> {
  late final TextEditingController _searchController;
  bool _showCapacityNotice = false;

  @override
  void initState() {
    super.initState();
    _searchController = TextEditingController(text: widget.data.search);
  }

  @override
  void didUpdateWidget(covariant SessionListView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.data.search != widget.data.search &&
        _searchController.text != widget.data.search) {
      _searchController.value = TextEditingValue(
        text: widget.data.search,
        selection: TextSelection.collapsed(offset: widget.data.search.length),
      );
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    widget.callbacks.onSearchChanged?.call(value);
  }

  void _onAddSession() {
    if (widget.capacity.isAtCapacity && !widget.capacity.hasEvictionCandidate) {
      setState(() => _showCapacityNotice = true);
      return;
    }
    setState(() => _showCapacityNotice = false);
    // The host decides whether to evict the LRU candidate or just open a
    // new one; we never construct the new session on the client.
    widget.callbacks.onTakeControl?.call('');
  }

  String _runtimeLabel(SessionRuntime r) {
    switch (r) {
      case SessionRuntime.idle:
        return 'Idle';
      case SessionRuntime.running:
        return 'Running';
      case SessionRuntime.waiting:
        return 'Waiting';
      case SessionRuntime.stopped:
        return 'Stopped';
      case SessionRuntime.crashed:
        return 'Crashed';
      case SessionRuntime.crashLoop:
        return 'Crash loop';
      case SessionRuntime.indeterminate:
        return 'Indeterminate';
      case SessionRuntime.providerInterrupted:
        return 'Provider interrupted';
      case SessionRuntime.deleted:
        return 'Deleted';
    }
    throw StateError('Unknown runtime');
  }

  @override
  Widget build(BuildContext context) {
    final data = widget.data;
    final page = data.page;
    final theme = Theme.of(context);
    return Semantics(
      container: true,
      label: 'Sessions',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _Header(data: data, callbacks: widget.callbacks),
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: PiSpacing.xs),
            child: TextField(
              key: const Key('session-search'),
              controller: _searchController,
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.search),
                hintText: widget.searchHint,
                border: const OutlineInputBorder(),
                suffixIcon: data.search.isEmpty
                    ? null
                    : IconButton(
                        key: const Key('session-search-clear'),
                        tooltip: 'Clear search',
                        icon: const Icon(Icons.close),
                        onPressed: () {
                          _searchController.clear();
                          _onSearchChanged('');
                        },
                      ),
              ),
              onChanged: _onSearchChanged,
            ),
          ),
          const SizedBox(height: 8),
          if (_showCapacityNotice)
            SessionCapacityNotice(
              capacity: widget.capacity,
              onDismiss: () => setState(() => _showCapacityNotice = false),
            ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: PiSpacing.xs),
            child: Row(
              children: [
                Expanded(
                  child: Semantics(
                    liveRegion: true,
                    label:
                        'Showing ${page.items.length} of ${page.totalMatching} matching sessions.',
                    child: Text(
                      '${page.items.length} of ${page.totalMatching} shown',
                      key: const Key('session-list-count'),
                      style: theme.textTheme.bodySmall,
                    ),
                  ),
                ),
                if (data.attentionCount > 0)
                  Chip(
                    key: const Key('session-list-attention-chip'),
                    avatar: const Icon(Icons.priority_high, size: 14),
                    label: Text('${data.attentionCount} need attention'),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: page.items.isEmpty
                ? _EmptyState(
                    filter: data.filter,
                    hasSearch: data.search.isNotEmpty,
                  )
                : ListView.separated(
                    key: const Key('session-list'),
                    itemCount: page.items.length,
                    separatorBuilder: (_, _) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final session = page.items[index];
                      final isForeground =
                          session.sessionId == data.foregroundSessionId;
                      return _SessionRow(
                        session: session,
                        isForeground: isForeground,
                        callbacks: widget.callbacks,
                        runtimeLabel: _runtimeLabel(session.runtime),
                      );
                    },
                  ),
          ),
          _Pagination(
            page: page,
            callbacks: widget.callbacks,
            onAdd: _onAddSession,
          ),
        ],
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.data, required this.callbacks});

  final SessionListViewData data;
  final SessionListCallbacks callbacks;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Text(
            'Sessions',
            key: const Key('session-list-title'),
            style: theme.textTheme.titleLarge,
          ),
        ),
        DropdownButton<SessionSortKey>(
          key: const Key('session-sort'),
          value: data.sort,
          underline: const SizedBox.shrink(),
          onChanged: (value) {
            if (value != null) callbacks.onSortChanged?.call(value);
          },
          items: [
            for (final key in SessionSortKey.values)
              DropdownMenuItem(value: key, child: Text('Sort: ${key.label}')),
          ],
        ),
      ],
    );
  }
}

class _SessionRow extends StatelessWidget {
  const _SessionRow({
    required this.session,
    required this.isForeground,
    required this.callbacks,
    required this.runtimeLabel,
  });

  final SessionSummaryData session;
  final bool isForeground;
  final SessionListCallbacks callbacks;
  final String runtimeLabel;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final canSwitch =
        !session.runtime.isDeleted && callbacks.onSessionSwitched != null;
    final canRestore =
        (session.attention == SessionAttention.deleted ||
            session.runtime.isDeleted) &&
        callbacks.onRestore != null;
    return Semantics(
      container: true,
      label: 'Session ${session.displayName}, $runtimeLabel.',
      child: ListTile(
        key: Key('session-row-${session.sessionId}'),
        leading: CircleAvatar(
          backgroundColor: isForeground
              ? colors.primaryContainer
              : colors.surfaceContainerHighest,
          child: Text(
            session.displayName.isEmpty
                ? '?'
                : session.displayName.characters.first.toUpperCase(),
            style: TextStyle(
              color: isForeground
                  ? colors.onPrimaryContainer
                  : colors.onSurfaceVariant,
            ),
          ),
        ),
        title: Text(
          session.displayName,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              session.workspaceLabel == null
                  ? 'Detached · $runtimeLabel'
                  : '${session.workspaceLabel} · $runtimeLabel',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              key: Key('session-row-meta-${session.sessionId}'),
            ),
            const SizedBox(height: 4),
            SessionBadges(session: session, dense: true),
          ],
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (canRestore)
              IconButton(
                key: Key('session-restore-${session.sessionId}'),
                tooltip: 'Restore deleted session',
                icon: const Icon(Icons.restore_from_trash),
                onPressed: () => callbacks.onRestore?.call(session),
              ),
            if (canSwitch)
              IconButton(
                key: Key('session-switch-${session.sessionId}'),
                tooltip: isForeground
                    ? 'Already the foreground session'
                    : 'Switch foreground to ${session.displayName}',
                icon: const Icon(Icons.swap_horiz),
                onPressed: isForeground
                    ? null
                    : () => callbacks.onSessionSwitched?.call(session),
              ),
          ],
        ),
        onTap: () => callbacks.onSessionSelected?.call(session),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.filter, required this.hasSearch});
  final SessionFilterKey filter;
  final bool hasSearch;

  @override
  Widget build(BuildContext context) {
    final text = hasSearch
        ? 'No sessions match the current search.'
        : switch (filter) {
            SessionFilterKey.all => 'No sessions yet.',
            SessionFilterKey.attention => 'Nothing needs attention right now.',
            SessionFilterKey.stopped => 'No stopped sessions.',
            SessionFilterKey.deleted => 'Trash is empty.',
            SessionFilterKey.background => 'Nothing running in the background.',
            SessionFilterKey.running => 'No sessions are running.',
          };
    return Center(key: const Key('session-list-empty'), child: Text(text));
  }
}

class _Pagination extends StatelessWidget {
  const _Pagination({
    required this.page,
    required this.callbacks,
    required this.onAdd,
  });

  final SessionPage page;
  final SessionListCallbacks callbacks;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    final start = page.items.isEmpty ? 0 : page.pageIndex * page.pageSize + 1;
    final end = page.pageIndex * page.pageSize + page.items.length;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: PiSpacing.sm),
      child: Row(
        children: [
          IconButton(
            key: const Key('session-page-prev'),
            tooltip: 'Previous page',
            icon: const Icon(Icons.chevron_left),
            onPressed: page.pageIndex == 0
                ? null
                : () => callbacks.onPageChanged?.call(page.pageIndex - 1),
          ),
          Expanded(
            child: Semantics(
              liveRegion: true,
              label:
                  'Page ${page.pageIndex + 1}. Showing items '
                  '$start to $end of ${page.totalMatching}.',
              child: Text(
                page.items.isEmpty
                    ? 'Page ${page.pageIndex + 1}'
                    : 'Page ${page.pageIndex + 1} · $start–$end of '
                          '${page.totalMatching}',
                key: const Key('session-page-status'),
                textAlign: TextAlign.center,
              ),
            ),
          ),
          IconButton(
            key: const Key('session-page-next'),
            tooltip: 'Next page',
            icon: const Icon(Icons.chevron_right),
            onPressed: page.hasMore
                ? () => callbacks.onPageChanged?.call(page.pageIndex + 1)
                : null,
          ),
          const SizedBox(width: 4),
          FilledButton.tonalIcon(
            key: const Key('session-add'),
            onPressed: onAdd,
            icon: const Icon(Icons.add),
            label: const Text('Add session'),
          ),
        ],
      ),
    );
  }
}
