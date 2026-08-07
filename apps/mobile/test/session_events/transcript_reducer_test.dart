import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/session_events/canonical_event.dart';
import 'package:pi_mob/src/session_events/canonical_transcript_document.dart';
import 'package:pi_mob/src/session_events/transcript_reducer.dart';
import 'package:pi_mob/src/transcript/domain/transcript_items.dart';
import 'package:pi_mob/src/transcript/domain/transcript_turn.dart';

CanonicalSessionEvent _user({
  required String messageId,
  required String turnId,
  String text = 'hello',
  required int sequence,
  String eventId = 'user',
  DateTime? occurredAt,
}) => CanonicalSessionEvent(
  eventId: eventId,
  sessionId: 's1',
  sequence: sequence,
  type: CanonicalEventType.userMessageCreated,
  occurredAt: occurredAt ?? DateTime.utc(2026, 7, 14, 12, 0, sequence),
  payload: <String, Object?>{
    'turnId': turnId,
    'messageId': messageId,
    'text': text,
  },
);

CanonicalSessionEvent _assistantStart({
  required String turnId,
  required String messageId,
  required int sequence,
  String eventId = 'a-start',
}) => CanonicalSessionEvent(
  eventId: eventId,
  sessionId: 's1',
  sequence: sequence,
  type: CanonicalEventType.assistantStarted,
  occurredAt: DateTime.utc(2026, 7, 14, 12, 0, sequence),
  payload: <String, Object?>{'turnId': turnId, 'messageId': messageId},
);

CanonicalSessionEvent _assistantContent({
  required String turnId,
  required String messageId,
  required String text,
  required int sequence,
  String eventId = 'a-replace',
}) => CanonicalSessionEvent(
  eventId: eventId,
  sessionId: 's1',
  sequence: sequence,
  type: CanonicalEventType.assistantContentReplaced,
  occurredAt: DateTime.utc(2026, 7, 14, 12, 0, sequence),
  payload: <String, Object?>{
    'turnId': turnId,
    'messageId': messageId,
    'content': <Map<String, Object?>>[
      <String, Object?>{'kind': 'text', 'text': text},
    ],
  },
);

CanonicalSessionEvent _assistantCompleted({
  required String turnId,
  required String messageId,
  required int sequence,
  String eventId = 'a-completed',
}) => CanonicalSessionEvent(
  eventId: eventId,
  sessionId: 's1',
  sequence: sequence,
  type: CanonicalEventType.assistantMessageCompleted,
  occurredAt: DateTime.utc(2026, 7, 14, 12, 0, sequence),
  payload: <String, Object?>{'turnId': turnId, 'messageId': messageId},
);

CanonicalSessionEvent _toolStart({
  required String turnId,
  required String toolCallId,
  String toolName = 'read',
  Map<String, Object?>? args,
  required int sequence,
  String eventId = 't-start',
}) => CanonicalSessionEvent(
  eventId: eventId,
  sessionId: 's1',
  sequence: sequence,
  type: CanonicalEventType.toolCallStarted,
  occurredAt: DateTime.utc(2026, 7, 14, 12, 0, sequence),
  payload: <String, Object?>{
    'turnId': turnId,
    'toolCallId': toolCallId,
    'toolName': toolName,
    'arguments': args ?? <String, Object?>{},
  },
);

CanonicalSessionEvent _toolProgress({
  required String turnId,
  required String toolCallId,
  required Map<String, Object?> progress,
  required int sequence,
  String eventId = 't-progress',
}) => CanonicalSessionEvent(
  eventId: eventId,
  sessionId: 's1',
  sequence: sequence,
  type: CanonicalEventType.toolProgressReplaced,
  occurredAt: DateTime.utc(2026, 7, 14, 12, 0, sequence),
  payload: <String, Object?>{
    'turnId': turnId,
    'toolCallId': toolCallId,
    'progress': progress,
  },
);

CanonicalSessionEvent _toolCompleted({
  required String turnId,
  required String toolCallId,
  required Map<String, Object?> result,
  required int sequence,
  String eventId = 't-completed',
}) => CanonicalSessionEvent(
  eventId: eventId,
  sessionId: 's1',
  sequence: sequence,
  type: CanonicalEventType.toolCallCompleted,
  occurredAt: DateTime.utc(2026, 7, 14, 12, 0, sequence),
  payload: <String, Object?>{
    'turnId': turnId,
    'toolCallId': toolCallId,
    'result': result,
  },
);

CanonicalSessionEvent _toolFailed({
  required String turnId,
  required String toolCallId,
  required String errorMessage,
  required int sequence,
  String eventId = 't-failed',
}) => CanonicalSessionEvent(
  eventId: eventId,
  sessionId: 's1',
  sequence: sequence,
  type: CanonicalEventType.toolCallFailed,
  occurredAt: DateTime.utc(2026, 7, 14, 12, 0, sequence),
  payload: <String, Object?>{
    'turnId': turnId,
    'toolCallId': toolCallId,
    'error': errorMessage,
  },
);

CanonicalSessionEvent _turn({
  required String turnId,
  required CanonicalEventType type,
  required int sequence,
  String eventId = 'turn',
}) => CanonicalSessionEvent(
  eventId: eventId,
  sessionId: 's1',
  sequence: sequence,
  type: type,
  occurredAt: DateTime.utc(2026, 7, 14, 12, 0, sequence),
  payload: <String, Object?>{'turnId': turnId},
);

CanonicalSessionEvent _event({
  required int sequence,
  required CanonicalEventType type,
  required Map<String, Object?> payload,
  String eventId = 'event',
}) => CanonicalSessionEvent(
  eventId: '$eventId-$sequence',
  sessionId: 's1',
  sequence: sequence,
  type: type,
  occurredAt: DateTime.utc(2026, 7, 14, 12, 0, sequence),
  payload: payload,
);

void main() {
  group('CanonicalTranscriptReducer', () {
    test('malformed completion does not create an empty assistant or duplicate tools', () {
      const turnId = 'turn-1';
      var state = CanonicalTranscriptState.empty('s1');
      final events = <CanonicalSessionEvent>[
        _event(sequence: 1, type: CanonicalEventType.userMessageCreated, payload: <String, Object?>{
          'turnId': turnId, 'messageId': 'user-1', 'text': 'pwd',
        }),
        _event(sequence: 2, type: CanonicalEventType.turnStarted, payload: <String, Object?>{'turnId': turnId}),
        _event(sequence: 3, type: CanonicalEventType.assistantMessageCompleted, payload: <String, Object?>{
          'turnId': turnId, 'messageId': '$turnId:0',
        }),
        _event(sequence: 4, type: CanonicalEventType.toolCallStarted, payload: <String, Object?>{
          'turnId': turnId, 'toolCallId': 'pwd', 'toolName': 'bash', 'arguments': <String, Object?>{},
        }),
        _event(sequence: 5, type: CanonicalEventType.toolCallCompleted, payload: <String, Object?>{
          'turnId': turnId, 'toolCallId': 'pwd', 'result': '/private/repo',
        }),
        _event(sequence: 6, type: CanonicalEventType.assistantStarted, payload: <String, Object?>{
          'turnId': turnId, 'messageId': '$turnId:assistant:1',
        }),
        _event(sequence: 7, type: CanonicalEventType.assistantContentReplaced, payload: <String, Object?>{
          'turnId': turnId, 'messageId': '$turnId:assistant:1', 'content': <Map<String, Object?>>[
            <String, Object?>{'kind': 'text', 'text': 'The working directory is /private/repo'},
          ],
        }),
        _event(sequence: 8, type: CanonicalEventType.assistantMessageCompleted, payload: <String, Object?>{
          'turnId': turnId, 'messageId': '$turnId:assistant:1',
        }),
        _event(sequence: 9, type: CanonicalEventType.assistantMessageCompleted, payload: <String, Object?>{
          'turnId': turnId, 'messageId': '$turnId:assistant',
        }),
        _event(sequence: 10, type: CanonicalEventType.turnSettled, payload: <String, Object?>{'turnId': turnId}),
      ];
      for (final event in events) state = applyCanonicalEvent(state, event);

      expect(state.assistantMessages, hasLength(1));
      expect(state.assistantMessages.values.single.content.single.text, contains('/private/repo'));
      expect(state.toolCalls, hasLength(1));
      final document = projectCanonicalToDocument(state);
      final toolCards = document.turns
          .whereType<AssistantTurn>()
          .expand((turn) => turn.items)
          .whereType<ToolItem>()
          .toList();
      expect(toolCards, hasLength(1));
      expect(document.turns.whereType<AssistantTurn>().length, 2);
      expect(state.diagnostics, hasLength(2));
    });


    test('reused Pi content-block IDs do not hide a later reply', () {
      var state = CanonicalTranscriptState.empty('s1');
      state = applyCanonicalEvent(
        state,
        _assistantStart(
          turnId: 'turn-1',
          messageId: 's1:0',
          sequence: 1,
          eventId: 'start-1',
        ),
      );
      state = applyCanonicalEvent(
        state,
        _assistantContent(
          turnId: 'turn-1',
          messageId: 's1:0',
          text: 'first',
          sequence: 2,
          eventId: 'content-1',
        ),
      );
      state = applyCanonicalEvent(
        state,
        _assistantCompleted(
          turnId: 'turn-1',
          messageId: 's1:0',
          sequence: 3,
          eventId: 'complete-1',
        ),
      );
      state = applyCanonicalEvent(
        state,
        _assistantStart(
          turnId: 'turn-2',
          messageId: 's1:0',
          sequence: 4,
          eventId: 'start-2',
        ),
      );
      state = applyCanonicalEvent(
        state,
        _assistantContent(
          turnId: 'turn-2',
          messageId: 's1:0',
          text: 'second',
          sequence: 5,
          eventId: 'content-2',
        ),
      );
      expect(
        state.assistantMessages.values.map(
          (message) => message.content.single.text,
        ),
        containsAll(<String>['first', 'second']),
      );
      expect(
        state.assistantMessages.values
            .where((message) => message.turnId == 'turn-2')
            .single
            .content
            .single
            .text,
        'second',
      );
    });

    test(
      'distinct assistant messages in one turn retain direct storage keys',
      () {
        var state = CanonicalTranscriptState.empty('s1');
        state = applyCanonicalEvent(
          state,
          _assistantStart(
            turnId: 'turn-1',
            messageId: 'message-a',
            sequence: 1,
            eventId: 'start-a',
          ),
        );
        state = applyCanonicalEvent(
          state,
          _assistantStart(
            turnId: 'turn-1',
            messageId: 'message-b',
            sequence: 2,
            eventId: 'start-b',
          ),
        );
        expect(
          state.assistantMessages.keys,
          containsAll(['message-a', 'message-b']),
        );
        expect(
          state.assistantMessages.keys,
          isNot(contains('message-b:turn-1')),
        );

        state = applyCanonicalEvent(
          state,
          _assistantContent(
            turnId: 'turn-1',
            messageId: 'message-a',
            text: 'first',
            sequence: 3,
            eventId: 'content-a',
          ),
        );
        state = applyCanonicalEvent(
          state,
          _assistantCompleted(
            turnId: 'turn-1',
            messageId: 'message-a',
            sequence: 4,
            eventId: 'complete-a',
          ),
        );
        state = applyCanonicalEvent(
          state,
          _assistantContent(
            turnId: 'turn-1',
            messageId: 'message-a',
            text: 'late',
            sequence: 5,
            eventId: 'late-a',
          ),
        );
        expect(
          state.assistantMessages['message-a']!.content.single.text,
          'first',
        );
        expect(state.assistantMessages['message-a']!.isTerminal, isTrue);
      },
    );

    test('reused wire message id is suffixed only across turns', () {
      var state = CanonicalTranscriptState.empty('s1');
      state = applyCanonicalEvent(
        state,
        _assistantStart(
          turnId: 'turn-1',
          messageId: 'wire-0',
          sequence: 1,
          eventId: 'reuse-start-1',
        ),
      );
      state = applyCanonicalEvent(
        state,
        _assistantStart(
          turnId: 'turn-2',
          messageId: 'wire-0',
          sequence: 2,
          eventId: 'reuse-start-2',
        ),
      );
      expect(
        state.assistantMessages.keys,
        containsAll(['wire-0', 'wire-0:turn-2']),
      );
      expect(state.assistantMessages, hasLength(2));

      state = applyCanonicalEvent(
        state,
        _assistantContent(
          turnId: 'turn-2',
          messageId: 'wire-0',
          text: 'second',
          sequence: 3,
          eventId: 'reuse-content-2',
        ),
      );
      expect(
        state.assistantMessages['wire-0:turn-2']!.content.single.text,
        'second',
      );
      expect(state.assistantMessages['wire-0']!.content, isEmpty);
    });

    test('user message insertion is idempotent on duplicate messageId', () {
      var state = CanonicalTranscriptState.empty('s1');
      state = applyCanonicalEvent(
        state,
        _user(messageId: 'm1', turnId: 't1', sequence: 1),
      );
      state = applyCanonicalEvent(
        state,
        _user(messageId: 'm1', turnId: 't1', sequence: 2, text: 'ignored'),
      );

      expect(state.userMessages, hasLength(1));
      expect(state.userMessages['m1']!.text, 'hello');
      expect(state.lastAppliedSequence, 2);
    });

    test('assistant content replaces prior snapshot', () {
      var state = CanonicalTranscriptState.empty('s1');
      state = applyCanonicalEvent(
        state,
        _assistantStart(turnId: 't1', messageId: 'a1', sequence: 1),
      );
      state = applyCanonicalEvent(
        state,
        _assistantContent(
          turnId: 't1',
          messageId: 'a1',
          text: 'first',
          sequence: 2,
        ),
      );
      state = applyCanonicalEvent(
        state,
        _assistantContent(
          turnId: 't1',
          messageId: 'a1',
          text: 'second',
          sequence: 3,
        ),
      );
      expect(state.assistantMessages['a1']!.content.single.text, 'second');
    });

    test(
      'content after completion is ignored and recorded as a diagnostic',
      () {
        var state = CanonicalTranscriptState.empty('s1');
        state = applyCanonicalEvent(
          state,
          _assistantStart(turnId: 't1', messageId: 'a1', sequence: 1),
        );
        state = applyCanonicalEvent(
          state,
          _assistantContent(
            turnId: 't1',
            messageId: 'a1',
            text: 'final',
            sequence: 2,
          ),
        );
        state = applyCanonicalEvent(
          state,
          _assistantCompleted(turnId: 't1', messageId: 'a1', sequence: 3),
        );
        state = applyCanonicalEvent(
          state,
          _assistantContent(
            turnId: 't1',
            messageId: 'a1',
            text: 'late',
            sequence: 4,
          ),
        );

        expect(state.assistantMessages['a1']!.isTerminal, isTrue);
        expect(state.assistantMessages['a1']!.content.single.text, 'final');
        expect(
          state.diagnostics.any((d) => d.label == 'late_progress_ignored'),
          isTrue,
        );
      },
    );

    test('content before assistant.started creates the message implicitly', () {
      var state = CanonicalTranscriptState.empty('s1');
      state = applyCanonicalEvent(
        state,
        _assistantContent(
          turnId: 't1',
          messageId: 'a1',
          text: 'orphan',
          sequence: 1,
        ),
      );
      expect(state.assistantMessages['a1']!.content.single.text, 'orphan');
      expect(
        state.diagnostics.any((d) => d.label == 'implicit_assistant_started'),
        isTrue,
      );
    });

    test('tool progress replaces only non-terminal tool state', () {
      var state = CanonicalTranscriptState.empty('s1');
      state = applyCanonicalEvent(
        state,
        _toolStart(turnId: 't1', toolCallId: 'tc1', sequence: 1),
      );
      state = applyCanonicalEvent(
        state,
        _toolProgress(
          turnId: 't1',
          toolCallId: 'tc1',
          progress: <String, Object?>{'bytes': 1},
          sequence: 2,
        ),
      );
      state = applyCanonicalEvent(
        state,
        _toolProgress(
          turnId: 't1',
          toolCallId: 'tc1',
          progress: <String, Object?>{'bytes': 5},
          sequence: 3,
        ),
      );
      final progress = state.toolCalls['tc1']!.progress as Map<String, Object?>;
      expect(progress['bytes'], 5);

      state = applyCanonicalEvent(
        state,
        _toolCompleted(
          turnId: 't1',
          toolCallId: 'tc1',
          result: <String, Object?>{'output': 'ok'},
          sequence: 4,
        ),
      );
      state = applyCanonicalEvent(
        state,
        _toolProgress(
          turnId: 't1',
          toolCallId: 'tc1',
          progress: <String, Object?>{'bytes': 99},
          sequence: 5,
        ),
      );
      expect(state.toolCalls['tc1']!.isTerminal, isTrue);
      expect(
        (state.toolCalls['tc1']!.progress as Map<String, Object?>)['bytes'],
        5,
      );
      expect(
        state.diagnostics.any((d) => d.label == 'late_progress_ignored'),
        isTrue,
      );
    });

    test('tool failure captures the canonical error message', () {
      var state = CanonicalTranscriptState.empty('s1');
      state = applyCanonicalEvent(
        state,
        _toolStart(turnId: 't1', toolCallId: 'tc1', sequence: 1),
      );
      state = applyCanonicalEvent(
        state,
        _toolFailed(
          turnId: 't1',
          toolCallId: 'tc1',
          errorMessage: 'denied',
          sequence: 2,
        ),
      );
      expect(state.toolCalls['tc1']!.isTerminal, isTrue);
      expect(state.toolCalls['tc1']!.isError, isTrue);
      expect(state.toolCalls['tc1']!.errorMessage, 'denied');
    });

    test('turn lifecycle is monotonic once terminal', () {
      var state = CanonicalTranscriptState.empty('s1');
      state = applyCanonicalEvent(
        state,
        _turn(turnId: 't1', type: CanonicalEventType.turnStarted, sequence: 1),
      );
      expect(state.turnStatuses['t1'], TurnStatus.running);
      state = applyCanonicalEvent(
        state,
        _turn(turnId: 't1', type: CanonicalEventType.turnSettled, sequence: 2),
      );
      expect(state.turnStatuses['t1'], TurnStatus.completed);
      state = applyCanonicalEvent(
        state,
        _turn(turnId: 't1', type: CanonicalEventType.turnFailed, sequence: 3),
      );
      // Once terminal, reducer refuses to regress.
      expect(state.turnStatuses['t1'], TurnStatus.completed);
      state = applyCanonicalEvent(
        state,
        _turn(
          turnId: 't1',
          type: CanonicalEventType.turnWaitingForInput,
          sequence: 4,
        ),
      );
      expect(state.turnStatuses['t1'], TurnStatus.completed);
    });

    test('replay in sequence is deterministic regardless of input order', () {
      final canonical = <CanonicalSessionEvent>[
        _user(messageId: 'm1', turnId: 't1', sequence: 1),
        _assistantStart(turnId: 't1', messageId: 'a1', sequence: 2),
        _assistantContent(
          turnId: 't1',
          messageId: 'a1',
          text: 'hello',
          sequence: 3,
        ),
        _assistantCompleted(turnId: 't1', messageId: 'a1', sequence: 4),
        _turn(turnId: 't1', type: CanonicalEventType.turnSettled, sequence: 5),
      ];
      var stateA = CanonicalTranscriptState.empty('s1');
      for (final event in canonical) {
        stateA = applyCanonicalEvent(stateA, event);
      }
      // Re-running in the same order produces the same projection.
      var stateB = CanonicalTranscriptState.empty('s1');
      for (final event in canonical) {
        stateB = applyCanonicalEvent(stateB, event);
      }
      expect(stateA, equals(stateB));
    });

    test('events for a different session are routed to diagnostics', () {
      var state = CanonicalTranscriptState.empty('s1');
      state = applyCanonicalEvent(
        state,
        CanonicalSessionEvent(
          eventId: 'other',
          sessionId: 'other-session',
          sequence: 1,
          type: CanonicalEventType.turnStarted,
          occurredAt: DateTime.utc(2026),
          payload: <String, Object?>{'turnId': 't'},
        ),
      );
      expect(
        state.diagnostics.any((d) => d.label == 'cross_session_event'),
        isTrue,
      );
    });
  });
}
