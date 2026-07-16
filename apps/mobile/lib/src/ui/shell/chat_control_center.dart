import 'package:flutter/material.dart';

import '../../attachments/share_callback.dart';
import '../../connection/connection_coordinator.dart';
import '../../controls/compaction_controls.dart';
import '../../controls/context_stats_card.dart';
import '../../controls/control_view_data.dart' as view;
import '../../controls/model_thinking_selector.dart';
import '../../controls/retry_controls.dart';
import '../../controls/supported_command_list.dart';
import '../../domain/session_controls.dart' as domain;
import '../theme/pi_theme.dart';

Future<void> showChatControlCenter(
  BuildContext context,
  ConnectionCoordinator coordinator,
) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (_) => ChatControlCenter(coordinator: coordinator),
);

class ChatControlCenter extends StatefulWidget {
  const ChatControlCenter({required this.coordinator, super.key});
  final ConnectionCoordinator coordinator;

  @override
  State<ChatControlCenter> createState() => _ChatControlCenterState();
}

class _ChatControlCenterState extends State<ChatControlCenter> {
  @override
  void initState() {
    super.initState();
    widget.coordinator.addListener(_changed);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (widget.coordinator.isReady) widget.coordinator.requestModels();
    });
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    widget.coordinator.removeListener(_changed);
    super.dispose();
  }

  view.RetryPhase _retry(domain.RetryPhase phase) => switch (phase) {
    domain.RetryPhase.waiting => view.RetryPhase.scheduled,
    domain.RetryPhase.running => view.RetryPhase.retrying,
    domain.RetryPhase.aborted => view.RetryPhase.aborting,
    domain.RetryPhase.idle ||
    domain.RetryPhase.completed ||
    domain.RetryPhase.failed => view.RetryPhase.idle,
  };

  view.CompactionPhase _compaction(domain.CompactionPhase phase) =>
      switch (phase) {
        domain.CompactionPhase.running => view.CompactionPhase.compacting,
        domain.CompactionPhase.completed => view.CompactionPhase.completed,
        domain.CompactionPhase.failed => view.CompactionPhase.failed,
        domain.CompactionPhase.aborted => view.CompactionPhase.failed,
        domain.CompactionPhase.idle => view.CompactionPhase.idle,
      };

  view.SupportedCommandCategory _category(String value) => switch (value) {
    'skill' => view.SupportedCommandCategory.skill,
    'template' => view.SupportedCommandCategory.template,
    _ => view.SupportedCommandCategory.extension,
  };

  @override
  Widget build(BuildContext context) {
    final coordinator = widget.coordinator;
    final controls = coordinator.selectedControls;
    if (controls == null) {
      return const SafeArea(
        child: Padding(
          padding: EdgeInsets.all(PiSpacing.xl),
          child: Text('Select a chat to view controls.'),
        ),
      );
    }
    final runtime = coordinator.selectedRuntimeState;
    final mutable = runtime == null || runtime == 'idle' || runtime == 'stopped';
    final models = coordinator.configuredModels
        .where((model) => model.available)
        .map(
          (model) => view.ModelOptionData(
            id: model.id,
            label: model.label,
            provider: model.provider ?? 'Configured',
            thinkingLevels: const [
              'off',
              'minimal',
              'low',
              'medium',
              'high',
              'xhigh',
            ],
          ),
        )
        .toList(growable: false);
    final statsAvailable = controls.inputTokens != null ||
        controls.outputTokens != null ||
        controls.contextTokens != null ||
        controls.contextWindow != null ||
        controls.cost != null;
    final needsControlRefresh = models.isEmpty || !statsAvailable;
    final sessionTokens = controls.inputTokens == null &&
            controls.outputTokens == null
        ? null
        : (controls.inputTokens ?? 0) + (controls.outputTokens ?? 0);
    final commands = controls.commands
        .map(
          (command) => view.SupportedCommandData(
            id: command.name,
            title: '/${command.name}',
            category: _category(command.category),
            description: command.description,
            invocation: '/${command.name}${command.requiresInput ? ' ' : ''}',
          ),
        )
        .toList(growable: false);

    return SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * .88,
        child: CustomScrollView(
          key: const Key('chat-control-center'),
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(
                PiSpacing.md,
                0,
                PiSpacing.md,
                PiSpacing.xl,
              ),
              sliver: SliverList.list(
                children: [
                  Text(
                    'Session controls',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: PiSpacing.md),
                  if (needsControlRefresh)
                    Card(
                      color: Theme.of(context).colorScheme.secondaryContainer,
                      child: Padding(
                        padding: const EdgeInsets.all(PiSpacing.md),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Model or statistics snapshot unavailable',
                              style: TextStyle(fontWeight: FontWeight.w600),
                            ),
                            const SizedBox(height: PiSpacing.xs),
                            const Text(
                              'Pi reports configured models, token usage, context usage, and cost through its live session RPC. Imported or stopped chats may not have reported a snapshot yet. Once reported, the latest values are stored on this device; token and cost values remain estimates.',
                            ),
                            const SizedBox(height: PiSpacing.sm),
                            FilledButton.tonalIcon(
                              key: const Key('load-session-control-data'),
                              onPressed: coordinator.isReady
                                  ? coordinator.loadSessionControlData
                                  : null,
                              icon: const Icon(Icons.sync),
                              label: const Text('Load from Pi'),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ModelThinkingSelector(
                    data: view.ModelThinkingViewData(
                      models: models,
                      selectedModelId: controls.modelId,
                      selectedThinkingLevel: controls.thinkingLevel,
                      unavailableRestoredModel: controls.modelUnavailable
                          ? controls.modelId
                          : null,
                      enabled: mutable,
                      disabledReason: mutable
                          ? null
                          : 'Model controls are available when Pi is idle.',
                    ),
                    callbacks: view.ModelThinkingCallbacks(
                      onModelSelected: mutable ? coordinator.setModel : null,
                      onThinkingSelected: mutable
                          ? coordinator.setThinking
                          : null,
                    ),
                  ),
                  ContextStatsCard(
                    data: view.ContextStatsViewData(
                      sessionTokens: sessionTokens,
                      contextTokens: controls.contextTokens,
                      contextWindowTokens: controls.contextWindow,
                      costUsd: controls.cost,
                    ),
                  ),
                  CompactionControls(
                    data: view.CompactionViewData(
                      phase: _compaction(controls.compactionPhase),
                      autoCompact: controls.autoCompactionEnabled,
                      summary: controls.compactionSummary,
                      canStart: mutable,
                    ),
                    callbacks: view.CompactionCallbacks(
                      onAutoCompactChanged: coordinator.setAutoCompaction,
                      onStart: coordinator.compactNow,
                    ),
                  ),
                  RetryControls(
                    data: view.RetryViewData(
                      phase: _retry(controls.retryPhase),
                      autoRetry: controls.autoRetryEnabled,
                      remaining: controls.retryDelayMs == null
                          ? null
                          : Duration(milliseconds: controls.retryDelayMs!),
                      attempt: controls.retryAttempt,
                      maximumAttempts: controls.retryMaxAttempts,
                    ),
                    callbacks: view.RetryCallbacks(
                      onAutoRetryChanged: coordinator.setAutoRetry,
                      onAbort: coordinator.abortRetry,
                    ),
                  ),
                  if (coordinator.leaseId == null &&
                      coordinator.selectedSessionId != null)
                    Card(
                      child: ListTile(
                        key: const Key('control-center-take-control'),
                        leading: const Icon(Icons.control_camera_outlined),
                        title: const Text('Take control'),
                        subtitle: const Text(
                          'This device is observing. Your draft is preserved.',
                        ),
                        onTap: () => coordinator.takeControl(
                          coordinator.selectedSessionId!,
                        ),
                      ),
                    ),
                  if (coordinator.selectedSessionId != null)
                    Card(
                      child: ListTile(
                        key: const Key('control-center-clone-session'),
                        leading: const Icon(Icons.call_split_outlined),
                        title: const Text('Clone current branch'),
                        subtitle: const Text(
                          'Create a separate durable chat from this branch.',
                        ),
                        onTap: () => coordinator.cloneSession(
                          coordinator.selectedSessionId!,
                        ),
                      ),
                    ),
                  Card(
                    child: Column(
                      children: [
                        ListTile(
                          key: const Key('control-center-export-session'),
                          leading: const Icon(Icons.ios_share_outlined),
                          title: const Text('Export chat as HTML'),
                          subtitle: Text(
                            coordinator.latestExportState == null
                                ? 'Generate a private, expiring export'
                                : 'Export ${coordinator.latestExportState}',
                          ),
                          onTap: coordinator.latestExportState == 'pending'
                              ? null
                              : coordinator.requestSessionExport,
                        ),
                        if (coordinator.latestExportState == 'completed' &&
                            coordinator.latestExportId != null)
                          Padding(
                            padding: const EdgeInsets.fromLTRB(
                              PiSpacing.md,
                              0,
                              PiSpacing.md,
                              PiSpacing.md,
                            ),
                            child: FilledButton.tonalIcon(
                              onPressed: () async {
                                final path = await coordinator.downloadLatestExport();
                                await const PlatformNativeShareCallback().share(
                                  ShareRequest(
                                    exportId: coordinator.latestExportId!,
                                    fileName: 'pi-session.html',
                                    mimeType: 'text/html',
                                    byteSize: coordinator.latestExportBytes,
                                    localPath: path,
                                    text: 'Sharing leaves your private network.',
                                  ),
                                );
                              },
                              icon: const Icon(Icons.share_outlined),
                              label: const Text('Download and share'),
                            ),
                          ),
                      ],
                    ),
                  ),
                  if (coordinator.canRetrySession)
                    Card(
                      child: ListTile(
                        key: const Key('control-center-retry-pi'),
                        leading: const Icon(Icons.restart_alt),
                        title: const Text('Restart Pi for this chat'),
                        subtitle: Text(runtime ?? 'Session needs recovery'),
                        onTap: coordinator.retrySession,
                      ),
                    ),
                  if (coordinator.extensionStatus != null ||
                      coordinator.extensionTitle != null ||
                      coordinator.extensionWidgetText != null ||
                      coordinator.latestExtensionNotice != null)
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(PiSpacing.md),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              coordinator.extensionTitle ?? 'Extension activity',
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            if (coordinator.extensionStatus != null)
                              Text(coordinator.extensionStatus!),
                            if (coordinator.extensionWidgetText != null)
                              SelectableText(coordinator.extensionWidgetText!),
                            if (coordinator.latestExtensionNotice != null)
                              Text(coordinator.latestExtensionNotice!),
                          ],
                        ),
                      ),
                    ),
                  const SizedBox(height: PiSpacing.md),
                  Text(
                    'Commands',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: PiSpacing.sm),
                  if (commands.isEmpty)
                    const Card(
                      child: Padding(
                        padding: EdgeInsets.all(PiSpacing.md),
                        child: Text('No mobile-compatible commands reported.'),
                      ),
                    )
                  else
                    SupportedCommandList(
                      commands: commands,
                      onInvoke: (command) async {
                        await coordinator.updateDraft(command.invocation ?? '');
                        if (context.mounted) Navigator.of(context).pop();
                      },
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
