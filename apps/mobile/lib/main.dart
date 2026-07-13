import 'dart:async';

import 'package:flutter/material.dart';

import 'src/connection/bridge_transport.dart';
import 'src/connection/connection_coordinator.dart';
import 'src/data/app_database.dart';
import 'src/domain/mobile_state.dart';
import 'src/pairing/pairing_payload.dart';
import 'src/pairing/pairing_screen.dart';
import 'src/workspaces/workspace_picker.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final database = AppDatabase();
  final coordinator = ConnectionCoordinator(
    transport: IoBridgeTransport(),
    database: database,
  );
  await coordinator.initialize();
  runApp(PiMobApp(coordinator: coordinator));
}

class PiMobApp extends StatelessWidget {
  const PiMobApp({required this.coordinator, super.key});

  final ConnectionCoordinator coordinator;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'pi-mob diagnostic',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple),
        useMaterial3: true,
      ),
      home: _HomeRouter(coordinator: coordinator),
    );
  }
}

/// Routes between the pairing screen and the diagnostic home. When a host is
/// already paired (a hostId was loaded during coordinator initialization) the
/// diagnostic home is shown; otherwise the pairing screen is displayed. After
/// a successful pair, the app switches to the diagnostic home and provides a
/// visible "Forget host" action so the user can re-enter the pairing flow.
class _HomeRouter extends StatefulWidget {
  const _HomeRouter({required this.coordinator});

  final ConnectionCoordinator coordinator;

  @override
  State<_HomeRouter> createState() => _HomeRouterState();
}

class _HomeRouterState extends State<_HomeRouter> {
  late bool _paired;

  @override
  void initState() {
    super.initState();
    _paired = widget.coordinator.hostId != null;
    widget.coordinator.addListener(_onCoordinatorChanged);
  }

  void _onCoordinatorChanged() {
    if (!mounted) return;
    final nextPaired = widget.coordinator.hostId != null;
    if (nextPaired != _paired) {
      setState(() {
        _paired = nextPaired;
      });
    }
  }

  @override
  void dispose() {
    widget.coordinator.removeListener(_onCoordinatorChanged);
    super.dispose();
  }

  Future<void> _handlePair(PairingPayload payload) async {
    // Drive the existing M5+ connection path so the bridge hello handshake
    // can fill in hostId and hostDisplayName. The pairing screen has already
    // validated the payload and confirmed the user; persistence happens
    // through the coordinator.
    await widget.coordinator.connect(payload.endpoint.toString());
  }

  Future<void> _handleForget() async {
    await widget.coordinator.forgetHost();
  }

  @override
  Widget build(BuildContext context) {
    if (!_paired) {
      return PairingScreen(
        key: const ValueKey('pairing-screen'),
        onPair: _handlePair,
        onForgetHost: _handleForget,
        allowForgetWhenUnpaired: false,
      );
    }
    return DiagnosticHome(
      key: const ValueKey('diagnostic-home'),
      coordinator: widget.coordinator,
      onForgetHost: _handleForget,
    );
  }
}

class DiagnosticHome extends StatefulWidget {
  const DiagnosticHome({
    required this.coordinator,
    required this.onForgetHost,
    super.key,
  });

  final ConnectionCoordinator coordinator;
  final Future<void> Function() onForgetHost;

  @override
  State<DiagnosticHome> createState() => _DiagnosticHomeState();
}

class _DiagnosticHomeState extends State<DiagnosticHome> {
  late final TextEditingController _endpointController;
  late final TextEditingController _draftController;

  @override
  void initState() {
    super.initState();
    _endpointController = TextEditingController(
      text: widget.coordinator.endpoint?.toString() ?? '',
    );
    _draftController = TextEditingController(text: widget.coordinator.draft);
    widget.coordinator.addListener(_coordinatorChanged);
  }

  @override
  void didUpdateWidget(covariant DiagnosticHome oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.coordinator != widget.coordinator) {
      oldWidget.coordinator.removeListener(_coordinatorChanged);
      widget.coordinator.addListener(_coordinatorChanged);
      _coordinatorChanged();
    }
  }

  void _coordinatorChanged() {
    if (!mounted) return;
    final remoteDraft = widget.coordinator.draft;
    if (_draftController.text != remoteDraft) {
      _draftController.value = TextEditingValue(
        text: remoteDraft,
        selection: TextSelection.collapsed(offset: remoteDraft.length),
      );
    }
    setState(() {});
  }

  @override
  void dispose() {
    widget.coordinator.removeListener(_coordinatorChanged);
    _endpointController.dispose();
    _draftController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final coordinator = widget.coordinator;
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('pi-mob M7 diagnostic'),
        actions: [
          IconButton(
            key: const Key('forget-host-button'),
            tooltip: 'Forget this host and re-pair',
            onPressed: () => widget.onForgetHost(),
            icon: const Icon(Icons.link_off),
          ),
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: Center(
              child: Badge(
                backgroundColor: coordinator.isReady
                    ? Colors.green
                    : colors.error,
                label: Text(coordinator.phase.name),
              ),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _ConnectionPanel(
                coordinator: coordinator,
                endpointController: _endpointController,
              ),
              const SizedBox(height: 8),
              _WorkspaceSessionPanel(coordinator: coordinator),
              const SizedBox(height: 8),
              Expanded(child: _EventPanel(coordinator: coordinator)),
              const SizedBox(height: 8),
              _Composer(
                coordinator: coordinator,
                draftController: _draftController,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ConnectionPanel extends StatelessWidget {
  const _ConnectionPanel({
    required this.coordinator,
    required this.endpointController,
  });

  final ConnectionCoordinator coordinator;
  final TextEditingController endpointController;

  @override
  Widget build(BuildContext context) {
    final probe = coordinator.readiness;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('endpoint-field'),
                    controller: endpointController,
                    autocorrect: false,
                    keyboardType: TextInputType.url,
                    decoration: const InputDecoration(
                      labelText: 'HTTPS endpoint',
                      hintText: 'https://host.tailnet.ts.net',
                      border: OutlineInputBorder(),
                    ),
                    onSubmitted: coordinator.connect,
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton.icon(
                  key: const Key('connect-button'),
                  onPressed: () => coordinator.connect(endpointController.text),
                  icon: const Icon(Icons.wifi_find),
                  label: const Text('Probe & connect'),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 12,
              runSpacing: 4,
              children: [
                Text(
                  'State: ${coordinator.phase.name}',
                  key: const Key('connection-state'),
                ),
                Text('Ready: ${probe?.ready ?? false}'),
                Text('HTTP: ${probe?.statusCode ?? '—'}'),
                Text('Host: ${coordinator.hostDisplayName ?? '—'}'),
                Text('Bridge: ${coordinator.bridgeVersion ?? '—'}'),
                Text('Pi: ${coordinator.piVersion ?? '—'}'),
                Text('Protocol: ${coordinator.protocolVersion}'),
                Text('Generation: ${coordinator.hostGeneration ?? '—'}'),
              ],
            ),
            if (coordinator.errorMessage != null) ...[
              const SizedBox(height: 6),
              SelectableText(
                coordinator.errorMessage!,
                key: const Key('connection-error'),
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
            if (!coordinator.isReady && coordinator.endpoint != null)
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  key: const Key('retry-connection'),
                  onPressed: coordinator.retryConnection,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Retry connection'),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _WorkspaceSessionPanel extends StatefulWidget {
  const _WorkspaceSessionPanel({required this.coordinator});

  final ConnectionCoordinator coordinator;

  @override
  State<_WorkspaceSessionPanel> createState() => _WorkspaceSessionPanelState();
}

class _WorkspaceSessionPanelState extends State<_WorkspaceSessionPanel> {
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

  Future<void> _openTrustReviewForSelected() async {
    final selected = widget.coordinator.selectedWorkspace;
    if (selected == null) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => _InlineTrustReview(
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
    final policy = coordinator.activePolicyMode;
    final trustRequired = coordinator.requiresTrustApproval;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 8,
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
                      if (value != null) coordinator.selectSession(value);
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
            const SizedBox(height: 8),
            _PolicyModeRow(
              coordinator: coordinator,
              mode: policy,
              enabled: coordinator.isReady && sessionValue != null,
            ),
            if (trustRequired) ...[
              const SizedBox(height: 8),
              _TrustRequiredBanner(
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

/// Inline trust review surface reachable from the trust-required banner.
/// Mirrors the picker dialog but is opened from the session panel directly
/// when the workspace requires approval before any prompt can be sent.
class _InlineTrustReview extends StatelessWidget {
  const _InlineTrustReview({required this.entry, required this.onApprove});

  final WorkspaceEntry entry;
  final Future<void> Function() onApprove;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    return AlertDialog(
      key: const Key('inline-trust-review'),
      title: const Text('Approve workspace trust'),
      content: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(entry.displayName, style: text.titleMedium),
            Text('Root: ${entry.rootLabel}'),
            Text('Relative path: ${entry.relativePath}'),
            const SizedBox(height: 8),
            Text('Resource fingerprint', style: text.labelLarge),
            SelectableText(
              entry.fingerprint,
              key: const Key('inline-trust-fingerprint'),
              style: text.bodySmall?.copyWith(fontFamily: 'monospace'),
            ),
            Text('Policy version: ${entry.policyVersion}'),
            const SizedBox(height: 8),
            Text('Resource manifest', style: text.labelLarge),
            if (entry.manifest.isEmpty)
              const Text('(host reported no manifest lines)')
            else
              for (final r in entry.manifest)
                Text(
                  '${r.kind}\t${r.relativePath}'
                  '${r.sizeBytes == null ? '' : '\t${r.sizeBytes}B'}',
                ),
            const SizedBox(height: 12),
            Container(
              key: const Key('inline-trust-guardrail-note'),
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: colors.errorContainer,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                'This is a product guardrail enforced through Pi tool hooks. '
                'It is not an OS sandbox. Pi may still attempt operations the '
                'host allows at the file-system layer.',
                style: text.bodySmall?.copyWith(color: colors.onErrorContainer),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          key: const Key('inline-trust-cancel'),
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: const Key('inline-trust-approve'),
          onPressed: () => unawaited(onApprove()),
          child: const Text('Approve'),
        ),
      ],
    );
  }
}

class _TrustRequiredBanner extends StatelessWidget {
  const _TrustRequiredBanner({required this.entry, required this.onReview});

  final WorkspaceEntry? entry;
  final VoidCallback onReview;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final isFingerprintChanged =
        entry?.trustState == WorkspaceTrustState.fingerprintChanged;
    final unavailable = entry?.availability != WorkspaceAvailability.available;
    final message = unavailable
        ? 'This workspace is unavailable on the host. Pick another to send.'
        : isFingerprintChanged
        ? 'Resource fingerprint changed. Re-review and re-approve before sending.'
        : 'Workspace trust approval required. Pi will refuse mutation until you '
              'approve the resource manifest and fingerprint.';
    return Container(
      key: const Key('trust-required-banner'),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.errorContainer,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(message, style: TextStyle(color: colors.onErrorContainer)),
          const SizedBox(height: 4),
          Text(
            'Trust approval is a guardrail, not an OS sandbox.',
            style: TextStyle(color: colors.onErrorContainer),
          ),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton.tonalIcon(
              key: const Key('trust-required-review'),
              onPressed: onReview,
              icon: const Icon(Icons.verified_user),
              label: const Text('Review and approve'),
            ),
          ),
        ],
      ),
    );
  }
}

class _PolicyModeRow extends StatelessWidget {
  const _PolicyModeRow({
    required this.coordinator,
    required this.mode,
    required this.enabled,
  });

  final ConnectionCoordinator coordinator;
  final SessionPolicyMode mode;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Row(
      children: [
        Text('Policy: ', key: const Key('policy-mode-label')),
        SegmentedButton<SessionPolicyMode>(
          key: const Key('policy-mode-toggle'),
          segments: const [
            ButtonSegment(
              value: SessionPolicyMode.full,
              label: Text('Full'),
              icon: Icon(Icons.shield),
            ),
            ButtonSegment(
              value: SessionPolicyMode.readOnly,
              label: Text('Read-only'),
              icon: Icon(Icons.visibility),
            ),
          ],
          selected: {mode},
          onSelectionChanged: enabled
              ? (next) {
                  if (next.isEmpty) return;
                  unawaited(coordinator.setSessionPolicy(next.first));
                }
              : null,
        ),
        const SizedBox(width: 12),
        if (mode == SessionPolicyMode.readOnly)
          Container(
            key: const Key('read-only-indicator'),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: colors.tertiaryContainer,
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              'Read-only',
              style: TextStyle(color: colors.onTertiaryContainer),
            ),
          ),
      ],
    );
  }
}

class _EventPanel extends StatelessWidget {
  const _EventPanel({required this.coordinator});

  final ConnectionCoordinator coordinator;

  @override
  Widget build(BuildContext context) {
    final events = coordinator.rawEvents;
    final notices = coordinator.toolOutputNotices;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
            child: Text(
              'Raw protocol events (${events.length})',
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ),
          if (notices.any((notice) => notice.isTruncated)) ...[
            const Divider(height: 1),
            for (final notice in notices.where((notice) => notice.isTruncated))
              ListTile(
                key: Key('tool-output-${notice.toolCallId}'),
                leading: const Icon(Icons.content_cut),
                title: const Text('Tool output truncated'),
                subtitle: Text(
                  '${notice.retainedBytes} of ${notice.totalBytes} bytes retained'
                  '${notice.digest == null ? '' : '\nSHA-256 ${notice.digest}'}',
                ),
              ),
          ],
          const Divider(height: 1),
          Expanded(
            child: events.isEmpty
                ? const Center(child: Text('No events received'))
                : ListView.separated(
                    key: const Key('raw-event-list'),
                    reverse: true,
                    itemCount: events.length,
                    separatorBuilder: (_, _) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final event = events[events.length - index - 1];
                      return Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 7,
                        ),
                        child: SelectableText(
                          event,
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(fontFamily: 'monospace'),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({required this.coordinator, required this.draftController});

  final ConnectionCoordinator coordinator;
  final TextEditingController draftController;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (coordinator.pendingState == 'indeterminate' ||
                coordinator.selectedRuntimeState == 'indeterminate') ...[
              const Card(
                key: Key('indeterminate-warning'),
                color: Color(0xFFFFF3CD),
                child: Padding(
                  padding: EdgeInsets.all(10),
                  child: Text(
                    'Completion is unknown. The command will not run again automatically. Inspect the session before deciding what to do.',
                  ),
                ),
              ),
              const SizedBox(height: 8),
            ],
            TextField(
              key: const Key('draft-field'),
              controller: draftController,
              minLines: 2,
              maxLines: 5,
              decoration: const InputDecoration(
                labelText: 'Persistent prompt draft',
                border: OutlineInputBorder(),
              ),
              onChanged: (value) => unawaited(coordinator.updateDraft(value)),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                if (coordinator.pendingCommandId != null) ...[
                  Expanded(
                    child: Text(
                      'Pending ${coordinator.pendingState ?? 'unknown'} · '
                      '${coordinator.pendingCommandId}',
                      key: const Key('pending-command'),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  OutlinedButton.icon(
                    key: const Key('retry-command'),
                    onPressed: coordinator.canRetry
                        ? coordinator.retryPending
                        : null,
                    icon: const Icon(Icons.replay),
                    label: const Text('Retry exact command'),
                  ),
                  const SizedBox(width: 8),
                ] else
                  const Spacer(),
                OutlinedButton.icon(
                  key: const Key('abort-button'),
                  onPressed: coordinator.canAbort ? coordinator.abort : null,
                  icon: const Icon(Icons.stop),
                  label: const Text('Abort'),
                ),
                const SizedBox(width: 8),
                FilledButton.icon(
                  key: const Key('send-button'),
                  onPressed: coordinator.canSend
                      ? coordinator.submitPrompt
                      : null,
                  icon: const Icon(Icons.send),
                  label: Text(coordinator.isReady ? 'Send' : 'Send (offline)'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
