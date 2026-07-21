import '../domain/mobile_state.dart';
import 'search_source.dart';

/// One normalized hit returned by [GlobalSearchController.search]. Carries
/// enough metadata for the UI to navigate to the right chat and to highlight
/// the matching region inside the chat transcript when the reducer supports
/// that resolution.
///
/// The summary is bounded to [_kSummaryCharCap] so the database never grows
/// past the configured ceiling regardless of how verbose a tool output or
/// reasoning delta was.
class SearchHit {
  SearchHit({
    required this.hostId,
    required this.sessionId,
    required this.sessionName,
    required this.eventId,
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
  final String eventId;
  final SearchSource source;

  /// Decimal cursor string of the originating journal event. Persisted as
  /// text so values above JavaScript-safe integers stay exact.
  final String cursor;
  final String summary;

  /// Character offset (inclusive) of the first match in [summary]. `0` when
  /// the query is empty.
  final int matchStart;

  /// Character offset (exclusive) of the end of the first match. `0` when
  /// the query is empty.
  final int matchEnd;

  final DateTime occurredAt;

  StreamCursor get cursorValue => StreamCursor.parse(cursor);

  String get snippet {
    if (summary.isEmpty) return summary;
    // Clamp to the summary bounds so a stale or oversized match range
    // (e.g. produced when no literal substring exists and the controller
    // falls back to the trimmed query length) cannot throw a RangeError
    // out of `replaceRange`. The clamp is a no-op for valid ranges and
    // collapses invalid ones into a plain summary render.
    final length = summary.length;
    final start = matchStart.clamp(0, length);
    final end = matchEnd.clamp(0, length);
    if (end <= start) return summary;
    return summary.replaceRange(
      start,
      end,
      '«${summary.substring(start, end)}»',
    );
  }
}

/// Bounded query result envelope returned by
/// [GlobalSearchController.search]. The [truncated] flag is set when the
/// underlying index search hit the per-query ceiling; the UI must surface
/// it so the user knows that narrowing the query would reveal more hits.
class SearchResults {
  SearchResults({
    required this.query,
    required this.hits,
    required this.truncated,
    required this.completedAt,
  });

  static SearchResults empty({String query = ''}) => SearchResults(
    query: query,
    hits: const <SearchHit>[],
    truncated: false,
    completedAt: DateTime.now().toUtc(),
  );

  final String query;
  final List<SearchHit> hits;
  final bool truncated;
  final DateTime completedAt;

  bool get isEmpty => hits.isEmpty;
}

/// Phases emitted by the global search controller. Mirrors the existing
/// workspace-search vocabulary so users see the same verbs in every sheet.
enum GlobalSearchPhase { idle, searching, results, error, cancelled }
