import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../theme/pi_theme.dart';

/// Compact host connection panel.
///
/// Hosts the endpoint input, the connect button, and a concise summary of the
/// host handshake data (`bridgeVersion`, `piVersion`, `protocolVersion`,
/// `hostGeneration`). Protocol/version details are deliberately tabled here
/// and on the dedicated Host destination so they never dominate the daily
/// Session/Activity journey.
///
/// End-user surface-level keys (`endpoint-field`, `connect-button`,
/// `connection-state`, `connection-error`, `retry-connection`) are
/// contract-stable; downstream layers and tests rely on them.
class ConnectionPanel extends StatelessWidget {
  const ConnectionPanel({
    required this.coordinator,
    required this.endpointController,
    super.key,
  });

  final ConnectionCoordinator coordinator;
  final TextEditingController endpointController;

  @override
  Widget build(BuildContext context) {
    final probe = coordinator.readiness;
    final theme = Theme.of(context);
    final text = theme.textTheme;
    return Card(
      key: const Key('host-connection-card'),
      child: Padding(
        padding: const EdgeInsets.all(PiSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            LayoutBuilder(
              builder: (context, constraints) {
                final narrow =
                    constraints.maxWidth < 520 ||
                    MediaQuery.textScalerOf(context).scale(1) > 1.3;
                final endpoint = TextField(
                  key: const Key('endpoint-field'),
                  controller: endpointController,
                  autocorrect: false,
                  keyboardType: TextInputType.url,
                  decoration: const InputDecoration(
                    labelText: 'HTTPS endpoint',
                    hintText: 'https://host.tailnet.ts.net',
                    border: OutlineInputBorder(),
                  ),
                  onSubmitted: coordinator.connect,
                );
                final connect = FilledButton.icon(
                  key: const Key('connect-button'),
                  onPressed: () => coordinator.connect(endpointController.text),
                  icon: const Icon(Icons.wifi_find),
                  label: const Text('Probe & connect'),
                );
                if (narrow) {
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      endpoint,
                      const SizedBox(height: PiSpacing.sm),
                      Align(alignment: Alignment.centerRight, child: connect),
                    ],
                  );
                }
                return Row(
                  children: [
                    Expanded(child: endpoint),
                    const SizedBox(width: PiSpacing.sm),
                    connect,
                  ],
                );
              },
            ),
            const SizedBox(height: PiSpacing.sm),
            DefaultTextStyle.merge(
              style:
                  text.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ) ??
                  const TextStyle(),
              child: Wrap(
                spacing: PiSpacing.md,
                runSpacing: PiSpacing.xs,
                children: [
                  Text(
                    'State: ${coordinator.phase.name}',
                    key: const Key('connection-state'),
                  ),
                  Text('Ready: ${probe?.ready ?? false}'),
                  Text('HTTP: ${probe?.statusCode ?? '—'}'),
                  Text('Host: ${coordinator.hostDisplayName ?? '—'}'),
                  Text('Bridge: ${coordinator.bridgeVersion ?? '—'}'),
                  Text('Pi: ${coordinator.piVersion ?? '—'}'),
                  Text('Protocol: ${coordinator.protocolVersion}'),
                  Text('Generation: ${coordinator.hostGeneration ?? '—'}'),
                ],
              ),
            ),
            if (coordinator.errorMessage != null) ...[
              const SizedBox(height: PiSpacing.sm),
              SelectableText(
                coordinator.errorMessage!,
                key: const Key('connection-error'),
                style: TextStyle(color: theme.colorScheme.error),
              ),
            ],
            if (!coordinator.isReady && coordinator.endpoint != null)
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  key: const Key('retry-connection'),
                  onPressed: coordinator.retryConnection,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Retry connection'),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
