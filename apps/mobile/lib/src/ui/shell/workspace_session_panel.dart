import 'dart:async';

import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../../domain/mobile_state.dart';
import '../../sessions/observer_banner.dart';
import '../../sessions/session_view_data.dart' as session_ui;
import '../../workspaces/workspace_picker.dart';
import '../theme/pi_theme.dart';
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
      await widget.coordinator.selectWorkspaceEntry(selected);
    }
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

  WorkspaceEntry? _workspaceFor(String? workspaceId) {
    if (workspaceId == null) return null;
    for (final workspace in widget.coordinator.workspaces) {
      if (workspace.workspaceId == workspaceId) return workspace;
    }
    return null;
  }

  String _sessionLabel(SessionState session) {
    final folder = _workspaceFor(session.workspaceId);
    final folderLabel = folder?.relativePath == '.'
        ? folder?.displayName
        : folder?.relativePath;
    final rawName = session.name.trim();
    final name = rawName.isEmpty || rawName == 'Session'
        ? (folderLabel ?? 'Session')
        : rawName;
    final shortId = session.sessionId.substring(0, 6);
    final context = folderLabel == null || folderLabel == name
        ? '#$shortId'
        : folderLabel;
    return '$name · $context · ${sessionStateLabel(session.runtimeState)}';
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
    final selectedSessionWorkspace = _workspaceFor(
      selectedSession?.workspaceId,
    );
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
                        ? 'Choose folder'
                        : 'Folder: ${selectedWorkspace.relativePath == '.' ? selectedWorkspace.displayName : selectedWorkspace.relativePath}',
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
                            _sessionLabel(session),
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
            if (selectedSession != null) ...[
              const SizedBox(height: PiSpacing.sm),
              Text(
                'Folder: ${selectedSessionWorkspace?.relativePath ?? selectedSessionWorkspace?.displayName ?? 'Unavailable'}  •  ${sessionStateLabel(selectedSession.runtimeState)}  •  #${selectedSession.sessionId.substring(0, 6)}',
                key: const Key('selected-session-context'),
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
            ],
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
