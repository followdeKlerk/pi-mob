import 'dart:async';

import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../../domain/prompt_send_lifecycle.dart';
import '../../notifications/notification_controller.dart';
import '../theme/pi_tokens.dart';
import 'activity_destination.dart';
import 'pi_brand_mark.dart';
import 'chat_session_drawer.dart';
import 'global_search_sheet.dart';
import 'session_sync_screen.dart';
import 'shortcut_intents.dart';
import 'transcript_search_sheet.dart';

/// Single-screen chat shell.
///
/// Host diagnostics and session-management internals remain available in the
/// codebase, but primary navigation is deliberately reduced to Chat. Saved
/// sessions and new-chat actions live in the leading drawer.
///
/// R12 — Back-stack priority is enforced via a `PopScope` that
/// intercepts the back gesture. Order: keyboard shortcuts -> transient
/// sheet/dialog (close that) -> drawer (close that) -> navigation
/// history. The `Shortcuts`/`Actions` layer provides the keyboard
/// surface (Cmd/Ctrl+Enter send, Cmd/Ctrl+K search, Cmd/Ctrl+Shift+O chats).
/// Modal focus and IME composition win over the
/// shell. The catalogue intent is intentionally absent: the catalogue
/// capability is not produced by the normal daemon, so the released
/// surface does not expose a commands/catalogue entry point.
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
  final _shortcutFocus = FocusNode(debugLabel: 'app-shell-shortcuts');
  bool _historyAvailable = false;
  String? _selectedSessionId;
  String? _selectedSessionName;

  @override
  void initState() {
    super.initState();
    _syncShellState();
    widget.coordinator.addListener(_onCoordinatorChanged);
  }

  @override
  void didUpdateWidget(covariant AppShell oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.coordinator != widget.coordinator) {
      oldWidget.coordinator.removeListener(_onCoordinatorChanged);
      widget.coordinator.addListener(_onCoordinatorChanged);
      _syncShellState();
    }
  }

  @override
  void dispose() {
    widget.coordinator.removeListener(_onCoordinatorChanged);
    _shortcutFocus.dispose();
    super.dispose();
  }

  void _onCoordinatorChanged() {
    if (mounted && _syncShellState()) setState(() {});
  }

  bool _syncShellState() {
    final coordinator = widget.coordinator;
    final historyAvailable =
        coordinator.historyGateComplete || !coordinator.isReady;
    final selectedId = coordinator.selectedSessionId;
    final selectedName = coordinator.selectedSession?.name;
    if (_historyAvailable == historyAvailable &&
        _selectedSessionId == selectedId &&
        _selectedSessionName == selectedName) {
      return false;
    }
    _historyAvailable = historyAvailable;
    _selectedSessionId = selectedId;
    _selectedSessionName = selectedName;
    return true;
  }

  void _openChats() => _scaffoldKey.currentState?.openDrawer();

  void _closeDrawerIfOpen() {
    final state = _scaffoldKey.currentState;
    if (state == null) return;
    if (state.isDrawerOpen) {
      state.closeDrawer();
    }
  }

  void _submitDraft() {
    final coordinator = widget.coordinator;
    if (coordinator.canAttemptSend) {
      unawaited(
        coordinator.submitPromptWithRecovery().catchError((Object _) {
          return const PromptSendStatus(phase: PromptSendPhase.failed);
        }),
      );
    }
  }

  void _openSearch() {
    final coordinator = widget.coordinator;
    final sessionId = coordinator.selectedSessionId;
    if (sessionId == null) {
      unawaited(showGlobalSearch(context, coordinator));
    } else {
      unawaited(showTranscriptSearch(context, coordinator));
    }
  }

  @override
  Widget build(BuildContext context) {
    final historyAvailable = _historyAvailable;
    final chatOpen = historyAvailable && _selectedSessionId != null;
    return Shortcuts(
      shortcuts: buildChatShellShortcuts(),
      child: Actions(
        actions: <Type, Action<Intent>>{
          SubmitComposerIntent: CallbackAction<SubmitComposerIntent>(
            onInvoke: (_) {
              _submitDraft();
              return null;
            },
          ),
          OpenSearchIntent: CallbackAction<OpenSearchIntent>(
            onInvoke: (_) {
              _openSearch();
              return null;
            },
          ),
          OpenChatsIntent: CallbackAction<OpenChatsIntent>(
            onInvoke: (_) {
              _openChats();
              return null;
            },
          ),
        },
        child: Focus(
          focusNode: _shortcutFocus,
          autofocus: true,
          child: PopScope(
            canPop: true,
            onPopInvokedWithResult: (bool didPop, Object? _) {
              if (didPop) return;
              _closeDrawerIfOpen();
            },
            child: Scaffold(
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
                leadingWidth: 56,
                leading: chatOpen
                    ? IconButton(
                        key: const Key('open-chat-drawer'),
                        tooltip: 'Open chats',
                        onPressed: _openChats,
                        icon: const Icon(
                          Icons.space_dashboard_outlined,
                          size: 24,
                        ),
                      )
                    : const Padding(
                        padding: EdgeInsets.all(PiSpacing.sm),
                        child: PiBrandMark(size: 28),
                      ),
                titleSpacing: 0,
                title: chatOpen
                    ? Text(
                        _selectedSessionName ?? 'Chat',
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
                      onPressed: () =>
                          showGlobalSearch(context, widget.coordinator),
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
            ),
          ),
        ),
      ),
    );
  }
}
