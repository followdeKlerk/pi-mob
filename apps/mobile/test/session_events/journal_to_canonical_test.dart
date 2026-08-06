import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/domain/mobile_state.dart';
import 'package:pi_mob/src/session_events/canonical_event.dart';
import 'package:pi_mob/src/session_events/journal_to_canonical.dart';
import 'package:pi_mob/src/session_events/session_event_repository.dart';
import 'package:pi_mob/src/session_events/session_event_synchronizer.dart';

StreamEventState _journalEvent({
  required int cursor,
  required String type,
  required Map<String, Object?> payload,
  String eventId = 'ev',
  String streamId = 'session:s1',
}) => StreamEventState(
  hostId: 'host',
  streamId: streamId,
  cursor: StreamCursor.parse('$cursor'),
  eventId: '$eventId-$cursor',
  type: type,
  payload: payload,
  occurredAt: DateTime.utc(2026, 7, 14, 12, 0, cursor),
);

void main() {
  group('JournalToCanonicalAdapter', () {
    test('maps turn.started to turnStarted canonical event', () {
      final journal = _journalEvent(
        cursor: 1,
        type: 'turn.started',
        payload: <String, Object?>{'turnIndex': 1, 'message': 'hi'},
      );
      final result = adaptJournalEvent(journal, sessionId: 's1');
      expect(result.isAccepted, isTrue);
      expect(result.canonical!.type, CanonicalEventType.turnStarted);
      expect(result.canonical!.sequence, 1);
      expect(result.canonical!.payload['turnId'], '1');
    });

    test('maps tool.started with arguments', () {
      final journal = _journalEvent(
        cursor: 2,
        type: 'tool.started',
        payload: <String, Object?>{
          'turnIndex': 1,
          'toolCallId': 'read-1',
          'toolName': 'read',
          'arguments': <String, Object?>{'path': '/x'},
        },
      );
      final result = adaptJournalEvent(journal, sessionId: 's1');
      expect(result.isAccepted, isTrue);
      expect(result.canonical!.type, CanonicalEventType.toolCallStarted);
      expect(result.canonical!.payload['toolName'], 'read');
    });

    test(
      'drops assistant.delta without auxiliary context (no replacement)',
      () {
        final journal = _journalEvent(
          cursor: 3,
          type: 'assistant.delta',
          payload: <String, Object?>{'contentBlockId': 'a1', 'text': 'hi'},
        );
        final result = adaptJournalEvent(journal, sessionId: 's1');
        expect(result.isAccepted, isFalse);
        expect(result.droppedReason, 'unmappable_journal_type:assistant.delta');
      },
    );

    test('assistant delta adapter emits a replacement snapshot', () {
      final journal = _journalEvent(
        cursor: 3,
        type: 'assistant.delta',
        payload: <String, Object?>{'contentBlockId': 'a1', 'text': ' world'},
      );
      final result = adaptAssistantDelta(
        journal,
        sessionId: 's1',
        messageId: 'a1',
        turnId: 't1',
        previousContent: 'hello',
      );
      expect(result.isAccepted, isTrue);
      expect(
        result.canonical!.type,
        CanonicalEventType.assistantContentReplaced,
      );
      final blocks = result.canonical!.payload['content']! as List;
      expect(blocks, hasLength(1));
      final first = blocks.first as Map;
      expect(first['text'], 'hello world');
    });

    test('tool.output adapter emits a replacement progress snapshot', () {
      final journal = _journalEvent(
        cursor: 5,
        type: 'tool.output',
        payload: <String, Object?>{
          'toolCallId': 'tc1',
          'output': 'first chunk',
          'retainedBytes': 11,
          'totalBytes': 100,
        },
      );
      final result = adaptToolOutput(
        journal,
        sessionId: 's1',
        toolCallId: 'tc1',
        turnId: 't1',
      );
      expect(result.isAccepted, isTrue);
      expect(result.canonical!.type, CanonicalEventType.toolProgressReplaced);
      final progress = result.canonical!.payload['progress']! as Map;
      expect(progress['output'], 'first chunk');
    });

    test('event for the wrong stream is dropped', () {
      final journal = _journalEvent(
        cursor: 6,
        type: 'turn.started',
        payload: <String, Object?>{'turnIndex': 1},
        streamId: 'session:other',
      );
      final result = adaptJournalEvent(journal, sessionId: 's1');
      expect(result.isAccepted, isFalse);
      expect(result.droppedReason, 'wrong_stream');
    });

    test('full live->replay->cold-start equivalence', () async {
      // Live delivery: a complete chat exchange.
      final journal = <StreamEventState>[
        _journalEvent(
          cursor: 1,
          type: 'turn.started',
          payload: <String, Object?>{'turnIndex': 1, 'message': 'Hi'},
        ),
        _journalEvent(
          cursor: 2,
          type: 'assistant.started',
          payload: <String, Object?>{'contentBlockId': 'a1', 'turnIndex': 1},
        ),
        _journalEvent(
          cursor: 3,
          type: 'assistant.delta',
          payload: <String, Object?>{'contentBlockId': 'a1', 'text': 'first '},
        ),
        _journalEvent(
          cursor: 4,
          type: 'assistant.delta',
          payload: <String, Object?>{'contentBlockId': 'a1', 'text': 'second'},
        ),
        _journalEvent(
          cursor: 5,
          type: 'assistant.completed',
          payload: <String, Object?>{'contentBlockId': 'a1', 'turnIndex': 1},
        ),
        _journalEvent(
          cursor: 6,
          type: 'turn.settled',
          payload: <String, Object?>{'turnIndex': 1},
        ),
      ];

      // Feed the live synchronizer through the canonical adapter.
      final repository = CanonicalEventRepository.inMemory('s1');
      try {
        final live = SessionEventSynchronizer(
          sessionId: 's1',
          repository: repository,
        );
        var assistantBuffer = '';
        for (final event in journal) {
          final adapted = adaptJournalEvent(event, sessionId: 's1');
          if (adapted.isAccepted) {
            await live.accept(adapted.canonical!);
            continue;
          }
          if (event.type == 'assistant.delta') {
            final messageId =
                (event.payload['contentBlockId'] as String?) ?? 'a1';
            final next = adaptAssistantDelta(
              event,
              sessionId: 's1',
              messageId: messageId,
              turnId: 't1',
              previousContent: assistantBuffer,
            );
            assistantBuffer = next.canonical!.payload['content'] == null
                ? assistantBuffer
                : ((next.canonical!.payload['content']! as List).first
                          as Map)['text']
                      as String;
            await live.accept(next.canonical!);
          }
        }

        // Cold-start replay path.
        final cold = SessionEventSynchronizer(
          sessionId: 's1',
          repository: repository,
        );
        await cold.replayFromCache();

        // The two projections are equal.
        expect(live.state, equals(cold.state));
        expect(live.lastAppliedSequence, cold.lastAppliedSequence);
        expect(live.lastAppliedSequence, 6);
      } finally {
        await repository.close();
      }
    });
  });
}
