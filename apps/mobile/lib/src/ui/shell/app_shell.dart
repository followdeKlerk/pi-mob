import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../../notifications/notification_controller.dart';
import 'activity_destination.dart';
import 'chat_session_drawer.dart';
import 'session_sync_screen.dart';
import 'transcript_search_sheet.dart';

/// Single-screen chat shell.
///
/// Host diagnostics and session-management internals remain available in the
/// codebase, but primary navigation is deliberately reduced to Chat. Saved
/// sessions and new-chat actions live in the leading drawer.
class AppShell extends StatefulWidget {
  const AppShell({
    required this.coordinator,
    required this.endpointController,
    required this.draftController,
    required this.notifications,
    required this.onForgetHost,
    required this.onOpenDialog,
    super.key,
  });

  final ConnectionCoordinator coordinator;

  /// Retained for the hidden Host diagnostics surface and API compatibility.
  final TextEditingController endpointController;
  final TextEditingController draftController;
  final NotificationController? notifications;
  final Future<void> Function() onForgetHost;
  final VoidCallback onOpenDialog;

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  final _scaffoldKey = GlobalKey<ScaffoldState>();

  @override
  void initState() {
    super.initState();
    widget.coordinator.addListener(_onCoordinatorChanged);
  }

  @override
  void didUpdateWidget(covariant AppShell oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.coordinator != widget.coordinator) {
      oldWidget.coordinator.removeListener(_onCoordinatorChanged);
      widget.coordinator.addListener(_onCoordinatorChanged);
    }
  }

  @override
  void dispose() {
    widget.coordinator.removeListener(_onCoordinatorChanged);
    super.dispose();
  }

  void _onCoordinatorChanged() {
    if (mounted) setState(() {});
  }

  void _openChats() => _scaffoldKey.currentState?.openDrawer();

  @override
  Widget build(BuildContext context) {
    final chatOpen = widget.coordinator.historyGateComplete &&
        widget.coordinator.selectedSessionId != null;
    final selectedId = widget.coordinator.selectedSessionId;
    final selected = selectedId == null
        ? null
        : widget.coordinator.sessions
              .where((session) => session.sessionId == selectedId)
              .firstOrNull;
    return Scaffold(
      key: _scaffoldKey,
      drawer: chatOpen ? ChatSessionDrawer(
        coordinator: widget.coordinator,
        notifications: widget.notifications,
        onForgetHost: widget.onForgetHost,
      ) : null,
      appBar: AppBar(
        automaticallyImplyLeading: false,
        leadingWidth: 52,
        leading: chatOpen
            ? IconButton(
                key: const Key('open-chat-drawer'),
                tooltip: 'Open chats',
                onPressed: _openChats,
                icon: const Icon(Icons.menu_rounded, size: 22),
              )
            : null,
        titleSpacing: chatOpen ? 0 : 16,
        title: chatOpen
            ? Column(
                key: const Key('shell-app-bar-title'),
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    selected?.name ?? 'Chat',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  Text(
                    '${widget.coordinator.selectedRuntimeState ?? 'idle'} · '
                    '${widget.coordinator.leaseId == null ? 'observer' : 'controller'}',
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                ],
              )
            : const Text(
                'Chats',
                key: Key('shell-app-bar-title'),
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
        centerTitle: false,
        actions: [
          if (chatOpen)
            IconButton(
              key: const Key('open-transcript-search'),
              tooltip: 'Search this chat',
              onPressed: () => showTranscriptSearch(
                context,
                widget.coordinator,
              ),
              icon: const Icon(Icons.search_rounded),
            ),
        ],
        surfaceTintColor: Colors.transparent,
        scrolledUnderElevation: 0,
      ),
      body: SafeArea(
        top: false,
        child: chatOpen
            ? ActivityDestination(
                coordinator: widget.coordinator,
                draftController: widget.draftController,
                onOpenDialog: widget.onOpenDialog,
                onGoToSessions: _openChats,
              )
            : SessionSyncScreen(coordinator: widget.coordinator),
      ),
    );
  }
}
