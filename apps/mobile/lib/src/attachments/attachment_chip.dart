import 'package:flutter/material.dart';

import '../ui/theme/pi_tokens.dart';

import 'attachment_callbacks.dart';
import 'attachment_view_data.dart';

/// Accessible attachment chip with preview, remove, and replace affordances.
///
/// The widget is fully coordinator-free: it renders [AttachmentViewData]
/// snapshots and emits callback events. It survives 200% text scaling and
/// exposes a semantics label that summarizes the attachment state.
class AttachmentChip extends StatelessWidget {
  const AttachmentChip({
    required this.data,
    required this.callbacks,
    this.onActionGate,
    super.key,
  });

  final AttachmentViewData data;
  final AttachmentCallbacks callbacks;
  final AttachmentActionGate? onActionGate;

  bool _allowed(AttachmentAction action) {
    final gate = onActionGate;
    if (gate == null) return true;
    return gate.allows(action);
  }

  String get _statusLabel => switch (data.phase) {
    AttachmentPhase.selected => 'Selected',
    AttachmentPhase.uploading =>
      data.progressFraction == null
          ? 'Uploading'
          : 'Uploading ${(data.progressFraction! * 100).round()}%',
    AttachmentPhase.uploaded => 'Uploaded',
    AttachmentPhase.failed =>
      'Failed${data.failureMessage == null ? '' : ': ${data.failureMessage}'}',
    AttachmentPhase.retrying =>
      data.progressFraction == null
          ? 'Retrying'
          : 'Retrying ${(data.progressFraction! * 100).round()}%',
    AttachmentPhase.expired => 'Expired',
    AttachmentPhase.removed => 'Removed',
  };

  String get _semanticsLabel {
    final kind = attachmentKindLabel(data.kind);
    final expires = data.expiresAt == null
        ? ''
        : ', expires ${data.expiresAt!.toIso8601String()}';
    final digest = data.digest == null ? '' : ', Digest ${data.digest}';
    return '$kind attachment ${data.fileName}, $data.byteSize bytes, $_statusLabel$digest$expires';
  }

  @override
  Widget build(BuildContext context) {
    final dimensionLabel = data.dimensions == null
        ? ''
        : ', ${data.dimensions!.width} by ${data.dimensions!.height}';

    return Semantics(
      container: true,
      button:
          callbacks.onPreviewTap != null && _allowed(AttachmentAction.preview),
      label: _semanticsLabel,
      hint: data.digest == null ? null : 'Digest ${data.digest}',
      child: Material(
        color: Theme.of(context).colorScheme.secondaryContainer,
        shape: const StadiumBorder(),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 320),
          child: InkWell(
            key: ValueKey('attachment-chip-${data.id}'),
            onTap:
                !_allowed(AttachmentAction.preview) ||
                    callbacks.onPreviewTap == null
                ? null
                : () => callbacks.onPreviewTap!(data.id),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: PiSpacing.md,
                vertical: PiSpacing.sm,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Icon(_iconFor(data.kind), size: 18),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              data.fileName,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context).textTheme.labelLarge,
                            ),
                            Text(
                              '${data.byteSize ~/ 1024} KB$dimensionLabel',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  Wrap(
                    alignment: WrapAlignment.end,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: 4,
                    children: [
                      Text(
                        _statusLabel,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      if (callbacks.onReplace != null)
                        IconButton(
                          key: ValueKey('attachment-replace-${data.id}'),
                          tooltip: 'Replace attachment',
                          onPressed: !_allowed(AttachmentAction.replace)
                              ? null
                              : () => callbacks.onReplace!(data.id),
                          icon: const Icon(Icons.swap_horiz),
                        ),
                      if (callbacks.onRemove != null)
                        IconButton(
                          key: ValueKey('attachment-remove-${data.id}'),
                          tooltip: 'Remove attachment',
                          onPressed: !_allowed(AttachmentAction.remove)
                              ? null
                              : () => callbacks.onRemove!(data.id),
                          icon: const Icon(Icons.close),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  IconData _iconFor(AttachmentKind kind) => switch (kind) {
    AttachmentKind.imageJpeg => Icons.image_outlined,
    AttachmentKind.imagePng => Icons.image_outlined,
    AttachmentKind.unknownImage => Icons.broken_image_outlined,
    AttachmentKind.genericFile => Icons.attach_file,
  };
}
