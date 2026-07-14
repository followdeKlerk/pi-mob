import 'package:flutter/material.dart';

import '../theme/pi_theme.dart';

/// Concise privacy and connection explanation rendered under the host
/// connection panel. Replaces the technical version/handshake surface that
/// used to dominate the diagnostic column with one short paragraph that a
/// non-developer reader can verify at a glance.
///
/// All copy is rendered from in-code constants on purpose: the explanation is
/// intended to stay in lockstep with the bridge/pairing protocol on the
/// `docs/PROTOCOL.md` track, and a constant avoids surprising readers when
/// the bundle ships.
class PrivacyExplanation extends StatelessWidget {
  const PrivacyExplanation({super.key});

  static const _key = Key('host-privacy-explanation');

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final semantic = context.piSemanticColors;
    final colors = theme.colorScheme;
    return Card(
      key: _key,
      child: Padding(
        padding: const EdgeInsets.all(PiSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'How this connection works',
              style: theme.textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.w600,
                color: colors.onSurface,
              ),
            ),
            const SizedBox(height: PiSpacing.sm),
            Text(
              'Pi Mob talks to your Pi host over the URL you enter. '
              'The phone and host must be on the same Tailscale tailnet '
              'for the bridge to accept the handshake.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: PiSpacing.md),
            Text(
              'What is sent',
              style: theme.textTheme.labelLarge?.copyWith(
                color: colors.onSurface,
              ),
            ),
            const SizedBox(height: PiSpacing.xs),
            _Bullet(
              'Only the prompts, attachments, and replies for the session '
              'you actively select.',
              color: colors.onSurfaceVariant,
            ),
            _Bullet(
              'A durable device token once notifications are enabled, so '
              'backgrounded sessions can wake the phone.',
              color: colors.onSurfaceVariant,
            ),
            _Bullet(
              'No analytics, no telemetry — the protocol is the wire.',
              color: colors.onSurfaceVariant,
            ),
            const SizedBox(height: PiSpacing.md),
            Text(
              'What is never sent',
              style: theme.textTheme.labelLarge?.copyWith(
                color: colors.onSurface,
              ),
            ),
            const SizedBox(height: PiSpacing.xs),
            _Bullet(
              'Photos or files from outside the composer.',
              color: colors.onSurfaceVariant,
            ),
            _Bullet(
              'Background data from other apps on this phone.',
              color: colors.onSurfaceVariant,
            ),
            _Bullet(
              'Identity tokens for any third-party service.',
              color: colors.onSurfaceVariant,
            ),
            const SizedBox(height: PiSpacing.md),
            Container(
              padding: const EdgeInsets.all(PiSpacing.sm),
              decoration: BoxDecoration(
                color: semantic.successContainer,
                borderRadius: BorderRadius.circular(PiRadius.sm),
              ),
              child: Text(
                'Pairing is a deliberate one-time action. Use “Forget host” '
                'in the top bar to revoke access at any time.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: semantic.onSuccessContainer,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Bullet extends StatelessWidget {
  const _Bullet(this.text, {required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: PiSpacing.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 6, right: PiSpacing.sm),
            child: Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
          ),
          Expanded(
            child: Text(
              text,
              style: Theme.of(
                context,
              ).textTheme.bodyMedium?.copyWith(color: color),
            ),
          ),
        ],
      ),
    );
  }
}
