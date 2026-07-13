import 'dart:async';

import 'package:flutter/material.dart';

import 'src/connection/bridge_transport.dart';
import 'src/connection/connection_coordinator.dart';
import 'src/data/app_database.dart';
import 'src/domain/mobile_state.dart';

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
      home: DiagnosticHome(coordinator: coordinator),
    );
  }
}

class DiagnosticHome extends StatefulWidget {
  const DiagnosticHome({required this.coordinator, super.key});

  final ConnectionCoordinator coordinator;

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
        title: const Text('pi-mob M5 diagnostic'),
        actions: [
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

class _WorkspaceSessionPanel extends StatelessWidget {
  const _WorkspaceSessionPanel({required this.coordinator});

  final ConnectionCoordinator coordinator;

  @override
  Widget build(BuildContext context) {
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
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Wrap(
          spacing: 8,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            SizedBox(
              width: 260,
              child: DropdownButtonFormField<String>(
                key: const Key('workspace-select'),
                isExpanded: true,
                initialValue: workspaceValue,
                decoration: const InputDecoration(
                  labelText: 'Workspace',
                  border: OutlineInputBorder(),
                ),
                items: [
                  for (final workspace in coordinator.workspaces)
                    DropdownMenuItem(
                      value: workspace.workspaceId,
                      child: Text(
                        workspace.displayName,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
                onChanged: (value) {
                  if (value != null) coordinator.selectWorkspace(value);
                },
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
      ),
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
