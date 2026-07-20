import 'package:flutter/material.dart';

import '../ui/theme/pi_tokens.dart';

import 'pairing_payload.dart';

/// Pairing confirmation view.
///
/// Shows the four fields the user must verify before a host is trusted:
///   * display name (host name),
///   * hostname (Tailscale MagicDNS name),
///   * protocol major version,
///   * host-ID suffix (last 8 characters of the stable UUID).
///
/// The confirmation view is intentionally simple, with explicit labels so a
/// screen reader can announce every field. The host-ID suffix is shown
/// verbatim so the user can compare it against the QR they scanned without
/// having to copy a long string.
class PairingConfirmationView extends StatelessWidget {
  const PairingConfirmationView({
    required this.payload,
    required this.onConfirm,
    required this.onDecline,
    this.hostIdSuffixOverride,
    super.key,
  });

  final PairingPayload payload;
  final Future<void> Function() onConfirm;
  final Future<void> Function() onDecline;

  /// Optional override for the displayed suffix. Manual recovery flows do not
  /// know the hostId until the bridge hello handshake completes, so the field
  /// is rendered as `—` in that case.
  final String? hostIdSuffixOverride;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final suffix = hostIdSuffixOverride ?? payload.hostIdSuffix;
    return Semantics(
      container: true,
      label: 'Pairing confirmation',
      child: Padding(
        padding: const EdgeInsets.all(PiSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Confirm host',
              style: text.headlineSmall,
              key: const Key('pairing-confirm-title'),
            ),
            const SizedBox(height: 4),
            Text(
              'Verify the host details match what you expect before pairing.',
              style: text.bodyMedium?.copyWith(color: colors.onSurfaceVariant),
            ),
            const SizedBox(height: 16),
            _ConfirmField(
              label: 'Host name',
              value: payload.displayName,
              keyName: 'pairing-confirm-display-name',
            ),
            const SizedBox(height: 8),
            _ConfirmField(
              label: 'Hostname',
              value: payload.hostname,
              keyName: 'pairing-confirm-hostname',
            ),
            const SizedBox(height: 8),
            _ConfirmField(
              label: 'Protocol',
              value: payload.protocolMajor.toString(),
              keyName: 'pairing-confirm-protocol',
            ),
            const SizedBox(height: 8),
            _ConfirmField(
              label: 'Host ID suffix',
              value: suffix.isEmpty ? '—' : suffix,
              keyName: 'pairing-confirm-host-suffix',
            ),
            const SizedBox(height: 8),
            _ConfirmField(
              label: 'Endpoint',
              value: payload.endpoint.toString(),
              keyName: 'pairing-confirm-endpoint',
            ),
            const Spacer(),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    key: const Key('pairing-confirm-decline'),
                    onPressed: () => onDecline(),
                    icon: const Icon(Icons.close),
                    label: const Text('Cancel'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton.icon(
                    key: const Key('pairing-confirm-accept'),
                    onPressed: () => onConfirm(),
                    icon: const Icon(Icons.check),
                    label: const Text('Pair'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _ConfirmField extends StatelessWidget {
  const _ConfirmField({
    required this.label,
    required this.value,
    required this.keyName,
  });

  final String label;
  final String value;
  final String keyName;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    return Semantics(
      container: true,
      label: '$label: $value',
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: PiSpacing.md,
          vertical: PiSpacing.sm,
        ),
        decoration: BoxDecoration(
          color: colors.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(PiRadius.md),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 140,
              child: Text(
                label,
                style: text.labelLarge?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
            ),
            Expanded(
              child: SelectableText(
                value,
                key: Key(keyName),
                style: text.bodyLarge,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
