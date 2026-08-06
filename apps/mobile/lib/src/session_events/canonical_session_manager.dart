/// Canonical session-event manager for the coordinator cut-in.
///
/// The coordinator owns one [CanonicalSessionManager] that:
///   * Tracks whether `session_events.v2` was advertised in
///     `hello.accepted`.
///   * Lazily constructs per-session
///     [SessionEventSynchronizer]s (and their underlying
///     [CanonicalEventRepository] SQLite handles).
///   * Persists the last durably applied sequence per session so
///     reconnect/replay can resume from the correct cursor.
///   * Accepts decoded wire events, feeds them through the per-session
///     synchronizer, and exposes the resulting
///     [CanonicalTranscriptState] for future UI cutover.
///
/// The manager is intentionally read-only from the UI's perspective:
/// it exposes a synchronous snapshot of the canonical state for the
/// requested session but never mutates the legacy transcript
/// projection. The legacy history/live merge in the coordinator
/// remains authoritative until the next deletion slice; this manager
/// runs alongside it.
///
/// Removal criteria:
///   * When `TranscriptPanel` (and the related search/side-channel
///     surfaces) read directly from this manager and the legacy
///     history/live merge is deleted, this module may be deleted
///     together with [SessionEventSynchronizer] and
///     [CanonicalEventRepository].
library;

import 'dart:async';

import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqlite3/sqlite3.dart';

import 'canonical_event.dart';
import 'canonical_wire_transport.dart';
import 'session_event_repository.dart';
import 'session_event_synchronizer.dart';
import 'transcript_reducer.dart';

const String _kCanonicalSessionEventsDir = 'canonical_session_events';
const int _kCanonicalSessionCap = 32;

/// One per-session canonical store + synchronizer pair.
class CanonicalSessionBindings {
  CanonicalSessionBindings({
    required this.sessionId,
    required this.repository,
    required this.synchronizer,
  });

  final String sessionId;
  final CanonicalEventRepository repository;
  final SessionEventSynchronizer synchronizer;

  Future<void> close() async {
    await repository.close();
  }
}

/// Outcome of feeding wire events into the manager. The coordinator
/// uses the resulting list of dispositions to drive diagnostics
/// without coupling the manager to UI state.
class CanonicalIngestSummary {
  const CanonicalIngestSummary({
    required this.applied,
    required this.duplicates,
    required this.gaps,
    required this.conflicts,
    required this.wrongSession,
  });

  final int applied;
  final int duplicates;
  final int gaps;
  final int conflicts;
  final int wrongSession;

  bool get hasIssues => gaps > 0 || conflicts > 0 || wrongSession > 0;
}

/// Owns the per-session synchronizer / repository map and persists the
/// last durably applied sequence so reconnects resume from the right
/// cursor.
///
/// The manager is a [ChangeNotifier] so widgets can subscribe to
/// canonical-only updates without listening to the legacy history/live
/// merge.
class CanonicalSessionManager extends ChangeNotifier {
  CanonicalSessionManager({Directory? baseDirectoryOverride})
    : baseDirectoryOverride = baseDirectoryOverride;

  /// Override the directory used for the per-session SQLite cache.
  /// When `null`, the manager uses `path_provider` to resolve the
  /// application support directory and creates a sub-directory.
  final Directory? baseDirectoryOverride;

  final Map<String, CanonicalSessionBindings> _bindings = {};
  final Map<String, int> _lastSequenceBySession = {};
  String? _hostGeneration;
  bool _enabled = false;

  /// Set of sessionIds the manager is currently subscribed to via
  /// `session.events.subscribe`. The coordinator uses this to know
  /// which sessions to skip when iterating subscriptions.
  Set<String> get subscribedSessionIds =>
      Set<String>.unmodifiable(_bindings.keys);

  /// Whether the bridge advertised `session_events.v2` in the most
  /// recent `hello.accepted` envelope.
  bool get isEnabled => _enabled;

  /// Number of sessions currently tracked. Diagnostic only.
  int get sessionCount => _bindings.length;

  /// Update the enabled state. Called by the coordinator when it
  /// processes `hello.accepted`. The manager resets its session map
  /// when the host generation changes.
  Future<void> updateCapabilities({
    required bool advertised,
    required String hostGeneration,
  }) async {
    if (hostGeneration != _hostGeneration) {
      await resetAll();
      _hostGeneration = hostGeneration;
    }
    final wasEnabled = _enabled;
    _enabled = advertised;
    if (!advertised) {
      await resetAll();
    }
    if (wasEnabled != advertised) notifyListeners();
  }

  /// Clear the entire manager state, closing every per-session SQLite
  /// handle. Called on disconnect, host generation change, and after
  /// capability removal.
  Future<void> resetAll() async {
    for (final binding in _bindings.values) {
      await binding.close();
    }
    _bindings.clear();
    _lastSequenceBySession.clear();
  }

  /// Forget a single session. Called when the user deletes a chat
  /// or the legacy subscription drops it.
  Future<void> forgetSession(String sessionId) async {
    final binding = _bindings.remove(sessionId);
    if (binding != null) await binding.close();
    _lastSequenceBySession.remove(sessionId);
  }

  /// Returns the canonical transcript state for [sessionId], or
  /// `null` when the manager is disabled or has no binding yet. The
  /// state is a snapshot suitable for read-only consumers; mutating
  /// helpers MUST go through [ingestWireEvents].
  CanonicalTranscriptState? snapshotFor(String sessionId) {
    if (!_enabled) return null;
    final binding = _bindings[sessionId];
    return binding?.synchronizer.state;
  }

  /// Last durable sequence applied to the local cache for
  /// [sessionId]. The coordinator uses this value as
  /// `afterSequence` when subscribing so a replay never repeats
  /// committed state.
  int lastAppliedSequence(String sessionId) =>
      _bindings[sessionId]?.synchronizer.lastAppliedSequence ??
      _lastSequenceBySession[sessionId] ??
      0;

  /// Returns the bindings for [sessionId], creating the repository
  /// and synchronizer lazily. When the manager is disabled or the
  /// session cap is exhausted, returns `null`.
  Future<CanonicalSessionBindings?> ensureSession(String sessionId) async {
    if (!_enabled) return null;
    if (sessionId.isEmpty) return null;
    final existing = _bindings[sessionId];
    if (existing != null) return existing;
    if (_bindings.length >= _kCanonicalSessionCap) return null;
    final directory = await _resolveBaseDirectory();
    final file = File(p.join(directory.path, 'canonical-$sessionId.sqlite'));
    final database = sqlite3.open(file.path);
    final repository = CanonicalEventRepository(
      sessionId: sessionId,
      database: database,
    );
    await repository.ensureSchema();
    final synchronizer = SessionEventSynchronizer(
      sessionId: sessionId,
      repository: repository,
    );
    await synchronizer.replayFromCache();
    final binding = CanonicalSessionBindings(
      sessionId: sessionId,
      repository: repository,
      synchronizer: synchronizer,
    );
    _bindings[sessionId] = binding;
    final persisted = _lastSequenceBySession[sessionId];
    if (persisted != null &&
        persisted > binding.synchronizer.lastAppliedSequence) {
      // The local cache lags the host's notion of "last durably
      // applied sequence"; flag the gap and let the next replay
      // resolve it.
      binding.synchronizer.markGapUntilReplay(persisted);
    }
    return binding;
  }

  /// Feed a batch of decoded canonical events into the synchronizer
  /// for [sessionId]. The manager persists the resulting sequence
  /// after the entire batch is committed.
  Future<CanonicalIngestSummary> ingestWireEvents(
    String sessionId,
    Iterable<CanonicalSessionEvent> events,
  ) async {
    var applied = 0;
    var duplicates = 0;
    var gaps = 0;
    var conflicts = 0;
    var wrongSession = 0;
    final binding = await ensureSession(sessionId);
    if (binding == null) {
      wrongSession = events.length;
      return CanonicalIngestSummary(
        applied: applied,
        duplicates: duplicates,
        gaps: gaps,
        conflicts: conflicts,
        wrongSession: wrongSession,
      );
    }
    for (final event in events) {
      final result = await binding.synchronizer.accept(event);
      switch (result.disposition) {
        case SynchronizerDisposition.applied:
          applied += 1;
        case SynchronizerDisposition.duplicate:
          duplicates += 1;
        case SynchronizerDisposition.gap:
          gaps += 1;
        case SynchronizerDisposition.conflict:
          conflicts += 1;
        case SynchronizerDisposition.wrongSession:
          wrongSession += 1;
      }
    }
    final sequence = binding.synchronizer.lastAppliedSequence;
    if (sequence > (_lastSequenceBySession[sessionId] ?? 0)) {
      _lastSequenceBySession[sessionId] = sequence;
    }
    notifyListeners();
    return CanonicalIngestSummary(
      applied: applied,
      duplicates: duplicates,
      gaps: gaps,
      conflicts: conflicts,
      wrongSession: wrongSession,
    );
  }

  /// Decodes and ingests a `session.events.replay.result` envelope.
  /// When the replay signals an internal gap or duplicate sequence,
  /// the manager resets the local cache and rebuilds from the
  /// provided events.
  Future<CanonicalIngestSummary> ingestReplay(
    Object? wireMessage, {
    required String sessionId,
  }) async {
    CanonicalReplayDecodeResult decoded;
    try {
      decoded = decodeReplayResult(wireMessage, wireSessionId: sessionId);
    } on CanonicalWireError {
      final binding = await ensureSession(sessionId);
      if (binding != null) await binding.synchronizer.resetAndReplay();
      return const CanonicalIngestSummary(
        applied: 0,
        duplicates: 0,
        gaps: 0,
        conflicts: 0,
        wrongSession: 0,
      );
    }
    final binding = await ensureSession(sessionId);
    if (binding != null && !decoded.complete) {
      await binding.synchronizer.resetAndReplay();
    }
    return ingestWireEvents(decoded.sessionId, decoded.events);
  }

  /// Decodes and ingests a single `session.event` envelope.
  Future<CanonicalIngestSummary> ingestLive(
    Object? wireMessage, {
    required String sessionId,
  }) async {
    CanonicalSessionEvent event;
    try {
      event = decodeWireEvent(wireMessage, wireSessionId: sessionId);
    } on CanonicalWireError {
      return const CanonicalIngestSummary(
        applied: 0,
        duplicates: 0,
        gaps: 0,
        conflicts: 0,
        wrongSession: 0,
      );
    }
    return ingestWireEvents(sessionId, <CanonicalSessionEvent>[event]);
  }

  /// Build the `session.events.subscribe` payload the coordinator
  /// should send for [sessionId]. Returns `null` when the manager is
  /// disabled, so the caller can fall back to the legacy path.
  Map<String, Object?>? buildSubscribePayload(String sessionId) {
    if (!_enabled) return null;
    return <String, Object?>{
      'sessionId': sessionId,
      'afterSequence': lastAppliedSequence(sessionId),
    };
  }

  Future<Directory> _resolveBaseDirectory() async {
    if (baseDirectoryOverride != null) return baseDirectoryOverride!;
    final base = await getApplicationSupportDirectory();
    final target = Directory(p.join(base.path, _kCanonicalSessionEventsDir));
    if (!target.existsSync()) {
      target.createSync(recursive: true);
    }
    return target;
  }
}
