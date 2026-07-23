import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/search/search_hits.dart';
import 'package:pi_mob/src/search/search_source.dart';

void main() {
  test('snippet wraps only a bounded match range', () {
    final hit = SearchHit(
      hostId: 'h',
      sessionId: 's',
      sessionName: 'Chat',
      sourceKey: 'k',
      source: SearchSource.assistant,
      cursor: '1',
      summary: 'A useful answer',
      matchStart: 2,
      matchEnd: 8,
      occurredAt: DateTime.utc(2026),
    );
    expect(hit.snippet, 'A «useful» answer');
  });

  test('snippet safely clamps stale bounds', () {
    final hit = SearchHit(
      hostId: 'h',
      sessionId: 's',
      sessionName: 'Chat',
      sourceKey: 'k',
      source: SearchSource.tool,
      cursor: '1',
      summary: 'tool',
      matchStart: -2,
      matchEnd: 99,
      occurredAt: DateTime.utc(2026),
    );
    expect(hit.snippet, '«tool»');
  });
}
