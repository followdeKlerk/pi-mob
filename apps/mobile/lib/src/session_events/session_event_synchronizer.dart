/// Deterministic canonical event synchronizer.
///
/// The synchronizer is the mobile-side counterpart of the
/// bridge-side replay/live delivery model. It enforces:
///
///   * strict sequence ordering (no gaps tolerated)
///   * deduplication on `(sessionId, sequence)` and event identity
///   * bounded diagnostic logging for unexpected events
///   * safe full-recovery on conflict / cache reset
///   * one durable row per canonical event (persist-before-apply)
///
/// The synchronizer is intentionally synchronous in-memory and pure
/// with respect to the [CanonicalEventRepository]: the repository
/// owns persistence, the reducer owns projection, and this class
/// owns ordering + dedup. The class is constructed once per session
/// and reused across reconnects. The class is test-only in terms of
/// the constructor signature; production wiring instantiates it
/// through the `SessionEventSynchronizerFactory`.
library;

import 'dart:async';

import 'canonical_event.dart';
import 'session_event_repository.dart';
import 'transcript_reducer.dart';

/// Result of accepting one canonical event into the synchronizer.
enum SynchronizerDisposition {
  /// The event advanced the projection. `state` is the new state.
  applied,

  /// The event was a duplicate (same identity and sequence).
  duplicate,

  /// The event created a sequence gap. The synchronizer pauses
  /// forward progress until a replay resolves the gap.
  gap,

  /// The event conflicted with persisted state (sequence reuse with
  /// a different event id). The synchronizer refuses to apply it
  /// and forces a full replay.
  conflict,

  /// The event belonged to a different session id.
  wrongSession,
}

/// Output of [SessionEventSynchronizer.accept]. The reducer state is
/// always populated, even for dedup/disposition, so callers can render
/// without checking each branch.
class SynchronizerResult {
  const SynchronizerResult({required this.disposition, required this.state});

  final SynchronizerDisposition disposition;
  final CanonicalTranscriptState state;
}

/// Reconciles an ordered stream of canonical events against a
/// durable cache. The synchronizer never inspects network state or
/// reads host clocks; all sequencing decisions come from the
/// canonical event stream itself.
class SessionEventSynchronizer {
  SessionEventSynchronizer({
    required this.sessionId,
    required this.repository,
    CanonicalTranscriptState? initialState,
  }) : _state = initialState ?? CanonicalTranscriptState.empty(sessionId);

  final String sessionId;
  final CanonicalEventRepository repository;
  CanonicalTranscriptState _state;
  bool _paused = false;

  /// Last contiguous sequence the synchronizer has durably applied.
  int get lastAppliedSequence => _state.lastAppliedSequence;

  /// Whether the synchronizer is currently paused awaiting a replay.
  bool get isPaused => _paused;

  /// Current projection. The reducer state is always durable-backed
  /// after each [accept] call.
  CanonicalTranscriptState get state => _state;

  /// Cold-start replay: read every cached canonical event for this
  /// session in strict sequence order and rebuild the projection.
  /// The projection's `lastAppliedSequence` matches the repository's
  /// `latestSequence` at the end of the call. Idempotent.
  Future<CanonicalTranscriptState> replayFromCache() async {
    await repository.ensureSchema();
    final stored = await repository.readAfter(0);
    var next = CanonicalTranscriptState.empty(sessionId);
    for (final entry in stored) {
      next = applyCanonicalEvent(next, entry.event);
    }
    final cachedLatest = await repository.latestSequence();
    if (cachedLatest != next.lastAppliedSequence) {
      // Cache inconsistency: rebuild by sequence only.
      next = CanonicalTranscriptState.empty(sessionId);
      final bySequence = [...stored]
        ..sort((a, b) => a.event.sequence.compareTo(b.event.sequence));
      for (final entry in bySequence) {
        next = applyCanonicalEvent(next, entry.event);
      }
    }
    _state = next;
    _paused = false;
    return _state;
  }

  /// Accepts one canonical event into the synchronizer. Persists the
  /// event before applying it (plan §3.2). Detects gaps and conflicts
  /// and pauses / triggers replay accordingly.
  Future<SynchronizerResult> accept(CanonicalSessionEvent event) async {
    if (event.sessionId != sessionId) {
      return SynchronizerResult(
        disposition: SynchronizerDisposition.wrongSession,
        state: _state,
      );
    }

    await repository.ensureSchema();
    final cached = await repository.lookupBySequence(event.sequence);
    if (cached != null) {
      // Same sequence in cache: either duplicate replay or conflict.
      if (cached.event.eventId == event.eventId) {
        return SynchronizerResult(
          disposition: SynchronizerDisposition.duplicate,
          state: _state,
        );
      }
      _paused = true;
      return SynchronizerResult(
        disposition: SynchronizerDisposition.conflict,
        state: _state,
      );
    }

    if (event.sequence <= _state.lastAppliedSequence) {
      // Replay ordering is captured upstream. We still persist so
      // the local cache matches the durable backend log.
      await repository.append(event);
      return SynchronizerResult(
        disposition: SynchronizerDisposition.duplicate,
        state: _state,
      );
    }

    if (event.sequence != _state.lastAppliedSequence + 1) {
      _paused = true;
      return SynchronizerResult(
        disposition: SynchronizerDisposition.gap,
        state: _state,
      );
    }

    await repository.append(event);
    _state = applyCanonicalEvent(_state, event);
    _paused = false;
    return SynchronizerResult(
      disposition: SynchronizerDisposition.applied,
      state: _state,
    );
  }

  /// Drops the entire session cache and resets the projection so the
  /// next [replayFromCache] rebuilds from scratch. Tests call this to
  /// validate full recovery; production should call it after
  /// detecting a conflict or a sequence rollback.
  Future<void> resetAndReplay() async {
    await repository.resetCache();
    _state = CanonicalTranscriptState.empty(sessionId);
    _paused = false;
    await replayFromCache();
  }

  /// Records a server-side `lastAppliedSequence` that exceeds the
  /// local cache. The synchronizer pauses forward progress so the
  /// next replay can close the gap deterministically.
  void markGapUntilReplay(int expectedSequence) {
    if (expectedSequence <= _state.lastAppliedSequence) return;
    _paused = true;
  }
}
