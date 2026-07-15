import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/domain/mobile_state.dart';
import 'package:pi_mob/src/transcript/domain/transcript_items.dart';
import 'package:pi_mob/src/transcript/domain/transcript_reducer.dart';
import 'package:pi_mob/src/transcript/domain/transcript_turn.dart';
import 'package:pi_mob/src/transcript/widgets/transcript_status.dart';
import 'package:pi_mob/src/transcript/widgets/view_data/reasoning_view_data.dart';

StreamEventState event(int cursor, String type, Map<String, Object?> payload) =>
    StreamEventState(
      hostId: 'host',
      streamId: 'session:s',
      cursor: StreamCursor.parse('$cursor'),
      eventId: 'event-$cursor',
      type: type,
      payload: payload,
      occurredAt: DateTime.utc(2026, 7, 14),
    );

void main() {
  test(
    'real normalized sparse events compose reasoning, tools, and answer',
    () {
      final events = <StreamEventState>[
        event(1, 'turn.started', {
          'turnIndex': 1,
          'message': 'Inspect the repository',
        }),
        event(2, 'reasoning.started', {'contentBlockId': 'reason-1'}),
        event(3, 'reasoning.delta', {
          'contentBlockId': 'reason-1',
          'text': 'Inspecting the repository',
        }),
        event(4, 'reasoning.completed', {'contentBlockId': 'reason-1'}),
        event(5, 'tool.started', {
          'toolCallId': 'read-1',
          'toolName': 'read',
          'builtIn': true,
          'arguments': {'path': 'README.md'},
          'status': 'running',
        }),
        event(6, 'tool.started', {
          'toolCallId': 'bash-1',
          'toolName': 'bash',
          'builtIn': true,
          'arguments': {'command': 'git status'},
          'status': 'running',
        }),
        event(7, 'tool.completed', {
          'toolCallId': 'read-1',
          'toolName': 'read',
          'result': {'content': 'hello', 'byteCount': 5},
          'retainedBytes': 5,
          'totalBytes': 5,
          'isTruncated': false,
        }),
        event(8, 'tool.failed', {
          'toolCallId': 'bash-1',
          'toolName': 'bash',
          'isError': true,
          'result': {'stderr': 'denied', 'exitCode': 1},
          'retainedBytes': 6,
          'totalBytes': 10,
          'isTruncated': true,
          'digest': 'abc',
        }),
        event(9, 'assistant.started', {'contentBlockId': 'answer-1'}),
        event(10, 'assistant.delta', {
          'contentBlockId': 'answer-1',
          'text': '**Done**',
        }),
        event(11, 'assistant.completed', {'contentBlockId': 'answer-1'}),
        event(12, 'turn.settled', {'turnIndex': 1}),
      ];

      const reducer = TranscriptReducer();
      var state = TranscriptReducerState.empty('session:s');
      for (final item in events) {
        state = reducer.apply(state: state, event: item);
      }

      final userTurn = state.document.turns.whereType<UserTurn>().single;
      expect(userTurn.message, 'Inspect the repository');
      final turn = state.document.turns.whereType<AssistantTurn>().single;
      expect(turn.status, AssistantTurnStatus.completed);
      final reasoning = turn.items.whereType<ReasoningItem>().single;
      expect(reasoning.viewData.phase, ReasoningPhase.completed);
      expect(reasoning.viewData.summary, contains('Inspecting'));
      final tools = turn.items.whereType<ToolItem>().toList();
      expect(tools.map((tool) => tool.viewData.toolName), ['read', 'bash']);
      expect(tools.first.viewData.status, TranscriptToolStatus.completed);
      expect(tools.last.viewData.status, TranscriptToolStatus.error);
      expect(tools.last.viewData.truncation?.totalBytes, 10);
      expect(turn.finalAnswer?.viewData.markdown, '**Done**');
      expect(state.document.diagnostics, isEmpty);
    },
  );

  test('reused Pi content block ids remain isolated between turns', () {
    final events = <StreamEventState>[
      event(1, 'turn.started', {'turnId': 'turn-1', 'message': 'First'}),
      event(2, 'assistant.started', {'contentBlockId': '0'}),
      event(3, 'assistant.delta', {
        'contentBlockId': '0',
        'text': 'First answer',
      }),
      event(4, 'assistant.completed', {'contentBlockId': '0'}),
      event(5, 'turn.settled', {'turnId': 'turn-1'}),
      event(6, 'turn.started', {'turnId': 'turn-2', 'message': 'Second'}),
      event(7, 'assistant.started', {'contentBlockId': '0'}),
      event(8, 'assistant.delta', {
        'contentBlockId': '0',
        'text': 'Second answer',
      }),
      event(9, 'assistant.completed', {'contentBlockId': '0'}),
      event(10, 'turn.settled', {'turnId': 'turn-2'}),
    ];

    const reducer = TranscriptReducer();
    var state = TranscriptReducerState.empty('session:s');
    for (final item in events) {
      state = reducer.apply(state: state, event: item);
    }

    final turns = state.document.turns.whereType<AssistantTurn>().toList();
    expect(turns, hasLength(2));
    expect(turns[0].finalAnswer?.viewData.markdown, 'First answer');
    expect(turns[1].finalAnswer?.viewData.markdown, 'Second answer');
  });
}
