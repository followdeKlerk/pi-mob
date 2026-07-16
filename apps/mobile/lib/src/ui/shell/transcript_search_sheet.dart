import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../connection/connection_coordinator.dart';
import '../../domain/mobile_state.dart';
import '../theme/pi_theme.dart';

Future<void> showTranscriptSearch(
  BuildContext context,
  ConnectionCoordinator coordinator,
) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (_) => TranscriptSearchSheet(coordinator: coordinator),
);

class TranscriptSearchSheet extends StatefulWidget {
  const TranscriptSearchSheet({required this.coordinator, super.key});
  final ConnectionCoordinator coordinator;

  @override
  State<TranscriptSearchSheet> createState() => _TranscriptSearchSheetState();
}

class _TranscriptSearchSheetState extends State<TranscriptSearchSheet> {
  String query = '';

  String? _text(StreamEventState event) {
    if (event.type == 'turn.started') return event.payload['message'] as String?;
    if (event.type == 'assistant.delta') {
      return (event.payload['text'] ?? event.payload['delta']) as String?;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final sessionId = widget.coordinator.selectedSessionId;
    final q = query.trim().toLowerCase();
    final results = sessionId == null
        ? <({StreamEventState event, String text})>[]
        : widget.coordinator
              .transcriptEvents(sessionId)
              .map((event) => (event: event, text: _text(event)))
              .where((item) =>
                  item.text != null &&
                  q.isNotEmpty &&
                  item.text!.toLowerCase().contains(q))
              .map((item) => (event: item.event, text: item.text!))
              .toList(growable: false);
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * .82,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(PiSpacing.md),
              child: TextField(
                key: const Key('transcript-search-input'),
                autofocus: true,
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  labelText: 'Search this chat',
                  border: OutlineInputBorder(),
                ),
                onChanged: (value) => setState(() => query = value),
              ),
            ),
            Expanded(
              child: q.isEmpty
                  ? const Center(child: Text('Type to search local messages'))
                  : results.isEmpty
                  ? const Center(child: Text('No matches'))
                  : ListView.separated(
                      itemCount: results.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final result = results[index];
                        return ListTile(
                          leading: Icon(
                            result.event.type == 'turn.started'
                                ? Icons.person_outline
                                : Icons.smart_toy_outlined,
                          ),
                          title: Text(
                            result.text,
                            maxLines: 4,
                            overflow: TextOverflow.ellipsis,
                          ),
                          subtitle: Text(
                            result.event.type == 'turn.started'
                                ? 'Your prompt'
                                : 'Assistant response',
                          ),
                          trailing: IconButton(
                            tooltip: 'Copy match',
                            icon: const Icon(Icons.copy_outlined),
                            onPressed: () => Clipboard.setData(
                              ClipboardData(text: result.text),
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
