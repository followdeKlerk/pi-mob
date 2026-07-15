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

  @override
  Widget build(BuildContext context) {
    final prefill = coordinator.editorPrefill;
    final aborting = coordinator.canAbort;
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
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
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
                        onPressed: aborting
                            ? coordinator.abort
                            : coordinator.canSend
                            ? coordinator.submitPrompt
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
