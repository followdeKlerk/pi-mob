import 'dart:async';

import 'package:flutter/material.dart';

import '../../domain/mobile_state.dart';
import '../theme/pi_theme.dart';

/// Inline trust review dialog surfaced from the trust-required banner.
///
/// Mirrors the picker-dialog detail on purpose so the user can review
/// resource manifest and fingerprint without leaving the Sessions surface.
class InlineTrustReview extends StatelessWidget {
  const InlineTrustReview({
    required this.entry,
    required this.onApprove,
    super.key,
  });

  final WorkspaceEntry entry;
  final Future<void> Function() onApprove;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    return AlertDialog(
      key: const Key('inline-trust-review'),
      title: const Text('Approve workspace trust'),
      content: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(entry.displayName, style: text.titleMedium),
            Text('Root: ${entry.rootLabel}'),
            Text('Relative path: ${entry.relativePath}'),
            const SizedBox(height: PiSpacing.sm),
            Text('Resource fingerprint', style: text.labelLarge),
            SelectableText(
              entry.fingerprint,
              key: const Key('inline-trust-fingerprint'),
              style: text.bodySmall?.copyWith(fontFamily: 'monospace'),
            ),
            Text('Policy version: ${entry.policyVersion}'),
            const SizedBox(height: PiSpacing.sm),
            Text('Resource manifest', style: text.labelLarge),
            if (entry.manifest.isEmpty)
              const Text('(host reported no manifest lines)')
            else
              for (final r in entry.manifest)
                Text(
                  '${r.kind}\t${r.relativePath}'
                  '${r.sizeBytes == null ? '' : '\t${r.sizeBytes}B'}',
                ),
            const SizedBox(height: PiSpacing.md),
            Container(
              key: const Key('inline-trust-guardrail-note'),
              padding: const EdgeInsets.all(PiSpacing.sm),
              decoration: BoxDecoration(
                color: colors.errorContainer,
                borderRadius: BorderRadius.circular(PiRadius.sm),
              ),
              child: Text(
                'This is a product guardrail enforced through Pi tool hooks. '
                'It is not an OS sandbox. Pi may still attempt operations the '
                'host allows at the file-system layer.',
                style: text.bodySmall?.copyWith(color: colors.onErrorContainer),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          key: const Key('inline-trust-cancel'),
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: const Key('inline-trust-approve'),
          onPressed: () => unawaited(onApprove()),
          child: const Text('Approve'),
        ),
      ],
    );
  }
}

/// Calmer banner presented inside the Sessions destination when a workspace is
/// missing trust approval or its fingerprint changed.
class TrustRequiredBanner extends StatelessWidget {
  const TrustRequiredBanner({
    required this.entry,
    required this.onReview,
    super.key,
  });

  final WorkspaceEntry? entry;
  final VoidCallback onReview;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final isFingerprintChanged =
        entry?.trustState == WorkspaceTrustState.fingerprintChanged;
    final unavailable = entry?.availability != WorkspaceAvailability.available;
    final message = unavailable
        ? 'This workspace is unavailable on the host. Pick another to send.'
        : isFingerprintChanged
        ? 'Resource fingerprint changed. Re-review and re-approve before sending.'
        : 'Workspace trust approval required. Pi will refuse mutation until you '
              'approve the resource manifest and fingerprint.';
    return Container(
      key: const Key('trust-required-banner'),
      padding: const EdgeInsets.all(PiSpacing.md),
      decoration: BoxDecoration(
        color: colors.errorContainer,
        borderRadius: BorderRadius.circular(PiRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(message, style: TextStyle(color: colors.onErrorContainer)),
          const SizedBox(height: PiSpacing.xs),
          Text(
            'Trust approval is a guardrail, not an OS sandbox.',
            style: TextStyle(color: colors.onErrorContainer),
          ),
          const SizedBox(height: PiSpacing.sm),
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton.tonalIcon(
              key: const Key('trust-required-review'),
              onPressed: onReview,
              icon: const Icon(Icons.verified_user),
              label: const Text('Review and approve'),
            ),
          ),
        ],
      ),
    );
  }
}
