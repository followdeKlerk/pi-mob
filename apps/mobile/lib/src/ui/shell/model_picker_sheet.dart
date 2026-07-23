import 'package:flutter/material.dart';

import '../../connection/connection_coordinator.dart';
import '../../controls/control_view_data.dart';
import '../../controls/model_thinking_selector.dart';
import '../theme/pi_theme.dart';

Future<void> showModelPickerSheet(
  BuildContext context,
  ConnectionCoordinator coordinator,
) async {
  try {
    await coordinator.requestModels();
  } on Object {
    if (!context.mounted) return;
    ScaffoldMessenger.maybeOf(
      context,
    )?.showSnackBar(const SnackBar(content: Text('Could not load models.')));
    return;
  }
  if (!context.mounted) return;
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _ModelPickerBody(coordinator: coordinator),
  );
}

class _ModelPickerBody extends StatefulWidget {
  const _ModelPickerBody({required this.coordinator});
  final ConnectionCoordinator coordinator;

  @override
  State<_ModelPickerBody> createState() => _ModelPickerBodyState();
}

class _ModelPickerBodyState extends State<_ModelPickerBody> {
  @override
  void initState() {
    super.initState();
    widget.coordinator.addListener(_changed);
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    widget.coordinator.removeListener(_changed);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final coordinator = widget.coordinator;
    final controls = coordinator.selectedControls;
    final runtime = coordinator.selectedRuntimeState;
    final mutable =
        runtime == null || runtime == 'idle' || runtime == 'stopped';
    final models = coordinator.configuredModels
        .where((model) => model.available)
        .map(
          (model) => ModelOptionData(
            id: model.id,
            label: model.label,
            provider: model.provider ?? 'configured',
            thinkingLevels: const [
              'off',
              'minimal',
              'low',
              'medium',
              'high',
              'xhigh',
            ],
          ),
        )
        .toList(growable: false);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: PiSpacing.md,
          right: PiSpacing.md,
          bottom: MediaQuery.viewInsetsOf(context).bottom + PiSpacing.lg,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Model',
              style: Theme.of(
                context,
              ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: PiSpacing.sm),
            Text(
              'Choose a model configured on your Pi host.',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: PiSpacing.md),
            ModelThinkingSelector(
              data: ModelThinkingViewData(
                models: models,
                selectedModelId: controls?.modelId,
                selectedThinkingLevel: controls?.thinkingLevel,
                unavailableRestoredModel: controls?.modelUnavailable == true
                    ? controls?.modelId
                    : null,
                enabled: mutable,
                disabledReason: mutable
                    ? null
                    : 'Change the model after the current turn finishes.',
              ),
              callbacks: ModelThinkingCallbacks(
                onModelSelected: mutable
                    ? (id) async {
                        await coordinator.setModel(id);
                        if (context.mounted) Navigator.of(context).pop();
                      }
                    : null,
                onThinkingSelected: mutable ? coordinator.setThinking : null,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
