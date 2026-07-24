import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../connection/connection_coordinator.dart';
import '../data/app_database.dart';
import 'search_hits.dart';
import 'search_indexer.dart';
import 'search_source.dart';

/// Hard ceiling on the per-query hit list. Prevents an over-broad query
/// from loading unbounded rows into the UI; the [SearchResults.truncated]
/// flag tells the user that more matches exist.
const int kGlobalSearchHitCap = 80;

/// Minimum query length before the controller will run. Keeping it above
/// one character prevents accidental single-letter scans from thrashing the
/// indexer and keeps the in-flight query latency well under one frame.
const int kGlobalSearchMinQueryLength = 2;

/// Coordinates one query at a time against the [SearchIndexer]-backed
/// [AppDatabase] search table. The controller is owned by
/// [ConnectionCoordinator] so the same instance survives sheet open and
/// close cycles without losing cached hits.
class GlobalSearchController extends ChangeNotifier {
  GlobalSearchController({
    required ConnectionCoordinator coordinator,
    required AppDatabase database,
    int hitCap = kGlobalSearchHitCap,
    DateTime Function()? now,
  }) : // Public parameter names keep this boundary ergonomic while these
       // assignments retain private fields.
       // ignore: prefer_initializing_formals
       _coordinator = coordinator,
       // ignore: prefer_initializing_formals
       _database = database,
       // ignore: prefer_initializing_formals
       _hitCap = hitCap,
       _now = now ?? DateTime.now;

  final ConnectionCoordinator _coordinator;
  final AppDatabase _database;
  final int _hitCap;
  final DateTime Function() _now;

  Completer<SearchResults>? _active;
  int _epoch = 0;
  bool _disposed = false;

  String _query = '';
  GlobalSearchPhase _phase = GlobalSearchPhase.idle;
  SearchResults _results = SearchResults.empty();
  String? _error;

  String get query => _query;
  GlobalSearchPhase get phase => _phase;
  SearchResults get results => _results;
  String? get error => _error;
  bool get isBusy => _phase == GlobalSearchPhase.searching;

  /// Sets the active query. Empty or too-short queries clear the result
  /// list immediately so the user sees an empty-state affordance without
  /// paying for a database scan.
  void setQuery(String value) {
    final next = value.trim();
    if (next == _query) return;
    _query = next;
    if (next.length < kGlobalSearchMinQueryLength) {
      _cancelActive(cancel: false);
      _phase = GlobalSearchPhase.idle;
      _results = SearchResults.empty(query: next);
      _error = null;
      notifyListeners();
      return;
    }
    _phase = GlobalSearchPhase.searching;
    _results = _results.query == next
        ? _results
        : SearchResults.empty(query: next);
    notifyListeners();
    unawaited(_runSearch(next));
  }

  /// Cancels the in-flight query (if any) and resets the state. The
  /// controller stays usable; the next [setQuery] call kicks off a fresh
  /// scan.
  void cancel() {
    _cancelActive(cancel: true);
    _phase = GlobalSearchPhase.cancelled;
    _results = SearchResults.empty(query: _query);
    _error = null;
    notifyListeners();
  }

  /// Resets to the idle state without firing a notification. Tests use
  /// this between scenarios; production callers should prefer
  /// [setQuery] with an empty string.
  void reset() {
    _cancelActive(cancel: false);
    _query = '';
    _phase = GlobalSearchPhase.idle;
    _results = SearchResults.empty();
    _error = null;
    notifyListeners();
  }

  /// Runs the search immediately against the database. After [dispose]
  /// this returns an empty result so a sheet that is still in the tree
  /// during teardown does not race against a torn-down controller.
  Future<SearchResults> searchNow(String value) async {
    if (_disposed) return SearchResults.empty(query: value.trim());
    return _runSearch(value);
  }

  Future<SearchResults> _runSearch(String value) async {
    final trimmed = value.trim();
    if (trimmed.length < kGlobalSearchMinQueryLength) {
      _phase = GlobalSearchPhase.idle;
      _results = SearchResults.empty(query: trimmed);
      _error = null;
      notifyListeners();
      return _results;
    }
    final hostId = _coordinator.hostId;
    if (hostId == null) {
      _phase = GlobalSearchPhase.error;
      _results = SearchResults.empty(query: trimmed);
      _error = 'No paired host';
      notifyListeners();
      return _results;
    }
    final tokens = tokenizeSearchQuery(trimmed);
    if (tokens.isEmpty) {
      _phase = GlobalSearchPhase.idle;
      _results = SearchResults.empty(query: trimmed);
      _error = null;
      notifyListeners();
      return _results;
    }
    final epoch = ++_epoch;
    final completer = Completer<SearchResults>();
    _active = completer;
    try {
      final raw = await _database.querySearchEntries(
        hostId: hostId,
        queryTokens: tokens,
        limit: _hitCap + 1,
      );
      if (epoch != _epoch) {
        // A newer query has superseded this one; drop the stale result.
        if (identical(_active, completer) && !completer.isCompleted) {
          completer.complete(SearchResults.empty(query: trimmed));
          return completer.future;
        }
        return SearchResults.empty(query: trimmed);
      }
      final truncated = raw.length > _hitCap;
      final limited = truncated ? raw.sublist(0, _hitCap) : raw;
      final hits = _hydrate(raw: limited, tokens: tokens, trimmed: trimmed);
      final results = SearchResults(
        query: trimmed,
        hits: hits,
        truncated: truncated,
        completedAt: _now().toUtc(),
      );
      _phase = GlobalSearchPhase.results;
      _results = results;
      _error = null;
      notifyListeners();
      if (!completer.isCompleted) completer.complete(results);
      return results;
    } on Object catch (e) {
      if (epoch != _epoch) {
        if (identical(_active, completer) && !completer.isCompleted) {
          completer.complete(SearchResults.empty(query: trimmed));
          return completer.future;
        }
        return SearchResults.empty(query: trimmed);
      }
      _phase = GlobalSearchPhase.error;
      _results = SearchResults.empty(query: trimmed);
      _error = e.toString();
      notifyListeners();
      if (!completer.isCompleted) completer.completeError(e);
      return _results;
    } finally {
      if (identical(_active, completer)) {
        _active = null;
      }
    }
  }

  void _cancelActive({required bool cancel}) {
    final active = _active;
    if (active == null || active.isCompleted) return;
    _epoch += 1;
    if (identical(_active, active) && !active.isCompleted) {
      active.complete(SearchResults.empty(query: _query));
    }
  }

  List<SearchHit> _hydrate({
    required List<Map<String, Object?>> raw,
    required List<String> tokens,
    required String trimmed,
  }) {
    final sessions = {for (final s in _coordinator.sessions) s.sessionId: s};
    final hits = <SearchHit>[];
    for (final row in raw) {
      final sessionId = row['sessionId'] as String;
      final eventId = row['eventId'] as String;
      final source = searchSourceFromWire(row['source']) ?? SearchSource.chat;
      final summary = row['summary'] as String;
      final match = locateMatch(summary, tokens);
      final session = sessions[sessionId];
      hits.add(
        SearchHit(
          hostId: _coordinator.hostId ?? '',
          sessionId: sessionId,
          sessionName: session?.name ?? 'Chat',
          eventId: eventId,
          source: source,
          cursor: row['cursor'] as String,
          summary: summary,
          matchStart: match?.start ?? 0,
          matchEnd: match?.end ?? trimmed.length,
          occurredAt: DateTime.parse(row['occurredAt'] as String),
          destination: row['destinationJson'] is String
              ? Map<String, Object?>.from(
                  jsonDecode(row['destinationJson'] as String) as Map,
                )
              : const <String, Object?>{},
        ),
      );
    }
    return hits;
  }

  @override
  void dispose() {
    _disposed = true;
    final active = _active;
    if (active != null && !active.isCompleted) {
      active.complete(_results);
    }
    super.dispose();
  }

  /// True after [dispose] has run. Late notifications from a sheet that
  /// is still mounted when the controller is torn down must not throw
  /// or fire listeners; production widgets also check `mounted`.
  bool get isDisposed => _disposed;

  @override
  void notifyListeners() {
    if (_disposed) return;
    super.notifyListeners();
  }
}
