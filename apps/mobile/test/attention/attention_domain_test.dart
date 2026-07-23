import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/attention/attention_domain.dart';

void main() {
  test('all five categories replay and read stays local', () {
    var state = const AttentionState();
    const wireCategories = <String>{
      'needs_input',
      'completed',
      'failed',
      'interrupted',
      'background',
    };
    for (final wireCategory in wireCategories) {
      state = reduceAttention(state, <String, Object?>{
        'attentionId': '$wireCategory-id',
        'sessionId': 'session-1',
        'turnId': 'turn-1',
        'category': wireCategory,
        'occurrence': '2026-07-23T10:00:00.000Z',
        'summary': wireCategory,
        'actionable': wireCategory == 'needs_input',
        'revision': 'rev-1',
        'resolved': false,
        'superseded': false,
      });
      final parsed = state.items['$wireCategory-id']!;
      expect(parsed.read, isFalse);
      expect(parsed.actionable, wireCategory == 'needs_input');
    }
    expect(state.visible, hasLength(5));
  });

  test('read marker persists across replays of the same event', () {
    var state = const AttentionState();
    state = reduceAttention(state, <String, Object?>{
      'attentionId': 'att-1',
      'sessionId': 'session-1',
      'turnId': 'turn-1',
      'category': 'needs_input',
      'occurrence': '2026-07-23T10:00:00.000Z',
      'summary': 'awaiting user',
      'actionable': true,
      'revision': 'rev-1',
      'resolved': false,
      'superseded': false,
    });
    state = AttentionState(<String, AttentionItemData>{
      ...state.items,
      'att-1': state.items['att-1']!.copyWith(read: true),
    });
    state = reduceAttention(state, <String, Object?>{
      'attentionId': 'att-1',
      'sessionId': 'session-1',
      'turnId': 'turn-1',
      'category': 'needs_input',
      'occurrence': '2026-07-23T10:00:00.000Z',
      'summary': 'awaiting user',
      'actionable': true,
      'revision': 'rev-2',
      'resolved': false,
      'superseded': false,
    });
    expect(state.items['att-1']!.read, isTrue);
    expect(state.items['att-1']!.revision, 'rev-2');
  });

  test('unknown category passes through unchanged', () {
    var state = const AttentionState();
    state = reduceAttention(state, <String, Object?>{
      'attentionId': 'att-bad',
      'sessionId': 'session-1',
      'turnId': 'turn-1',
      'category': 'bogus',
      'occurrence': '2026-07-23T10:00:00.000Z',
      'summary': 'bad',
      'actionable': true,
      'revision': 'rev-1',
      'resolved': false,
      'superseded': false,
    });
    expect(state.items.containsKey('att-bad'), isFalse);
  });
}
