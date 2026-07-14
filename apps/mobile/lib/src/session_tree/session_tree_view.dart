import 'package:flutter/material.dart';

import 'session_tree_view_data.dart';

/// Accessible, lazily rendered session tree. Child pages are requested only
/// when the user expands a node or explicitly asks for the next page.
class SessionTreeView extends StatelessWidget {
  const SessionTreeView({
    required this.data,
    required this.callbacks,
    super.key,
  });

  final SessionTreeViewData data;
  final SessionTreeCallbacks callbacks;

  Future<void> _confirmFork(
    BuildContext context,
    SessionTreeNodeData node,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        key: const Key('fork-confirm-dialog'),
        title: const Text('Fork from this prompt?'),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Fork creates a new durable session from the selected user '
                'prompt. The current session stays unchanged.',
              ),
              const SizedBox(height: 12),
              Text(
                'Selected prompt',
                style: Theme.of(context).textTheme.labelLarge,
              ),
              const SizedBox(height: 4),
              SelectableText(
                node.preview,
                key: const Key('fork-message-preview'),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            key: const Key('fork-cancel'),
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const Key('fork-confirm'),
            onPressed: callbacks.onFork == null
                ? null
                : () => Navigator.of(dialogContext).pop(true),
            child: const Text('Create fork'),
          ),
        ],
      ),
    );
    if (confirmed ?? false) callbacks.onFork?.call(node);
  }

  Future<void> _confirmClone(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        key: const Key('clone-confirm-dialog'),
        title: const Text('Clone current branch?'),
        content: const SingleChildScrollView(
          child: Text(
            'Clone duplicates the current active branch into a new durable '
            'session. It does not fork from a selected message, and the '
            'current session stays unchanged.',
          ),
        ),
        actions: [
          TextButton(
            key: const Key('clone-cancel'),
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const Key('clone-confirm'),
            onPressed: callbacks.onClone == null
                ? null
                : () => Navigator.of(dialogContext).pop(true),
            child: const Text('Create clone'),
          ),
        ],
      ),
    );
    if (confirmed ?? false) callbacks.onClone?.call();
  }

  @override
  Widget build(BuildContext context) {
    final canClone =
        !data.isStale &&
        !data.branchOperation.isBusy &&
        callbacks.onClone != null;
    return Semantics(
      container: true,
      label: 'Session tree for ${data.sessionName}',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _TreeHeader(
            sessionName: data.sessionName,
            onClone: canClone ? () => _confirmClone(context) : null,
          ),
          if (data.isStale)
            const _TreeNotice(
              key: Key('session-tree-stale'),
              icon: Icons.cloud_off,
              text: 'Showing saved tree data. Reconnect to change branches.',
              semanticPrefix: 'Stale session tree.',
            ),
          if (data.partialDataMessage case final message?)
            _TreeNotice(
              key: const Key('session-tree-partial'),
              icon: Icons.info_outline,
              text: message,
              semanticPrefix: 'Partial session tree.',
            ),
          if (data.branchOperation.phase != SessionBranchOperationPhase.idle)
            _BranchOperationStatus(
              operation: data.branchOperation,
              onDismiss: callbacks.onDismissBranchStatus,
            ),
          Expanded(child: _buildBody(context)),
        ],
      ),
    );
  }

  Widget _buildBody(BuildContext context) {
    switch (data.surfaceState) {
      case SessionTreeSurfaceState.loading:
        return Center(
          key: const Key('session-tree-loading'),
          child: Semantics(
            liveRegion: true,
            label: 'Loading session tree',
            child: CircularProgressIndicator(),
          ),
        );
      case SessionTreeSurfaceState.failed:
        return _TreeFailure(
          key: const Key('session-tree-failure'),
          title: 'Session tree could not be loaded',
          message: data.errorMessage ?? 'Try loading the tree again.',
          onRetry: callbacks.onRetryTree,
        );
      case SessionTreeSurfaceState.incompatible:
        return _TreeFailure(
          key: const Key('session-tree-incompatible'),
          title: 'Session tree requires an update',
          message:
              data.errorMessage ??
              'Update the app or bridge before opening this tree.',
          onRetry: null,
        );
      case SessionTreeSurfaceState.ready:
        if (data.roots.isEmpty) {
          return const Center(
            key: Key('session-tree-empty'),
            child: Text('No branch history is available yet.'),
          );
        }
        return ListView.builder(
          key: const Key('session-tree-list'),
          padding: const EdgeInsets.fromLTRB(8, 4, 8, 24),
          itemCount: data.roots.length,
          itemBuilder: (context, index) => _TreeNode(
            node: data.roots[index],
            callbacks: callbacks,
            changesEnabled: !data.isStale && !data.branchOperation.isBusy,
            onFork: (node) => _confirmFork(context, node),
          ),
        );
    }
  }
}

class _TreeHeader extends StatelessWidget {
  const _TreeHeader({required this.sessionName, required this.onClone});

  final String sessionName;
  final VoidCallback? onClone;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(12, 8, 8, 4),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Session tree',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              Text(sessionName, maxLines: 2, overflow: TextOverflow.ellipsis),
            ],
          ),
        ),
        const SizedBox(width: 8),
        FilledButton.tonalIcon(
          key: const Key('session-tree-clone'),
          onPressed: onClone,
          icon: const Icon(Icons.copy_all_outlined),
          label: const Text('Clone branch'),
        ),
      ],
    ),
  );
}

class _TreeNode extends StatefulWidget {
  const _TreeNode({
    required this.node,
    required this.callbacks,
    required this.changesEnabled,
    required this.onFork,
  });

  final SessionTreeNodeData node;
  final SessionTreeCallbacks callbacks;
  final bool changesEnabled;
  final ValueChanged<SessionTreeNodeData> onFork;

  @override
  State<_TreeNode> createState() => _TreeNodeState();
}

class _TreeNodeState extends State<_TreeNode> {
  late bool _expanded;
  bool _requestedInitialPage = false;

  @override
  void initState() {
    super.initState();
    _expanded = widget.node.initiallyExpanded;
    if (_expanded) _requestInitialPageIfNeeded();
  }

  @override
  void didUpdateWidget(covariant _TreeNode oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.node.entryId != widget.node.entryId) {
      _expanded = widget.node.initiallyExpanded;
      _requestedInitialPage = false;
    }
  }

  void _requestInitialPageIfNeeded() {
    if (_requestedInitialPage ||
        widget.node.childrenState != SessionTreeChildrenState.notRequested) {
      return;
    }
    _requestedInitialPage = true;
    widget.callbacks.onLoadChildren?.call(
      SessionTreePageRequest(
        parentEntryId: widget.node.entryId,
        pageToken: null,
      ),
    );
  }

  void _toggle() {
    setState(() => _expanded = !_expanded);
    if (_expanded) _requestInitialPageIfNeeded();
  }

  void _requestNextPage({bool retry = false}) {
    widget.callbacks.onLoadChildren?.call(
      SessionTreePageRequest(
        parentEntryId: widget.node.entryId,
        pageToken: widget.node.nextPageToken,
        isRetry: retry,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final node = widget.node;
    final kindLabel = node.kind.semanticLabel;
    final current = node.isCurrentLeaf ? ', current leaf' : '';
    final branch = node.isOnCurrentBranch ? ', on current branch' : '';
    final forkable = node.isForkEligible ? ', eligible to fork' : '';
    final expanded = node.canExpand
        ? ', ${_expanded ? 'expanded' : 'collapsed'}'
        : '';

    return Padding(
      padding: EdgeInsets.only(left: node.depth * 16.0),
      child: Semantics(
        container: true,
        label: '$kindLabel$current$branch$forkable$expanded. ${node.preview}',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Material(
              color: node.isCurrentLeaf
                  ? Theme.of(context).colorScheme.primaryContainer
                  : Colors.transparent,
              borderRadius: BorderRadius.circular(8),
              child: InkWell(
                key: Key('tree-node-${node.entryId}'),
                borderRadius: BorderRadius.circular(8),
                onTap: widget.callbacks.onNodeSelected == null
                    ? null
                    : () => widget.callbacks.onNodeSelected?.call(node),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 4,
                    vertical: 6,
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      if (node.canExpand)
                        IconButton(
                          key: Key('tree-expand-${node.entryId}'),
                          tooltip: _expanded
                              ? 'Collapse branch'
                              : 'Expand branch',
                          onPressed: _toggle,
                          icon: Icon(
                            _expanded ? Icons.expand_more : Icons.chevron_right,
                          ),
                        )
                      else
                        const SizedBox(width: 48),
                      Icon(_kindIcon(node.kind), semanticLabel: kindLabel),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              node.preview.isEmpty
                                  ? 'No preview available'
                                  : node.preview,
                              maxLines: 3,
                              overflow: TextOverflow.ellipsis,
                            ),
                            if (node.isCurrentLeaf)
                              const Text(
                                'Current leaf',
                                key: Key('session-tree-current-leaf'),
                              )
                            else if (node.isOnCurrentBranch)
                              const Text('Current branch'),
                          ],
                        ),
                      ),
                      if (node.isForkEligible)
                        IconButton(
                          key: Key('tree-fork-${node.entryId}'),
                          tooltip: 'Fork from this user prompt',
                          onPressed:
                              widget.changesEnabled &&
                                  widget.callbacks.onFork != null
                              ? () => widget.onFork(node)
                              : null,
                          icon: const Icon(Icons.call_split),
                        ),
                    ],
                  ),
                ),
              ),
            ),
            if (_expanded) ...[
              for (final child in node.children)
                _TreeNode(
                  node: child,
                  callbacks: widget.callbacks,
                  changesEnabled: widget.changesEnabled,
                  onFork: widget.onFork,
                ),
              _ChildPageState(
                node: node,
                onLoadMore: _requestNextPage,
                onRetry: () => _requestNextPage(retry: true),
              ),
            ],
          ],
        ),
      ),
    );
  }

  IconData _kindIcon(SessionTreeEntryKind kind) => switch (kind) {
    SessionTreeEntryKind.userPrompt => Icons.person_outline,
    SessionTreeEntryKind.assistant => Icons.auto_awesome_outlined,
    SessionTreeEntryKind.tool => Icons.build_outlined,
    SessionTreeEntryKind.system => Icons.info_outline,
  };
}

class _ChildPageState extends StatelessWidget {
  const _ChildPageState({
    required this.node,
    required this.onLoadMore,
    required this.onRetry,
  });

  final SessionTreeNodeData node;
  final VoidCallback onLoadMore;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    if (node.childrenState == SessionTreeChildrenState.loading) {
      return Padding(
        key: Key('tree-children-loading-${node.entryId}'),
        padding: const EdgeInsets.all(12),
        child: Semantics(
          liveRegion: true,
          label: 'Loading child entries',
          child: const LinearProgressIndicator(),
        ),
      );
    }
    if (node.childrenState == SessionTreeChildrenState.failed) {
      return Padding(
        padding: const EdgeInsets.only(left: 48, bottom: 8),
        child: Semantics(
          liveRegion: true,
          label: 'Child entries failed to load. ${node.childrenError ?? ''}',
          child: Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 8,
            children: [
              Text(node.childrenError ?? 'Child entries could not be loaded.'),
              TextButton.icon(
                key: Key('tree-children-retry-${node.entryId}'),
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: const Text('Retry'),
              ),
            ],
          ),
        ),
      );
    }
    if (node.hasMoreChildren) {
      return Padding(
        padding: const EdgeInsets.only(left: 48, bottom: 8),
        child: Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            key: Key('tree-load-more-${node.entryId}'),
            onPressed: onLoadMore,
            icon: const Icon(Icons.expand_more),
            label: const Text('Load more replies'),
          ),
        ),
      );
    }
    return const SizedBox.shrink();
  }
}

class _BranchOperationStatus extends StatelessWidget {
  const _BranchOperationStatus({required this.operation, this.onDismiss});

  final SessionBranchOperationData operation;
  final VoidCallback? onDismiss;

  @override
  Widget build(BuildContext context) {
    final kind = operation.kind == SessionBranchOperationKind.fork
        ? 'Fork'
        : 'Clone';
    final (icon, text) = switch (operation.phase) {
      SessionBranchOperationPhase.submitting => (
        Icons.sync,
        '$kind request is being accepted.',
      ),
      SessionBranchOperationPhase.waitingForSnapshot => (
        Icons.hourglass_top,
        '$kind created. Waiting for the new session snapshot before opening it.',
      ),
      SessionBranchOperationPhase.cancelled => (
        Icons.cancel_outlined,
        '$kind was cancelled by an extension. The current session is unchanged.',
      ),
      SessionBranchOperationPhase.failed => (
        Icons.error_outline,
        operation.message ??
            '$kind could not be created. The current session is unchanged.',
      ),
      SessionBranchOperationPhase.idle => (Icons.info_outline, ''),
    };
    return Semantics(
      container: true,
      liveRegion: true,
      label: text,
      child: Material(
        key: const Key('session-branch-operation-status'),
        color: Theme.of(context).colorScheme.secondaryContainer,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(
            children: [
              Icon(icon),
              const SizedBox(width: 8),
              Expanded(child: Text(text)),
              if (!operation.isBusy)
                IconButton(
                  key: const Key('session-branch-status-dismiss'),
                  tooltip: 'Dismiss status',
                  onPressed: onDismiss,
                  icon: const Icon(Icons.close),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TreeNotice extends StatelessWidget {
  const _TreeNotice({
    required this.icon,
    required this.text,
    required this.semanticPrefix,
    super.key,
  });

  final IconData icon;
  final String text;
  final String semanticPrefix;

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    label: '$semanticPrefix $text',
    child: Material(
      key: key,
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Row(
          children: [
            Icon(icon),
            const SizedBox(width: 8),
            Expanded(child: Text(text)),
          ],
        ),
      ),
    ),
  );
}

class _TreeFailure extends StatelessWidget {
  const _TreeFailure({
    required this.title,
    required this.message,
    required this.onRetry,
    super.key,
  });

  final String title;
  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Semantics(
      container: true,
      liveRegion: true,
      label: '$title. $message',
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.account_tree_outlined, size: 40),
            const SizedBox(height: 12),
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(message, textAlign: TextAlign.center),
            if (onRetry != null) ...[
              const SizedBox(height: 12),
              FilledButton.icon(
                key: const Key('session-tree-retry'),
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: const Text('Retry'),
              ),
            ],
          ],
        ),
      ),
    ),
  );
}
