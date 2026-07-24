import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/agents/agent_domain.dart';

void main() {
  test('uses only explicitly reported supported actions', () {
    final state = reduceAgents(
      const AgentSupervisionState(),
      'agent.snapshot',
      <String, Object?>{
        'items': <Object?>[
          <String, Object?>{
            'agentId': 'agent-1',
            'task': 'Check tests',
            'state': 'running',
            'originSessionId': 'session-1',
            'originTurnId': 'turn-1',
            'supportedActions': <Object?>['transcript', 'cancel'],
            'revision': 'rev-1',
          },
        ],
      },
    );
    expect(state.items.single.supportedActions, {'transcript', 'cancel'});
    expect(state.items.single.supportedActions.contains('merge'), isFalse);
  });

  test('renders unavailable reason instead of inferring agents', () {
    final state = reduceAgents(
      const AgentSupervisionState(),
      'agent.unavailable',
      <String, Object?>{
        'status': <String, Object?>{
          'state': 'unavailable',
          'reason': 'No approved source',
        },
      },
    );
    expect(state.unavailableReason, 'No approved source');
  });
}
