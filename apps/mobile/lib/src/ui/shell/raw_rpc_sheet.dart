import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../connection/connection_coordinator.dart';
import '../theme/pi_theme.dart';

Future<void> showRawRpcSheet(
  BuildContext context, {
  required ConnectionCoordinator coordinator,
  required String sessionId,
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (_) => FractionallySizedBox(
    heightFactor: 0.9,
    child: RawRpcSheet(coordinator: coordinator, sessionId: sessionId),
  ),
);

class RawRpcSheet extends StatefulWidget {
  const RawRpcSheet({
    required this.coordinator,
    required this.sessionId,
    this.sendForTest,
    super.key,
  });

  final ConnectionCoordinator coordinator;
  final String sessionId;
  @visibleForTesting
  final Future<Map<String, Object?>> Function(Map<String, Object?> command)?
  sendForTest;

  @override
  State<RawRpcSheet> createState() => _RawRpcSheetState();
}

class _RawRpcSheetState extends State<RawRpcSheet> {
  final TextEditingController _command = TextEditingController(
    text: const JsonEncoder.withIndent(
      '  ',
    ).convert(<String, Object?>{'type': 'get_state'}),
  );
  final TextEditingController _response = TextEditingController();
  final TextEditingController _events = TextEditingController();
  StreamSubscription<Object?>? _responseSubscription;
  String? _requestId;
  String? _error;

  @override
  void initState() {
    super.initState();
    widget.coordinator.addListener(_refreshEvents);
    _refreshEvents();
  }

  @override
  void dispose() {
    widget.coordinator.removeListener(_refreshEvents);
    unawaited(_responseSubscription?.cancel());
    _command.dispose();
    _response.dispose();
    _events.dispose();
    super.dispose();
  }

  void _refreshEvents() {
    final encoder = const JsonEncoder.withIndent('  ');
    final text = widget.coordinator
        .rawPiEventsForSession(widget.sessionId)
        .map((item) => encoder.convert(item.event))
        .join('\n\n');
    if (_events.text != text) _events.text = text;
    if (mounted) setState(() {});
  }

  Future<void> _send() async {
    setState(() => _error = null);
    try {
      final decoded = jsonDecode(_command.text);
      if (decoded is! Map)
        throw const FormatException('Command must be a JSON object');
      final command = Map<String, Object?>.from(decoded);
      if (command['type'] is! String || (command['type'] as String).isEmpty) {
        throw const FormatException('Command requires a non-empty type');
      }
      if (widget.sendForTest case final send?) {
        _response.text = const JsonEncoder.withIndent(
          '  ',
        ).convert(await send(command));
        if (mounted) setState(() {});
        return;
      }
      final requestId = 'raw-${DateTime.now().microsecondsSinceEpoch}';
      await _responseSubscription?.cancel();
      _requestId = requestId;
      _responseSubscription = widget.coordinator
          .rawRpcResponsesFor(widget.sessionId, requestId)
          .listen((response) {
            _response.text = const JsonEncoder.withIndent(
              '  ',
            ).convert(response.response);
            if (mounted) setState(() {});
          });
      await widget.coordinator.sendRawRpc(
        sessionId: widget.sessionId,
        requestId: requestId,
        command: command,
      );
    } on Object catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  Future<void> _copy() => Clipboard.setData(
    ClipboardData(text: '${_response.text}\n\n${_events.text}'.trim()),
  );

  void _clear() {
    widget.coordinator.clearRawRpcState(
      sessionId: widget.sessionId,
      requestId: _requestId,
    );
    _response.clear();
    _events.clear();
    setState(() => _error = null);
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(
        16,
        0,
        16,
        MediaQuery.viewInsetsOf(context).bottom + 16,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Raw Pi RPC', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          TextField(
            key: const Key('raw-rpc-command-editor'),
            controller: _command,
            maxLines: 8,
            decoration: const InputDecoration(
              labelText: 'Command JSON',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 8),
          FilledButton.icon(
            key: const Key('raw-rpc-send'),
            onPressed: _send,
            icon: const Icon(Icons.send),
            label: const Text('Send'),
          ),
          if (_error case final error?)
            Padding(
              padding: const EdgeInsets.only(top: PiSpacing.sm),
              child: Text(
                error,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          const SizedBox(height: 16),
          TextField(
            key: const Key('raw-rpc-response'),
            controller: _response,
            readOnly: true,
            maxLines: 8,
            decoration: const InputDecoration(
              labelText: 'Formatted response',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            key: const Key('raw-rpc-events'),
            controller: _events,
            readOnly: true,
            maxLines: 12,
            decoration: const InputDecoration(
              labelText: 'Streamed raw events',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              TextButton.icon(
                key: const Key('raw-rpc-copy'),
                onPressed: _copy,
                icon: const Icon(Icons.copy_outlined),
                label: const Text('Copy'),
              ),
              TextButton.icon(
                key: const Key('raw-rpc-clear'),
                onPressed: _clear,
                icon: const Icon(Icons.clear),
                label: const Text('Clear'),
              ),
            ],
          ),
        ],
      ),
    ),
  );
}
