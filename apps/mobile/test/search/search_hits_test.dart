import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/search/search_hits.dart';
import 'package:pi_mob/src/search/search_source.dart';

SearchHit _hit({
  String summary = 'lorem ipsum dolor sit amet',
  int matchStart = 0,
  int matchEnd = 5,
}) => SearchHit(
  hostId: 'host',
  sessionId: 'session',
  sessionName: 'Session',
  eventId: 'event',
  source: SearchSource.userPrompt,
  cursor: '1',
  summary: summary,
  matchStart: matchStart,
  matchEnd: matchEnd,
  occurredAt: DateTime.utc(2026, 1, 1),
);

void main() {
  group('SearchHit.snippet', () {
    test('highlights a valid range inside a non-empty summary', () {
      final hit = _hit(summary: 'lorem ipsum', matchStart: 6, matchEnd: 11);
      expect(hit.snippet, 'lorem «ipsum»');
    });

    test('returns the empty summary verbatim', () {
      final hit = _hit(summary: '', matchStart: 0, matchEnd: 0);
      expect(hit.snippet, '');
    });

    test('returns the summary when the range is oversized', () {
      final hit = _hit(summary: 'short', matchStart: 1000, matchEnd: 2000);
      expect(hit.snippet, 'short');
    });

    test('returns the summary when both offsets are negative', () {
      final hit = _hit(summary: 'short', matchStart: -5, matchEnd: -1);
      expect(hit.snippet, 'short');
    });

    test('returns the summary when the range is reversed', () {
      final hit = _hit(summary: 'short text', matchStart: 8, matchEnd: 2);
      expect(hit.snippet, 'short text');
    });

    test('returns the summary when the range is empty after clamping', () {
      final hit = _hit(summary: 'short', matchStart: 3, matchEnd: 3);
      expect(hit.snippet, 'short');
    });

    test('clamps the end independently when only it is oversized', () {
      // matchStart stays in bounds but matchEnd overshoots: the highlight
      // should still extend to the summary's end without throwing.
      final hit = _hit(summary: 'hello', matchStart: 0, matchEnd: 9999);
      expect(hit.snippet, '«hello»');
    });

    test('clamps the start independently when only it is negative', () {
      final hit = _hit(summary: 'hello', matchStart: -2, matchEnd: 5);
      expect(hit.snippet, '«hello»');
    });
  });
}
