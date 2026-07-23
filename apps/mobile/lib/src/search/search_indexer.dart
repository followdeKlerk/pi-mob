import 'dart:convert';

import '../connection/connection_coordinator.dart';
import '../data/app_database.dart';
import '../domain/mobile_state.dart';
import 'search_source.dart';

const int kSearchSummaryCharCap = 240;
const int kSearchEntriesPerSessionCap = 500;
const int kSearchEntriesPerHostCap = 5000;
const int kSearchRebuildSessionCap = 64;

/// Recoverable local projection of the exact source families the transcript
/// reducer consumes. It replays the coordinator's public, cursor-ordered
/// transcript stream, never transport event ids or event timestamps.
final class SearchIndexer {
  SearchIndexer({
    required AppDatabase database,
    required ConnectionCoordinator coordinator,
  }) : // Public parameter names form the coordinator integration boundary.
       // ignore: prefer_initializing_formals
       _database = database,
       // ignore: prefer_initializing_formals
       _coordinator = coordinator;

  final AppDatabase _database;
  final ConnectionCoordinator _coordinator;
  final Set<String> _rebuilding = <String>{};

  Future<void> indexSessionMeta(SessionState session) async {
    final hostId = _coordinator.hostId;
    if (hostId == null || session.hostId != hostId) return;
    final now = DateTime.now().toUtc();
    await _database.upsertSearchEntry(
      hostId: hostId,
      sessionId: session.sessionId,
      sourceKey: kChatNameEventId,
      cursor: kChatNameCursor,
      source: searchSourceWire(SearchSource.chat),
      summary: _capSummary(session.name.isEmpty ? 'Chat' : session.name),
      tokens: _tokenize(session.name),
      occurredAt: now,
      updatedAt: now,
    );
  }

  /// Replaying one session makes lifecycle retries and history/live overlap
  /// idempotent. Rows are keyed by logical source identity, never `eventId`.
  Future<void> indexSession(String sessionId) async {
    final hostId = _coordinator.hostId;
    if (hostId == null) return;
    SessionState? session;
    for (final candidate in _coordinator.sessions) {
      if (candidate.sessionId == sessionId) {
        session = candidate;
        break;
      }
    }
    if (session == null || session.hostId != hostId) return;
    final records = _extract(
      hostId,
      session,
      _coordinator.transcriptEvents(sessionId),
    );
    await _database.removeSearchEntriesForSession(
      hostId: hostId,
      sessionId: sessionId,
    );
    await indexSessionMeta(session);
    for (final record in records) {
      await _database.upsertSearchEntry(
        hostId: record.hostId,
        sessionId: record.sessionId,
        sourceKey: record.sourceKey,
        cursor: record.cursor,
        source: searchSourceWire(record.source),
        summary: record.summary,
        tokens: record.tokens,
        occurredAt: record.occurredAt,
        updatedAt: DateTime.now().toUtc(),
      );
    }
    await _enforceSessionCap(hostId, sessionId);
    await _enforceHostCap(hostId);
  }

  Future<void> removeSession(String sessionId) async {
    final hostId = _coordinator.hostId;
    if (hostId != null) {
      await _database.removeSearchEntriesForSession(
        hostId: hostId,
        sessionId: sessionId,
      );
    }
  }

  Future<int> rebuildHost(String hostId) async {
    if (!_rebuilding.add(hostId)) return 0;
    try {
      await _database.resetSearchEntries(hostId);
      var indexed = 0;
      for (final session in _coordinator.sessions) {
        if (session.hostId != hostId || indexed >= kSearchRebuildSessionCap)
          continue;
        await indexSession(session.sessionId);
        indexed += 1;
      }
      return _database.searchEntryCountForHost(hostId);
    } finally {
      _rebuilding.remove(hostId);
    }
  }

  Future<void> _enforceSessionCap(String hostId, String sessionId) async {
    final count = await _database.searchEntryCountForSession(
      hostId: hostId,
      sessionId: sessionId,
    );
    final excess = count - kSearchEntriesPerSessionCap;
    if (excess <= 0) return;
    for (final row in await _database.searchEntriesOldestForSession(
      hostId: hostId,
      sessionId: sessionId,
      limit: excess,
    )) {
      await _database.removeSearchEntry(
        hostId: hostId,
        sessionId: sessionId,
        sourceKey: row['sourceKey']! as String,
      );
    }
  }

  Future<void> _enforceHostCap(String hostId) async {
    final excess =
        await _database.searchEntryCountForHost(hostId) -
        kSearchEntriesPerHostCap;
    if (excess <= 0) return;
    for (final row in await _database.searchEntriesOldestForHost(
      hostId: hostId,
      limit: excess,
    )) {
      await _database.removeSearchEntry(
        hostId: hostId,
        sessionId: row['sessionId']! as String,
        sourceKey: row['sourceKey']! as String,
      );
    }
  }

  List<_Record> _extract(
    String hostId,
    SessionState session,
    List<StreamEventState> events,
  ) {
    final results = <String, _Record>{};
    final assistant = <String, _AssistantBuffer>{};
    final tools = <String, _ToolBuffer>{};
    String? activeTurn;
    final ordered = List<StreamEventState>.of(events)
      ..sort((a, b) => a.cursor.compareTo(b.cursor));

    void emit(_Record record) => results[record.sourceKey] = record;
    void sealAssistant(_AssistantBuffer buffer, StreamEventState event) {
      if (buffer.text.isEmpty || buffer.turnId == null) return;
      emit(
        _record(
          hostId,
          session.sessionId,
          '${buffer.turnId}|assistant|${buffer.contentBlockId}',
          event,
          SearchSource.assistant,
          buffer.text.toString(),
        ),
      );
    }

    void sealTool(
      _ToolBuffer buffer,
      StreamEventState event, {
      String? result,
      String? error,
    }) {
      if (buffer.turnId == null) return;
      if (buffer.output.isEmpty && result != null && result.isNotEmpty)
        buffer.output.write(result);
      final pieces = <String>[
        if (buffer.name.isNotEmpty) buffer.name,
        if (buffer.arguments.isNotEmpty) buffer.arguments,
        if (buffer.output.isNotEmpty) buffer.output.toString(),
        if (error != null && error.isNotEmpty) error,
      ];
      if (pieces.isEmpty) return;
      emit(
        _record(
          hostId,
          session.sessionId,
          '${buffer.turnId}|tool|${buffer.toolCallId}',
          event,
          SearchSource.tool,
          pieces.join(' • '),
        ),
      );
    }

    for (final event in ordered) {
      final payload = event.payload;
      final explicitTurn = _text(payload['turnId']);
      if (event.type == 'turn.started') {
        final turnId = explicitTurn ?? 'turn-${event.cursor.value}';
        activeTurn = turnId;
        final message = _text(payload['message']);
        if (message != null) {
          emit(
            _record(
              hostId,
              session.sessionId,
              '$turnId|userPrompt|prompt',
              event,
              SearchSource.userPrompt,
              message,
            ),
          );
        }
        continue;
      }
      final turnId = explicitTurn ?? activeTurn;
      if (event.type == 'assistant.delta') {
        final blockId = _contentBlockId(payload);
        final text = _text(payload['text']);
        if (blockId != null && text != null && turnId != null) {
          final key = '$turnId|$blockId';
          (assistant[key] ??= _AssistantBuffer(
            turnId,
            blockId,
          )).text.write(text);
        }
      } else if (event.type == 'assistant.completed') {
        final blockId = _contentBlockId(payload);
        if (blockId != null && turnId != null) {
          final buffer = assistant['$turnId|$blockId'];
          if (buffer != null) sealAssistant(buffer, event);
        }
      } else if (event.type == 'reasoning.completed') {
        final blockId = _contentBlockId(payload);
        final summary = _text(payload['summary']);
        if (blockId != null && turnId != null && summary != null) {
          emit(
            _record(
              hostId,
              session.sessionId,
              '$turnId|reasoning|$blockId',
              event,
              SearchSource.reasoning,
              summary,
            ),
          );
        }
      } else if (event.type.startsWith('tool.')) {
        final callId = _text(payload['toolCallId']);
        if (callId == null) continue;
        final buffer = tools.putIfAbsent(
          callId,
          () => _ToolBuffer(callId, turnId),
        );
        // The first event owns the call. Later explicit scope may fill an
        // unknown scope, but a different scope is a protocol mismatch and is
        // intentionally ignored instead of cross-attaching output.
        if (turnId != null && buffer.turnId != null && buffer.turnId != turnId)
          continue;
        buffer.turnId ??= turnId;
        final toolName = _text(payload['toolName']);
        if (buffer.name.isEmpty && toolName != null) buffer.name = toolName;
        if (event.type == 'tool.started') {
          buffer.arguments = _print(payload['arguments']);
        } else if (event.type == 'tool.output') {
          final output = _text(payload['output']);
          if (output != null) buffer.output.write(output);
        } else if (event.type == 'tool.completed' ||
            event.type == 'tool.failed' ||
            event.type == 'tool.cancelled') {
          final result = _printResult(payload['result']);
          final error = event.type == 'tool.failed'
              ? _text(
                  payload['errorMessage'] ??
                      (payload['error'] is Map
                          ? (payload['error'] as Map)['message']
                          : null),
                )
              : null;
          sealTool(buffer, event, result: result, error: error);
        }
      } else if (_isTurnTerminal(event.type)) {
        for (final buffer in assistant.values.where(
          (value) => value.turnId == turnId,
        )) {
          sealAssistant(buffer, event);
        }
        for (final buffer in tools.values.where(
          (value) => value.turnId == turnId,
        )) {
          sealTool(buffer, event);
        }
      }
    }
    return results.values.toList(growable: false);
  }
}

final class _AssistantBuffer {
  _AssistantBuffer(this.turnId, this.contentBlockId);
  final String? turnId;
  final String contentBlockId;
  final StringBuffer text = StringBuffer();
}

final class _ToolBuffer {
  _ToolBuffer(this.toolCallId, this.turnId);
  final String toolCallId;
  String? turnId;
  String name = '';
  String arguments = '';
  final StringBuffer output = StringBuffer();
}

final class _Record {
  const _Record({
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

_Record _record(
  String hostId,
  String sessionId,
  String sourceKey,
  StreamEventState event,
  SearchSource source,
  String value,
) {
  final summary = _capSummary(value);
  return _Record(
    hostId: hostId,
    sessionId: sessionId,
    sourceKey: sourceKey,
    cursor: event.cursor.value,
    source: source,
    summary: summary,
    tokens: _tokenize(summary),
    occurredAt: event.occurredAt,
  );
}

String _capSummary(String value) {
  if (utf8.encode(value).length <= kSearchSummaryCharCap) return value;
  // Reserve the three UTF-8 bytes used by the ellipsis, then stop on a rune
  // boundary. A nearest word boundary keeps rendered excerpts intelligible.
  const payloadCap = kSearchSummaryCharCap - 3;
  final out = StringBuffer();
  var bytes = 0;
  var lastWhitespaceLength = -1;
  for (final rune in value.runes) {
    final character = String.fromCharCode(rune);
    final next = utf8.encode(character).length;
    if (bytes + next > payloadCap) break;
    out.write(character);
    bytes += next;
    if (RegExp(r'\s').hasMatch(character)) lastWhitespaceLength = out.length;
  }
  var prefix = out.toString();
  if (lastWhitespaceLength >= 0 &&
      bytes - utf8.encode(prefix.substring(0, lastWhitespaceLength)).length <
          48) {
    prefix = prefix.substring(0, lastWhitespaceLength).trimRight();
  }
  return '$prefix…';
}

String _tokenize(String value) {
  final tokens = <String>[];
  final buffer = StringBuffer();
  for (final rune in value.toLowerCase().runes) {
    final letterOrDigit =
        (rune >= 0x30 && rune <= 0x39) ||
        (rune >= 0x61 && rune <= 0x7a) ||
        (rune >= 0x00c0 && rune <= 0x024f) ||
        (rune >= 0x1e00 && rune <= 0x1eff);
    if (letterOrDigit) {
      buffer.writeCharCode(rune);
    } else if (buffer.isNotEmpty) {
      tokens.add(buffer.toString());
      buffer.clear();
    }
  }
  if (buffer.isNotEmpty) tokens.add(buffer.toString());
  final joined = tokens.take(128).join(' ');
  if (utf8.encode(joined).length <= kSearchSummaryCharCap) return joined;
  final out = StringBuffer();
  var bytes = 0;
  for (final rune in joined.runes) {
    final character = String.fromCharCode(rune);
    final next = utf8.encode(character).length;
    if (bytes + next > kSearchSummaryCharCap) break;
    out.write(character);
    bytes += next;
  }
  return out.toString().trimRight();
}

List<String> tokenizeSearchQuery(String value) {
  final tokens = _tokenize(value)
      .split(' ')
      .where((token) => token.length >= 2)
      .toSet()
      .toList(growable: false);
  return tokens;
}

({int start, int end})? locateMatch({
  required String summary,
  required List<String> tokens,
}) {
  final lowered = summary.toLowerCase();
  for (final token in tokens) {
    final start = lowered.indexOf(token);
    if (start >= 0) return (start: start, end: start + token.length);
  }
  return null;
}

String? _text(Object? value) =>
    value is String && value.trim().isNotEmpty ? value : null;
String? _contentBlockId(Map<String, Object?> payload) => _text(
  payload['contentBlockId'] ?? payload['answerId'] ?? payload['reasoningId'],
);
String _print(Object? value) {
  if (value == null) return '';
  if (value is String) return value;
  try {
    return jsonEncode(value);
  } on Object {
    return '';
  }
}

String? _printResult(Object? value) {
  if (value is String) return value;
  if (value is Map && value['output'] is String)
    return value['output'] as String;
  return null;
}

bool _isTurnTerminal(String type) => const <String>{
  'turn.settled',
  'turn.aborted',
  'turn.failed',
  'turn.indeterminate',
  'turn.interrupted',
}.contains(type);
