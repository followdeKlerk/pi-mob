import 'dart:async';

import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../../domain/mobile_state.dart';
import '../../interaction/interaction_panel.dart';
import '../theme/pi_theme.dart';
import 'model_picker_sheet.dart';

/// Prompt composer with delivery-mode selector, follow-up queue, extension
/// dialog opener, and the persistent draft `TextField`.
///
/// The composer is intentionally a single fixed-height surface anchored at the
/// bottom of the Activity destination. It owns its own `LiveRegion`
/// semantics node so screen-readers announce state transitions, and exposes
/// stable keys (`draft-field`, `send-button`, `retry-command`,
/// `delivery-mode-selector`, `open-extension-dialog`, `pending-command`) used
/// by downstream integrations.
class Composer extends StatelessWidget {
  const Composer({
    required this.coordinator,
    required this.draftController,
    required this.onOpenDialog,
    super.key,
  });

  final ConnectionCoordinator coordinator;
  final TextEditingController draftController;
  final VoidCallback onOpenDialog;

  Future<void> _clearDraft() async {
    draftController.clear();
    await coordinator.updateDraft('');
  }

  Future<void> _submitOrRunCommand(BuildContext context) async {
    if (coordinator.canAbort && coordinator.draft.trim().isEmpty) {
      await coordinator.abort();
      return;
    }
    final command = coordinator.draft.trim().toLowerCase();
    switch (command) {
      case '/model':
        await _clearDraft();
        if (context.mounted) await showModelPickerSheet(context, coordinator);
        return;
      case '/compact':
        await _clearDraft();
        await coordinator.compactNow();
        return;
      case '/export':
        await _clearDraft();
        await coordinator.requestSessionExport();
        return;
      case '/take-control':
      case '/takeover':
        await _clearDraft();
        final sessionId = coordinator.selectedSessionId;
        if (sessionId != null) {
          await coordinator.takeControl(sessionId);
        }
        return;
      case '/clone':
        await _clearDraft();
        final sessionId = coordinator.selectedSessionId;
        if (sessionId != null) {
          await coordinator.cloneSession(sessionId);
        }
        return;
      case '/restart':
      case '/recover':
        await _clearDraft();
        if (coordinator.canRetrySession) {
          await coordinator.retrySession();
        }
        return;
      default:
        await coordinator.submitPromptWithRecovery();
    }
  }

  List<_SlashCommand> _slashCommands() {
    final commands = <_SlashCommand>[
      const _SlashCommand(
        '/model',
        'Choose the model and thinking level',
        'Control',
      ),
      const _SlashCommand(
        '/compact',
        'Compact this session context',
        'Control',
      ),
      const _SlashCommand('/export', 'Export and share this chat', 'Chat'),
      const _SlashCommand(
        '/clone',
        'Clone this chat into a new session',
        'Chat',
      ),
      const _SlashCommand(
        '/take-control',
        'Take the controller lease',
        'Recovery',
      ),
      const _SlashCommand(
        '/restart',
        'Restart an unavailable Pi session',
        'Recovery',
      ),
      for (final command in coordinator.selectedControls?.commands ?? const [])
        _SlashCommand(
          '/${command.name}',
          command.description,
          switch (command.category) {
            'skill' => 'Skill',
            'template' => 'Template',
            _ => 'Extension',
          },
          requiresInput: command.requiresInput,
        ),
    ];
    final unique = <String, _SlashCommand>{};
    for (final command in commands) {
      unique.putIfAbsent(command.invocation.toLowerCase(), () => command);
    }
    return unique.values.toList(growable: false);
  }

  Future<void> _selectSlashCommand(
    BuildContext context,
    _SlashCommand command,
  ) async {
    if (command.invocation == '/model') {
      await _clearDraft();
      if (context.mounted) await showModelPickerSheet(context, coordinator);
      return;
    }
    final value = '${command.invocation}${command.requiresInput ? ' ' : ''}';
    draftController.value = TextEditingValue(
      text: value,
      selection: TextSelection.collapsed(offset: value.length),
    );
    await coordinator.updateDraft(value);
  }

  Future<void> _discardIndeterminate(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Discard uncertain message?'),
        content: const Text(
          'This message may already have completed. Discarding will not '
          'cancel or undo it. Pi will restart without sending it again, and '
          'you can compose a new message.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Keep'),
          ),
          FilledButton(
            key: const Key('confirm-discard-indeterminate'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Discard and continue'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await coordinator.discardIndeterminateAndContinue();
    }
  }

  @override
  Widget build(BuildContext context) {
    final prefill = coordinator.editorPrefill;
    final aborting = coordinator.canAbort && coordinator.draft.trim().isEmpty;
    final slashQuery = coordinator.draft.startsWith('/')
        ? coordinator.draft.toLowerCase()
        : null;
    if (prefill != null && draftController.text != prefill) {
      draftController.value = TextEditingValue(
        text: prefill,
        selection: TextSelection.collapsed(offset: prefill.length),
      );
    }
    return Card(
      key: const Key('composer-card'),
      child: Padding(
        padding: const EdgeInsets.all(PiSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (coordinator.pendingState == 'indeterminate' ||
                coordinator.selectedRuntimeState == 'indeterminate') ...[
              Card(
                key: const Key('indeterminate-warning'),
                color: Theme.of(context).colorScheme.errorContainer,
                child: Padding(
                  padding: const EdgeInsets.all(PiSpacing.md),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'Completion is unknown',
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          color: Theme.of(context).colorScheme.onErrorContainer,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: PiSpacing.xs),
                      Text(
                        'The previous message will not run again automatically.',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: Theme.of(context).colorScheme.onErrorContainer,
                        ),
                      ),
                      const SizedBox(height: PiSpacing.sm),
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(
                          key: const Key('discard-indeterminate'),
                          onPressed: () =>
                              unawaited(_discardIndeterminate(context)),
                          child: const Text('Discard and continue'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: PiSpacing.sm),
            ],
            if (coordinator.selectedRuntimeState == 'running') ...[
              Text(
                'Choose how to deliver while Pi is working',
                style: Theme.of(context).textTheme.labelLarge,
              ),
              const SizedBox(height: PiSpacing.sm),
              SegmentedButton<DeliveryMode>(
                key: const Key('delivery-mode-selector'),
                segments: const [
                  ButtonSegment(
                    value: DeliveryMode.steer,
                    label: Text('Steer'),
                  ),
                  ButtonSegment(
                    value: DeliveryMode.followUp,
                    label: Text('Follow up'),
                  ),
                ],
                emptySelectionAllowed: true,
                selected:
                    coordinator.selectedDeliveryMode == DeliveryMode.immediate
                    ? const <DeliveryMode>{}
                    : <DeliveryMode>{coordinator.selectedDeliveryMode},
                onSelectionChanged: (selection) {
                  unawaited(
                    coordinator.setSelectedDeliveryMode(
                      selection.isEmpty
                          ? DeliveryMode.immediate
                          : selection.first,
                    ),
                  );
                },
              ),
              const SizedBox(height: PiSpacing.sm),
            ],
            FollowUpQueuePanel(
              items: coordinator.selectedFollowUps,
              onRemove: (id) => unawaited(coordinator.removeFollowUp(id)),
              onClear: () => unawaited(coordinator.clearFollowUps()),
            ),
            if (coordinator.selectedFollowUps.isNotEmpty)
              const SizedBox(height: PiSpacing.sm),
            if (coordinator.draftAttachments.isNotEmpty) ...[
              Wrap(
                spacing: PiSpacing.xs,
                runSpacing: PiSpacing.xs,
                children: [
                  for (final attachment in coordinator.draftAttachments)
                    InputChip(
                      key: ValueKey('draft-attachment-${attachment.id}'),
                      avatar: const Icon(Icons.image_outlined, size: 18),
                      label: Text(attachment.filename),
                      onDeleted: () => unawaited(
                        coordinator.removeDraftAttachment(attachment.id),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: PiSpacing.sm),
            ],
            if (coordinator.selectedDialog != null) ...[
              FilledButton.tonalIcon(
                key: const Key('open-extension-dialog'),
                onPressed: onOpenDialog,
                icon: const Icon(Icons.open_in_new),
                label: Text(
                  'Open ${coordinator.selectedDialog!.method.name} request',
                ),
              ),
              const SizedBox(height: PiSpacing.sm),
            ],
            if (slashQuery != null && !slashQuery.contains(' ')) ...[
              Builder(
                builder: (context) {
                  final query = slashQuery.substring(1);
                  final matches = _slashCommands()
                      .where(
                        (command) =>
                            query.isEmpty ||
                            command.invocation.substring(1).contains(query) ||
                            command.description.toLowerCase().contains(query) ||
                            command.category.toLowerCase().contains(query),
                      )
                      .toList(growable: false);
                  return Container(
                    key: const Key('slash-command-list'),
                    constraints: const BoxConstraints(maxHeight: 260),
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.surfaceContainerLow,
                      border: Border.all(
                        color: Theme.of(context).colorScheme.outlineVariant,
                      ),
                      borderRadius: BorderRadius.circular(PiRadius.md),
                    ),
                    child: matches.isEmpty
                        ? const Padding(
                            padding: EdgeInsets.all(PiSpacing.md),
                            child: Text('No matching commands'),
                          )
                        : ListView.separated(
                            key: const Key('slash-command-results'),
                            shrinkWrap: true,
                            itemCount: matches.length,
                            separatorBuilder: (_, _) =>
                                const Divider(height: 1),
                            itemBuilder: (context, index) {
                              final command = matches[index];
                              return ListTile(
                                dense: true,
                                title: Text(command.invocation),
                                subtitle: Text(
                                  '${command.category} · ${command.description}',
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                onTap: () =>
                                    _selectSlashCommand(context, command),
                              );
                            },
                          ),
                  );
                },
              ),
              const SizedBox(height: PiSpacing.sm),
            ],
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                IconButton.filledTonal(
                  key: const Key('attach-image-button'),
                  tooltip: 'Attach image',
                  onPressed: coordinator.isReady
                      ? () async {
                          try {
                            await coordinator.pickAndUploadImage();
                          } on Object catch (error) {
                            if (context.mounted) {
                              ScaffoldMessenger.maybeOf(context)?.showSnackBar(
                                SnackBar(
                                  content: Text(
                                    'Could not attach image: $error',
                                  ),
                                ),
                              );
                            }
                          }
                        }
                      : null,
                  icon: const Icon(Icons.add_photo_alternate_outlined),
                ),
                const SizedBox(width: PiSpacing.sm),
                Expanded(
                  child: TextField(
                    key: const Key('draft-field'),
                    controller: draftController,
                    minLines: 1,
                    maxLines: 5,
                    keyboardType: TextInputType.multiline,
                    textInputAction: TextInputAction.newline,
                    decoration: const InputDecoration(
                      hintText: 'Message Pi',
                      border: OutlineInputBorder(),
                    ),
                    onChanged: (value) =>
                        unawaited(coordinator.updateDraft(value)),
                  ),
                ),
                const SizedBox(width: PiSpacing.sm),
                Tooltip(
                  message: aborting ? 'Abort' : 'Send',
                  child: Semantics(
                    button: true,
                    label: aborting ? 'Abort active Pi turn' : 'Send message',
                    child: SizedBox.square(
                      dimension: 52,
                      child: FilledButton(
                        key: const Key('send-button'),
                        style: FilledButton.styleFrom(
                          padding: EdgeInsets.zero,
                          shape: const CircleBorder(),
                        ),
                        onPressed: aborting || coordinator.canAttemptSend
                            ? () => _submitOrRunCommand(context)
                            : null,
                        child: Icon(aborting ? Icons.stop : Icons.send),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            Semantics(
              liveRegion: true,
              label: coordinator.pendingCommandId == null
                  ? 'Composer ready'
                  : 'Prompt ${coordinator.pendingState ?? 'pending'}',
              child: const SizedBox.shrink(),
            ),
            if (coordinator.pendingCommandId != null) ...[
              const SizedBox(height: PiSpacing.sm),
              Text(
                'Pending ${coordinator.pendingState ?? 'unknown'} · '
                '${coordinator.pendingCommandId}',
                key: const Key('pending-command'),
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: PiSpacing.sm),
              Align(
                alignment: Alignment.centerRight,
                child: OutlinedButton.icon(
                  key: const Key('retry-command'),
                  onPressed: coordinator.canRetry
                      ? coordinator.retryPending
                      : null,
                  icon: const Icon(Icons.replay),
                  label: const Text('Retry exact command'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _SlashCommand {
  const _SlashCommand(
    this.invocation,
    this.description,
    this.category, {
    this.requiresInput = false,
  });

  final String invocation;
  final String description;
  final String category;
  final bool requiresInput;
}
