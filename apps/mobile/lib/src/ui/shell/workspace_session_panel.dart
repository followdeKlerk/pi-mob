import 'dart:async';

import 'package:flutter/material.dart';

import '../../controls/controls.dart' as control_ui;
import '../../connection/connection_coordinator.dart';
import '../../domain/session_controls.dart' as control_domain;
import '../../domain/mobile_state.dart';
import '../../sessions/observer_banner.dart';
import '../../sessions/session_view_data.dart' as session_ui;
import '../../workspaces/workspace_picker.dart';
import '../theme/pi_theme.dart';
import 'policy_mode_row.dart';
import 'trust_review.dart';

/// Session and workspace control surface shown on the Sessions destination.
///
/// The visible rows are unchanged in semantics from the original diagnostic
/// column: workspace picker, session picker, create-session control,
/// controller lease indicator, retry-session affordance for broken runs,
/// policy mode, and the trust-required banner. Bottom-sheet and dialog
/// affordances (`WorkspacePicker`, `SessionControls`, `InlineTrustReview`)
/// continue to use their pre-existing keys so external callers and existing
/// widget tests stay green.
class WorkspaceSessionPanel extends StatefulWidget {
  const WorkspaceSessionPanel({required this.coordinator, super.key});

  final ConnectionCoordinator coordinator;

  @override
  State<WorkspaceSessionPanel> createState() => _WorkspaceSessionPanelState();
}

class _WorkspaceSessionPanelState extends State<WorkspaceSessionPanel> {
  @override
  void initState() {
    super.initState();
    widget.coordinator.addListener(_onChanged);
  }

  @override
  void dispose() {
    widget.coordinator.removeListener(_onChanged);
    super.dispose();
  }

  void _onChanged() {
    if (mounted) setState(() {});
  }

  Future<void> _openWorkspacePicker() async {
    final selected = await showModalBottomSheet<WorkspaceEntry>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) {
        return FractionallySizedBox(
          heightFactor: 0.9,
          child: WorkspacePicker(
            coordinator: widget.coordinator,
            onSelect: (entry) => Navigator.of(sheetContext).pop(entry),
            onCancel: () => Navigator.of(sheetContext).pop(),
            onApproveTrust: (entry) async {
              await widget.coordinator.approveWorkspaceTrust(entry.workspaceId);
            },
          ),
        );
      },
    );
    if (selected != null) {
      await widget.coordinator.selectWorkspace(selected.workspaceId);
    }
  }

  Future<void> _openSessionControls() async {
    final coordinator = widget.coordinator;
    await coordinator.requestModels();
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) {
        final state = coordinator.selectedControls;
        final models = coordinator.configuredModels;
        final idle =
            coordinator.selectedRuntimeState == 'idle' ||
            coordinator.selectedRuntimeState == 'stopped';
        final retryPhase = switch (state?.retryPhase) {
          control_domain.RetryPhase.waiting => control_ui.RetryPhase.scheduled,
          control_domain.RetryPhase.running => control_ui.RetryPhase.retrying,
          control_domain.RetryPhase.aborted => control_ui.RetryPhase.idle,
          control_domain.RetryPhase.failed => control_ui.RetryPhase.idle,
          _ => control_ui.RetryPhase.idle,
        };
        final compactionPhase = switch (state?.compactionPhase) {
          control_domain.CompactionPhase.running =>
            control_ui.CompactionPhase.compacting,
          control_domain.CompactionPhase.completed =>
            control_ui.CompactionPhase.completed,
          control_domain.CompactionPhase.failed =>
            control_ui.CompactionPhase.failed,
          _ => control_ui.CompactionPhase.idle,
        };
        return FractionallySizedBox(
          heightFactor: 0.92,
          child: ListView(
            key: const Key('session-controls-sheet'),
            padding: const EdgeInsets.all(PiSpacing.lg),
            children: [
              Text(
                'Pi controls',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: PiSpacing.md),
              control_ui.ModelThinkingSelector(
                data: control_ui.ModelThinkingViewData(
                  models: [
                    for (final model in models)
                      control_ui.ModelOptionData(
                        id: model.id,
                        label: model.label,
                        provider: model.provider ?? 'Configured host',
                        thinkingLevels: const [
                          'off',
                          'minimal',
                          'low',
                          'medium',
                          'high',
                        ],
                      ),
                  ],
                  selectedModelId: state?.modelId,
                  selectedThinkingLevel: state?.thinkingLevel,
                  unavailableRestoredModel: state?.modelUnavailable == true
                      ? state?.modelId
                      : null,
                  enabled: idle,
                  disabledReason: idle
                      ? null
                      : 'Model and thinking can change only while idle.',
                ),
                callbacks: control_ui.ModelThinkingCallbacks(
                  onModelSelected: (id) => unawaited(coordinator.setModel(id)),
                  onThinkingSelected: (level) =>
                      unawaited(coordinator.setThinking(level)),
                ),
              ),
              control_ui.ContextStatsCard(
                data: control_ui.ContextStatsViewData(
                  sessionTokens:
                      (state?.inputTokens ?? 0) + (state?.outputTokens ?? 0),
                  contextTokens: state?.contextTokens,
                  contextWindowTokens: state?.contextWindow,
                  costUsd: state?.cost,
                ),
              ),
              control_ui.RetryControls(
                data: control_ui.RetryViewData(
                  phase: retryPhase,
                  autoRetry: state?.autoRetryEnabled,
                  remaining: state?.retryDelayMs == null
                      ? null
                      : Duration(milliseconds: state!.retryDelayMs!),
                  attempt: state?.retryAttempt,
                  maximumAttempts: state?.retryMaxAttempts,
                ),
                callbacks: control_ui.RetryCallbacks(
                  onAutoRetryChanged: (value) =>
                      unawaited(coordinator.setAutoRetry(value)),
                  onAbort: () => unawaited(coordinator.abortRetry()),
                ),
              ),
              control_ui.CompactionControls(
                data: control_ui.CompactionViewData(
                  phase: compactionPhase,
                  autoCompact: state?.autoCompactionEnabled,
                  summary: state?.compactionSummary,
                  canStart: coordinator.isReady,
                ),
                callbacks: control_ui.CompactionCallbacks(
                  onAutoCompactChanged: (value) =>
                      unawaited(coordinator.setAutoCompaction(value)),
                  onStart: () => unawaited(coordinator.compactNow()),
                ),
              ),
              control_ui.SupportedCommandList(
                commands: [
                  for (final command
                      in state?.commands ??
                          const <control_domain.DiscoveredCommand>[])
                    control_ui.SupportedCommandData(
                      id: '${command.category}:${command.name}',
                      title: '/${command.name}',
                      category: switch (command.category) {
                        'skill' => control_ui.SupportedCommandCategory.skill,
                        'template' =>
                          control_ui.SupportedCommandCategory.template,
                        _ => control_ui.SupportedCommandCategory.extension,
                      },
                      description: command.description,
                      invocation: '/${command.name}',
                    ),
                ],
                onInvoke: (command) {
                  unawaited(
                    coordinator.updateDraft(
                      command.invocation ?? command.title,
                    ),
                  );
                  Navigator.of(context).pop();
                },
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _openTrustReviewForSelected() async {
    final selected = widget.coordinator.selectedWorkspace;
    if (selected == null) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => InlineTrustReview(
        entry: selected,
        onApprove: () async {
          await widget.coordinator.approveWorkspaceTrust(selected.workspaceId);
          if (dialogContext.mounted) Navigator.of(dialogContext).pop();
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final coordinator = widget.coordinator;
    final workspaceValue =
        coordinator.workspaces.any(
          (item) => item.workspaceId == coordinator.selectedWorkspaceId,
        )
        ? coordinator.selectedWorkspaceId
        : null;
    final sessionValue =
        coordinator.sessions.any(
          (item) => item.sessionId == coordinator.selectedSessionId,
        )
        ? coordinator.selectedSessionId
        : null;
    final selectedWorkspace = coordinator.selectedWorkspace;
    final selectedSessionMatches = coordinator.sessions.where(
      (item) => item.sessionId == sessionValue,
    );
    final selectedSession = selectedSessionMatches.isEmpty
        ? null
        : selectedSessionMatches.first;
    final policy = coordinator.activePolicyMode;
    final trustRequired = coordinator.requiresTrustApproval;
    return Card(
      key: const Key('workspace-session-card'),
      child: Padding(
        padding: const EdgeInsets.all(PiSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              spacing: PiSpacing.sm,
              runSpacing: PiSpacing.sm,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                FilledButton.tonalIcon(
                  key: const Key('open-workspace-picker'),
                  onPressed: coordinator.isReady ? _openWorkspacePicker : null,
                  icon: const Icon(Icons.folder_open),
                  label: Text(
                    selectedWorkspace == null
                        ? 'Choose workspace'
                        : 'Workspace: ${selectedWorkspace.displayName}',
                  ),
                ),
                FilledButton.tonalIcon(
                  key: const Key('create-session'),
                  onPressed: coordinator.isReady && workspaceValue != null
                      ? coordinator.createSession
                      : null,
                  icon: const Icon(Icons.add),
                  label: const Text('Create session'),
                ),
                SizedBox(
                  width: 300,
                  child: DropdownButtonFormField<String>(
                    key: const Key('session-select'),
                    isExpanded: true,
                    initialValue: sessionValue,
                    decoration: const InputDecoration(
                      labelText: 'Session',
                      border: OutlineInputBorder(),
                    ),
                    items: [
                      for (final session in coordinator.sessions)
                        DropdownMenuItem(
                          value: session.sessionId,
                          child: Text(
                            '${session.name} · ${sessionStateLabel(session.runtimeState)}',
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                    onChanged: (value) {
                      if (value != null) {
                        coordinator.selectPrimarySession(value);
                      }
                    },
                  ),
                ),
                Text(
                  'Controller: ${coordinator.leaseId == null ? 'observer' : 'acquired'}',
                ),
                FilledButton.tonalIcon(
                  key: const Key('open-session-controls'),
                  onPressed: coordinator.isReady && sessionValue != null
                      ? _openSessionControls
                      : null,
                  icon: const Icon(Icons.tune),
                  label: const Text('Pi controls'),
                ),
                if (coordinator.sessions.any(
                  (session) =>
                      session.sessionId == coordinator.selectedSessionId &&
                      const {
                        'crashed',
                        'crash_loop',
                        'provider_interrupted',
                        'indeterminate',
                      }.contains(session.runtimeState),
                ))
                  FilledButton.tonalIcon(
                    key: const Key('retry-pi-session'),
                    onPressed: coordinator.canRetrySession
                        ? coordinator.retrySession
                        : null,
                    icon: const Icon(Icons.restart_alt),
                    label: const Text('Retry Pi'),
                  ),
              ],
            ),
            if (coordinator.isReady &&
                selectedSession != null &&
                coordinator.leaseId == null) ...[
              const SizedBox(height: PiSpacing.sm),
              ObserverBanner(
                data: session_ui.ObserverBannerViewData(
                  session: session_ui.SessionSummaryData(
                    sessionId: selectedSession.sessionId,
                    displayName: selectedSession.name,
                    workspaceLabel: selectedWorkspace?.displayName,
                    runtime: session_ui.SessionRuntime.fromLabel(
                      selectedSession.runtimeState,
                    ),
                    attention: selectedSession.unreadState == 'needs_attention'
                        ? session_ui.SessionAttention.attention
                        : session_ui.SessionAttention.none,
                    background: session_ui.SessionBackground.foreground,
                    lastActivityAt: selectedSession.lastActivityAt,
                  ),
                  reason: session_ui.ObserverReason.anotherClient,
                  controllerClientName: 'Another connected device',
                ),
                callbacks: session_ui.ObserverBannerCallbacks(
                  onTakeControl: (session) =>
                      unawaited(coordinator.takeControl(session.sessionId)),
                ),
              ),
            ],
            const SizedBox(height: PiSpacing.sm),
            PolicyModeRow(
              coordinator: coordinator,
              mode: policy,
              enabled: coordinator.isReady && sessionValue != null,
            ),
            if (trustRequired) ...[
              const SizedBox(height: PiSpacing.sm),
              TrustRequiredBanner(
                entry: selectedWorkspace,
                onReview: _openTrustReviewForSelected,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
