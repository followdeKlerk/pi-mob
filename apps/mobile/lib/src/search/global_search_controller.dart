import 'dart:async';

import 'package:flutter/foundation.dart';

import '../connection/connection_coordinator.dart';
import '../data/app_database.dart';
import 'search_hits.dart';
import 'search_indexer.dart';
import 'search_source.dart';

const int kGlobalSearchHitCap = 80;
const int kGlobalSearchMinQueryLength = 2;
const Duration kGlobalSearchDebounce = Duration(milliseconds: 120);

final class GlobalSearchController extends ChangeNotifier {
  GlobalSearchController({
    required ConnectionCoordinator coordinator,
    required AppDatabase database,
    Duration debounce = kGlobalSearchDebounce,
  }) : // Public parameter names form the coordinator integration boundary.
       // ignore: prefer_initializing_formals
       _coordinator = coordinator,
       // ignore: prefer_initializing_formals
       _database = database,
       // ignore: prefer_initializing_formals
       _debounce = debounce;

  final ConnectionCoordinator _coordinator;
  final AppDatabase _database;
  final Duration _debounce;
  Timer? _timer;
  int _epoch = 0;
  String _query = '';
  GlobalSearchPhase _phase = GlobalSearchPhase.idle;
  SearchResults _results = SearchResults.empty();
  String? _error;

  String get query => _query;
  GlobalSearchPhase get phase => _phase;
  SearchResults get results => _results;
  String? get error => _error;

  void setQuery(String value) {
    _query = value.trim();
    _timer?.cancel();
    final epoch = ++_epoch;
    if (_query.length < kGlobalSearchMinQueryLength) {
      _phase = GlobalSearchPhase.idle;
      _results = SearchResults.empty(query: _query);
      _error = null;
      notifyListeners();
      return;
    }
    _phase = GlobalSearchPhase.searching;
    _error = null;
    notifyListeners();
    _timer = Timer(_debounce, () {
      unawaited(_search(_query, epoch));
    });
  }

  void cancel() {
    _timer?.cancel();
    _epoch += 1;
    _phase = GlobalSearchPhase.cancelled;
    _results = SearchResults.empty(query: _query);
    _error = null;
    notifyListeners();
  }

  Future<SearchResults> searchNow([String? value]) {
    if (value != null) _query = value.trim();
    _timer?.cancel();
    return _search(_query, ++_epoch);
  }

  void reset() {
    _timer?.cancel();
    _epoch += 1;
    _query = '';
    _phase = GlobalSearchPhase.idle;
    _results = SearchResults.empty();
    _error = null;
    notifyListeners();
  }

  Future<SearchResults> _search(String requested, int epoch) async {
    final tokens = tokenizeSearchQuery(requested);
    final hostId = _coordinator.hostId;
    if (requested.length < kGlobalSearchMinQueryLength || tokens.isEmpty) {
      if (epoch == _epoch) {
        _phase = GlobalSearchPhase.idle;
        _results = SearchResults.empty(query: requested);
        notifyListeners();
      }
      return SearchResults.empty(query: requested);
    }
    if (hostId == null) {
      if (epoch == _epoch) {
        _phase = GlobalSearchPhase.error;
        _error = 'No paired host';
        _results = SearchResults.empty(query: requested);
        notifyListeners();
      }
      return SearchResults.empty(query: requested);
    }
    try {
      final rows = await _database.querySearchEntries(
        hostId: hostId,
        tokens: tokens,
        limit: kGlobalSearchHitCap + 1,
      );
      final limited = rows.take(kGlobalSearchHitCap).toList(growable: false);
      final sessions = <String, String>{
        for (final session in _coordinator.sessions)
          session.sessionId: session.name,
      };
      final hits = <SearchHit>[
        for (final row in limited)
          SearchHit(
            hostId: hostId,
            sessionId: row['sessionId']! as String,
            sessionName: sessions[row['sessionId']] ?? 'Chat',
            sourceKey: row['sourceKey']! as String,
            source:
                searchSourceFromWire(row['source']! as String) ??
                SearchSource.chat,
            cursor: row['cursor']! as String,
            summary: row['summary']! as String,
            matchStart:
                locateMatch(
                  summary: row['summary']! as String,
                  tokens: tokens,
                )?.start ??
                0,
            matchEnd:
                locateMatch(
                  summary: row['summary']! as String,
                  tokens: tokens,
                )?.end ??
                0,
            occurredAt:
                DateTime.tryParse(row['occurredAt']! as String)?.toUtc() ??
                DateTime.now().toUtc(),
          ),
      ];
      final next = SearchResults(
        query: requested,
        hits: hits,
        truncated: rows.length > kGlobalSearchHitCap,
        completedAt: DateTime.now().toUtc(),
      );
      if (epoch == _epoch) {
        _phase = GlobalSearchPhase.results;
        _results = next;
        _error = null;
        notifyListeners();
      }
      return next;
    } on Object catch (error) {
      if (epoch == _epoch) {
        _phase = GlobalSearchPhase.error;
        _error = error.toString();
        _results = SearchResults.empty(query: requested);
        notifyListeners();
      }
      return SearchResults.empty(query: requested);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}
