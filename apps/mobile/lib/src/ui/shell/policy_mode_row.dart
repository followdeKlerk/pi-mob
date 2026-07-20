import 'dart:async';

import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../../domain/mobile_state.dart';
import '../theme/pi_theme.dart';

/// Read-only / Full segmented control bound to the selected session's policy
/// mode. Mirrors the prior inline behaviour; lifted into its own file so the
/// Sessions destination can compose it next to the session picker.
class PolicyModeRow extends StatelessWidget {
  const PolicyModeRow({
    required this.coordinator,
    required this.mode,
    required this.enabled,
    super.key,
  });

  final ConnectionCoordinator coordinator;
  final SessionPolicyMode mode;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Wrap(
      spacing: PiSpacing.md,
      runSpacing: PiSpacing.sm,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text('Policy: ', key: const Key('policy-mode-label')),
        SegmentedButton<SessionPolicyMode>(
          key: const Key('policy-mode-toggle'),
          segments: const [
            ButtonSegment(
              value: SessionPolicyMode.full,
              label: Text('Full'),
              icon: Icon(Icons.shield),
            ),
            ButtonSegment(
              value: SessionPolicyMode.readOnly,
              label: Text('Read-only'),
              icon: Icon(Icons.visibility),
            ),
          ],
          selected: {mode},
          onSelectionChanged: enabled
              ? (next) {
                  if (next.isEmpty) return;
                  unawaited(coordinator.setSessionPolicy(next.first));
                }
              : null,
        ),
        if (mode == SessionPolicyMode.readOnly)
          Container(
            key: const Key('read-only-indicator'),
            padding: const EdgeInsets.symmetric(
              horizontal: PiSpacing.sm,
              vertical: PiSpacing.xs,
            ),
            decoration: BoxDecoration(
              color: colors.tertiaryContainer,
              borderRadius: BorderRadius.circular(PiRadius.sm),
            ),
            child: Text(
              'Read-only',
              style: TextStyle(color: colors.onTertiaryContainer),
            ),
          ),
      ],
    );
  }
}
