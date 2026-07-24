import 'dart:async';

import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../../domain/mobile_state.dart';
import '../../domain/session_controls.dart';
import '../../domain/session_directory.dart';
import '../../notifications/notification_controller.dart';
import '../../workspaces/workspace_picker.dart';
import '../theme/pi_theme.dart';
import 'motion_primitives.dart';
import 'raw_rpc_sheet.dart';

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

  String? _context(SessionState session) {
    final workspace = _workspaceFor(session.workspaceId);
    if (workspace == null) return null;
    final title = _title(session).trim();

    String? meaningful(String value) {
      final candidate = value.trim();
      if (candidate.isEmpty || candidate == '.' || candidate == title) {
        return null;
      }
      return candidate;
    }

    return meaningful(workspace.relativePath) ??
        meaningful(workspace.displayName);
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
          ),
        ),
      );

  Future<({String? modelId, String? provider})?> _chooseAgent() async {
    try {
      await widget.coordinator.requestModels();
    } on Object {
      if (mounted) {
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(
          const SnackBar(
            content: Text('Could not load agents. Check the connection.'),
          ),
        );
      }
      return null;
    }
    if (!mounted) return null;
    final models = widget.coordinator.configuredModels
        .where((model) => model.available && model.provider != null)
        .toList(growable: false);
    if (models.isEmpty) {
      // A new host may not have a durable model catalogue until its first Pi
      // session starts. Let the bridge create that session with Pi's default
      // rather than trapping the valid zero-chat state.
      return (modelId: null, provider: null);
    }
    ModelOption selected = models.first;
    final chosen = await showDialog<ModelOption>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Choose agent'),
          content: DropdownButtonFormField<String>(
            key: const Key('new-chat-agent-picker'),
            initialValue: selected.id,
            isExpanded: true,
            decoration: const InputDecoration(
              labelText: 'Agent',
              border: OutlineInputBorder(),
            ),
            items: [
              for (final model in models)
                DropdownMenuItem(
                  value: model.id,
                  child: Text(
                    '${model.provider} · ${model.label}',
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
            ],
            onChanged: (id) {
              if (id == null) return;
              setDialogState(
                () => selected = models.firstWhere((model) => model.id == id),
              );
            },
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              key: const Key('confirm-new-chat-agent'),
              onPressed: () => Navigator.of(dialogContext).pop(selected),
              child: const Text('Continue'),
            ),
          ],
        ),
      ),
    );
    if (chosen == null) return null;
    return (modelId: chosen.id, provider: chosen.provider);
  }

  Future<void> _newChat() async {
    if (widget.coordinator.sessionCreation.isCreating) return;
    final workspace = await _chooseFolder();
    if (workspace == null) return;
    await widget.coordinator.selectWorkspaceEntry(workspace);
    final agent = await _chooseAgent();
    if (agent == null) return;
    try {
      await widget.coordinator.createSession(
        modelId: agent.modelId,
        provider: agent.provider,
      );
    } on Object {
      // The coordinator exposes a concise, typed failure directly below the
      // New chat affordance. Keep the drawer open so the user can retry.
      return;
    }
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _selectSession(String sessionId) async {
    Navigator.of(context).pop();
    await widget.coordinator.takeControl(sessionId);
  }

  Future<void> _changeBridgeAddress() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Change bridge address?'),
        content: const Text(
          'You’ll be unpaired from the current bridge. Saved chats and cached '
          'data associated with this host may be cleared, but local drafts are '
          'preserved. You’ll then enter and verify the new address.',
        ),
        actions: [
          TextButton(
            key: const Key('cancel-change-bridge-address'),
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const Key('confirm-change-bridge-address'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Change address'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    Navigator.of(context).pop();
    await widget.onForgetHost();
  }

  Future<void> _openRawRpc() async {
    final sessionId = widget.coordinator.selectedSessionId;
    if (sessionId == null) return;
    Navigator.of(context).pop();
    await WidgetsBinding.instance.endOfFrame;
    if (!mounted) return;
    await showRawRpcSheet(
      context,
      coordinator: widget.coordinator,
      sessionId: sessionId,
    );
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
    final creation = coordinator.sessionCreation;
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final semantic = context.piSemanticColors;
    final connectionLabel = switch (coordinator.phase) {
      ConnectionPhase.ready => 'Bridge connected',
      ConnectionPhase.probing ||
      ConnectionPhase.connecting ||
      ConnectionPhase.handshaking => 'Connecting',
      ConnectionPhase.synchronizing => 'Syncing',
      ConnectionPhase.disconnected => 'Reconnecting',
      ConnectionPhase.background => 'Background',
      _ => 'Issue',
    };
    final connectionHealthy = coordinator.phase == ConnectionPhase.ready;
    final connectionBusy = const {
      ConnectionPhase.probing,
      ConnectionPhase.connecting,
      ConnectionPhase.handshaking,
      ConnectionPhase.synchronizing,
      ConnectionPhase.disconnected,
      ConnectionPhase.background,
    }.contains(coordinator.phase);
    final selectedSessionId = coordinator.selectedSessionId;
    final transcriptSyncing =
        selectedSessionId != null &&
        coordinator.isHistorySyncing(selectedSessionId);
    final sessions = coordinator.sessions.toList()
      ..sort((a, b) {
        int rank(String id) => switch (coordinator.attentionFor(id)) {
          SessionAttentionState.needsAttention => 0,
          SessionAttentionState.unread => 1,
          SessionAttentionState.background => 2,
          SessionAttentionState.none => 3,
        };
        final attention = rank(a.sessionId).compareTo(rank(b.sessionId));
        if (attention != 0) return attention;
        return (b.lastActivityAt ?? DateTime.fromMillisecondsSinceEpoch(0))
            .compareTo(
              a.lastActivityAt ?? DateTime.fromMillisecondsSinceEpoch(0),
            );
      });

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
                    label: connectionLabel == 'Issue'
                        ? 'Connection issue: ${coordinator.errorMessage ?? coordinator.phase.name}'
                        : connectionLabel,
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
                                  : connectionBusy
                                  ? semantic.connectionDegraded
                                  : semantic.connectionOffline,
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: PiSpacing.xs),
                          Text(
                            connectionLabel,
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
                onPressed: coordinator.isReady && !creation.isCreating
                    ? _newChat
                    : null,
                icon: const Icon(Icons.edit_square, size: 19),
                label: const Text('New chat'),
              ),
            ),
            if (creation.isCreating)
              const Padding(
                padding: EdgeInsets.only(
                  left: PiSpacing.md,
                  top: PiSpacing.sm,
                  right: PiSpacing.md,
                ),
                child: Row(
                  key: Key('creating-chat-indicator'),
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SizedBox(
                      width: 14,
                      height: 14,
                      child: MotionSpinner(
                        strokeWidth: 2,
                        dimension: 14,
                        label: 'Creating chat',
                      ),
                    ),
                    SizedBox(width: PiSpacing.sm),
                    Text('Creating chat…'),
                  ],
                ),
              )
            else if (creation.phase == SessionCreationPhase.failed)
              Padding(
                padding: const EdgeInsets.only(
                  left: PiSpacing.md,
                  top: PiSpacing.sm,
                  right: PiSpacing.md,
                ),
                child: Text(
                  creation.error ?? 'Could not create chat.',
                  key: const Key('creating-chat-error'),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: colors.error,
                  ),
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
                        child: MotionSpinner(
                          strokeWidth: 2,
                          dimension: 14,
                          label: 'Syncing chat history',
                        ),
                      ),
                      const SizedBox(width: PiSpacing.sm),
                      Expanded(
                        child: Text(
                          'Syncing open chat · ${coordinator.historyEventCount(selectedSessionId)} events',
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
                            leading: Icon(
                              Icons.chat_bubble_outline,
                              size: 20,
                              color: colors.onSurfaceVariant,
                            ),
                            title: Text(
                              _title(session),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            subtitle: switch (_context(session)) {
                              final context? => Padding(
                                padding: const EdgeInsets.only(
                                  top: PiSpacing.xs,
                                ),
                                child: Text(
                                  context,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              null => null,
                            },
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
              key: const Key('drawer-raw-rpc'),
              leading: const Icon(Icons.code),
              title: const Text('Advanced · Raw RPC'),
              enabled: coordinator.selectedSessionId != null,
              onTap: coordinator.selectedSessionId == null
                  ? null
                  : () => unawaited(_openRawRpc()),
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
              leading: const Icon(Icons.swap_horiz),
              title: const Text('Change bridge address'),
              onTap: () => unawaited(_changeBridgeAddress()),
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
