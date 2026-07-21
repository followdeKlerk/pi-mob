import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../../notifications/notification_controller.dart';
import '../../controls/control_view_data.dart';
import '../../controls/supported_command_list.dart';
import 'activity_destination.dart';
import '../theme/pi_tokens.dart';
import 'chat_session_drawer.dart';
import 'global_search_sheet.dart';
import 'model_picker_sheet.dart';
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

  /// Returns the label of the currently selected model for the open chat,
  /// or `null` when no chat is open or no model has been chosen yet.
  String? _currentModelLabel() {
    final coordinator = widget.coordinator;
    final modelId = coordinator.selectedControls?.modelId;
    if (modelId == null) return null;
    for (final model in coordinator.configuredModels) {
      if (model.id == modelId) return model.label;
    }
    return modelId;
  }

  void _openChats() => _scaffoldKey.currentState?.openDrawer();

  /// Surfaces the M16 command palette.
  ///
  /// The bridge still owns the actual command catalogue, so the sheet
  /// consumes whatever the [ConnectionCoordinator] exposes through
  /// [ConnectionCoordinator.supportedCommands] once that field lands. Until
  /// then the sheet renders a curated baseline of common skills / templates
  /// so the discoverable affordance is visible end-to-end and can be wired
  /// to the bridge without a UX rework.
  Future<void> _openCommands(BuildContext context) async {
    final commands =
        widget.coordinator.supportedCommands ??
        const <SupportedCommandData>[
          SupportedCommandData(
            id: 'skill:help',
            title: 'Show available skills',
            category: SupportedCommandCategory.skill,
            description: 'Lists every skill the bridge currently exposes.',
            invocation: '/skills',
          ),
          SupportedCommandData(
            id: 'skill:status',
            title: 'Connection status',
            category: SupportedCommandCategory.skill,
            description: 'Inspects the active host, lease, and stream state.',
            invocation: '/status',
          ),
          SupportedCommandData(
            id: 'template:compact',
            title: 'Compact this transcript',
            category: SupportedCommandCategory.template,
            description:
                'Summarises the current transcript into a final answer.',
            invocation: '/compact',
          ),
          SupportedCommandData(
            id: 'template:retry',
            title: 'Retry last turn',
            category: SupportedCommandCategory.template,
            description:
                'Resubmits the most recent user prompt with the same model.',
            invocation: '/retry',
          ),
          SupportedCommandData(
            id: 'extension:approve',
            title: 'Approve pending extension',
            category: SupportedCommandCategory.extension,
            description:
                'Confirms the most recent extension dialog if one is open.',
          ),
          SupportedCommandData(
            id: 'extension:cancel',
            title: 'Cancel pending extension',
            category: SupportedCommandCategory.extension,
            description:
                'Rejects the most recent extension dialog if one is open.',
          ),
        ];
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: PiSpacing.lg,
              vertical: PiSpacing.sm,
            ),
            child: SizedBox(
              height: MediaQuery.of(sheetContext).size.height * 0.7,
              child: SupportedCommandList(
                commands: commands,
                onInvoke: (cmd) {
                  Navigator.of(sheetContext).pop();
                  ScaffoldMessenger.of(sheetContext).showSnackBar(
                    SnackBar(
                      content: Text(
                        '${cmd.title} queued for ${widget.coordinator.displayName}.',
                      ),
                      behavior: SnackBarBehavior.floating,
                    ),
                  );
                },
              ),
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final historyAvailable =
        widget.coordinator.historyGateComplete || !widget.coordinator.isReady;
    final chatOpen =
        historyAvailable && widget.coordinator.selectedSessionId != null;
    final selectedId = widget.coordinator.selectedSessionId;
    final selected = selectedId == null
        ? null
        : widget.coordinator.sessions
              .where((session) => session.sessionId == selectedId)
              .firstOrNull;
    return Scaffold(
      key: _scaffoldKey,
      drawer: historyAvailable
          ? ChatSessionDrawer(
              coordinator: widget.coordinator,
              notifications: widget.notifications,
              onForgetHost: widget.onForgetHost,
            )
          : null,
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
            ? Text(
                selected?.name ?? 'Chat',
                key: const Key('shell-app-bar-title'),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontWeight: FontWeight.w600),
              )
            : const Text(
                'Chats',
                key: Key('shell-app-bar-title'),
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
        centerTitle: false,
        actions: [
          if (chatOpen) ...[
            Builder(
              builder: (context) {
                final modelLabel = _currentModelLabel();
                return IconButton(
                  key: const Key('open-model-picker'),
                  tooltip: modelLabel == null
                      ? 'Choose model'
                      : 'Model: $modelLabel',
                  onPressed: () =>
                      showModelPickerSheet(context, widget.coordinator),
                  icon: const Icon(Icons.smart_toy_outlined),
                );
              },
            ),
            IconButton(
              key: const Key('open-commands'),
              tooltip: 'Commands and skills',
              onPressed: () => _openCommands(context),
              icon: const Icon(Icons.bolt_rounded),
            ),
            IconButton(
              key: const Key('open-transcript-search'),
              tooltip: 'Search this chat',
              onPressed: () =>
                  showTranscriptSearch(context, widget.coordinator),
              icon: const Icon(Icons.search_rounded),
            ),
            IconButton(
              key: const Key('open-global-search'),
              tooltip: 'Search every chat',
              onPressed: () => showGlobalSearch(context, widget.coordinator),
              icon: const Icon(Icons.manage_search_rounded),
            ),
          ],
        ],
        surfaceTintColor: Colors.transparent,
        scrolledUnderElevation: 0,
      ),
      body: SafeArea(
        top: false,
        child: historyAvailable
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
