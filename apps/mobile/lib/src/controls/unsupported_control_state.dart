import 'package:flutter/material.dart';

/// Explicit presentation for a capability the current host/session cannot
/// provide. This is intentionally reusable instead of silently hiding a row.
class UnsupportedControlState extends StatelessWidget {
  const UnsupportedControlState({
    required this.feature,
    required this.explanation,
    super.key,
  });

  final String feature;
  final String explanation;

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    label: '$feature unavailable. $explanation',
    child: Card(
      key: const Key('unsupported-control-state'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.block_outlined),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '$feature unavailable',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: 4),
                  Text(explanation),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}
