import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/search/search_indexer.dart';

void main() {
  test(
    'tokenization is bounded, normalized, and preserves latin extended letters',
    () {
      expect(tokenizeSearchQuery('  Café -- BUILD_42  '), [
        'café',
        'build',
        '42',
      ]);
    },
  );

  test('matching uses persisted-safe normalized query tokens', () {
    expect(locateMatch(summary: 'A café answer', tokens: ['café']), (
      start: 2,
      end: 6,
    ));
    expect(
      locateMatch(summary: 'A provider summary', tokens: ['private']),
      isNull,
    );
  });

  test('search constants keep index persistence bounded', () {
    expect(kSearchSummaryCharCap, 240);
    expect(kSearchEntriesPerSessionCap, 500);
    expect(kSearchEntriesPerHostCap, 5000);
    expect(kSearchRebuildSessionCap, 64);
  });
}
