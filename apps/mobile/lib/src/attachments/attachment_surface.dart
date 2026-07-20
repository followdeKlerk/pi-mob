import 'package:flutter/material.dart';

import '../ui/theme/pi_tokens.dart';

import 'attachment_callbacks.dart';
import 'attachment_chip.dart';
import 'attachment_expiry.dart';
import 'attachment_upload_progress.dart';
import 'attachment_view_data.dart';

/// Composer attachment row composing chips, upload progress, and expiry.
class AttachmentSurface extends StatelessWidget {
  const AttachmentSurface({
    required this.data,
    required this.callbacks,
    required this.now,
    this.onExpireAcknowledged,
    super.key,
  });

  final AttachmentSurfaceData data;
  final AttachmentCallbacks callbacks;
  final DateTime now;
  final void Function(String attachmentId)? onExpireAcknowledged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final unavailable = data.unavailableReason;
    if (unavailable != null) {
      return Semantics(
        container: true,
        label: 'Attachments unavailable. $unavailable',
        child: Material(
          color: theme.colorScheme.surfaceContainerHighest,
          child: Padding(
            padding: const EdgeInsets.all(PiSpacing.md),
            child: Text(
              'Attachments unavailable: $unavailable',
              style: theme.textTheme.bodyMedium,
            ),
          ),
        ),
      );
    }
    if (data.attachments.isEmpty) {
      return const SizedBox.shrink();
    }
    final live = data.visible.toList(growable: false);
    return Semantics(
      container: true,
      label:
          'Attachment surface with ${live.length} of ${data.maxAttachmentCount} maximum attachments',
      liveRegion: true,
      child: Material(
        color: theme.colorScheme.surface,
        child: Padding(
          padding: const EdgeInsets.all(PiSpacing.sm),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (data.isFull)
                Padding(
                  padding: const EdgeInsets.only(bottom: PiSpacing.sm),
                  child: Text(
                    'Maximum ${data.maxAttachmentCount} attachments reached',
                    style: theme.textTheme.bodySmall,
                    key: const Key('attachment-surface-full-warning'),
                  ),
                ),
              for (final attachment in live)
                _AttachmentRow(
                  attachment: attachment,
                  callbacks: callbacks,
                  now: now,
                  onExpireAcknowledged: onExpireAcknowledged == null
                      ? null
                      : () => onExpireAcknowledged!(attachment.id),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AttachmentRow extends StatelessWidget {
  const _AttachmentRow({
    required this.attachment,
    required this.callbacks,
    required this.now,
    this.onExpireAcknowledged,
  });

  final AttachmentViewData attachment;
  final AttachmentCallbacks callbacks;
  final DateTime now;
  final VoidCallback? onExpireAcknowledged;

  bool get _showProgress =>
      attachment.phase == AttachmentPhase.uploading ||
      attachment.phase == AttachmentPhase.failed ||
      attachment.phase == AttachmentPhase.retrying;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: PiSpacing.xs),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AttachmentChip(data: attachment, callbacks: callbacks),
          if (_showProgress) ...[
            const SizedBox(height: 6),
            AttachmentUploadProgress(data: attachment, callbacks: callbacks),
          ],
          if (attachment.expiresAt != null) ...[
            const SizedBox(height: 6),
            AttachmentExpiryIndicator(
              data: attachment,
              now: now,
              onExpireAcknowledged: onExpireAcknowledged,
            ),
          ],
        ],
      ),
    );
  }
}
