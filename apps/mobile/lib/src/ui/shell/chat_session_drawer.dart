import 'dart:async';

import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../../domain/mobile_state.dart';
import '../../notifications/notification_controller.dart';
import '../../workspaces/workspace_picker.dart';
import '../theme/pi_theme.dart';

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
    await widget.coordinator.selectPrimarySession(sessionId);
  }

  @override
  Widget build(BuildContext context) {
    final coordinator = widget.coordinator;
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final sessions = [...coordinator.sessions]
      ..sort(
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
            const SizedBox(height: PiSpacing.md),
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
