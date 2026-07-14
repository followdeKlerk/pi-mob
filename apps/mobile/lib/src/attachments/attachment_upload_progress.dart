import 'package:flutter/material.dart';

import 'attachment_callbacks.dart';
import 'attachment_view_data.dart';

/// Upload progress indicator with bounded retry/replace/remove affordances.
class AttachmentUploadProgress extends StatelessWidget {
  const AttachmentUploadProgress({
    required this.data,
    required this.callbacks,
    this.showBytes = true,
    super.key,
  });

  final AttachmentViewData data;
  final AttachmentCallbacks callbacks;
  final bool showBytes;

  double get _ratio {
    final fraction = data.progressFraction;
    if (fraction != null) {
      return fraction.clamp(0.0, 1.0);
    }
    if (data.byteSize <= 0) return 0.0;
    return (data.uploadedBytes / data.byteSize).clamp(0.0, 1.0);
  }

  String get _status {
    if (data.phase == AttachmentPhase.failed) {
      return data.failureMessage ?? 'Upload failed';
    }
    if (data.phase == AttachmentPhase.retrying) return 'Retrying upload';
    return 'Uploading';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isFailed = data.phase == AttachmentPhase.failed;
    final isRetryable = isFailed || data.phase == AttachmentPhase.retrying;
    final indeterminate =
        data.phase == AttachmentPhase.uploading &&
        data.progressFraction == null;
    return Semantics(
      container: true,
      liveRegion: true,
      label: 'Upload progress for ${data.fileName}. $_status',
      value: '${(_ratio * 100).round()} percent',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        key: ValueKey('attachment-upload-${data.id}'),
        children: [
          LinearProgressIndicator(
            key: ValueKey('attachment-progress-bar-${data.id}'),
            value: indeterminate ? null : _ratio,
            minHeight: 6,
            backgroundColor: theme.colorScheme.surfaceContainerHighest,
            color: isFailed ? theme.colorScheme.error : null,
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Expanded(
                child: Text(
                  _status,
                  style: theme.textTheme.bodySmall,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (showBytes)
                Text(
                  '${(data.uploadedBytes ~/ 1024)} / ${(data.byteSize ~/ 1024)} KB',
                  style: theme.textTheme.bodySmall,
                ),
            ],
          ),
          if (isRetryable)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Row(
                children: [
                  if (callbacks.onRetry != null)
                    TextButton.icon(
                      key: ValueKey('attachment-retry-${data.id}'),
                      icon: const Icon(Icons.refresh),
                      label: const Text('Retry upload'),
                      onPressed: () => callbacks.onRetry!(data.id),
                    ),
                  if (callbacks.onReplace != null)
                    TextButton.icon(
                      key: ValueKey('attachment-replace-upload-${data.id}'),
                      icon: const Icon(Icons.swap_horiz),
                      label: const Text('Replace'),
                      onPressed: () => callbacks.onReplace!(data.id),
                    ),
                  if (callbacks.onRemove != null)
                    TextButton.icon(
                      key: ValueKey('attachment-remove-upload-${data.id}'),
                      icon: const Icon(Icons.delete_outline),
                      label: const Text('Remove'),
                      onPressed: () => callbacks.onRemove!(data.id),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
