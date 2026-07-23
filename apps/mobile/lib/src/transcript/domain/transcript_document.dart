import 'transcript_diagnostics.dart';
import 'transcript_turn.dart';

/// A fully-reduced transcript for a single session stream.
///
/// The document is immutable. The reducer returns a new instance whenever
/// a journal event modifies the transcript; the widget layer can use
/// [widgetKey] lookups and [indexOfTurnByKey] without copying the list
/// itself.
///
/// [lastSettledTurnId] is the widget key (`turn:assistant:<id>`) of the
/// most recent assistant turn that reached a terminal state. The
/// jump-to-latest affordance and the "unread" badge both derive from this
/// value.
class TranscriptDocument {
  const TranscriptDocument({
    required this.streamId,
    required this.turns,
    required this.diagnostics,
    required this.lastSettledTurnId,
  });

  /// Identifier of the session stream this document describes. The
  /// reducer refuses to apply events from a different stream.
  final String streamId;

  /// Ordered turns. Order is canonical: the widget renders the list in
  /// index order without re-sorting.
  final List<Turn> turns;

  /// Bounded diagnostics the reducer absorbed. Older entries are evicted
  /// once the cap is reached so memory stays predictable.
  final List<TranscriptDiagnostic> diagnostics;

  /// Widget key (`turn:assistant:<id>`) of the most recent terminal
  /// assistant turn. `null` when no assistant turn has settled yet.
  final String? lastSettledTurnId;

  /// Empty transcript for [streamId].
  factory TranscriptDocument.empty(String streamId) => TranscriptDocument(
    streamId: streamId,
    turns: const [],
    diagnostics: const [],
    lastSettledTurnId: null,
  );

  bool get isEmpty => turns.isEmpty;
  int get length => turns.length;

  /// Returns the index of the turn whose [Turn.widgetKey] equals [key], or
  /// `-1` when no match is found. The widget uses this for scroll
  /// restoration and jump-to-anchor flows.
  int indexOfTurnByKey(String key) {
    for (var i = 0; i < turns.length; i++) {
      if (turns[i].widgetKey == key) return i;
    }
    return -1;
  }

  /// Returns the turn at [index] or `null` when out of range. Mirrors
  /// `List.elementAtOrNull` semantics.
  Turn? turnAt(int index) {
    if (index < 0 || index >= turns.length) return null;
    return turns[index];
  }

  /// Returns the last turn whose [Turn.widgetKey] starts with the given
  /// prefix, or `null` when none is found. Used by the reducer to update
  /// in place.
  Turn? lastTurnWithKeyPrefix(String prefix) {
    for (var i = turns.length - 1; i >= 0; i--) {
      if (turns[i].widgetKey.startsWith(prefix)) return turns[i];
    }
    return null;
  }

  /// Returns a new document with [turn] appended. Used by the reducer when
  /// it needs to insert a new turn rather than mutate an existing one.
  TranscriptDocument appendTurn(Turn turn) => TranscriptDocument(
    streamId: streamId,
    turns: List<Turn>.unmodifiable([...turns, turn]),
    diagnostics: diagnostics,
    lastSettledTurnId: lastSettledTurnId,
  );

  /// Returns a new document with [turn] replacing the existing turn that
  /// has the same [Turn.widgetKey]. Throws [StateError] when no matching
  /// turn is found so the reducer surfaces bugs instead of silently
  /// double-inserting.
  TranscriptDocument replaceTurn(Turn turn) {
    final index = indexOfTurnByKey(turn.widgetKey);
    if (index < 0) {
      throw StateError('Cannot replace unknown turn: ${turn.widgetKey}');
    }
    final next = List<Turn>.of(turns);
    next[index] = turn;
    return TranscriptDocument(
      streamId: streamId,
      turns: List<Turn>.unmodifiable(next),
      diagnostics: diagnostics,
      lastSettledTurnId: _recomputeLastSettled(next, lastSettledTurnId),
    );
  }

  /// Returns a new document with the diagnostic list replaced. The reducer
  /// is responsible for keeping the list within
  /// [kTranscriptDiagnosticCountCap].
  TranscriptDocument withDiagnostics(List<TranscriptDiagnostic> next) =>
      TranscriptDocument(
        streamId: streamId,
        turns: turns,
        diagnostics: List<TranscriptDiagnostic>.unmodifiable(next),
        lastSettledTurnId: lastSettledTurnId,
      );

  /// Returns a new document with [lastSettledTurnId] updated. The reducer
  /// passes the assistant widget key, not the turnId.
  TranscriptDocument withLastSettled(String? key) => TranscriptDocument(
    streamId: streamId,
    turns: turns,
    diagnostics: diagnostics,
    lastSettledTurnId: key,
  );

  static String? _recomputeLastSettled(List<Turn> turns, String? existing) {
    if (existing != null) {
      // Preserve the existing pointer when its turn is still terminal.
      for (final turn in turns) {
        if (turn.widgetKey == existing &&
            turn is AssistantTurn &&
            turn.isTerminal) {
          return existing;
        }
      }
    }
    for (var i = turns.length - 1; i >= 0; i--) {
      final turn = turns[i];
      if (turn is AssistantTurn && turn.isTerminal) {
        return turn.widgetKey;
      }
    }
    return null;
  }

  @override
  bool operator ==(Object other) =>
      other is TranscriptDocument &&
      other.streamId == streamId &&
      other.lastSettledTurnId == lastSettledTurnId &&
      _turnListEquals(other.turns, turns) &&
      _diagListEquals(other.diagnostics, diagnostics);

  @override
  int get hashCode => Object.hash(
    streamId,
    lastSettledTurnId,
    Object.hashAll(turns),
    Object.hashAll(diagnostics),
  );
}

bool _turnListEquals(List<Turn> a, List<Turn> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

bool _diagListEquals(
  List<TranscriptDiagnostic> a,
  List<TranscriptDiagnostic> b,
) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}
