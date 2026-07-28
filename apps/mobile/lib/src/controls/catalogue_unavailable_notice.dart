import 'package:flutter/material.dart';

import '../ui/theme/pi_tokens.dart';

/// Host-authoritative notice shown after the bridge explicitly reports that
/// its command catalogue cannot be provided. It deliberately does not invent
/// local command entries in place of the unavailable catalogue.
class CatalogueUnavailableNotice extends StatelessWidget {
  const CatalogueUnavailableNotice({this.reason, super.key});

  final String? reason;

  @override
  Widget build(BuildContext context) {
    final detail = reason?.trim();
    return Padding(
      padding: const EdgeInsets.only(bottom: PiSpacing.sm),
      child: Material(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(PiRadius.md),
        child: Padding(
          padding: const EdgeInsets.all(PiSpacing.sm),
          child: Column(
            key: const Key('catalogue-unavailable-notice'),
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Catalogue unavailable',
                style: Theme.of(context).textTheme.titleSmall,
              ),
              const SizedBox(height: PiSpacing.xs),
              Text(
                detail?.isNotEmpty == true
                    ? detail!
                    : 'The host could not provide its command catalogue.',
              ),
            ],
          ),
        ),
      ),
    );
  }
}
