import 'package:flutter/material.dart';

import '../ui/theme/pi_tokens.dart';
import 'pairing_flow.dart';
import 'pairing_payload.dart';

typedef PairingSubmit = Future<void> Function(PairingPayload payload);
typedef ForgetHostAction = Future<void> Function();

class PairingScreen extends StatefulWidget {
  const PairingScreen({
    required this.onPair,
    required this.onForgetHost,
    this.allowForgetWhenUnpaired = false,
    super.key,
  });
  final PairingSubmit onPair;
  final ForgetHostAction onForgetHost;
  final bool allowForgetWhenUnpaired;
  @override
  State<PairingScreen> createState() => _PairingScreenState();
}

class _PairingScreenState extends State<PairingScreen> {
  late final PairingFlowController _flow;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _flow = PairingFlowController()..addListener(_changed);
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _flow.dispose();
    super.dispose();
  }

  Future<void> _pair() async {
    if (_busy || !_flow.submit()) return;
    final candidate = _flow.candidate;
    if (candidate == null) return;
    setState(() => _busy = true);
    try {
      await widget.onPair(candidate);
      _flow.confirm();
    } on Object catch (error) {
      _flow.reset();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Pairing failed: $error')),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Pair host'),
        actions: [
          if (widget.allowForgetWhenUnpaired)
            IconButton(
              key: const Key('pairing-forget-from-unpaired'),
              tooltip: 'Forget host',
              onPressed: _busy ? null : widget.onForgetHost,
              icon: const Icon(Icons.delete_outline),
            ),
        ],
      ),
      body: SafeArea(
        child: _flow.phase == PairingPhase.rejected
            ? _RejectionPanel(flow: _flow)
            : _PairForm(flow: _flow, busy: _busy, onPair: _pair),
      ),
    );
  }
}

class _PairForm extends StatefulWidget {
  const _PairForm({
    required this.flow,
    required this.busy,
    required this.onPair,
  });
  final PairingFlowController flow;
  final bool busy;
  final VoidCallback onPair;
  @override
  State<_PairForm> createState() => _PairFormState();
}

class _PairFormState extends State<_PairForm> {
  late final TextEditingController _endpoint;
  late final TextEditingController _passcode;

  @override
  void initState() {
    super.initState();
    _endpoint = TextEditingController(text: widget.flow.typedEndpoint);
    _passcode = TextEditingController(text: widget.flow.typedPasscode);
  }

  @override
  void dispose() {
    _endpoint.dispose();
    _passcode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final flow = widget.flow;
    final theme = Theme.of(context);
    return ListView(
      key: const Key('pairing-form'),
      padding: const EdgeInsets.all(PiSpacing.lg),
      children: [
        Text('Connect to your bridge', style: theme.textTheme.headlineSmall),
        const SizedBox(height: 8),
        Text(
          'Enter the HTTPS endpoint and the short passcode shown by `pi-mob pair`.',
          style: theme.textTheme.bodyMedium,
        ),
        const SizedBox(height: 20),
        Semantics(
          label: 'Bridge endpoint',
          textField: true,
          child: TextField(
            key: const Key('manual-endpoint-field'),
            controller: _endpoint,
            autocorrect: false,
            enableSuggestions: false,
            keyboardType: TextInputType.url,
            onChanged: flow.updateTypedEndpoint,
            decoration: InputDecoration(
              labelText: 'Bridge endpoint',
              hintText: 'https://host.tailnet.ts.net:8788',
              errorText: flow.typedEndpointError,
              border: const OutlineInputBorder(),
            ),
          ),
        ),
        const SizedBox(height: 16),
        Semantics(
          label: 'Six-digit passcode',
          textField: true,
          child: TextField(
            key: const Key('pairing-passcode-field'),
            controller: _passcode,
            autocorrect: false,
            enableSuggestions: false,
            keyboardType: TextInputType.number,
            maxLength: 6,
            onChanged: flow.updateTypedPasscode,
            decoration: InputDecoration(
              labelText: 'Six-digit passcode',
              errorText: flow.typedPasscodeError,
              border: const OutlineInputBorder(),
            ),
          ),
        ),
        const SizedBox(height: 12),
        FilledButton.icon(
          key: const Key('pairing-submit'),
          onPressed: widget.busy ? null : widget.onPair,
          icon: const Icon(Icons.link),
          label: Text(widget.busy ? 'Connecting…' : 'Pair'),
        ),
      ],
    );
  }
}

class _RejectionPanel extends StatelessWidget {
  const _RejectionPanel({required this.flow});
  final PairingFlowController flow;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(PiSpacing.lg),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Pairing rejected',
          key: const Key('pairing-rejection-title'),
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 8),
        Text(
          flow.rejection?.technicalReason ?? 'Pairing input was rejected',
          key: const Key('pairing-rejection-message'),
        ),
        const Spacer(),
        FilledButton(
          key: const Key('pairing-rejection-retry'),
          onPressed: flow.reset,
          child: const Text('Try again'),
        ),
      ],
    ),
  );
}
