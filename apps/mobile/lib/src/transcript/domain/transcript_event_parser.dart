import '../widgets/view_data/reasoning_view_data.dart';
import '../widgets/transcript_status.dart';
import 'transcript_truncation.dart';

/// Parsed payload of a `turn.queued` / `turn.accepted` event.
///
/// The reducer uses this to lower the durable command state and prompt into
/// the user-turn lifecycle.
class ParsedTurnStarted {
  const ParsedTurnStarted({
    required this.turnId,
    required this.commandId,
    required this.deliveryMode,
    this.message,
    this.respondingToTurnId,
  });

  final String turnId;
  final String commandId;
  final String deliveryMode;
  final String? message;
  final String? respondingToTurnId;
}

/// Parsed payload of an assistant-related event (`assistant.started`,
/// `assistant.delta`, `assistant.completed`).
class ParsedAssistantEvent {
  const ParsedAssistantEvent({
    required this.assistantStepId,
    this.answerId,
    this.delta,
    this.isCompleted = false,
  });

  final String assistantStepId;
  final String? answerId;
  final String? delta;
  final bool isCompleted;
}

/// Parsed payload of a reasoning event (`reasoning.started`,
/// `reasoning.delta`, `reasoning.completed`).
class ParsedReasoningEvent {
  const ParsedReasoningEvent({
    required this.reasoningId,
    required this.assistantStepId,
    this.phase = ReasoningPhase.active,
    this.delta,
    this.summary,
    this.steps = const <String>[],
  });

  final String reasoningId;
  final String assistantStepId;
  final ReasoningPhase phase;
  final String? delta;
  final String? summary;
  final List<String> steps;
}

/// Parsed payload of a tool lifecycle event.
class ParsedToolEvent {
  const ParsedToolEvent({
    required this.toolCallId,
    required this.assistantStepId,
    required this.toolName,
    this.status = TranscriptToolStatus.running,
    this.arguments = const <String, Object?>{},
    this.outputSnapshot,
    this.outputDelta,
    this.result,
    this.errorMessage,
    this.truncation,
    this.startedAt,
    this.finishedAt,
  });

  final String toolCallId;
  final String assistantStepId;
  final String toolName;
  final TranscriptToolStatus status;
  final Map<String, Object?> arguments;

  /// Snapshot output replaces prior output for this tool call. Genuine deltas
  /// are carried separately by the protocol as `delta`.
  final String? outputSnapshot;

  /// Genuine incremental output, appended only when explicitly marked delta.
  final String? outputDelta;
  final Map<String, Object?>? result;
  final String? errorMessage;
  final TranscriptTruncation? truncation;
  final DateTime? startedAt;
  final DateTime? finishedAt;
}

/// Strict, defensive parser for the journal events the reducer needs to
/// lower. Every method returns the structured record the reducer consumes
/// or throws [FormatException] on missing/malformed required fields. The
/// reducer catches those exceptions and routes them to the bounded
/// diagnostic surface so a single bad event never crashes the reducer.
class TranscriptEventParser {
  const TranscriptEventParser();

  // ---- Turn lifecycle ----

  ParsedTurnStarted parseTurnStarted(Map<String, Object?> payload) {
    final turnId = _turnId(payload);
    final commandId = _optionalString(payload['commandId']) ?? turnId;
    final deliveryMode =
        _optionalString(payload['deliveryMode']) ?? 'immediate';
    final respondingTo = payload['respondingToTurnId'];
    return ParsedTurnStarted(
      turnId: turnId,
      commandId: commandId,
      deliveryMode: deliveryMode,
      message: _optionalString(payload['message']),
      respondingToTurnId: respondingTo is String ? respondingTo : null,
    );
  }

  /// Parses a `turn.queued` / `turn.accepted` event. The required field set
  /// is intentionally narrower than `turn.started` because the bridge may
  /// emit these before the full turn record is allocated.
  ({String turnId, String commandId}) parseTurnQueued(
    Map<String, Object?> payload,
  ) {
    final turnId = _turnId(payload);
    final commandId = _optionalString(payload['commandId']) ?? turnId;
    return (turnId: turnId, commandId: commandId);
  }

  ({String turnId, String? errorCode, String? errorMessage}) parseTurnTerminal(
    Map<String, Object?> payload,
  ) {
    final turnId = _turnId(payload);
    final errorCode = payload['errorCode'];
    final errorMessage = payload['errorMessage'];
    return (
      turnId: turnId,
      errorCode: errorCode is String ? errorCode : null,
      errorMessage: errorMessage is String ? errorMessage : null,
    );
  }

  String parseTurnStatusId(Map<String, Object?> payload) => _turnId(payload);

  // ---- Assistant ----

  ParsedAssistantEvent parseAssistantStarted(Map<String, Object?> payload) {
    final id = _contentId(payload, 'assistant.started');
    return ParsedAssistantEvent(
      assistantStepId: _optionalString(payload['assistantStepId']) ?? '',
      answerId: id,
    );
  }

  ParsedAssistantEvent parseAssistantDelta(Map<String, Object?> payload) {
    final id = _contentId(payload, 'assistant.delta');
    return ParsedAssistantEvent(
      assistantStepId: _optionalString(payload['assistantStepId']) ?? '',
      answerId: id,
      delta: _optionalString(payload['text'] ?? payload['delta']),
    );
  }

  ParsedAssistantEvent parseAssistantCompleted(Map<String, Object?> payload) {
    final id = _contentId(payload, 'assistant.completed');
    return ParsedAssistantEvent(
      assistantStepId: _optionalString(payload['assistantStepId']) ?? '',
      answerId: id,
      isCompleted: true,
    );
  }

  // ---- Reasoning ----

  ParsedReasoningEvent parseReasoningStarted(Map<String, Object?> payload) =>
      ParsedReasoningEvent(
        reasoningId: _contentId(payload, 'reasoning.started'),
        assistantStepId: _optionalString(payload['assistantStepId']) ?? '',
        phase: ReasoningPhase.active,
      );

  ParsedReasoningEvent parseReasoningDelta(Map<String, Object?> payload) =>
      ParsedReasoningEvent(
        reasoningId: _contentId(payload, 'reasoning.delta'),
        assistantStepId: _optionalString(payload['assistantStepId']) ?? '',
        phase: ReasoningPhase.active,
        delta: _optionalString(payload['text'] ?? payload['delta']),
      );

  ParsedReasoningEvent parseReasoningCompleted(Map<String, Object?> payload) {
    final stepsRaw = payload['steps'];
    return ParsedReasoningEvent(
      reasoningId: _contentId(payload, 'reasoning.completed'),
      assistantStepId: _optionalString(payload['assistantStepId']) ?? '',
      phase: ReasoningPhase.completed,
      summary: _optionalString(payload['summary']),
      steps: List<String>.unmodifiable(
        stepsRaw is List ? stepsRaw.whereType<String>() : const <String>[],
      ),
    );
  }

  // ---- Tools ----

  ParsedToolEvent parseToolStarted(Map<String, Object?> payload) {
    final callId = payload['toolCallId'];
    if (callId is! String || callId.isEmpty) {
      throw const FormatException('tool.started requires non-empty toolCallId');
    }
    final step = _optionalString(payload['assistantStepId']) ?? '';
    final name = payload['toolName'];
    if (name is! String || name.isEmpty) {
      throw const FormatException('tool.started requires non-empty toolName');
    }
    final argsRaw = payload['arguments'];
    final args = <String, Object?>{};
    if (argsRaw is Map) {
      args.addAll(Map<String, Object?>.from(argsRaw));
    }
    final startedAt = payload['startedAt'];
    return ParsedToolEvent(
      toolCallId: callId,
      assistantStepId: step,
      toolName: name,
      status: TranscriptToolStatus.running,
      arguments: Map<String, Object?>.unmodifiable(args),
      startedAt: startedAt is String ? DateTime.tryParse(startedAt) : null,
    );
  }

  ParsedToolEvent parseToolOutput(Map<String, Object?> payload) {
    final callId = payload['toolCallId'];
    if (callId is! String || callId.isEmpty) {
      throw const FormatException('tool.output requires non-empty toolCallId');
    }
    final step = _optionalString(payload['assistantStepId']) ?? '';
    final snapshot = payload['output'];
    final delta = payload['delta'];
    final resultRaw = payload['result'];
    final result = <String, Object?>{};
    if (resultRaw is Map) {
      result.addAll(Map<String, Object?>.from(resultRaw));
    }
    return ParsedToolEvent(
      toolCallId: callId,
      assistantStepId: step,
      toolName: payload['toolName'] is String
          ? payload['toolName'] as String
          : '',
      status: TranscriptToolStatus.running,
      outputSnapshot: snapshot is String ? snapshot : null,
      outputDelta: delta is String ? delta : null,
      result: result.isEmpty ? null : Map<String, Object?>.unmodifiable(result),
      truncation: _truncation(payload),
    );
  }

  ParsedToolEvent parseToolCompleted(Map<String, Object?> payload) {
    final callId = payload['toolCallId'];
    if (callId is! String || callId.isEmpty) {
      throw const FormatException(
        'tool.completed requires non-empty toolCallId',
      );
    }
    final step = _optionalString(payload['assistantStepId']) ?? '';
    final resultRaw = payload['result'];
    final result = <String, Object?>{};
    if (resultRaw is Map) {
      result.addAll(Map<String, Object?>.from(resultRaw));
    }
    if (resultRaw is String) result['output'] = resultRaw;
    final finishedAtRaw = payload['finishedAt'];
    return ParsedToolEvent(
      toolCallId: callId,
      assistantStepId: step,
      toolName: payload['toolName'] is String
          ? payload['toolName'] as String
          : '',
      status: TranscriptToolStatus.completed,
      result: result.isEmpty ? null : Map<String, Object?>.unmodifiable(result),
      truncation: _truncation(payload),
      finishedAt: finishedAtRaw is String
          ? DateTime.tryParse(finishedAtRaw)
          : null,
    );
  }

  ParsedToolEvent parseToolFailed(Map<String, Object?> payload) {
    final callId = payload['toolCallId'];
    if (callId is! String || callId.isEmpty) {
      throw const FormatException('tool.failed requires non-empty toolCallId');
    }
    final step = _optionalString(payload['assistantStepId']) ?? '';
    final errorRaw = payload['error'];
    final errorCode = errorRaw is Map ? errorRaw['code'] : null;
    final errorMessage = errorRaw is Map ? errorRaw['message'] : null;
    final message = payload['errorMessage'];
    final finishedAtRaw = payload['finishedAt'];
    return ParsedToolEvent(
      toolCallId: callId,
      assistantStepId: step,
      toolName: payload['toolName'] is String
          ? payload['toolName'] as String
          : '',
      status: TranscriptToolStatus.error,
      result: _result(payload['result']),
      errorMessage: errorMessage is String
          ? errorMessage
          : (message is String
                ? message
                : (errorCode is String ? errorCode : 'Tool failed')),
      truncation: _truncation(payload),
      finishedAt: finishedAtRaw is String
          ? DateTime.tryParse(finishedAtRaw)
          : null,
    );
  }

  ParsedToolEvent parseToolCancelled(Map<String, Object?> payload) {
    final callId = payload['toolCallId'];
    if (callId is! String || callId.isEmpty) {
      throw const FormatException(
        'tool.cancelled requires non-empty toolCallId',
      );
    }
    final step = _optionalString(payload['assistantStepId']) ?? '';
    final finishedAtRaw = payload['finishedAt'];
    return ParsedToolEvent(
      toolCallId: callId,
      assistantStepId: step,
      toolName: payload['toolName'] is String
          ? payload['toolName'] as String
          : '',
      status: TranscriptToolStatus.cancelled,
      finishedAt: finishedAtRaw is String
          ? DateTime.tryParse(finishedAtRaw)
          : null,
    );
  }

  static String _turnId(Map<String, Object?> payload) {
    final explicit = _optionalString(payload['turnId']);
    if (explicit != null) return explicit;
    final index = payload['turnIndex'];
    return index is int || index is String ? 'turn-$index' : 'turn-current';
  }

  static String _contentId(Map<String, Object?> payload, String type) {
    final value =
        payload['contentBlockId'] ??
        payload['answerId'] ??
        payload['reasoningId'];
    if (value is! String || value.isEmpty) {
      throw FormatException('$type requires non-empty contentBlockId');
    }
    return value;
  }

  static String? _optionalString(Object? value) =>
      value is String && value.isNotEmpty ? value : null;

  static Map<String, Object?>? _result(Object? value) {
    if (value is Map) return Map<String, Object?>.from(value);
    if (value is String) return <String, Object?>{'output': value};
    return null;
  }

  static TranscriptTruncation? _truncation(Map<String, Object?> payload) {
    final nested = payload['truncation'];
    if (nested is Map) {
      return TranscriptTruncation.fromMap(Map<String, Object?>.from(nested));
    }
    final retained = payload['retainedBytes'];
    final total = payload['totalBytes'];
    final truncated = payload['isTruncated'];
    if (retained is int &&
        total is int &&
        truncated is bool &&
        (truncated || total > retained)) {
      return TranscriptTruncation(
        retainedBytes: retained,
        totalBytes: total,
        digest: payload['digest'] is String
            ? payload['digest'] as String
            : null,
      );
    }
    return null;
  }
}
