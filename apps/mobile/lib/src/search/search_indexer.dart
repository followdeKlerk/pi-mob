import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:drift/drift.dart';

import '../connection/connection_coordinator.dart';
import '../data/app_database.dart';
import '../domain/mobile_state.dart';
import '../session_events/transcript_reducer.dart';
import 'search_source.dart';

/// Maximum characters of the visible summary retained per search entry.
///
/// Sized so a 100k-event transcript still fits comfortably under
/// `kSearchEntriesPerSessionCap` rows × 256 bytes ≈ 25 MiB, the same
/// memory ceiling the existing journal cache targets.
const int kSearchSummaryCharCap = 240;

/// Maximum rows retained per (host, session). Keeps individual sessions
/// bounded so a runaway tool loop cannot grow the global index without
/// limit. Older rows are dropped in cursor order when this is exceeded.
const int kSearchEntriesPerSessionCap = 500;

/// Maximum rows retained per host in aggregate. Triggers a graceful
/// prune of the oldest rows across all sessions when exceeded.
const int kSearchEntriesPerHostCap = 5000;

/// Bounded incremental index that mirrors the durable subset of the
/// journal cache into a normalised search table.
///
/// The indexer is intentionally append-only over [AppDatabase] so the
/// database remains the source of truth — coordinators, host resets,
/// and the global search controller all read the same rows.
class SearchIndexer {
  SearchIndexer({
    required AppDatabase database,
    required ConnectionCoordinator coordinator,
    DateTime Function()? now,
  }) : // ignore: prefer_initializing_formals
       // ignore: prefer_initializing_formals
       _database = database,
       // ignore: prefer_initializing_formals
       _coordinator = coordinator,
       _now = now ?? DateTime.now;

  final AppDatabase _database;
  final ConnectionCoordinator _coordinator;
  final DateTime Function() _now;

  final Set<String> _rebuilding = <String>{};

  /// Processes the in-memory transcript of [sessionId] and writes a
  /// bounded set of normalised summaries into the search table. Idempotent:
  /// each (host, session, event) collapses onto one row, so re-running
  /// after a reconnect or rename is safe.
  Future<void> indexSession(String sessionId) async {
    final hostId = _coordinator.hostId;
    if (hostId == null) return;
    final session = _coordinator.sessions.firstWhere(
      (s) => s.sessionId == sessionId,
      orElse: () => SessionState(
        sessionId: sessionId,
        hostId: hostId,
        name: 'Chat',
        runtimeState: 'unknown',
        queueCount: 0,
      ),
    );
    final canonicalState = _coordinator.canonicalTranscriptStateFor(sessionId);
    final indexed = _coordinator.canonicalSessionManager.isEnabled
        ? (canonicalState == null
              ? const <_Extracted>[]
              : _extractCanonical(hostId, session, canonicalState))
        : _extractAll(
            hostId,
            session,
            _coordinator.transcriptEvents(sessionId),
          );
    if (indexed.isEmpty) return;
    for (final extracted in indexed) {
      await _database.upsertSearchEntry(
        hostId: extracted.hostId,
        sessionId: extracted.sessionId,
        eventId: extracted.sourceKey,
        cursor: extracted.cursor,
        source: searchSourceWire(extracted.source),
        summary: extracted.summary,
        tokens: extracted.tokens,
        occurredAt: extracted.occurredAt,
        updatedAt: extracted.occurredAt,
      );
    }
    await _ensurePerSessionCap(hostId, sessionId);
    await _ensurePerHostCap(hostId);
  }

  /// Upserts one chat-name entry so the global sheet can find the chat
  /// by display name even before its first event has streamed. A new
  /// row keyed by the well-known [`kChatNameEventId`] replaces any prior
  /// row so a rename surfaces immediately.
  Future<void> indexSessionMeta(SessionState session) async {
    final hostId = _coordinator.hostId;
    if (hostId == null || session.hostId != hostId) return;
    final updatedAt = _now().toUtc();
    await _database.upsertSearchEntry(
      hostId: hostId,
      sessionId: session.sessionId,
      eventId: kChatNameEventId,
      cursor: kChatNameCursor,
      source: searchSourceWire(SearchSource.chat),
      summary: _cap(session.name.isEmpty ? 'Chat' : session.name),
      tokens: _tokenize(session.name),
      occurredAt: updatedAt,
      updatedAt: updatedAt,
    );
  }

  Future<void> indexWorkspace(
    String sessionId, {
    required String workspaceId,
    required String label,
  }) async {
    await _indexExternal(
      sessionId,
      'workspace:$workspaceId',
      SearchSource.workspace,
      label,
      <String, Object?>{'kind': 'workspace', 'workspaceId': workspaceId},
    );
  }

  Future<void> indexViewedFile(
    String sessionId, {
    required String workspaceId,
    required String path,
    String? content,
    int? line,
  }) async {
    final summary = content == null || content.trim().isEmpty
        ? path
        : '$path ${content.trim()}';
    await _indexExternal(
      sessionId,
      'file:$workspaceId:$path',
      SearchSource.file,
      summary,
      <String, Object?>{
        'kind': 'file',
        'workspaceId': workspaceId,
        'path': path,
        'line': ?line,
      },
    );
  }

  Future<void> indexGit(String sessionId) async {
    final summary = _coordinator.git.summary;
    if (summary == null) return;
    await _indexExternal(
      sessionId,
      'git:${summary.workspaceId}:${summary.revision}',
      SearchSource.git,
      '${summary.repository} ${summary.branch ?? summary.latestCommit.sha} ${summary.latestCommit.message ?? ''}',
      <String, Object?>{
        'kind': 'git',
        'workspaceId': summary.workspaceId,
        'revision': summary.revision,
      },
    );
  }

  Future<void> _indexExternal(
    String sessionId,
    String eventId,
    SearchSource source,
    String summary,
    Map<String, Object?> destination,
  ) async {
    final hostId = _coordinator.hostId;
    if (hostId == null || summary.trim().isEmpty) return;
    final now = _now().toUtc();
    await _database.upsertSearchEntry(
      hostId: hostId,
      sessionId: sessionId,
      eventId: eventId,
      cursor: '0',
      source: searchSourceWire(source),
      summary: _cap(summary),
      tokens: _tokenize(summary),
      occurredAt: now,
      updatedAt: now,
      destinationJson: jsonEncode(destination),
    );
  }

  /// Removes every search row for a session. Called when the user
  /// deletes a chat or when a host reset drops the host's cached rows.
  Future<void> removeSession(String sessionId) async {
    final hostId = _coordinator.hostId;
    if (hostId == null) return;
    await _database.removeSearchEntriesForSession(
      hostId: hostId,
      sessionId: sessionId,
    );
  }

  /// Reindexes every chat for the active host. Safe to call on app
  /// launch; the upsert key ensures already-indexed events stay
  /// idempotent and the per-session / per-host caps prevent growth.
  Future<int> rebuildHost(String hostId) async {
    if (!_rebuilding.add(hostId)) return 0;
    try {
      await _database.resetSearchIndexCaches(hostId);
      for (final session in _coordinator.sessions.where(
        (s) => s.hostId == hostId,
      )) {
        await indexSessionMeta(session);
        await indexSession(session.sessionId);
      }
      return await _database.searchEntryCountForHost(hostId);
    } finally {
      _rebuilding.remove(hostId);
    }
  }

  Future<void> _ensurePerSessionCap(String hostId, String sessionId) async {
    final total = await _database.searchEntryCountForSession(
      hostId: hostId,
      sessionId: sessionId,
    );
    if (total <= kSearchEntriesPerSessionCap) return;
    final excess = total - kSearchEntriesPerSessionCap;
    final oldest = await _database.searchEntriesOldestForSession(
      hostId: hostId,
      sessionId: sessionId,
      limit: excess,
    );
    for (final row in oldest) {
      await _database.customStatement(
        'DELETE FROM search_entries WHERE host_id = ? AND session_id = ? '
        'AND event_id = ?',
        <Object?>[hostId, sessionId, row['eventId']],
      );
    }
  }

  Future<void> _ensurePerHostCap(String hostId) async {
    final total = await _database.searchEntryCountForHost(hostId);
    if (total <= kSearchEntriesPerHostCap) return;
    final excess = total - kSearchEntriesPerHostCap;
    final rows = await _database
        .customSelect(
          'SELECT session_id, event_id FROM search_entries '
          'WHERE host_id = ? ORDER BY cursor ASC, updated_at ASC LIMIT ?',
          variables: [Variable.withString(hostId), Variable.withInt(excess)],
        )
        .get();
    for (final row in rows) {
      await _database.customStatement(
        'DELETE FROM search_entries WHERE host_id = ? AND session_id = ? '
        'AND event_id = ?',
        <Object?>[
          hostId,
          row.read<String>('session_id'),
          row.read<String>('event_id'),
        ],
      );
    }
  }

  List<_Extracted> _extractCanonical(
    String hostId,
    SessionState session,
    CanonicalTranscriptState state,
  ) {
    final output = <_Extracted>[];
    final cursor = _coordinator
        .canonicalLastAppliedSequence(session.sessionId)
        .toString();
    for (final message in state.userMessages.values) {
      output.add(
        _simpleCanonical(
          hostId,
          session,
          cursor,
          message.occurredAt,
          SearchSource.userPrompt,
          message.text,
          'user:${message.messageId}',
        ),
      );
    }
    for (final message in state.assistantMessages.values) {
      final text = message.content.map((block) => block.text).join('\\n');
      if (text.trim().isNotEmpty) {
        output.add(
          _simpleCanonical(
            hostId,
            session,
            cursor,
            message.startedAt,
            SearchSource.assistant,
            text,
            'assistant:${message.messageId}',
          ),
        );
      }
    }
    for (final tool in state.toolCalls.values) {
      final text = <String>[
        tool.toolName,
        jsonEncode(tool.arguments),
        if (tool.progress != null) tool.progress.toString(),
        if (tool.result != null) tool.result.toString(),
        if (tool.errorMessage != null) tool.errorMessage!,
      ].where((value) => value.trim().isNotEmpty).join('\\n');
      if (text.trim().isNotEmpty) {
        output.add(
          _simpleCanonical(
            hostId,
            session,
            cursor,
            tool.startedAt,
            SearchSource.tool,
            text,
            'tool:${tool.toolCallId}',
          ),
        );
      }
    }
    return output;
  }

  _Extracted _simpleCanonical(
    String hostId,
    SessionState session,
    String cursor,
    DateTime occurredAt,
    SearchSource source,
    String raw,
    String key,
  ) => _Extracted(
    hostId: hostId,
    sessionId: session.sessionId,
    sourceKey: key,
    cursor: cursor,
    source: source,
    summary: _cap(raw),
    tokens: _tokenize(_cap(raw)),
    occurredAt: occurredAt,
  );

  List<_Extracted> _extractAll(
    String hostId,
    SessionState session,
    List<StreamEventState> events,
  ) {
    final output = <_Extracted>[];
    final assistant = <String, StringBuffer>{};
    final tools = <String, Map<String, dynamic>>{};
    String? turn;
    for (final event
        in [...events]..sort(
          (a, b) => BigInt.parse(
            a.cursor.value,
          ).compareTo(BigInt.parse(b.cursor.value)),
        )) {
      final p = event.payload;
      if (event.type == 'turn.started') {
        turn = p['turnId']?.toString();
        final message = _text(p['message']);
        if (message != null) {
          output.add(
            _simple(
              hostId,
              session,
              event,
              SearchSource.userPrompt,
              message,
              event.eventId,
            ),
          );
        }
        continue;
      }
      final explicit = p['turnId']?.toString();
      final scoped = explicit ?? turn;
      if (event.type == 'assistant.delta') {
        final id = p['contentBlockId']?.toString();
        final text = _text(p['text']);
        if (scoped != null && id != null && text != null) {
          assistant.putIfAbsent('$scoped|$id', StringBuffer.new).write(text);
        }
      } else if (event.type == 'assistant.completed') {
        final id = p['contentBlockId']?.toString();
        final key = scoped == null || id == null ? null : '$scoped|$id';
        final b = key == null ? null : assistant[key];
        if (b != null && b.isNotEmpty) {
          output.add(
            _simple(
              hostId,
              session,
              event,
              SearchSource.assistant,
              b.toString(),
              'assistant:$scoped:$id',
            ),
          );
        }
      } else if (event.type == 'reasoning.completed') {
        final id = p['contentBlockId']?.toString();
        final summary = _text(p['summary']);
        if (scoped != null && id != null && summary != null) {
          output.add(
            _simple(
              hostId,
              session,
              event,
              SearchSource.reasoning,
              summary,
              'reasoning:$scoped:$id',
            ),
          );
        }
      } else if (event.type.startsWith('tool.')) {
        final id = p['toolCallId']?.toString();
        if (id == null) continue;
        final t = tools.putIfAbsent(
          id,
          () => <String, dynamic>{
            'turn': scoped,
            'name': '',
            'args': '',
            'output': StringBuffer(),
            'terminal': false,
          },
        );
        if (t['turn'] == null) t['turn'] = scoped;
        if (p['toolName'] != null && (t['name'] as String).isEmpty) {
          t['name'] = p['toolName'].toString();
        }
        if (event.type == 'tool.started') t['args'] = _print(p['arguments']);
        if (event.type == 'tool.output' && _text(p['output']) != null) {
          (t['output'] as StringBuffer).write(p['output']);
        }
        if (event.type == 'tool.completed' ||
            event.type == 'tool.failed' ||
            event.type == 'tool.cancelled') {
          t['terminal'] = true;
          final text = <String>[
            if ((t['name'] as String).isNotEmpty) t['name'],
            if ((t['args'] as String).isNotEmpty) t['args'],
            if ((t['output'] as StringBuffer).isNotEmpty)
              (t['output'] as StringBuffer).toString(),
            if (event.type == 'tool.completed' &&
                (t['output'] as StringBuffer).isEmpty)
              _print(p['result']),
            if (event.type == 'tool.failed')
              _text(
                    p['errorMessage'] ??
                        (p['error'] is Map
                            ? (p['error'] as Map)['message']
                            : null),
                  ) ??
                  '',
          ].where((x) => x.isNotEmpty).toList();
          if (text.isNotEmpty) {
            output.add(
              _simple(
                hostId,
                session,
                event,
                SearchSource.tool,
                text.join(' • '),
                'tool:$id',
              ),
            );
          }
        }
      }
    }
    return output;
  }

  _Extracted _simple(
    String hostId,
    SessionState session,
    StreamEventState event,
    SearchSource source,
    String raw,
    String key,
  ) => _Extracted(
    hostId: hostId,
    sessionId: session.sessionId,
    sourceKey: key,
    cursor: event.cursor.value,
    source: source,
    summary: _cap(raw),
    tokens: _tokenize(_cap(raw)),
    occurredAt: event.occurredAt,
  );

  static String? _text(Object? value) =>
      value is String && value.trim().isNotEmpty ? value : null;
  static String _print(Object? value) =>
      value is String ? value : (value == null ? '' : _encodeJson(value));
}

/// Stable identifier used for the synthetic per-chat summary row. Lets a
/// rename overwrite the prior chat-name row instead of accumulating
/// duplicates in the index.
const String kChatNameEventId = 'chat-name';
const String kChatNameCursor = '0';

class _Extracted {
  const _Extracted({
    required this.hostId,
    required this.sessionId,
    required this.sourceKey,
    required this.cursor,
    required this.source,
    required this.summary,
    required this.tokens,
    required this.occurredAt,
  });

  final String hostId;
  final String sessionId;
  final String sourceKey;
  final String cursor;
  final SearchSource source;
  final String summary;
  final String tokens;
  final DateTime occurredAt;
}

/// Trims a string to [kSearchSummaryCharCap] characters, breaking on the
/// nearest word boundary so the visible summary remains readable.
String _cap(String value) {
  if (value.length <= kSearchSummaryCharCap) return value;
  final truncated = value.substring(0, kSearchSummaryCharCap);
  final lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > kSearchSummaryCharCap - 40) {
    return '${truncated.substring(0, lastSpace)}…';
  }
  return '$truncated…';
}

/// Normalises free-form text into a space-separated token list suitable for
/// `LIKE` matching. Lowercases, strips punctuation, and collapses whitespace
/// so the persisted `tokens` column stays small and predictable.
String _tokenize(String value) {
  if (value.isEmpty) return '';
  final lowered = value.toLowerCase();
  final buf = StringBuffer();
  var pendingSpace = false;
  for (final rune in lowered.runes) {
    final ch = String.fromCharCode(rune);
    final code = rune;
    final isLetter =
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) ||
        (code >= 0x00c0 && code <= 0x024f) ||
        (code >= 0x1e00 && code <= 0x1eff);
    final isDigit = code >= 0x30 && code <= 0x39;
    if (isLetter || isDigit) {
      if (pendingSpace) buf.write(' ');
      buf.write(ch);
      pendingSpace = false;
    } else {
      pendingSpace = true;
    }
  }
  return buf.toString().trim();
}

/// Tokenises an external query string using the same rules the indexer
/// stores. Whitespace-separated tokens longer than two characters are
/// returned in their original order so the UI can surface the matched
/// substring alongside the highlighted snippet.
List<String> tokenizeSearchQuery(String value) {
  if (value.trim().isEmpty) return const <String>[];
  final tokens = <String>[];
  for (final match in value.toLowerCase().split(RegExp(r'\s+'))) {
    if (match.length < 2) continue;
    if (tokens.contains(match)) continue;
    tokens.add(match);
  }
  return tokens;
}

/// Resolves the first match of [tokens] inside [summary]. Honours the
/// per-token query against the persisted token list, falling back to a
/// raw substring scan when the persisted form has been compacted.
({int start, int end})? locateMatch(String summary, List<String> tokens) {
  if (summary.isEmpty || tokens.isEmpty) return null;
  final lowered = summary.toLowerCase();
  var bestStart = -1;
  var bestEnd = -1;
  for (final token in tokens) {
    final at = lowered.indexOf(token);
    if (at < 0) continue;
    if (bestStart == -1 || at < bestStart) {
      bestStart = at;
      bestEnd = at + token.length;
    }
  }
  if (bestStart < 0) return null;
  return (start: bestStart, end: bestEnd);
}

/// Padded cap helper used by the indexer unit tests so the cap stays in
/// one place even if we lift [kSearchSummaryCharCap] later.
int effectiveSearchCap({int? override}) => override ?? kSearchSummaryCharCap;

/// Number of session rows the indexer is willing to walk per single
/// rebuild. Defensive ceiling that prevents a pathological host from
/// pinning the UI thread on launch.
const int kSearchRebuildSessionCap = 64;

/// Returns the maximum number of search rows the indexer will keep per
/// session, expressed as a [math.min] guard so callers can probe the cap.
int effectivePerSessionCap({int? override}) =>
    math.min(override ?? kSearchEntriesPerSessionCap, kSearchEntriesPerHostCap);

/// JSON encoder that ignores unknown types. Tools occasionally surface
/// opaque payloads (binary, function refs); we still want them indexed
/// by their printable string form so a search by tool name still hits.
String _encodeJson(Object? input) {
  try {
    return jsonEncode(input);
  } on Object {
    return input?.toString() ?? '';
  }
}
