import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/domain/session_subscriptions.dart';
import 'package:pi_mob/src/domain/mobile_state.dart';

void main() {
  group('SessionSubscriptionSet', () {
    test('starts empty', () {
      final set = SessionSubscriptionSet.empty();
      expect(set.isEmpty, isTrue);
      expect(set.full, isNull);
      expect(set.summaries, isEmpty);
    });

    test('setFull installs exactly one full subscription', () {
      final set = SessionSubscriptionSet.empty().setFull(
        sessionId: 's1',
        cursor: StreamCursor.zero,
      );
      expect(set.full?.sessionId, 's1');
      expect(set.full?.detail, SubscriptionDetail.full);
      expect(set.summaries, isEmpty);
    });

    test('setFull replaces an existing full subscription', () {
      var set = SessionSubscriptionSet.empty().setFull(
        sessionId: 's1',
        cursor: StreamCursor.zero,
      );
      set = set.setFull(sessionId: 's2', cursor: StreamCursor.parse('3'));
      expect(set.full?.sessionId, 's2');
      expect(set.full?.cursor.value, '3');
    });

    test('addSummary enforces the five-cap', () {
      var set = SessionSubscriptionSet.empty().setFull(
        sessionId: 'full',
        cursor: StreamCursor.zero,
      );
      for (var i = 0; i < 5; i++) {
        set = set.addSummary(sessionId: 'sum$i', cursor: StreamCursor.zero);
      }
      expect(set.summaries, hasLength(5));
      expect(
        () => set.addSummary(sessionId: 'overflow', cursor: StreamCursor.zero),
        throwsStateError,
      );
    });

    test('addSummary rejects sessions already subscribed in any role', () {
      var set = SessionSubscriptionSet.empty()
          .setFull(sessionId: 'full', cursor: StreamCursor.zero)
          .addSummary(sessionId: 'sum1', cursor: StreamCursor.zero);
      expect(
        () => set.addSummary(sessionId: 'full', cursor: StreamCursor.zero),
        throwsStateError,
      );
      expect(
        () => set.addSummary(sessionId: 'sum1', cursor: StreamCursor.zero),
        throwsStateError,
      );
    });

    test('addSummary rejects empty session ids', () {
      final set = SessionSubscriptionSet.empty();
      expect(
        () => set.addSummary(sessionId: '', cursor: StreamCursor.zero),
        throwsArgumentError,
      );
    });

    test('remove drops summary sessions', () {
      var set = SessionSubscriptionSet.empty()
          .setFull(sessionId: 'full', cursor: StreamCursor.zero)
          .addSummary(sessionId: 'sum1', cursor: StreamCursor.zero);
      set = set.remove('sum1');
      expect(set.summaries, isEmpty);
    });

    test('advanceCursor is per-session and never crosses sessions', () {
      var set = SessionSubscriptionSet.empty()
          .setFull(sessionId: 'a', cursor: StreamCursor.parse('5'))
          .addSummary(sessionId: 'b', cursor: StreamCursor.parse('5'));
      set = set.advanceCursor(sessionId: 'b', next: StreamCursor.parse('9'));
      // full cursor unchanged
      expect(set.full?.cursor.value, '5');
      // summary cursor advanced
      final summary = set.summaries.single;
      expect(summary.sessionId, 'b');
      expect(summary.cursor.value, '9');
    });

    test('advanceCursor rejects a non-monotonic move and is a no-op', () {
      var set = SessionSubscriptionSet.empty().setFull(
        sessionId: 'a',
        cursor: StreamCursor.parse('9'),
      );
      final next = set.advanceCursor(
        sessionId: 'a',
        next: StreamCursor.parse('5'),
      );
      expect(identical(next, set), isTrue);
      expect(set.full?.cursor.value, '9');
    });

    test('toWire emits detail and cursor for every entry', () {
      final set = SessionSubscriptionSet.empty()
          .setFull(sessionId: 'a', cursor: StreamCursor.parse('2'))
          .addSummary(sessionId: 'b', cursor: StreamCursor.parse('3'));
      final wire = set.toWire();
      expect(wire, hasLength(2));
      expect(wire[0]['streamId'], 'session:a');
      expect(wire[0]['detail'], 'full');
      expect(wire[0]['afterCursor'], '2');
      expect(wire[1]['streamId'], 'session:b');
      expect(wire[1]['detail'], 'summary');
      expect(wire[1]['afterCursor'], '3');
    });

    test('hard caps: at most one full and five summaries', () {
      expect(SessionSubscriptionSet.maxSummarySubscriptions, 5);
      expect(SessionSubscriptionSet.maxTotalSubscriptions, 6);
    });
  });
}
