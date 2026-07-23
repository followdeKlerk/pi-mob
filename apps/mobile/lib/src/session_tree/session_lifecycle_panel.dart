import 'package:flutter/material.dart';

import '../ui/theme/pi_tokens.dart';
import '../ui/shell/motion_primitives.dart';

import 'session_tree_view_data.dart';

/// Accessible lifecycle/details surface for rename, recoverable delete,
/// restore, repair, and separately guarded irreversible purge.
class SessionLifecyclePanel extends StatelessWidget {
  const SessionLifecyclePanel({
    required this.data,
    required this.callbacks,
    super.key,
  });

  final SessionLifecycleViewData data;
  final SessionLifecycleCallbacks callbacks;

  bool get _actionsAllowed => data.actionsEnabled && !data.isBusy;

  Future<void> _showRename(BuildContext context) async {
    final controller = TextEditingController(
      text: data.identity.customName ?? '',
    );
    final request = await showDialog<SessionRenameRequest>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        key: const Key('session-rename-dialog'),
        title: const Text('Rename session'),
        content: TextField(
          key: const Key('session-rename-field'),
          controller: controller,
          autofocus: true,
          maxLength: 120,
          textInputAction: TextInputAction.done,
          decoration: InputDecoration(
            labelText: 'Session name',
            helperText: 'Leave empty to use: ${data.identity.fallbackName}',
          ),
          onSubmitted: (_) {
            final trimmed = controller.text.trim();
            Navigator.of(
              dialogContext,
            ).pop(SessionRenameRequest(trimmed.isEmpty ? null : trimmed));
          },
        ),
        actions: [
          TextButton(
            key: const Key('session-rename-cancel'),
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const Key('session-rename-save'),
            onPressed: callbacks.onRename == null
                ? null
                : () {
                    final trimmed = controller.text.trim();
                    Navigator.of(dialogContext).pop(
                      SessionRenameRequest(trimmed.isEmpty ? null : trimmed),
                    );
                  },
            child: const Text('Save name'),
          ),
        ],
      ),
    );
    if (request != null) callbacks.onRename?.call(request);
  }

  Future<void> _confirmSoftDelete(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        key: const Key('session-delete-dialog'),
        icon: const Icon(Icons.delete_outline),
        title: Text('Move ${data.identity.displayName} to Trash?'),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              _Fact(label: 'Workspace', value: data.identity.workspaceLabel),
              _Fact(
                label: 'Process',
                value: data.hasActiveProcess
                    ? 'Active process will stop'
                    : 'No active process',
              ),
              _Fact(
                label: 'Queued prompts',
                value: data.queuedPromptCount == 0
                    ? 'None'
                    : '${data.queuedPromptCount} will be cancelled',
              ),
              const SizedBox(height: 12),
              const Text(
                'This is a soft delete. You can restore the session for seven '
                'days before its scheduled purge.',
              ),
              if (data.hasActiveTurn) ...[
                const SizedBox(height: 12),
                Semantics(
                  liveRegion: true,
                  label: 'Active turn will be aborted before deletion.',
                  child: Material(
                    color: Theme.of(context).colorScheme.errorContainer,
                    borderRadius: BorderRadius.circular(PiRadius.md),
                    child: const Padding(
                      padding: EdgeInsets.all(PiSpacing.sm),
                      child: Text(
                        'Step 1: abort the active turn. '
                        'Step 2: move the settled session to Trash. '
                        'Deletion starts only after the abort is confirmed.',
                      ),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
        actions: [
          TextButton(
            key: const Key('session-delete-cancel'),
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Keep session'),
          ),
          FilledButton(
            key: const Key('session-delete-confirm'),
            onPressed: callbacks.onSoftDelete == null
                ? null
                : () => Navigator.of(dialogContext).pop(true),
            child: Text(
              data.hasActiveTurn ? 'Abort, then delete' : 'Move to Trash',
            ),
          ),
        ],
      ),
    );
    if (!(confirmed ?? false)) return;
    callbacks.onSoftDelete?.call();
    if (!context.mounted || callbacks.onUndoDelete == null) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          key: const Key('session-delete-undo-snackbar'),
          content: const Text('Session moved to Trash.'),
          action: SnackBarAction(
            key: const Key('session-delete-undo'),
            label: 'Undo',
            onPressed: callbacks.onUndoDelete!,
          ),
        ),
      );
  }

  Future<void> _confirmPermanentDelete(BuildContext context) async {
    final confirmationController = TextEditingController();
    var matches = false;
    final confirmed = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          key: const Key('session-purge-dialog'),
          icon: Icon(
            Icons.warning_amber,
            color: Theme.of(context).colorScheme.error,
          ),
          title: const Text('Permanently delete session?'),
          content: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '${data.identity.displayName} and its remaining durable '
                  'session material will be deleted.',
                ),
                const SizedBox(height: 8),
                const Text(
                  'This cannot be undone. The stable session ID will never be reused.',
                ),
                const SizedBox(height: 12),
                TextField(
                  key: const Key('session-purge-confirmation-field'),
                  controller: confirmationController,
                  autofocus: true,
                  autocorrect: false,
                  decoration: const InputDecoration(
                    labelText: 'Type DELETE to confirm',
                    border: OutlineInputBorder(),
                  ),
                  onChanged: (value) =>
                      setDialogState(() => matches = value == 'DELETE'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              key: const Key('session-purge-cancel'),
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              key: const Key('session-purge-confirm'),
              onPressed: matches && callbacks.onPermanentDelete != null
                  ? () => Navigator.of(dialogContext).pop(true)
                  : null,
              style: FilledButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.error,
              ),
              child: const Text('Delete permanently'),
            ),
          ],
        ),
      ),
    );
    if (confirmed ?? false) callbacks.onPermanentDelete?.call();
  }

  @override
  Widget build(BuildContext context) {
    final identity = data.identity;
    return Semantics(
      container: true,
      label: 'Session details and lifecycle for ${identity.displayName}',
      child: Card(
        key: const Key('session-lifecycle-panel'),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(PiSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          identity.displayName,
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        Text(identity.workspaceLabel),
                        Text(
                          identity.parentSessionName == null
                              ? 'Original session'
                              : 'Branched from ${identity.parentSessionName}',
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    key: const Key('session-rename'),
                    tooltip: 'Rename session',
                    onPressed:
                        _actionsAllowed &&
                            !data.isDeleted &&
                            callbacks.onRename != null
                        ? () => _showRename(context)
                        : null,
                    icon: const Icon(Icons.edit_outlined),
                  ),
                ],
              ),
              if (data.disabledReason case final reason?) ...[
                const SizedBox(height: 8),
                _LifecycleNotice(
                  key: const Key('session-lifecycle-disabled'),
                  icon: Icons.cloud_off,
                  text: reason,
                ),
              ],
              if (data.phase != SessionLifecyclePhase.idle) ...[
                const SizedBox(height: 8),
                _LifecyclePhase(data: data),
              ],
              if (data.deleteFailedMessage case final message?) ...[
                const SizedBox(height: 8),
                Semantics(
                  container: true,
                  liveRegion: true,
                  label: 'Session deletion needs repair. $message',
                  child: Material(
                    key: const Key('session-delete-failed'),
                    color: Theme.of(context).colorScheme.errorContainer,
                    borderRadius: BorderRadius.circular(PiRadius.md),
                    child: Padding(
                      padding: const EdgeInsets.all(PiSpacing.sm),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            'Deletion needs repair',
                            style: Theme.of(context).textTheme.titleSmall,
                          ),
                          const SizedBox(height: 4),
                          Text(message),
                          const SizedBox(height: 8),
                          Align(
                            alignment: Alignment.centerLeft,
                            child: FilledButton.tonalIcon(
                              key: const Key('session-delete-repair'),
                              onPressed:
                                  _actionsAllowed &&
                                      callbacks.onRepairDelete != null
                                  ? callbacks.onRepairDelete
                                  : null,
                              icon: const Icon(Icons.build_outlined),
                              label: const Text('Retry deletion repair'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 12),
              if (data.isDeleted)
                _DeletedActions(
                  data: data,
                  canAct: _actionsAllowed,
                  onRestore: callbacks.onRestore,
                  onPermanentDelete: callbacks.onPermanentDelete == null
                      ? null
                      : () => _confirmPermanentDelete(context),
                )
              else
                Align(
                  alignment: Alignment.centerLeft,
                  child: OutlinedButton.icon(
                    key: const Key('session-soft-delete'),
                    onPressed: _actionsAllowed && callbacks.onSoftDelete != null
                        ? () => _confirmSoftDelete(context)
                        : null,
                    icon: const Icon(Icons.delete_outline),
                    label: const Text('Move to Trash'),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DeletedActions extends StatelessWidget {
  const _DeletedActions({
    required this.data,
    required this.canAct,
    required this.onRestore,
    required this.onPermanentDelete,
  });

  final SessionLifecycleViewData data;
  final bool canAct;
  final VoidCallback? onRestore;
  final VoidCallback? onPermanentDelete;

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    label: 'Session is in Trash. Scheduled purge: ${data.purgeDateLabel}.',
    child: Column(
      key: const Key('session-deleted-actions'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('In Trash', style: Theme.of(context).textTheme.titleMedium),
        Text('Scheduled purge: ${data.purgeDateLabel}'),
        if (!data.canRestore && data.restoreUnavailableReason != null)
          Text(data.restoreUnavailableReason!),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            FilledButton.icon(
              key: const Key('session-restore'),
              onPressed: canAct && data.canRestore && onRestore != null
                  ? onRestore
                  : null,
              icon: const Icon(Icons.restore_from_trash),
              label: const Text('Restore session'),
            ),
            OutlinedButton.icon(
              key: const Key('session-permanent-delete'),
              onPressed: canAct && onPermanentDelete != null
                  ? onPermanentDelete
                  : null,
              icon: const Icon(Icons.delete_forever),
              label: const Text('Delete permanently'),
            ),
          ],
        ),
      ],
    ),
  );
}

class _LifecyclePhase extends StatelessWidget {
  const _LifecyclePhase({required this.data});

  final SessionLifecycleViewData data;

  @override
  Widget build(BuildContext context) {
    final text = switch (data.phase) {
      SessionLifecyclePhase.renaming => 'Saving session name…',
      SessionLifecyclePhase.abortingForDelete =>
        'Step 1 of 2: aborting the active turn before deletion…',
      SessionLifecyclePhase.deleting => 'Step 2 of 2: moving session to Trash…',
      SessionLifecyclePhase.undoingDelete => 'Undoing session deletion…',
      SessionLifecyclePhase.restoring =>
        'Restoring session and rebuilding its snapshot…',
      SessionLifecyclePhase.purging => 'Permanently deleting session…',
      SessionLifecyclePhase.repairingDelete =>
        'Repairing partial session deletion…',
      SessionLifecyclePhase.idle => '',
    };
    return Semantics(
      liveRegion: true,
      label: text,
      child: Material(
        key: const Key('session-lifecycle-progress'),
        color: Theme.of(context).colorScheme.secondaryContainer,
        borderRadius: BorderRadius.circular(PiRadius.md),
        child: Padding(
          padding: const EdgeInsets.all(PiSpacing.sm),
          child: Row(
            children: [
              const SizedBox.square(
                dimension: 20,
                child: MotionSpinner(
                  strokeWidth: 2,
                  dimension: 20,
                  label: 'Lifecycle operation in progress',
                ),
              ),
              const SizedBox(width: PiSpacing.sm),
              Expanded(child: Text(text)),
            ],
          ),
        ),
      ),
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: PiSpacing.xs),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(width: 116, child: Text(label)),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
        ),
      ],
    ),
  );
}

class _LifecycleNotice extends StatelessWidget {
  const _LifecycleNotice({required this.icon, required this.text, super.key});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    label: text,
    child: Material(
      key: key,
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(PiRadius.md),
      child: Padding(
        padding: const EdgeInsets.all(PiSpacing.sm),
        child: Row(
          children: [
            Icon(icon),
            const SizedBox(width: 8),
            Expanded(child: Text(text)),
          ],
        ),
      ),
    ),
  );
}
