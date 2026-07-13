import 'package:flutter/material.dart';

import 'pairing_flow.dart';

/// Manual endpoint entry view.
///
/// The text field accepts an HTTPS origin only; the flow controller runs the
/// strict [validateManualEndpoint] check. Inline error messages and the
/// concise label are designed for screen-reader narration: the validation
/// reason is announced as a live region when the user submits.
class ManualEndpointView extends StatefulWidget {
  const ManualEndpointView({required this.controller, super.key});

  final PairingFlowController controller;

  @override
  State<ManualEndpointView> createState() => _ManualEndpointViewState();
}

class _ManualEndpointViewState extends State<ManualEndpointView> {
  late final TextEditingController _text;

  @override
  void initState() {
    super.initState();
    _text = TextEditingController(text: widget.controller.typedEndpoint);
    widget.controller.addListener(_syncFromController);
  }

  void _syncFromController() {
    if (!mounted) return;
    final external = widget.controller.typedEndpoint;
    if (_text.text != external) {
      _text.value = TextEditingValue(
        text: external,
        selection: TextSelection.collapsed(offset: external.length),
      );
    }
    setState(() {});
  }

  @override
  void dispose() {
    widget.controller.removeListener(_syncFromController);
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final errorText = widget.controller.typedEndpointError;
    return Semantics(
      container: true,
      label: 'Manual endpoint entry',
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Enter an HTTPS endpoint',
              style: theme.textTheme.headlineSmall,
              key: const Key('manual-endpoint-title'),
            ),
            const SizedBox(height: 4),
            Text(
              'Use the full Tailscale MagicDNS origin, e.g. '
              'https://host.tailnet-name.ts.net',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              key: const Key('manual-endpoint-field'),
              controller: _text,
              autocorrect: false,
              enableSuggestions: false,
              keyboardType: TextInputType.url,
              decoration: InputDecoration(
                labelText: 'HTTPS endpoint',
                hintText: 'https://host.tailnet-name.ts.net',
                border: const OutlineInputBorder(),
                errorText: errorText,
              ),
              onChanged: widget.controller.updateTypedEndpoint,
              onSubmitted: (_) => widget.controller.submitTypedEndpoint(),
            ),
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton.icon(
                key: const Key('manual-endpoint-submit'),
                onPressed: () => widget.controller.submitTypedEndpoint(),
                icon: const Icon(Icons.wifi_tethering),
                label: const Text('Continue'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
