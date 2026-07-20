import 'package:flutter/material.dart';

import '../ui/theme/pi_tokens.dart';

import 'attachment_view_data.dart';

/// Full-size preview surface for an attachment.
///
/// The widget renders a deterministic placeholder when no image provider is
/// available so tests stay plugin-free. It announces itself as a live region
/// for screen readers and respects 200% text scaling.
class AttachmentPreview extends StatelessWidget {
  const AttachmentPreview({
    required this.data,
    this.image,
    this.onClose,
    super.key,
  });

  final AttachmentViewData data;
  final ImageProvider? image;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dimensions = data.dimensions;
    return Semantics(
      container: true,
      liveRegion: true,
      label:
          'Attachment preview of ${attachmentKindLabel(data.kind)} ${data.fileName}',
      child: Stack(
        fit: StackFit.expand,
        children: [
          ColoredBox(color: theme.colorScheme.surfaceContainerHighest),
          Center(
            child: image == null
                ? Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.image_not_supported_outlined,
                        size: 96,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      const SizedBox(height: 16),
                      Text(
                        data.fileName,
                        style: theme.textTheme.titleMedium,
                        textAlign: TextAlign.center,
                      ),
                      if (dimensions != null)
                        Padding(
                          padding: const EdgeInsets.only(top: PiSpacing.sm),
                          child: Text(
                            dimensions.toString(),
                            style: theme.textTheme.bodyMedium,
                          ),
                        ),
                      const SizedBox(height: 8),
                      Text(
                        '${(data.byteSize / 1024).toStringAsFixed(1)} KB',
                        style: theme.textTheme.bodySmall,
                      ),
                    ],
                  )
                : Image(image: image!, fit: BoxFit.contain),
          ),
          if (onClose != null)
            Positioned(
              top: 8,
              right: 8,
              child: IconButton.filledTonal(
                key: const Key('attachment-preview-close'),
                tooltip: 'Close preview',
                onPressed: onClose,
                icon: const Icon(Icons.close),
              ),
            ),
        ],
      ),
    );
  }
}
