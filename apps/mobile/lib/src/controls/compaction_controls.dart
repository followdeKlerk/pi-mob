import 'package:flutter/material.dart';

import 'control_view_data.dart';
import 'unsupported_control_state.dart';

/// Manual/automatic compaction controls and explicit lifecycle state.
class CompactionControls extends StatelessWidget {
  const CompactionControls({
    required this.data,
    required this.callbacks,
    super.key,
  });

  final CompactionViewData data;
  final CompactionCallbacks callbacks;

  String get _status => switch (data.phase) {
    CompactionPhase.idle => 'Ready to compact',
    CompactionPhase.compacting => 'Compacting context',
    CompactionPhase.summarizing => 'Creating summary',
    CompactionPhase.completed => 'Compaction complete',
    CompactionPhase.failed => 'Compaction failed',
    CompactionPhase.unavailable => 'Compaction unavailable',
  };

  bool get _busy =>
      data.phase == CompactionPhase.compacting ||
      data.phase == CompactionPhase.summarizing;

  @override
  Widget build(BuildContext context) {
    if (data.phase == CompactionPhase.unavailable && data.autoCompact == null) {
      return const UnsupportedControlState(
        feature: 'Compaction controls',
        explanation: 'This host does not support session compaction controls.',
      );
    }
    return Semantics(
      container: true,
      liveRegion: _busy || data.phase == CompactionPhase.completed,
      label: 'Compaction controls. $_status',
      child: Card(
        key: const Key('compaction-controls'),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 8, 8, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SwitchListTile(
                key: const Key('auto-compaction-toggle'),
                title: const Text('Auto compaction'),
                subtitle: const Text('Let Pi compact context when needed'),
                value: data.autoCompact ?? false,
                onChanged: data.autoCompact == null || _busy
                    ? null
                    : callbacks.onAutoCompactChanged,
              ),
              ListTile(
                leading: Icon(
                  _busy
                      ? Icons.compress
                      : data.phase == CompactionPhase.failed
                      ? Icons.error_outline
                      : Icons.check_circle_outline,
                ),
                title: Text(_status, key: const Key('compaction-status')),
                subtitle: data.message == null ? null : Text(data.message!),
              ),
              if (data.summary case final summary?) ...[
                const Divider(),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  child: Text(
                    summary,
                    key: const Key('compaction-summary'),
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ),
              ],
              const SizedBox(height: 8),
              FilledButton.tonalIcon(
                key: const Key('start-compaction'),
                onPressed: data.canStart && !_busy ? callbacks.onStart : null,
                icon: const Icon(Icons.compress),
                label: const Text('Compact now'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
