import 'package:flutter/material.dart';

import 'control_view_data.dart';

/// Advisory context/token/cost values. Missing values are shown as unknown,
/// never coerced to zero, and the cost copy explicitly avoids a spending-cap
/// promise.
class ContextStatsCard extends StatelessWidget {
  const ContextStatsCard({required this.data, super.key});

  final ContextStatsViewData data;

  String _tokens(int? value) => value == null ? 'Unknown' : _compact(value);

  String _compact(int value) {
    if (value >= 1000000) return '${(value / 1000000).toStringAsFixed(1)}M';
    if (value >= 1000) return '${(value / 1000).toStringAsFixed(1)}K';
    return '$value';
  }

  @override
  Widget build(BuildContext context) {
    final fraction = data.contextFraction;
    final contextValue = data.contextTokens == null
        ? 'Unknown'
        : data.contextWindowTokens == null
        ? _compact(data.contextTokens!)
        : '${_compact(data.contextTokens!)} / ${_compact(data.contextWindowTokens!)}';
    final cost = data.costUsd == null
        ? 'Unknown'
        : '\$${data.costUsd!.toStringAsFixed(4)}';
    return Semantics(
      container: true,
      label:
          'Session statistics. Tokens ${_tokens(data.sessionTokens)}. Context $contextValue. Cost $cost. ${data.advisory}. Advisory estimates only.',
      child: Card(
        key: const Key('context-stats-card'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Session statistics',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 24,
                runSpacing: 12,
                children: [
                  _Stat(label: 'Tokens', value: _tokens(data.sessionTokens)),
                  _Stat(label: 'Context', value: contextValue),
                  _Stat(label: 'Cost', value: cost),
                ],
              ),
              if (fraction != null) ...[
                const SizedBox(height: 12),
                LinearProgressIndicator(
                  key: const Key('context-usage'),
                  value: fraction,
                  semanticsLabel:
                      'Context usage ${(fraction * 100).round()} percent',
                ),
              ],
              const SizedBox(height: 12),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.info_outline, size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '${data.advisory}. Values are estimates, not a spending cap.',
                      key: const Key('context-advisory'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 96,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.labelMedium),
        const SizedBox(height: 2),
        Text(value, style: Theme.of(context).textTheme.titleSmall),
      ],
    ),
  );
}
