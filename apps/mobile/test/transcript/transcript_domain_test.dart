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

  test(
    'repeated truncation metadata aggregates on one originating tool item',
    () {
      final events = <StreamEventState>[
        event(1, 'turn.started', {
          'turnId': 'turn-1',
          'message': 'Read the large file',
        }),
        event(2, 'tool.started', {
          'toolCallId': 'read-1',
          'toolName': 'read',
          'arguments': {'path': 'large.log'},
        }),
        event(3, 'tool.output', {
          'toolCallId': 'read-1',
          'output': 'first chunk',
          'retainedBytes': 100,
          'totalBytes': 200,
          'isTruncated': true,
          'digest': 'first',
        }),
        event(4, 'tool.output', {
          'toolCallId': 'read-1',
          'output': 'second chunk',
          'retainedBytes': 150,
          'totalBytes': 300,
          'isTruncated': true,
          'digest': 'latest',
        }),
        event(5, 'tool.completed', {
          'toolCallId': 'read-1',
          'toolName': 'read',
          'result': {'content': 'retained output', 'byteCount': 150},
        }),
      ];

      const reducer = TranscriptReducer();
      var state = TranscriptReducerState.empty('session:s');
      for (final item in events) {
        state = reducer.apply(state: state, event: item);
      }

      final turn = state.document.turns.whereType<AssistantTurn>().single;
      final tools = turn.items.whereType<ToolItem>().toList();
      expect(tools, hasLength(1));
      expect(tools.single.itemId, 'read-1');
      expect(tools.single.viewData.status, TranscriptToolStatus.completed);
      expect(tools.single.viewData.truncation?.retainedBytes, 150);
      expect(tools.single.viewData.truncation?.totalBytes, 300);
      expect(tools.single.viewData.truncation?.digest, 'latest');
      expect(tools.single.viewData.result?['content'], 'retained output');
    },
  );

  test('interleaved truncations remain associated by tool call id', () {
    final events = <StreamEventState>[
      event(1, 'turn.started', {'message': 'Run both'}),
      event(2, 'tool.started', {
        'toolCallId': 'read-1',
        'toolName': 'read',
        'arguments': {'path': 'a'},
      }),
      event(3, 'tool.started', {
        'toolCallId': 'bash-1',
        'toolName': 'bash',
        'arguments': {'command': 'echo b'},
      }),
      event(4, 'tool.output', {
        'toolCallId': 'read-1',
        'retainedBytes': 10,
        'totalBytes': 20,
        'isTruncated': true,
        'digest': 'read-digest',
      }),
      event(5, 'tool.output', {
        'toolCallId': 'bash-1',
        'retainedBytes': 30,
        'totalBytes': 40,
        'isTruncated': true,
        'digest': 'bash-digest',
      }),
    ];

    const reducer = TranscriptReducer();
    var state = TranscriptReducerState.empty('session:s');
    for (final item in events) {
      state = reducer.apply(state: state, event: item);
    }

    final tools = state.document.turns
        .whereType<AssistantTurn>()
        .single
        .items
        .whereType<ToolItem>()
        .toList();
    expect(tools, hasLength(2));
    final byId = {for (final tool in tools) tool.itemId: tool.viewData};
    expect(byId['read-1']?.truncation?.totalBytes, 20);
    expect(byId['read-1']?.truncation?.digest, 'read-digest');
    expect(byId['bash-1']?.truncation?.totalBytes, 40);
    expect(byId['bash-1']?.truncation?.digest, 'bash-digest');
  });

  test('metadata-only output waits for its originating tool start', () {
    const reducer = TranscriptReducer();
    var state = TranscriptReducerState.empty('session:s');
    state = reducer.apply(
      state: state,
      event: event(1, 'turn.started', {
        'turnId': 'turn-1',
        'message': 'Inspect output',
      }),
    );
    state = reducer.apply(
      state: state,
      event: event(2, 'tool.output', {
        'toolCallId': 'read-1',
        'retainedBytes': 100,
        'totalBytes': 200,
        'isTruncated': true,
      }),
    );

    var turn = state.document.turns.whereType<AssistantTurn>().single;
    expect(turn.items.whereType<ToolItem>(), isEmpty);
    expect(state.document.diagnostics, isEmpty);

    state = reducer.apply(
      state: state,
      event: event(3, 'tool.started', {
        'toolCallId': 'read-1',
        'toolName': 'read',
        'arguments': {'path': 'large.log'},
      }),
    );

    turn = state.document.turns.whereType<AssistantTurn>().single;
    final tool = turn.items.whereType<ToolItem>().single;
    expect(tool.itemId, 'read-1');
    expect(tool.viewData.truncation?.retainedBytes, 100);
    expect(tool.viewData.truncation?.totalBytes, 200);
  });

  test('late tool metadata updates its original turn', () {
    final events = <StreamEventState>[
      event(1, 'turn.started', {'turnId': 'turn-1', 'message': 'First'}),
      event(2, 'tool.started', {
        'toolCallId': 'read-1',
        'toolName': 'read',
        'arguments': {'path': 'large.log'},
      }),
      event(3, 'turn.settled', {'turnId': 'turn-1'}),
      event(4, 'turn.started', {'turnId': 'turn-2', 'message': 'Second'}),
      event(5, 'tool.output', {
        'toolCallId': 'read-1',
        'retainedBytes': 100,
        'totalBytes': 200,
        'isTruncated': true,
      }),
      event(6, 'tool.completed', {
        'toolCallId': 'read-1',
        'toolName': 'read',
        'result': {'content': 'late result', 'byteCount': 100},
      }),
    ];

    const reducer = TranscriptReducer();
    var state = TranscriptReducerState.empty('session:s');
    for (final item in events) {
      state = reducer.apply(state: state, event: item);
    }

    final turns = state.document.turns.whereType<AssistantTurn>().toList();
    final firstTools = turns[0].items.whereType<ToolItem>().toList();
    final secondTools = turns[1].items.whereType<ToolItem>().toList();
    expect(firstTools, hasLength(1));
    expect(firstTools.single.itemId, 'read-1');
    expect(firstTools.single.viewData.truncation?.totalBytes, 200);
    expect(firstTools.single.viewData.status, TranscriptToolStatus.completed);
    expect(secondTools, isEmpty);
  });

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

  test('late event carrying an old turn id cannot modify the latest turn', () {
    final events = <StreamEventState>[
      event(1, 'turn.started', {'turnId': 'turn-1', 'message': 'First'}),
      event(2, 'assistant.started', {
        'turnId': 'turn-1',
        'contentBlockId': '0',
      }),
      event(3, 'assistant.delta', {
        'turnId': 'turn-1',
        'contentBlockId': '0',
        'text': 'First answer',
      }),
      event(4, 'assistant.completed', {
        'turnId': 'turn-1',
        'contentBlockId': '0',
      }),
      event(5, 'turn.started', {'turnId': 'turn-2', 'message': 'Second'}),
      event(6, 'assistant.started', {
        'turnId': 'turn-2',
        'contentBlockId': '0',
      }),
      event(7, 'assistant.delta', {
        'turnId': 'turn-2',
        'contentBlockId': '0',
        'text': 'Second answer',
      }),
      event(8, 'assistant.delta', {
        'turnId': 'turn-1',
        'contentBlockId': '0',
        'text': ' late first fragment',
      }),
      event(9, 'assistant.completed', {
        'turnId': 'turn-2',
        'contentBlockId': '0',
      }),
    ];

    const reducer = TranscriptReducer();
    var state = TranscriptReducerState.empty('session:s');
    for (final item in events) {
      state = reducer.apply(state: state, event: item);
    }

    final turns = state.document.turns.whereType<AssistantTurn>().toList();
    expect(turns, hasLength(2));
    expect(turns[1].finalAnswer?.viewData.markdown, 'Second answer');
  });
}
