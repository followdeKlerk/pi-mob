import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../connection/connection_coordinator.dart';
import '../../domain/prompt_send_lifecycle.dart';
import '../../interaction/interaction_panel.dart';
import '../theme/pi_theme.dart';
import 'shortcut_intents.dart';
import 'motion_primitives.dart';

/// Prompt composer with delivery-mode selector, follow-up queue, extension
/// dialog opener, and the persistent draft `TextField`.
///
/// The composer is intentionally a single fixed-height surface anchored at the
/// bottom of the Activity destination. It owns its own `LiveRegion`
/// semantics node so screen-readers announce state transitions, and exposes
/// stable keys (`draft-field`, `send-button`, `prompt-send-action`,
/// `delivery-mode-selector`, and `open-extension-dialog`) used by downstream
/// integrations.
class Composer extends StatelessWidget {
  const Composer({
    required this.coordinator,
    required this.draftController,
    required this.onOpenDialog,
    this.onSubmit,
    super.key,
  });

  final ConnectionCoordinator coordinator;
  final TextEditingController draftController;
  final VoidCallback onOpenDialog;
  final Future<void> Function(BuildContext context)? onSubmit;

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

  bool get _isComposing {
    final composing = draftController.value.composing;
    return composing.isValid && !composing.isCollapsed;
  }

  void _handleSendShortcut(BuildContext context) {
    if (_isComposing ||
        !(HardwareKeyboard.instance.isControlPressed ||
            HardwareKeyboard.instance.isMetaPressed)) {
      return;
    }
    final submit = onSubmit;
    if (submit != null) {
      unawaited(submit(context));
      return;
    }
    if (coordinator.canAbort || coordinator.canAttemptSend) {
      unawaited(_submitOrRunCommand(context));
    }
  }

  List<_SlashCommand> _slashCommands() {
    final commands = <_SlashCommand>[
      const _SlashCommand(
        '/model',
        'Change the model using Pi command syntax',
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
    final value = '${command.invocation}${command.requiresInput ? ' ' : ''}';
    draftController.value = TextEditingValue(
      text: value,
      selection: TextSelection.collapsed(offset: value.length),
    );
    await coordinator.updateDraft(value);
  }

  Future<void> _handlePromptFailureAction(
    BuildContext context,
    PromptSendFailure failure,
  ) async {
    switch (failure.action) {
      case PromptFailureAction.retry:
      case PromptFailureAction.takeControl:
        await coordinator.retryPending();
        return;
      case PromptFailureAction.reconnect:
        await coordinator.reconnectForPrompt();
        return;
      case PromptFailureAction.approveWorkspace:
        // Phase 4: bridge-owned workspace trust approval is gone.
        // Pi's own project-resource trust system applies at the Pi
        // layer. Surface a transient notice so the user can retry.
        if (context.mounted) {
          ScaffoldMessenger.maybeOf(context)?.showSnackBar(
            const SnackBar(
              content: Text('Workspace trust approval is no longer required.'),
            ),
          );
        }
        return;
      case PromptFailureAction.discardUncertain:
        // Uncertain completion is intentionally non-blocking. The connected
        // composer remains usable and the next prompt may be sent.
        return;
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge(<Listenable>[coordinator, draftController]),
      builder: (context, _) => _build(context),
    );
  }

  Widget _build(BuildContext context) {
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
    return Shortcuts(
      shortcuts: const <ShortcutActivator, Intent>{
        SingleActivator(LogicalKeyboardKey.enter, control: true):
            SubmitComposerIntent(),
        SingleActivator(LogicalKeyboardKey.enter, meta: true):
            SubmitComposerIntent(),
      },
      child: Actions(
        actions: <Type, Action<Intent>>{
          SubmitComposerIntent: CallbackAction<SubmitComposerIntent>(
            onInvoke: (_) => _handleSendShortcut(context),
          ),
        },
        child: Card(
          key: const Key('composer-card'),
          child: Padding(
            padding: const EdgeInsets.all(PiSpacing.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (const {
                  PromptSendPhase.acquiringControl,
                  PromptSendPhase.submitting,
                  PromptSendPhase.failed,
                }.contains(coordinator.promptSendStatus.phase)) ...[
                  _PromptSendFeedback(
                    status: coordinator.promptSendStatus,
                    onAction: (failure) =>
                        _handlePromptFailureAction(context, failure),
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
                                command.invocation
                                    .substring(1)
                                    .contains(query) ||
                                command.description.toLowerCase().contains(
                                  query,
                                ) ||
                                command.category.toLowerCase().contains(query),
                          )
                          .toList(growable: false);
                      return Container(
                        key: const Key('slash-command-list'),
                        constraints: const BoxConstraints(maxHeight: 260),
                        decoration: BoxDecoration(
                          color: Theme.of(
                            context,
                          ).colorScheme.surfaceContainerLow,
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
                                  return Material(
                                    color: Colors.transparent,
                                    child: ListTile(
                                      dense: true,
                                      title: Text(command.invocation),
                                      subtitle: Text(
                                        '${command.category} · ${command.description}',
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                      onTap: () =>
                                          _selectSlashCommand(context, command),
                                    ),
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
                                  ScaffoldMessenger.maybeOf(
                                    context,
                                  )?.showSnackBar(
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
                        label: aborting
                            ? 'Abort active Pi turn'
                            : 'Send message',
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
                  label: _promptSemanticLabel(coordinator.promptSendStatus),
                  child: const SizedBox.shrink(),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

String _promptSemanticLabel(PromptSendStatus status) => switch (status.phase) {
  PromptSendPhase.ready => 'Composer ready',
  PromptSendPhase.acquiringControl => 'Getting control of this chat',
  PromptSendPhase.submitting => 'Sending message',
  PromptSendPhase.accepted => 'Message accepted',
  PromptSendPhase.running => 'Message is running',
  PromptSendPhase.failed =>
    'Message failed: ${status.failure?.message ?? 'Unknown failure'}',
  PromptSendPhase.indeterminate => 'Message completion is unknown',
};

class _PromptSendFeedback extends StatelessWidget {
  const _PromptSendFeedback({required this.status, required this.onAction});

  final PromptSendStatus status;
  final Future<void> Function(PromptSendFailure failure) onAction;

  @override
  Widget build(BuildContext context) {
    final failure = status.failure;
    final failed = status.phase == PromptSendPhase.failed;
    final colors = Theme.of(context).colorScheme;
    final title = switch (status.phase) {
      PromptSendPhase.acquiringControl => 'Getting control of this chat…',
      PromptSendPhase.submitting => 'Sending…',
      PromptSendPhase.accepted => 'Message accepted',
      PromptSendPhase.running => 'Pi is responding',
      PromptSendPhase.failed => 'Message not sent',
      _ => 'Message status',
    };
    return Semantics(
      liveRegion: true,
      container: true,
      label: _promptSemanticLabel(status),
      child: Container(
        key: Key('prompt-send-${status.phase.name}'),
        padding: const EdgeInsets.all(PiSpacing.sm),
        decoration: BoxDecoration(
          color: failed ? colors.errorContainer : colors.secondaryContainer,
          borderRadius: BorderRadius.circular(PiRadius.sm),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            if (status.isBusy)
              MotionSpinner(strokeWidth: 2, dimension: 18, label: title)
            else
              Icon(
                failed ? Icons.error_outline : Icons.check_circle_outline,
                size: 18,
                color: failed
                    ? colors.onErrorContainer
                    : colors.onSecondaryContainer,
              ),
            const SizedBox(width: PiSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    title,
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      color: failed
                          ? colors.onErrorContainer
                          : colors.onSecondaryContainer,
                    ),
                  ),
                  if (failure != null)
                    Text(
                      failure.message,
                      key: const Key('prompt-send-failure-message'),
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: colors.onErrorContainer,
                      ),
                    ),
                ],
              ),
            ),
            if (failure != null)
              TextButton(
                key: const Key('prompt-send-action'),
                onPressed: () => unawaited(onAction(failure)),
                child: Text(switch (failure.action) {
                  PromptFailureAction.retry => 'Retry',
                  PromptFailureAction.takeControl => 'Take control',
                  PromptFailureAction.reconnect => 'Reconnect',
                  PromptFailureAction.approveWorkspace => 'Review workspace',
                  PromptFailureAction.discardUncertain => 'Discard',
                }),
              ),
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
