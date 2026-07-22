import 'dart:convert';

import '../../domain/mobile_state.dart';

/// R1's closed activity states. This is a client-side projection of the
/// already-normalized tool/reasoning journal; it is not a second protocol.
enum RecipeActivityStatus { pending, running, completed, failed, cancelled }
enum RecipeActivityKind { thinking, tool }

final class RecipeTiming {
  const RecipeTiming({required this.startedAt, this.updatedAt, this.finishedAt, this.durationMs});
  final DateTime startedAt;
  final DateTime? updatedAt;
  final DateTime? finishedAt;
  final int? durationMs;
}

final class RecipeTruncation {
  const RecipeTruncation({required this.retainedBytes, required this.totalBytes, required this.isTruncated, this.digest});
  final int retainedBytes;
  final int totalBytes;
  final bool isTruncated;
  final String? digest;
}

final class RecipeErrorInfo {
  const RecipeErrorInfo({required this.code, required this.message, required this.retryable, this.recommendedDelayMs});
  final String code;
  final String message;
  final bool retryable;
  final int? recommendedDelayMs;
}

/// Immutable, display-safe recipe activity. Thinking text is intentionally
/// absent: raw reasoning deltas are never promoted to a provider summary.
final class RecipeActivity {
  const RecipeActivity({
    required this.kind,
    required this.sessionId,
    required this.turnId,
    required this.activityId,
    required this.ordinal,
    required this.status,
    required this.timing,
    required this.title,
    this.toolName,
    this.arguments,
    this.output,
    this.errorInfo,
    this.truncation,
  });

  final RecipeActivityKind kind;
  final String sessionId;
  final String turnId;
  final String activityId;
  final int ordinal;
  final RecipeActivityStatus status;
  final RecipeTiming timing;
  final String title;
  final String? toolName;
  final String? arguments;
  final String? output;
  final RecipeErrorInfo? errorInfo;
  final RecipeTruncation? truncation;

  String get identity => '$sessionId\u0000$turnId\u0000$activityId';

  RecipeActivity copyWith({
    RecipeActivityStatus? status,
    RecipeTiming? timing,
    String? arguments,
    String? output,
    RecipeErrorInfo? errorInfo,
    RecipeTruncation? truncation,
  }) => RecipeActivity(
    kind: kind, sessionId: sessionId, turnId: turnId, activityId: activityId,
    ordinal: ordinal, status: status ?? this.status, timing: timing ?? this.timing,
    title: title, toolName: toolName, arguments: arguments ?? this.arguments,
    output: output ?? this.output, errorInfo: errorInfo ?? this.errorInfo,
    truncation: truncation ?? this.truncation,
  );

  @override
  bool operator ==(Object other) => other is RecipeActivity && other.identity == identity && other.kind == kind && other.status == status && other.ordinal == ordinal && other.arguments == arguments && other.output == output && other.timing.startedAt == timing.startedAt && other.timing.finishedAt == timing.finishedAt;
  @override
  int get hashCode => Object.hash(identity, kind, status, ordinal, arguments, output, timing.startedAt, timing.finishedAt);
}

final class RecipeActivityProjector {
  RecipeActivityProjector({this.sessionId, this.turnId}) : _activeTurnId = turnId;

  final String? sessionId;
  final String? turnId;
  String? _activeTurnId;
  final Map<String, RecipeActivity> _activities = <String, RecipeActivity>{};
  final Map<String, int> _ordinals = <String, int>{};

  RecipeActivityProjector apply(StreamEventState event) {
    final payload = event.payload;
    if (event.type == 'turn.started' && payload['turnId'] is String) {
      _activeTurnId = payload['turnId'] as String;
      return this;
    }
    if (!event.type.startsWith('tool.') && !event.type.startsWith('reasoning.')) return this;
    final sid = _string(payload['sessionId']) ?? sessionId;
    final tid = _string(payload['turnId']) ?? _activeTurnId ?? turnId;
    final id = _string(payload['toolCallId']) ?? _string(payload['contentBlockId']);
    if (sid == null || tid == null || id == null) return this;
    final kind = event.type.startsWith('tool.') ? RecipeActivityKind.tool : RecipeActivityKind.thinking;
    final identity = '$sid\u0000$tid\u0000$id';
    final old = _activities[identity];
    if (old != null && old.kind != kind) return this; // kind is immutable.
    final at = event.occurredAt.toUtc();
    if (old == null) {
      if (event.type != 'tool.started' && event.type != 'reasoning.started') return this;
      final ordinal = _ordinals[tid] ?? 0;
      _ordinals[tid] = ordinal + 1;
      if (kind == RecipeActivityKind.thinking) {
        _activities[identity] = RecipeActivity(
          kind: kind, sessionId: sid, turnId: tid, activityId: id,
          ordinal: ordinal, status: RecipeActivityStatus.running,
          timing: RecipeTiming(startedAt: at), title: 'Thinking',
        );
      } else {
        final args = _bounded(_stringify(payload['arguments'], '{}'));
        _activities[identity] = RecipeActivity(
          kind: kind, sessionId: sid, turnId: tid, activityId: id,
          ordinal: ordinal, status: RecipeActivityStatus.running,
          timing: RecipeTiming(startedAt: at), title: _bounded(_string(payload['toolName']) ?? 'Tool').value,
          toolName: _bounded(_string(payload['toolName']) ?? 'tool').value,
          arguments: args.value, output: '-', truncation: args.truncation,
        );
      }
      return this;
    }
    var timing = RecipeTiming(startedAt: old.timing.startedAt, updatedAt: at);
    final status = _status(event.type);
    if (_terminal(status)) {
      final duration = at.difference(old.timing.startedAt).inMilliseconds;
      timing = RecipeTiming(startedAt: old.timing.startedAt, updatedAt: at, finishedAt: at, durationMs: duration < 0 ? 0 : duration);
    }
    var next = old.copyWith(status: status == RecipeActivityStatus.running ? old.status : status, timing: timing);
    if (kind == RecipeActivityKind.tool) {
      final args = payload.containsKey('arguments') ? _bounded(_stringify(payload['arguments'], '{}')) : null;
      final rawOutput = payload.containsKey('output') ? payload['output'] : payload['result'];
      final output = rawOutput == null ? null : _bounded(_stringify(rawOutput, '-'));
      final trunc = _merge(old.truncation, args?.truncation, output?.truncation, payload);
      next = next.copyWith(arguments: args?.value, output: output?.value, truncation: trunc);
      if (event.type == 'tool.failed') next = next.copyWith(errorInfo: _error(payload));
    }
    _activities[identity] = next;
    return this;
  }

  List<RecipeActivity> get activities => snapshot();
  List<RecipeActivity> snapshot() {
    final result = _activities.values.toList()..sort((a, b) => a.ordinal == b.ordinal ? a.activityId.compareTo(b.activityId) : a.ordinal.compareTo(b.ordinal));
    return List<RecipeActivity>.unmodifiable(result);
  }

  RecipeActivityProjector applyAll(Iterable<StreamEventState> events) {
    for (final event in events) {
      apply(event);
    }
    return this;
  }
}

List<RecipeActivity> projectRecipeActivities(Iterable<StreamEventState> events, {String? sessionId, String? turnId}) => RecipeActivityProjector(sessionId: sessionId, turnId: turnId).applyAll(events).snapshot();

RecipeActivityStatus _status(String type) {
  if (type == 'tool.failed') return RecipeActivityStatus.failed;
  if (type == 'tool.cancelled') return RecipeActivityStatus.cancelled;
  if (type == 'tool.completed' || type == 'reasoning.completed') return RecipeActivityStatus.completed;
  return RecipeActivityStatus.running;
}
bool _terminal(RecipeActivityStatus status) => status == RecipeActivityStatus.completed || status == RecipeActivityStatus.failed || status == RecipeActivityStatus.cancelled;
String? _string(Object? value) => value is String && value.isNotEmpty ? value : null;
String _stringify(Object? value, String fallback) {
  if (value is String && value.isNotEmpty) return value;
  try { final encoded = jsonEncode(value); return encoded == 'null' ? fallback : encoded; } catch (_) { return fallback; }
}
({String value, RecipeTruncation? truncation}) _bounded(String value, [int maximum = 240]) {
  if (value.length <= maximum) return (value: value.isEmpty ? '-' : value, truncation: null);
  final retained = value.substring(0, maximum);
  return (value: retained.isEmpty ? '-' : retained, truncation: RecipeTruncation(retainedBytes: utf8.encode(retained).length, totalBytes: utf8.encode(value).length, isTruncated: true));
}
RecipeTruncation? _merge(RecipeTruncation? first, RecipeTruncation? second, RecipeTruncation? third, Map<String, Object?> payload) {
  final values = <RecipeTruncation>[
    ?first,
    ?second,
    ?third,
  ];
  final r = payload['retainedBytes']; final t = payload['totalBytes'];
  if (r is int || t is int) values.add(RecipeTruncation(retainedBytes: r is int && r >= 0 ? r : 0, totalBytes: t is int && t >= 0 ? t : (r is int && r >= 0 ? r : 0), isTruncated: payload['isTruncated'] == true, digest: _string(payload['digest'])));
  if (values.isEmpty) return null;
  final retained = values.map((item) => item.retainedBytes).reduce((a, b) => a > b ? a : b);
  final total = values.map((item) => item.totalBytes).reduce((a, b) => a > b ? a : b);
  return RecipeTruncation(retainedBytes: retained, totalBytes: total < retained ? retained : total, isTruncated: values.any((item) => item.isTruncated || item.retainedBytes < item.totalBytes), digest: values.map((item) => item.digest).whereType<String>().firstOrNull);
}
RecipeErrorInfo _error(Map<String, Object?> payload) {
  final raw = payload['errorInfo'] is Map ? Map<String, Object?>.from(payload['errorInfo'] as Map) : const <String, Object?>{};
  return RecipeErrorInfo(code: _string(raw['code']) ?? 'internal_error', message: _bounded(_string(raw['message']) ?? 'Tool execution failed', 512).value, retryable: raw['retryable'] == true, recommendedDelayMs: raw.containsKey('recommendedDelayMs') && (raw['recommendedDelayMs'] == null || raw['recommendedDelayMs'] is int) ? raw['recommendedDelayMs'] as int? : null);
}
