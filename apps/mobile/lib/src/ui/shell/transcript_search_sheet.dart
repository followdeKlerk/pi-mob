import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../connection/connection_coordinator.dart';
import '../../session_events/transcript_reducer.dart';
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

  List<({String type, String text})> _canonicalResults(
    CanonicalTranscriptState state,
  ) => <({String type, String text})>[
    ...state.userMessages.values.map(
      (message) => (type: 'user.message.created', text: message.text),
    ),
    ...state.assistantMessages.values.map(
      (message) => (
        type: 'assistant.message.completed',
        text: message.content.map((block) => block.text).join('\\n'),
      ),
    ),
    ...state.toolCalls.values.map(
      (tool) => (
        type: 'tool.completed',
        text: <String>[
          tool.toolName,
          if (tool.result != null) tool.result.toString(),
          if (tool.errorMessage != null) tool.errorMessage!,
        ].join('\\n'),
      ),
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final sessionId = widget.coordinator.selectedSessionId;
    final q = query.trim().toLowerCase();
    final candidates = sessionId == null
        ? <({String type, String text})>[]
        : _canonicalResults(
            widget.coordinator.canonicalTranscriptStateFor(sessionId) ??
                CanonicalTranscriptState(sessionId: sessionId),
          );
    final results = candidates
        .where((item) => q.isNotEmpty && item.text.toLowerCase().contains(q))
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
            if (q.isNotEmpty)
              Semantics(
                liveRegion: true,
                label: '${results.length} matches',
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: PiSpacing.md),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text('${results.length} matches'),
                  ),
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
                        return Semantics(
                          label: 'Result ${index + 1} of ${results.length}',
                          child: ListTile(
                            leading: Icon(
                              result.type == 'user.message.created'
                                  ? Icons.person_outline
                                  : Icons.smart_toy_outlined,
                            ),
                            title: Text(
                              result.text,
                              maxLines: 4,
                              overflow: TextOverflow.ellipsis,
                            ),
                            subtitle: Text(
                              result.type == 'user.message.created'
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
