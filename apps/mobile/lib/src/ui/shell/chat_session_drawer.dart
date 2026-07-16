import 'dart:async';

import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../../domain/mobile_state.dart';
import '../../domain/session_tree.dart';
import '../../notifications/notification_controller.dart';
import '../../workspaces/workspace_picker.dart';
import '../theme/pi_theme.dart';

enum _ChatAction { rename, delete }

final class _ChatActionResult {
  const _ChatActionResult(this.action, [this.name]);

  final _ChatAction action;
  final String? name;
}

/// Compact saved-chat navigation for the single-screen chat shell.
class ChatSessionDrawer extends StatefulWidget {
  const ChatSessionDrawer({
    required this.coordinator,
    required this.notifications,
    required this.onForgetHost,
    super.key,
  });

  final ConnectionCoordinator coordinator;
  final NotificationController? notifications;
  final Future<void> Function() onForgetHost;

  @override
  State<ChatSessionDrawer> createState() => _ChatSessionDrawerState();
}

class _ChatSessionDrawerState extends State<ChatSessionDrawer> {
  @override
  void initState() {
    super.initState();
    widget.coordinator.addListener(_refresh);
  }

  @override
  void didUpdateWidget(covariant ChatSessionDrawer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.coordinator != widget.coordinator) {
      oldWidget.coordinator.removeListener(_refresh);
      widget.coordinator.addListener(_refresh);
    }
  }

  @override
  void dispose() {
    widget.coordinator.removeListener(_refresh);
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  WorkspaceEntry? _workspaceFor(String? workspaceId) {
    for (final workspace in widget.coordinator.workspaces) {
      if (workspace.workspaceId == workspaceId) return workspace;
    }
    return null;
  }

  String _title(SessionState session) {
    final name = session.name.trim();
    if (name.isNotEmpty && name != 'Session') return name;
    final workspace = _workspaceFor(session.workspaceId);
    final folder = workspace?.relativePath == '.'
        ? workspace?.displayName
        : workspace?.relativePath;
    return folder?.split('/').last ?? 'Untitled chat';
  }

  String _context(SessionState session) {
    final workspace = _workspaceFor(session.workspaceId);
    final folder = workspace?.relativePath == '.'
        ? workspace?.displayName
        : workspace?.relativePath;
    return folder == null
        ? sessionStateLabel(session.runtimeState)
        : '$folder · ${sessionStateLabel(session.runtimeState)}';
  }

  Future<WorkspaceEntry?> _chooseFolder() =>
      showModalBottomSheet<WorkspaceEntry>(
        context: context,
        isScrollControlled: true,
        builder: (sheetContext) => FractionallySizedBox(
          heightFactor: 0.9,
          child: WorkspacePicker(
            coordinator: widget.coordinator,
            onSelect: (entry) => Navigator.of(sheetContext).pop(entry),
            onCancel: () => Navigator.of(sheetContext).pop(),
            onApproveTrust: (entry) =>
                widget.coordinator.approveWorkspaceTrust(entry.workspaceId),
          ),
        ),
      );

  Future<void> _newChat() async {
    var workspace = widget.coordinator.selectedWorkspace;
    workspace ??= await _chooseFolder();
    if (workspace == null) return;
    await widget.coordinator.selectWorkspaceEntry(workspace);
    if (!widget.coordinator.requiresTrustApproval) {
      await widget.coordinator.createSession();
      if (mounted) Navigator.of(context).pop();
    }
  }

  Future<void> _changeFolder() async {
    final workspace = await _chooseFolder();
    if (workspace != null) {
      await widget.coordinator.selectWorkspaceEntry(workspace);
    }
  }

  Future<void> _selectSession(String sessionId) async {
    Navigator.of(context).pop();
    await widget.coordinator.takeControl(sessionId);
  }

  Future<void> _openChatActions(SessionState session) async {
    final result = await showDialog<_ChatActionResult>(
      context: context,
      builder: (dialogContext) =>
          _ChatActionsDialog(initialName: _title(session)),
    );
    // Route completion happens before its reverse transition has necessarily
    // unmounted every inherited dependency. Dispatch on the following frame,
    // after the dialog owns and disposes its own controller.
    await WidgetsBinding.instance.endOfFrame;
    if (!mounted || result == null) return;
    try {
      switch (result.action) {
        case _ChatAction.rename:
          final name = result.name?.trim();
          if (name != null && name.isNotEmpty && name != session.name.trim()) {
            await widget.coordinator.renameSession(session.sessionId, name);
          }
        case _ChatAction.delete:
          await widget.coordinator.deleteSession(session.sessionId);
      }
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.maybeOf(
        context,
      )?.showSnackBar(SnackBar(content: Text('Could not update chat: $error')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final coordinator = widget.coordinator;
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final semantic = context.piSemanticColors;
    final connectionHealthy =
        coordinator.isReady && coordinator.errorMessage == null;
    final selectedSessionId = coordinator.selectedSessionId;
    final transcriptSyncing = selectedSessionId != null &&
        coordinator.isHistorySyncing(selectedSessionId);
    final sessions =
        coordinator.sessions.where((session) {
          final lifecycle =
              coordinator.sessionTree[session.sessionId]?.lifecycle;
          return lifecycle != SessionLifecycleState.softDeleted &&
              lifecycle != SessionLifecycleState.purged;
        }).toList()..sort(
          (a, b) => (b.lastActivityAt ?? DateTime.fromMillisecondsSinceEpoch(0))
              .compareTo(
                a.lastActivityAt ?? DateTime.fromMillisecondsSinceEpoch(0),
              ),
        );

    return Drawer(
      key: const Key('chat-session-drawer'),
      width: MediaQuery.sizeOf(context).width.clamp(280, 360).toDouble(),
      backgroundColor: colors.surfaceContainerLow,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                PiSpacing.md,
                PiSpacing.sm,
                PiSpacing.md,
                PiSpacing.md,
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'Chats',
                      style: theme.textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  Semantics(
                    label: connectionHealthy
                        ? 'Connected'
                        : 'Connection issue: ${coordinator.errorMessage ?? coordinator.phase.name}',
                    child: Container(
                      key: const Key('drawer-connection-indicator'),
                      padding: const EdgeInsets.symmetric(
                        horizontal: PiSpacing.sm,
                        vertical: PiSpacing.xs,
                      ),
                      decoration: BoxDecoration(
                        color: colors.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(PiRadius.pill),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 8,
                            height: 8,
                            decoration: BoxDecoration(
                              color: connectionHealthy
                                  ? semantic.connectionReady
                                  : semantic.connectionOffline,
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: PiSpacing.xs),
                          Text(
                            connectionHealthy ? 'Connected' : 'Issue',
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: colors.onSurfaceVariant,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: PiSpacing.xs),
                  IconButton(
                    key: const Key('close-chat-drawer'),
                    tooltip: 'Close',
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: PiSpacing.md),
              child: FilledButton.icon(
                key: const Key('new-chat-button'),
                onPressed: coordinator.isReady ? _newChat : null,
                icon: const Icon(Icons.edit_square, size: 19),
                label: const Text('New chat'),
              ),
            ),
            const SizedBox(height: PiSpacing.sm),
            if (transcriptSyncing)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: PiSpacing.md),
                child: Container(
                  key: const Key('drawer-transcript-sync-indicator'),
                  padding: const EdgeInsets.symmetric(
                    horizontal: PiSpacing.md,
                    vertical: PiSpacing.sm,
                  ),
                  decoration: BoxDecoration(
                    color: colors.primaryContainer,
                    borderRadius: BorderRadius.circular(PiRadius.md),
                  ),
                  child: Row(
                    children: [
                      const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                      const SizedBox(width: PiSpacing.sm),
                      Expanded(
                        child: Text(
                          'Syncing open chat · ${coordinator.historyEventCount(selectedSessionId!)} events',
                          style: theme.textTheme.labelSmall,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            const SizedBox(height: PiSpacing.sm),
            Expanded(
              child: sessions.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(PiSpacing.xl),
                        child: Text(
                          'No saved chats yet',
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: colors.onSurfaceVariant,
                          ),
                        ),
                      ),
                    )
                  : ListView.builder(
                      key: const Key('saved-chat-list'),
                      padding: const EdgeInsets.symmetric(
                        horizontal: PiSpacing.sm,
                      ),
                      itemCount: sessions.length,
                      itemBuilder: (context, index) {
                        final session = sessions[index];
                        final selected =
                            session.sessionId == coordinator.selectedSessionId;
                        return Padding(
                          padding: const EdgeInsets.only(bottom: PiSpacing.xs),
                          child: ListTile(
                            key: Key('saved-chat-${session.sessionId}'),
                            selected: selected,
                            selectedTileColor: colors.secondaryContainer,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(PiRadius.md),
                            ),
                            leading: const Icon(
                              Icons.chat_bubble_outline,
                              size: 20,
                            ),
                            title: Text(
                              _title(session),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            subtitle: Text(
                              _context(session),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            trailing: IconButton(
                              key: Key('chat-actions-${session.sessionId}'),
                              tooltip: 'Chat actions',
                              onPressed: coordinator.isReady
                                  ? () => unawaited(_openChatActions(session))
                                  : null,
                              icon: const Icon(Icons.more_horiz),
                            ),
                            onTap: () =>
                                unawaited(_selectSession(session.sessionId)),
                          ),
                        );
                      },
                    ),
            ),
            const Divider(height: 1),
            ListTile(
              key: const Key('change-chat-folder'),
              leading: const Icon(Icons.folder_outlined),
              title: const Text('Choose folder'),
              subtitle: Text(
                coordinator.selectedWorkspace?.relativePath ??
                    coordinator.selectedWorkspace?.displayName ??
                    'No folder selected',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              onTap: coordinator.isReady
                  ? () => unawaited(_changeFolder())
                  : null,
            ),
            if (widget.notifications case final notifications?)
              ListenableBuilder(
                listenable: notifications,
                builder: (context, _) => ListTile(
                  key: const Key('drawer-notifications'),
                  leading: Icon(
                    notifications.enabled
                        ? Icons.notifications_active_outlined
                        : Icons.notifications_none,
                  ),
                  title: Text(
                    notifications.enabled
                        ? 'Notifications on'
                        : 'Enable notifications',
                  ),
                  onTap: notifications.enabled
                      ? null
                      : () => unawaited(notifications.enableByUserAction()),
                ),
              ),
            ListTile(
              key: const Key('drawer-forget-host'),
              leading: const Icon(Icons.link_off),
              title: const Text('Forget connection'),
              onTap: () => unawaited(widget.onForgetHost()),
            ),
          ],
        ),
      ),
    );
  }
}

class _ChatActionsDialog extends StatefulWidget {
  const _ChatActionsDialog({required this.initialName});

  final String initialName;

  @override
  State<_ChatActionsDialog> createState() => _ChatActionsDialogState();
}

class _ChatActionsDialogState extends State<_ChatActionsDialog> {
  late final TextEditingController _nameController;
  bool _confirmingDelete = false;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.initialName);
  }

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  void _save() {
    final name = _nameController.text.trim();
    if (name.isNotEmpty) {
      Navigator.of(context).pop(_ChatActionResult(_ChatAction.rename, name));
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    if (_confirmingDelete) {
      return AlertDialog(
        title: const Text('Delete chat?'),
        content: Text(
          '“${widget.initialName}” will be removed. Any active work in this chat will stop.',
        ),
        actions: [
          TextButton(
            onPressed: () => setState(() => _confirmingDelete = false),
            child: const Text('Back'),
          ),
          FilledButton(
            key: const Key('confirm-delete-chat'),
            style: FilledButton.styleFrom(
              backgroundColor: colors.error,
              foregroundColor: colors.onError,
            ),
            onPressed: () => Navigator.of(
              context,
            ).pop(const _ChatActionResult(_ChatAction.delete)),
            child: const Text('Delete'),
          ),
        ],
      );
    }

    return AlertDialog(
      title: const Text('Chat options'),
      content: TextField(
        key: const Key('rename-chat-field'),
        controller: _nameController,
        autofocus: true,
        maxLength: 120,
        textCapitalization: TextCapitalization.sentences,
        decoration: const InputDecoration(labelText: 'Chat name'),
        onSubmitted: (_) => _save(),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        TextButton.icon(
          key: const Key('delete-chat-action'),
          style: TextButton.styleFrom(foregroundColor: colors.error),
          onPressed: () => setState(() => _confirmingDelete = true),
          icon: const Icon(Icons.delete_outline),
          label: const Text('Delete'),
        ),
        FilledButton(
          key: const Key('confirm-rename-chat'),
          onPressed: _save,
          child: const Text('Save'),
        ),
      ],
    );
  }
}
