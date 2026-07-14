import 'package:flutter/material.dart';

import 'html_export_view_data.dart';

/// HTML export progress + completion surface.
///
/// Mirrors the retry/attachment conventions: coordinator-free, immutable
/// view-data, optional callbacks, accessibility-first, 200% text scaling.
class HtmlExportProgressCard extends StatelessWidget {
  const HtmlExportProgressCard({
    required this.data,
    required this.callbacks,
    super.key,
  });

  final HtmlExportViewData data;
  final HtmlExportCallbacks callbacks;

  double get _ratio {
    final fraction = data.progressFraction;
    if (fraction != null) return fraction.clamp(0.0, 1.0);
    if (data.byteSize == null || data.byteSize! <= 0) return 0.0;
    return (data.downloadedBytes / data.byteSize!).clamp(0.0, 1.0);
  }

  String get _status {
    return switch (data.phase) {
      HtmlExportPhase.idle => 'Export idle',
      HtmlExportPhase.preparing => 'Preparing export',
      HtmlExportPhase.rendering => 'Rendering HTML',
      HtmlExportPhase.uploading => 'Uploading to private storage',
      HtmlExportPhase.downloading => 'Downloading HTML export',
      HtmlExportPhase.completed => 'Export ready',
      HtmlExportPhase.failed => data.failureMessage ?? 'Export failed',
      HtmlExportPhase.cancelled => 'Export cancelled',
    };
  }

  bool get _indeterminate =>
      (data.phase == HtmlExportPhase.preparing ||
          data.phase == HtmlExportPhase.rendering) &&
      data.progressFraction == null;

  bool get isFailed => data.phase == HtmlExportPhase.failed;
  bool get isCancelled => data.phase == HtmlExportPhase.cancelled;
  bool get isCompleted => data.phase == HtmlExportPhase.completed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      container: true,
      liveRegion: true,
      label: 'HTML export. $_status',
      value: '${(_ratio * 100).round()} percent',
      child: Card(
        key: const Key('html-export-progress'),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Icon(
                    isFailed
                        ? Icons.error_outline
                        : isCompleted
                        ? Icons.check_circle_outline
                        : Icons.download_outlined,
                    color: isFailed ? theme.colorScheme.error : null,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      data.fileName ?? 'HTML export',
                      style: theme.textTheme.titleMedium,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (data.byteSize != null)
                    Text(
                      '${(data.downloadedBytes ~/ 1024)} / ${(data.byteSize! ~/ 1024)} KB',
                      style: theme.textTheme.bodySmall,
                    ),
                ],
              ),
              const SizedBox(height: 8),
              LinearProgressIndicator(
                key: const Key('html-export-progress-bar'),
                value: _indeterminate ? null : _ratio,
                minHeight: 6,
                color: isFailed ? theme.colorScheme.error : null,
              ),
              const SizedBox(height: 8),
              Text(_status, style: theme.textTheme.bodySmall),
              if (data.exportId != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    'Export ID ${data.exportId}${data.expiresAt == null ? '' : ' expires ${data.expiresAt!.toIso8601String()}'}',
                    style: theme.textTheme.bodySmall,
                  ),
                ),
              const SizedBox(height: 8),
              _buildActions(context, theme),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildActions(BuildContext context, ThemeData theme) {
    final isBusy =
        data.phase == HtmlExportPhase.preparing ||
        data.phase == HtmlExportPhase.rendering ||
        data.phase == HtmlExportPhase.uploading ||
        data.phase == HtmlExportPhase.downloading;
    return Wrap(
      spacing: 8,
      runSpacing: 4,
      children: [
        if (data.phase == HtmlExportPhase.idle && callbacks.onStart != null)
          FilledButton.icon(
            key: const Key('html-export-start'),
            icon: const Icon(Icons.play_arrow),
            label: const Text('Generate HTML'),
            onPressed: callbacks.onStart,
          ),
        if (isBusy && data.cancellable && callbacks.onCancel != null)
          TextButton.icon(
            key: const Key('html-export-cancel'),
            icon: const Icon(Icons.stop),
            label: const Text('Cancel'),
            onPressed: callbacks.onCancel,
          ),
        if (isFailed && callbacks.onRetry != null)
          TextButton.icon(
            key: const Key('html-export-retry'),
            icon: const Icon(Icons.refresh),
            label: const Text('Retry export'),
            onPressed: callbacks.onRetry,
          ),
        if (isCancelled && callbacks.onRetry != null)
          TextButton.icon(
            key: const Key('html-export-restart'),
            icon: const Icon(Icons.replay),
            label: const Text('Try again'),
            onPressed: callbacks.onRetry,
          ),
      ],
    );
  }
}
