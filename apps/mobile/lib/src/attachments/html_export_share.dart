import 'package:flutter/material.dart';

import 'html_export_view_data.dart';
import 'share_callback.dart';

/// Bridges [HtmlExportViewData] into the abstract [NativeShareCallback]
/// surface. The widget never calls plugins directly — the host application
/// registers a concrete [NativeShareCallback] (or a no-op) at the surface
/// root.
class HtmlExportShareSheet extends StatelessWidget {
  const HtmlExportShareSheet({
    required this.data,
    required this.shareCallback,
    this.onShareResult,
    super.key,
  });

  final HtmlExportViewData data;
  final NativeShareCallback shareCallback;
  final void Function(ShareResult result)? onShareResult;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final shareable = data.shareAvailable && data.hasExport;
    return Semantics(
      container: true,
      liveRegion: true,
      label:
          'HTML export share. '
          '${shareable ? 'Ready to share via ${data.mimeType}' : 'Sharing unavailable'}'
          '. Sharing leaves the private network once a destination is chosen.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        key: const Key('html-export-share-sheet'),
        children: [
          Container(
            key: const Key('html-export-share-privacy-warning'),
            color: theme.colorScheme.tertiaryContainer,
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                Icon(
                  Icons.shield_outlined,
                  color: theme.colorScheme.onTertiaryContainer,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Sharing leaves the private network once you pick a destination. No public link is generated.',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onTertiaryContainer,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          FilledButton.tonalIcon(
            key: const Key('html-export-share-open'),
            icon: const Icon(Icons.ios_share),
            label: Text(
              shareable
                  ? 'Open system share sheet'
                  : 'Share unavailable until export completes',
            ),
            onPressed: shareable
                ? () async {
                    final exportId = data.exportId;
                    if (exportId == null) return;
                    final request = ShareRequest(
                      exportId: exportId,
                      fileName: data.fileName ?? 'export.html',
                      mimeType: data.mimeType,
                      byteSize: data.byteSize,
                      localPath: data.downloadPath,
                    );
                    final result = await shareCallback.share(request);
                    onShareResult?.call(result);
                  }
                : null,
          ),
          const SizedBox(height: 4),
          Text(
            'Export ID ${data.exportId ?? 'unavailable'}',
            style: theme.textTheme.bodySmall,
            key: const Key('html-export-share-export-id'),
          ),
        ],
      ),
    );
  }
}
