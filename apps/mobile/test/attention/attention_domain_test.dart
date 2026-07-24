import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/attention/attention_domain.dart';

void main() {
  test('all five categories replay and read stays local', () {
    var state = const AttentionState();
    for (final entry in <String, AttentionCategory>{
      'needs_input': AttentionCategory.needsInput,
      'completed': AttentionCategory.completed,
      'failed': AttentionCategory.failed,
      'interrupted': AttentionCategory.interrupted,
      'background': AttentionCategory.background,
    }.entries) {
      state = reduceAttention(state, <String, Object?>{
        'attentionId': '${entry.key}-id',
        'sessionId': 'session-1',
        'turnId': 'turn-1',
        'category': entry.key,
        'occurrence': '2026-07-23T10:00:00.000Z',
        'summary': entry.key,
        'actionable': entry.key == 'needs_input',
        'revision': 'rev-1',
        'resolved': false,
        'superseded': false,
      });
      expect(state.items['${entry.key}-id']!.category, entry.value);
    }
    expect(state.visible, hasLength(5));
  });
}
