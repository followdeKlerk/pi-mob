import 'dart:async';

import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../../domain/prompt_send_lifecycle.dart';
import '../../attention/attention_inbox.dart';
import '../../agents/widgets/agent_supervision_sheet.dart';
import '../../agents/agent_domain.dart' as wire_agents;
import '../../notifications/notification_controller.dart';
import '../../controls/control_view_data.dart';
import '../../controls/supported_command_list.dart';
import 'activity_destination.dart';
import '../theme/pi_tokens.dart';
import 'chat_session_drawer.dart';
import 'global_search_sheet.dart';
import 'model_picker_sheet.dart';
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
/// surface described in `docs/REMAINING_UX_PLAN.md` §5 R12
/// (Cmd/Ctrl+Enter send, Cmd/Ctrl+K search, Cmd/Ctrl+M model picker,
/// Cmd/Ctrl+Shift+O chats, Cmd/Ctrl+Shift+P commands). Modal focus and
/// IME composition win over the shell.
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
    _shortcutFocus.dispose();
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

  void _openModel() {
    if (widget.coordinator.selectedSessionId == null) return;
    unawaited(showModelPickerSheet(context, widget.coordinator));
  }

  void _openCommandsAction() {
    unawaited(_openCommands(context));
  }

  Future<void> _openAgents(BuildContext context) async {
    await widget.coordinator.requestAgentSnapshot().catchError((_) {});
    if (!context.mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(sheetContext).height * .75,
          child: AgentSupervisionSheet(
            state: widget.coordinator.agents,
            title: 'Agents',
            onAction: (run, action) {
              if (action == 'transcript') {
                unawaited(
                  widget.coordinator.selectSession(run.originChatId ?? ''),
                );
                Navigator.of(sheetContext).pop();
              } else if (action != 'compare') {
                final wireAgent = wire_agents.AgentRecordData(
                  agentId: run.agentId ?? run.toolCallId,
                  task: run.task,
                  state: run.status.name,
                  originSessionId: run.originChatId ?? '',
                  originTurnId: run.originTurnId ?? '',
                  supportedActions: <String>{action},
                  revision: run.caps?.contractSource?.split(':').last ?? '',
                  model: run.model,
                  latestActivity: run.latestOutput,
                  completionSummary: run.errorMessage,
                );
                unawaited(
                  widget.coordinator.sendAgentAction(wireAgent, action),
                );
              }
            },
          ),
        ),
      ),
    );
  }

  Future<void> _openAttention(BuildContext context) =>
      showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        showDragHandle: true,
        builder: (sheetContext) => SafeArea(
          child: SizedBox(
            height: MediaQuery.sizeOf(sheetContext).height * .75,
            child: AttentionInbox(
              state: widget.coordinator.attentionItems,
              onOpen: (item) {
                unawaited(
                  widget.coordinator.markAttentionItemRead(item.attentionId),
                );
                unawaited(widget.coordinator.selectSession(item.sessionId));
                Navigator.of(sheetContext).pop();
              },
            ),
          ),
        ),
      );

  /// Opens the authoritative host catalogue. When the bridge has not
  /// reported one, the sheet remains explicit instead of inventing entries.
  Future<void> _openCommands(BuildContext context) async {
    try {
      await widget.coordinator.requestCatalogue();
    } on Object {
      // The explicit unavailable state below remains visible when the host
      // cannot report a catalogue.
    }
    if (!context.mounted) return;
    final commands =
        widget.coordinator.supportedCommands ?? <SupportedCommandData>[];
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: PiSpacing.lg,
              vertical: PiSpacing.md,
            ),
            child: SupportedCommandList(
              commands: commands,
              onInvoke: (command) {
                final invocation = command.invocation;
                if (invocation == null || invocation.isEmpty) return;
                final current = widget.draftController.text;
                final next = current.trim().isEmpty
                    ? invocation
                    : '$current $invocation';
                widget.draftController.value = TextEditingValue(
                  text: next,
                  selection: TextSelection.collapsed(offset: next.length),
                );
                unawaited(widget.coordinator.updateDraft(next));
                Navigator.of(sheetContext).pop();
              },
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
          OpenModelPickerIntent: CallbackAction<OpenModelPickerIntent>(
            onInvoke: (_) {
              _openModel();
              return null;
            },
          ),
          OpenChatsIntent: CallbackAction<OpenChatsIntent>(
            onInvoke: (_) {
              _openChats();
              return null;
            },
          ),
          OpenCommandsIntent: CallbackAction<OpenCommandsIntent>(
            onInvoke: (_) {
              _openCommandsAction();
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
                      key: const Key('open-agents'),
                      tooltip: 'Agent supervision',
                      onPressed: () => _openAgents(context),
                      icon: const Icon(Icons.hub_outlined),
                    ),
                    IconButton(
                      key: const Key('open-attention'),
                      tooltip: 'Attention inbox',
                      onPressed: () => _openAttention(context),
                      icon: const Icon(Icons.notifications_none),
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
