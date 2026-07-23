import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../theme/pi_theme.dart';
import 'connection_panel.dart';
import 'privacy_explanation.dart';

/// Body for the Host destination — the calm home of endpoint entry, version/
/// generation details, and the privacy/connection explanation.
///
/// The technical surface deliberately lives here, not on the daily Sessions
/// or Activity destination, so the user can keep working without staring at
/// bridge/protocol counters.
class HostDestination extends StatelessWidget {
  const HostDestination({
    required this.coordinator,
    required this.endpointController,
    super.key,
  });

  final ConnectionCoordinator coordinator;
  final TextEditingController endpointController;

  @override
  Widget build(BuildContext context) {
    return ListView(
      key: const Key('host-destination-scroll'),
      padding: const EdgeInsets.fromLTRB(
        PiSpacing.lg,
        PiSpacing.md,
        PiSpacing.lg,
        PiSpacing.xl,
      ),
      children: [
        ConnectionPanel(
          coordinator: coordinator,
          endpointController: endpointController,
        ),
        const SizedBox(height: PiSpacing.lg),
        const PrivacyExplanation(),
      ],
    );
  }
}
