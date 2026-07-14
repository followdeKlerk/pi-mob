import 'package:flutter/material.dart';

import 'session_view_data.dart';

/// Observer banner. Always exposes a "Take control" action that requires an
/// accessible confirmation dialog before the callback fires. The widget
/// must not let a stray tap steal a controller lease.
class ObserverBanner extends StatelessWidget {
  const ObserverBanner({
    required this.data,
    required this.callbacks,
    super.key,
  });

  final ObserverBannerViewData data;
  final ObserverBannerCallbacks callbacks;

  Future<void> _onTakeControlPressed(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      barrierDismissible: true,
      builder: (dialogContext) {
        return Semantics(
          container: true,
          label: ObserverBannerText.confirmAccessibilityHint,
          child: AlertDialog(
            key: const Key('observer-take-control-dialog'),
            title: const Text(ObserverBannerText.confirmTitle),
            content: const Text(ObserverBannerText.confirmBody),
            actions: [
              TextButton(
                key: const Key('observer-take-control-cancel'),
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: const Text(ObserverBannerText.confirmDecline),
              ),
              FilledButton(
                key: const Key('observer-take-control-confirm'),
                onPressed: () => Navigator.of(dialogContext).pop(true),
                child: const Text(ObserverBannerText.confirmAffirm),
              ),
            ],
          ),
        );
      },
    );
    if (confirmed == true) {
      callbacks.onTakeControl?.call(data.session);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final reason = data.reason;
    return Semantics(
      container: true,
      liveRegion: true,
      label:
          'Observer banner. ${ObserverBannerText.headline(reason)} '
          '${ObserverBannerText.detail(reason, data.controllerClientName)}',
      child: Container(
        key: const Key('observer-banner'),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: colors.tertiaryContainer,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.visibility, color: colors.onTertiaryContainer),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    ObserverBannerText.headline(reason),
                    style: text.titleSmall?.copyWith(
                      color: colors.onTertiaryContainer,
                    ),
                    key: const Key('observer-banner-headline'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              ObserverBannerText.detail(reason, data.controllerClientName),
              style: text.bodySmall?.copyWith(
                color: colors.onTertiaryContainer,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                FilledButton.tonalIcon(
                  key: const Key('observer-take-control'),
                  onPressed: () => _onTakeControlPressed(context),
                  icon: const Icon(Icons.ads_click),
                  label: const Text(ObserverBannerText.confirmAffirm),
                ),
                TextButton.icon(
                  key: const Key('observer-dismiss'),
                  onPressed: () => callbacks.onDismiss?.call(data.session),
                  icon: const Icon(Icons.close),
                  label: const Text('Dismiss'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
