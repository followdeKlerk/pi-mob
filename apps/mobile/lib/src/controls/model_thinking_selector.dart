import 'package:flutter/material.dart';

import 'control_view_data.dart';
import 'unsupported_control_state.dart';

/// Configured-host model and thinking selector.
class ModelThinkingSelector extends StatelessWidget {
  const ModelThinkingSelector({
    required this.data,
    required this.callbacks,
    super.key,
  });

  final ModelThinkingViewData data;
  final ModelThinkingCallbacks callbacks;

  @override
  Widget build(BuildContext context) {
    if (data.models.isEmpty && data.unavailableRestoredModel == null) {
      return const UnsupportedControlState(
        feature: 'Model selection',
        explanation: 'The host did not report any configured models.',
      );
    }
    final grouped = <String, List<ModelOptionData>>{};
    for (final model in data.models) {
      grouped.putIfAbsent(model.provider, () => <ModelOptionData>[]).add(model);
    }
    final selected = data.selectedModel;
    final enabled = data.enabled && callbacks.onModelSelected != null;
    return Semantics(
      container: true,
      label: 'Model and thinking controls',
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Model', style: Theme.of(context).textTheme.titleMedium),
              if (data.unavailableRestoredModel case final restored?) ...[
                const SizedBox(height: 8),
                Semantics(
                  liveRegion: true,
                  label:
                      'Restored model unavailable: $restored. Select a configured model.',
                  child: Material(
                    key: const Key('unavailable-restored-model'),
                    color: Theme.of(context).colorScheme.errorContainer,
                    borderRadius: BorderRadius.circular(8),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.warning_amber_rounded),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Restored model “$restored” is no longer available. '
                              'Select a configured model to continue.',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
              if (!data.enabled && data.disabledReason != null) ...[
                const SizedBox(height: 8),
                Text(
                  data.disabledReason!,
                  key: const Key('model-disabled-reason'),
                ),
              ],
              const SizedBox(height: 8),
              for (final entry in grouped.entries) ...[
                Text(entry.key, style: Theme.of(context).textTheme.labelLarge),
                const SizedBox(height: 4),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final model in entry.value)
                      ChoiceChip(
                        key: ValueKey('model-${model.id}'),
                        label: Text(model.label),
                        selected: selected?.id == model.id,
                        onSelected: enabled
                            ? (chosen) {
                                if (chosen) {
                                  callbacks.onModelSelected!(model.id);
                                }
                              }
                            : null,
                      ),
                  ],
                ),
                const SizedBox(height: 8),
              ],
              if (selected != null) ...[
                const SizedBox(height: 4),
                if (selected.thinkingLevels.isEmpty)
                  const UnsupportedControlState(
                    feature: 'Thinking level',
                    explanation:
                        'The selected model does not expose thinking levels.',
                  )
                else
                  DropdownButtonFormField<String>(
                    key: const Key('thinking-selector'),
                    initialValue:
                        selected.thinkingLevels.contains(
                          data.selectedThinkingLevel,
                        )
                        ? data.selectedThinkingLevel
                        : null,
                    decoration: const InputDecoration(
                      labelText: 'Thinking level',
                      border: OutlineInputBorder(),
                    ),
                    isExpanded: true,
                    items: [
                      for (final level in selected.thinkingLevels)
                        DropdownMenuItem(value: level, child: Text(level)),
                    ],
                    onChanged: data.enabled
                        ? (value) {
                            if (value != null) {
                              callbacks.onThinkingSelected?.call(value);
                            }
                          }
                        : null,
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
