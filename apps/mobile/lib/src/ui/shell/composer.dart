import 'dart:async';

import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../../domain/mobile_state.dart';
import '../../interaction/interaction_panel.dart';
import '../theme/pi_theme.dart';

/// Prompt composer with delivery-mode selector, follow-up queue, extension
/// dialog opener, and the persistent draft `TextField`.
///
/// The composer is intentionally a single fixed-height surface anchored at the
/// bottom of the Activity destination. It owns its own `LiveRegion`
/// semantics node so screen-readers announce state transitions, and exposes
/// the original keys (`draft-field`, `send-button`, `abort-button`,
/// `retry-command`, `composer-disabled-reason`, `delivery-mode-selector`,
/// `open-extension-dialog`, `pending-command`) that downstream tests rely on.
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

  @override
  Widget build(BuildContext context) {
    final prefill = coordinator.editorPrefill;
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
                color: const Color(0xFFFFF3CD),
                child: const Padding(
                  padding: EdgeInsets.all(PiSpacing.sm + 2),
                  child: Text(
                    'Completion is unknown. The command will not run again automatically. Inspect the session before deciding what to do.',
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
            if (!coordinator.canSend &&
                coordinator.composerDisabledReason != null) ...[
              const SizedBox(height: PiSpacing.sm),
              Text(
                coordinator.composerDisabledReason!,
                key: const Key('composer-disabled-reason'),
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            Semantics(
              liveRegion: true,
              label: coordinator.pendingCommandId == null
                  ? 'Composer ready'
                  : 'Prompt ${coordinator.pendingState ?? 'pending'}',
              child: const SizedBox.shrink(),
            ),
            const SizedBox(height: PiSpacing.sm),
            if (coordinator.pendingCommandId != null)
              Text(
                'Pending ${coordinator.pendingState ?? 'unknown'} · '
                '${coordinator.pendingCommandId}',
                key: const Key('pending-command'),
                overflow: TextOverflow.ellipsis,
              ),
            Wrap(
              alignment: WrapAlignment.end,
              spacing: PiSpacing.sm,
              runSpacing: PiSpacing.sm,
              children: [
                if (coordinator.pendingCommandId != null)
                  OutlinedButton.icon(
                    key: const Key('retry-command'),
                    onPressed: coordinator.canRetry
                        ? coordinator.retryPending
                        : null,
                    icon: const Icon(Icons.replay),
                    label: const Text('Retry exact command'),
                  ),
                Semantics(
                  button: true,
                  label: 'Abort active Pi turn',
                  child: OutlinedButton.icon(
                    key: const Key('abort-button'),
                    onPressed: coordinator.canAbort ? coordinator.abort : null,
                    icon: const Icon(Icons.stop),
                    label: const Text('Abort'),
                  ),
                ),
                FilledButton.icon(
                  key: const Key('send-button'),
                  onPressed: coordinator.canSend
                      ? coordinator.submitPrompt
                      : null,
                  icon: const Icon(Icons.send),
                  label: Text(
                    !coordinator.isReady
                        ? 'Send (offline)'
                        : deliveryModeLabel(coordinator.selectedDeliveryMode),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
