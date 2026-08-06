/// Canonical projection helper.
///
/// This module wires the canonical session-event machinery for one
/// selected session. The helper:
///
///   1. Opens an on-disk canonical-event cache for the session
///      (lazily created in the platform's application support
///      directory).
///   2. Replays the existing journal events into the cache via the
///      adapter. The replay is idempotent because the cache uses
///      `(session_id, sequence)` as the durable identity.
///   3. Returns a synchronizer the caller can use to accept new
///      events. The returned synchronizer is independent of the
///      coordinator and does not interfere with the existing
///      history/live merge path.
///
/// The helper is opt-in: production callers SHOULD instantiate the
/// synchronizer only after the bridge advertises the canonical
/// session-event capability, or behind a feature flag in tests. The
/// class deliberately avoids touching the coordinator so the rewrite
/// slice can ship without disturbing existing widgets.
library;

import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqlite3/sqlite3.dart';

import '../domain/mobile_state.dart';
import 'journal_to_canonical.dart';
import 'session_event_repository.dart';
import 'session_event_synchronizer.dart';

/// Result of feeding one journal event through the adapter. Returned
/// so callers (e.g. tests) can assert on the canonical mapping.
class CanonicalProjection {
  CanonicalProjection({required this.synchronizer, required this.repository});

  final SessionEventSynchronizer synchronizer;
  final CanonicalEventRepository repository;

  Future<void> close() async {
    await repository.close();
  }
}

/// Factory for [CanonicalProjection]. The factory opens (or creates)
/// a per-session sqlite file under the platform's application support
/// directory.
class CanonicalProjectionFactory {
  CanonicalProjectionFactory({this.baseDirectoryOverride});

  /// Override the directory used for the canonical cache. When set,
  /// the factory skips the [path_provider] lookup. Tests use this to
  /// point the cache at a temporary directory.
  final Directory? baseDirectoryOverride;

  /// Constructs a [CanonicalProjection] for [sessionId]. The cache is
  /// primed from the journal events passed in [bootstrap]. The
  /// caller is responsible for providing the journal in canonical
  /// sequence order.
  Future<CanonicalProjection> openForSession({
    required String sessionId,
    Iterable<StreamEventState> bootstrap = const <StreamEventState>[],
  }) async {
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

    // Replay bootstrap events once. The repository dedups by
    // sequence, so the second call is a no-op.
    for (final event in bootstrap) {
      await _acceptJournal(synchronizer, event, sessionId);
    }
    await synchronizer.replayFromCache();
    return CanonicalProjection(
      synchronizer: synchronizer,
      repository: repository,
    );
  }

  /// Feeds one journal event into the synchronizer via the canonical
  /// adapter. Assistant deltas are routed through the replacement
  /// adapter so the canonical reducer never sees append-only
  /// semantics. Tool outputs are routed through the replacement
  /// adapter for the same reason.
  Future<void> _acceptJournal(
    SessionEventSynchronizer synchronizer,
    StreamEventState event,
    String sessionId,
  ) async {
    final adapted = adaptJournalEvent(event, sessionId: sessionId);
    if (adapted.isAccepted) {
      await synchronizer.accept(adapted.canonical!);
      return;
    }
    if (event.type == 'assistant.delta') {
      // Replace semantics: the synchronizer only sees one
      // `assistant_content_replaced` event per journal delta. The
      // reducer still treats it as a snapshot because the
      // canonical-event contract forbids append-style content.
      final payload = event.payload;
      final messageId = payload['contentBlockId'] is String
          ? payload['contentBlockId'] as String
          : 'assistant-current';
      final replaced = adaptAssistantDelta(
        event,
        sessionId: sessionId,
        messageId: messageId,
        turnId: payload['turnId'] is String
            ? payload['turnId'] as String
            : 'unknown',
        previousContent: synchronizer.state.assistantMessages[messageId] == null
            ? ''
            : ((synchronizer.state.assistantMessages[messageId]!.content.isEmpty
                  ? ''
                  : synchronizer
                        .state
                        .assistantMessages[messageId]!
                        .content
                        .last
                        .text)),
      );
      await synchronizer.accept(replaced.canonical!);
    } else if (event.type == 'tool.output') {
      final payload = event.payload;
      final toolCallId = payload['toolCallId'] is String
          ? payload['toolCallId'] as String
          : 'tool-current';
      final replaced = adaptToolOutput(
        event,
        sessionId: sessionId,
        toolCallId: toolCallId,
        turnId: payload['turnId'] is String
            ? payload['turnId'] as String
            : 'unknown',
      );
      await synchronizer.accept(replaced.canonical!);
    }
    // Anything else that does not map to a canonical event is
    // intentionally dropped (matches plan §7.4).
  }

  Future<Directory> _resolveBaseDirectory() async {
    if (baseDirectoryOverride != null) return baseDirectoryOverride!;
    final base = await getApplicationSupportDirectory();
    final target = Directory(p.join(base.path, 'canonical_events'));
    if (!target.existsSync()) {
      target.createSync(recursive: true);
    }
    return target;
  }
}
