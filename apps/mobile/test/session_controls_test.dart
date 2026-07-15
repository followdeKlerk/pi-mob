import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/domain/session_controls.dart';

void main() {
  test('host state shape changes cannot crash cached replay', () {
    final state = SessionControlState.empty('session');

    final next = state.apply('context.state', <String, Object?>{
      'contextWindow': <String, Object?>{'tokens': 200000},
      'tokens': <String, Object?>{'input': 12, 'output': 4},
      'cost': <String, Object?>{'total': 0.1},
      'modelUnavailable': <String, Object?>{},
      'steeringEnabled': 'unknown',
    });

    expect(next.contextWindow, isNull);
    expect(next.contextTokens, isNull);
    expect(next.cost, isNull);
    expect(next.modelUnavailable, isFalse);
  });
}
