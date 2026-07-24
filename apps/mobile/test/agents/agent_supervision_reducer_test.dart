/// Focused tests for [AgentSupervisionReducer].
///
/// Coverage:
///
///   * `tool.started` for the Agent tool opens a run keyed by
///     `toolCallId`, capturing task, model, background mode, and
///     subagent type.
///   * `tool.output` deltas accumulate into the latest-output buffer
///     with a hard cap.
///   * `tool.completed` with a structured result finalises the run
///     and surfaces the returned `agent_id`.
///   * `tool.failed` produces an error state with the bridge's error
///     message.
///   * `tool.cancelled` produces a cancelled state.
///   * `get_subagent_result` and `steer_subagent` correlate by
///     `agent_id` onto the originating Agent run when present.
///   * `turn.started` populates the origin chat and turn on the run.
///   * Replaying the same event stream is idempotent.
///   * Blockers are surfaced when a query references an unknown id.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/agents/domain/agent_supervision.dart';
import 'package:pi_mob/src/agents/domain/agent_supervision_reducer.dart';
import 'package:pi_mob/src/domain/mobile_state.dart';

StreamEventState _event(
  int cursor,
  String type,
  Map<String, Object?> payload, {
  String streamId = 'session:s1',
  DateTime? at,
}) => StreamEventState(
  hostId: 'host',
  streamId: streamId,
  cursor: StreamCursor.parse('$cursor'),
  eventId: 'event-$cursor',
  type: type,
  payload: payload,
  occurredAt: at ?? DateTime.utc(2026, 7, 21, 12, 0, cursor),
);

void main() {
  const reducer = AgentSupervisionReducer();

  group('Agent tool lifecycle', () {
    test('tool.started opens a run with task, model, and background flag', () {
      final events = <StreamEventState>[
        _event(1, 'turn.started', {'turnId': 'turn-1'}),
        _event(2, 'tool.started', {
          'toolCallId': 'call-A',
          'toolName': 'Agent',
          'assistantStepId': 'step-1',
          'arguments': {
            'description': 'Investigate the bug',
            'subagent_type': 'general-purpose',
            'model': 'claude-opus-4-7',
            'thinking': 'high',
            'run_in_background': true,
          },
        }),
      ];
      var state = AgentSupervisionState.empty();
      for (final event in events) {
        state = reducer.apply(state: state, event: event);
      }
      final run = state.runByToolCallId('call-A');
      expect(run, isNotNull);
      expect(run!.task, 'Investigate the bug');
      expect(run.subagentType, 'general-purpose');
      expect(run.model, 'claude-opus-4-7');
      expect(run.thinkingLevel, 'high');
      expect(run.backgroundRequested, isTrue);
      expect(run.status, AgentRunStatus.running);
      expect(run.originChatId, 's1');
      expect(run.originTurnId, 'turn-1');
      expect(run.assistantStepId, 'step-1');
    });

    test('tool.output accumulates into latestOutput with a byte cap', () {
      final runStarted = _event(1, 'tool.started', {
        'toolCallId': 'call-B',
        'toolName': 'Agent',
        'arguments': {'description': 'long task'},
      });
      var state = AgentSupervisionState.empty();
      state = reducer.apply(state: state, event: runStarted);
      // Two 5 KiB deltas must be capped to the 8 KiB buffer size.
      final bigDelta = 'x' * 5120;
      state = reducer.apply(
        state: state,
        event: _event(2, 'tool.output', {
          'toolCallId': 'call-B',
          'output': bigDelta,
        }),
      );
      state = reducer.apply(
        state: state,
        event: _event(3, 'tool.output', {
          'toolCallId': 'call-B',
          'output': bigDelta,
        }),
      );
      final run = state.runByToolCallId('call-B')!;
      expect(run.latestOutput, isNotNull);
      expect(run.latestOutput!.length, 8 * 1024);
      expect(run.latestOutputCapturedAt, isNotNull);
    });

    test('tool.completed surfaces agent_id and result output', () {
      var state = AgentSupervisionState.empty();
      state = reducer.apply(
        state: state,
        event: _event(1, 'tool.started', {
          'toolCallId': 'call-C',
          'toolName': 'Agent',
          'arguments': {'description': 'check coverage'},
        }),
      );
      state = reducer.apply(
        state: state,
        event: _event(2, 'tool.completed', {
          'toolCallId': 'call-C',
          'toolName': 'Agent',
          'result': {
            'agent_id': 'agt-1',
            'agent_status': 'completed',
            'output': 'Coverage is at 92%.',
          },
        }),
      );
      final run = state.runByToolCallId('call-C')!;
      expect(run.status, AgentRunStatus.completed);
      expect(run.agentId, 'agt-1');
      expect(run.latestOutput, 'Coverage is at 92%.');
      expect(run.endedAt, isNotNull);
      expect(state.runByAgentId('agt-1'), same(run));
    });

    test('tool.failed records errorMessage verbatim', () {
      var state = AgentSupervisionState.empty();
      state = reducer.apply(
        state: state,
        event: _event(1, 'tool.started', {
          'toolCallId': 'call-D',
          'toolName': 'Agent',
          'arguments': {'description': 'risky call'},
        }),
      );
      state = reducer.apply(
        state: state,
        event: _event(2, 'tool.failed', {
          'toolCallId': 'call-D',
          'toolName': 'Agent',
          'errorMessage': 'subagent exploded',
          'result': {'error': 'subagent exploded'},
        }),
      );
      final run = state.runByToolCallId('call-D')!;
      expect(run.status, AgentRunStatus.error);
      expect(run.errorMessage, 'subagent exploded');
      expect(run.endedAt, isNotNull);
    });

    test('tool.cancelled records a cancelled state', () {
      var state = AgentSupervisionState.empty();
      state = reducer.apply(
        state: state,
        event: _event(1, 'tool.started', {
          'toolCallId': 'call-E',
          'toolName': 'Agent',
          'arguments': {'description': 'cancelled call'},
        }),
      );
      state = reducer.apply(
        state: state,
        event: _event(2, 'tool.cancelled', {
          'toolCallId': 'call-E',
          'toolName': 'Agent',
        }),
      );
      final run = state.runByToolCallId('call-E')!;
      expect(run.status, AgentRunStatus.cancelled);
      expect(run.endedAt, isNotNull);
    });

    test('blocked status from result is treated as error with reason', () {
      var state = AgentSupervisionState.empty();
      state = reducer.apply(
        state: state,
        event: _event(1, 'tool.started', {
          'toolCallId': 'call-F',
          'toolName': 'Agent',
          'arguments': {'description': 'blocked call'},
        }),
      );
      state = reducer.apply(
        state: state,
        event: _event(2, 'tool.completed', {
          'toolCallId': 'call-F',
          'toolName': 'Agent',
          'result': {'agent_status': 'blocked', 'blocked': 'policy denied'},
        }),
      );
      final run = state.runByToolCallId('call-F')!;
      expect(run.status, AgentRunStatus.error);
      expect(run.blockedReason, contains('policy denied'));
    });
  });

  group('Query tool correlation', () {
    test('steer_subagent with agent_id patches the originating run', () {
      var state = AgentSupervisionState.empty();
      state = reducer.apply(
        state: state,
        event: _event(1, 'tool.started', {
          'toolCallId': 'call-G',
          'toolName': 'Agent',
          'arguments': {'description': 'plan a refactor'},
        }),
      );
      state = reducer.apply(
        state: state,
        event: _event(2, 'tool.completed', {
          'toolCallId': 'call-G',
          'toolName': 'Agent',
          'result': {'agent_id': 'agt-G'},
        }),
      );
      state = reducer.apply(
        state: state,
        event: _event(3, 'tool.started', {
          'toolCallId': 'call-G2',
          'toolName': 'steer_subagent',
          'arguments': {'agent_id': 'agt-G', 'message': 'use safe mode'},
        }),
      );
      final run = state.runByToolCallId('call-G')!;
      expect(run.lastSteerDirection, 'use safe mode');
      expect(run.lastSteerAt, isNotNull);
    });

    test('orphan query records an orphan_query blocker', () {
      var state = AgentSupervisionState.empty();
      state = reducer.apply(
        state: state,
        event: _event(1, 'tool.started', {
          'toolCallId': 'call-H',
          'toolName': 'get_subagent_result',
          'arguments': {'agent_id': 'missing-id'},
        }),
      );
      expect(state.blockers, hasLength(1));
      expect(state.blockers.single.kind, 'orphan_query');
    });

    test('orphan completion records an orphan_completion blocker', () {
      var state = AgentSupervisionState.empty();
      state = reducer.apply(
        state: state,
        event: _event(1, 'tool.completed', {
          'toolCallId': 'call-I',
          'toolName': 'Agent',
          'result': {'agent_id': 'agt-I'},
        }),
      );
      expect(state.blockers, hasLength(1));
      expect(state.blockers.single.kind, 'orphan_completion');
    });
  });

  group('Origin and replay', () {
    test('turn.started populates origin on runs without one', () {
      // The Agent tool runs before turn.started arrives. The reducer
      // must still attach the origin on the next turn.started event.
      var state = AgentSupervisionState.empty();
      state = reducer.apply(
        state: state,
        event: _event(1, 'tool.started', {
          'toolCallId': 'call-J',
          'toolName': 'Agent',
          'arguments': {'description': 'out-of-order'},
        }),
      );
      state = reducer.apply(
        state: state,
        event: _event(2, 'turn.started', {'turnId': 'turn-7'}),
      );
      final run = state.runByToolCallId('call-J')!;
      expect(run.originChatId, 's1');
      expect(run.originTurnId, 'turn-7');
    });

    test('replay of the same events is idempotent', () {
      final events = <StreamEventState>[
        _event(1, 'turn.started', {'turnId': 'turn-1'}),
        _event(2, 'tool.started', {
          'toolCallId': 'call-K',
          'toolName': 'Agent',
          'arguments': {'description': 'replay', 'model': 'sonnet'},
        }),
        _event(3, 'tool.output', {
          'toolCallId': 'call-K',
          'output': 'partial output',
        }),
        _event(4, 'tool.completed', {
          'toolCallId': 'call-K',
          'toolName': 'Agent',
          'result': {'agent_id': 'agt-K', 'output': 'final answer'},
        }),
      ];
      var state = AgentSupervisionState.empty();
      for (final event in events) {
        state = reducer.apply(state: state, event: event);
      }
      final firstSnapshot = state;
      for (final event in events) {
        state = reducer.apply(state: state, event: event);
      }
      expect(state, equals(firstSnapshot));
    });

    test('non-supervision events are passed through', () {
      var state = AgentSupervisionState.empty();
      state = reducer.apply(
        state: state,
        event: _event(1, 'tool.started', {
          'toolCallId': 'call-L',
          'toolName': 'bash',
          'arguments': {'command': 'ls'},
        }),
      );
      expect(state.runs, isEmpty);
      expect(state.blockers, isEmpty);
    });
  });

  group('Capabilities and blockers', () {
    test('capabilities default to all-false (no authoritative contract)', () {
      var state = AgentSupervisionState.empty();
      state = reducer.apply(
        state: state,
        event: _event(1, 'tool.started', {
          'toolCallId': 'call-M',
          'toolName': 'Agent',
          'arguments': {'description': 'no caps'},
        }),
      );
      final run = state.runByToolCallId('call-M')!;
      expect(
        run.caps,
        isNull,
        reason: 'reducer never invents a capabilities object',
      );
    });
  });

  test('authoritative snapshot lowers reported actions without inference', () {
    final state = reduceAuthoritativeAgentSnapshot(
      AgentSupervisionState.empty(),
      const AgentAuthoritativeSnapshot(<AgentAuthoritativeRecord>[
        AgentAuthoritativeRecord(
          agentId: 'agent-1',
          task: 'Verify protocol',
          state: 'running',
          originSessionId: 'session-1',
          originTurnId: 'turn-1',
          revision: 'rev-1',
          supportedActions: <String>{'steer'},
        ),
      ]),
    );

    expect(state.runs.single.status, AgentRunStatus.running);
    expect(state.runs.single.caps?.canSteer, isTrue);
    expect(state.runs.single.caps?.canCancel, isFalse);
    expect(
      state.blockers.any((item) => item.kind == 'no_cancel_contract'),
      isTrue,
    );
  });
}
