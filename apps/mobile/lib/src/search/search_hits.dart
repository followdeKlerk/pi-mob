import '../domain/mobile_state.dart';
import 'search_source.dart';

final class SearchHit {
  const SearchHit({
    required this.hostId,
    required this.sessionId,
    required this.sessionName,
    required this.sourceKey,
    required this.source,
    required this.cursor,
    required this.summary,
    required this.matchStart,
    required this.matchEnd,
    required this.occurredAt,
  });

  final String hostId;
  final String sessionId;
  final String sessionName;
  final String sourceKey;
  final SearchSource source;
  final String cursor;
  final String summary;
  final int matchStart;
  final int matchEnd;
  final DateTime occurredAt;

  StreamCursor get cursorValue => StreamCursor.parse(cursor);

  /// Delimit the bounded matching range without mutating the indexed text.
  String get snippet {
    final start = matchStart.clamp(0, summary.length);
    final end = matchEnd.clamp(start, summary.length);
    if (end <= start) return summary;
    return '${summary.substring(0, start)}«${summary.substring(start, end)}»${summary.substring(end)}';
  }
}

final class SearchResults {
  const SearchResults({
    required this.query,
    required this.hits,
    required this.truncated,
    required this.completedAt,
  });

  factory SearchResults.empty({String query = ''}) => SearchResults(
    query: query,
    hits: const <SearchHit>[],
    truncated: false,
    completedAt: DateTime.now().toUtc(),
  );

  final String query;
  final List<SearchHit> hits;
  final bool truncated;
  final DateTime completedAt;
}

enum GlobalSearchPhase { idle, searching, results, error, cancelled }
