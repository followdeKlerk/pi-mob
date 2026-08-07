/// Canonical transcript document adapter.
///
/// The released chat surface renders [CanonicalTranscriptState]
/// produced by the bridge's `session_events.v2` log. The existing
/// [TranscriptView] widget consumes the legacy [TranscriptDocument]
/// produced by [TranscriptReducer] over [StreamEventState] rows.
///
/// This adapter projects [CanonicalTranscriptState] into the
/// existing [TranscriptDocument] shape so the production
/// `TranscriptView` can render canonical state through one reducer
/// path. `TranscriptPanel` uses this adapter for the released canonical
/// transcript view. Legacy caches remain only for migration compatibility.
///
/// The adapter is pure. It does not perform I/O and never inspects
/// wall-clock time, satisfying the plan's reducer discipline (§10.4).
library;

import '../transcript/domain/transcript_diagnostics.dart';
import '../transcript/domain/transcript_document.dart';
import '../transcript/domain/transcript_items.dart';
import '../transcript/domain/transcript_turn.dart';
import '../transcript/widgets/view_data/final_answer_view_data.dart';
import '../transcript/widgets/view_data/tool_call_view_data.dart';
import '../transcript/widgets/transcript_status.dart';
import 'transcript_reducer.dart';

/// Maximum diagnostics retained in the canonical projection before
/// eviction. Mirrors the legacy `TranscriptDocument` cap
/// (`kTranscriptDiagnosticCountCap`).
const int _kCanonicalDiagnosticCountCap = 64;

/// Projects a canonical state into the legacy [TranscriptDocument]
/// shape consumed by `TranscriptView`.
///
/// The projection is deterministic: identical inputs produce identical
/// output. The function never touches the wall clock, the network,
/// or any session-local cache.
TranscriptDocument projectCanonicalToDocument(CanonicalTranscriptState state) {
  final streamId = 'session:${state.sessionId}';
  if (state.userMessages.isEmpty &&
      state.assistantMessages.isEmpty &&
      state.toolCalls.isEmpty) {
    return TranscriptDocument(
      streamId: streamId,
      turns: List<Turn>.unmodifiable(const <Turn>[]),
      diagnostics: _cappedDiagnostics(state.diagnostics),
      lastSettledTurnId: null,
    );
  }
  final turns = <Turn>[];
  final orderedKeys = _orderedEntityKeys(state);
  String? lastSettledTurnId;
  for (final key in orderedKeys) {
    final turn = _buildTurnForKey(state, key);
    if (turn == null) continue;
    turns.add(turn);
    if (turn is AssistantTurn && turn.isTerminal) {
      lastSettledTurnId = turn.widgetKey;
    }
  }
  return TranscriptDocument(
    streamId: streamId,
    turns: List<Turn>.unmodifiable(turns),
    diagnostics: _cappedDiagnostics(state.diagnostics),
    lastSettledTurnId: lastSettledTurnId,
  );
}

List<String> _orderedEntityKeys(CanonicalTranscriptState state) {
  // The reducer records the first canonical sequence for each entity. Sort
  // one combined list so interleaved user and assistant messages stay
  // interleaved after the category maps are projected.
  final keys = <String>[
    ...state.userMessages.keys.map((id) => 'user:$id'),
    ...state.assistantMessages.keys.map((id) => 'assistant:$id'),
    ...state.toolCalls.keys.map((id) => 'tool:$id'),
  ];
  int orderFor(String key) {
    final recorded = state.entityOrder[key];
    if (recorded != null) return recorded;
    // Backward-compatible fallback for state created before entityOrder.
    if (key.startsWith('user:')) return 0;
    if (key.startsWith('assistant:')) return 1;
    return 2;
  }

  keys.sort((a, b) {
    final bySequence = orderFor(a).compareTo(orderFor(b));
    return bySequence != 0 ? bySequence : a.compareTo(b);
  });
  return keys;
}

Turn? _buildTurnForKey(CanonicalTranscriptState state, String key) {
  final separator = key.indexOf(':');
  if (separator < 0) return null;
  final kind = key.substring(0, separator);
  final id = key.substring(separator + 1);
  if (kind == 'user' && state.userMessages.containsKey(id)) {
    return _buildUserTurn(state, state.userMessages[id]!);
  }
  if (kind == 'assistant' && state.assistantMessages.containsKey(id)) {
    return _buildAssistantTurn(state, state.assistantMessages[id]!);
  }
  if (kind == 'tool' && state.toolCalls.containsKey(id)) {
    return _buildToolOnlyTurn(state, state.toolCalls[id]!);
  }
  return null;
}

Turn _buildUserTurn(
  CanonicalTranscriptState state,
  CanonicalUserMessage message,
) {
  final status = _userStatusFor(
    state.turnStatuses[message.turnId] ?? TurnStatus.completed,
  );
  return UserTurn(
    turnId: message.turnId,
    commandId: message.messageId,
    deliveryMode: 'immediate',
    status: status,
    startedAt: message.occurredAt,
    endedAt:
        status == UserTurnStatus.settled ||
            status == UserTurnStatus.failed ||
            status == UserTurnStatus.aborted
        ? message.occurredAt
        : null,
    message: message.text,
    respondingToTurnId: null,
  );
}

Turn _buildAssistantTurn(
  CanonicalTranscriptState state,
  CanonicalAssistantMessage message,
) {
  final turnStatus = state.turnStatuses[message.turnId] ?? TurnStatus.completed;
  final assistantStatus = _assistantStatusFor(turnStatus);
  final items = <TurnItem>[];
  final text = _flattenContent(message.content);
  items.add(
    FinalAnswerItem(
      itemId: message.messageId,
      assistantStepId: message.messageId,
      viewData: FinalAnswerViewData(
        answerId: message.messageId,
        markdown: text,
      ),
      completedAt: message.completedAt,
    ),
  );
  final errorInfo = _assistantError(turnStatus);
  return AssistantTurn(
    turnId: message.turnId,
    assistantStepId: message.messageId,
    status: assistantStatus,
    items: List<TurnItem>.unmodifiable(items),
    startedAt: message.startedAt,
    endedAt: message.completedAt,
    errorCode: errorInfo?.$1,
    errorMessage: errorInfo?.$2,
  );
}

Turn _buildToolOnlyTurn(
  CanonicalTranscriptState state,
  CanonicalToolCall tool,
) {
  final assistantMessageId = state.turnToMessage[tool.turnId];
  final status = _toolStatusFor(tool);
  final viewData = ToolCallViewData(
    toolCallId: tool.toolCallId,
    toolName: tool.toolName,
    arguments: _immutableMap(tool.arguments),
    status: status,
    result: _resultMap(tool),
    errorMessage: tool.errorMessage,
    truncation: _truncationFor(tool),
    startedAt: tool.startedAt,
    finishedAt: tool.completedAt,
  );
  final item = ToolItem(
    itemId: tool.toolCallId,
    assistantStepId: assistantMessageId ?? tool.toolCallId,
    viewData: viewData,
  );
  final assistantStatus = _assistantStatusFor(
    state.turnStatuses[tool.turnId] ?? TurnStatus.completed,
  );
  return AssistantTurn(
    turnId: tool.turnId,
    assistantStepId: assistantMessageId ?? tool.toolCallId,
    status: assistantStatus,
    items: List<TurnItem>.unmodifiable(<TurnItem>[item]),
    startedAt: tool.startedAt,
    endedAt: tool.completedAt,
    respondingToUserTurnId: null,
    errorCode: null,
    errorMessage: null,
  );
}

Map<String, Object?>? _resultMap(CanonicalToolCall tool) {
  if (tool.result is Map<String, Object?>) {
    return _immutableMap(tool.result as Map<String, Object?>);
  }
  if (tool.result == null) return null;
  return <String, Object?>{'value': tool.result};
}

Map<String, Object?> _immutableMap(Map<String, Object?> source) {
  return Map<String, Object?>.unmodifiable(Map<String, Object?>.from(source));
}

ToolOutputTruncation? _truncationFor(CanonicalToolCall tool) {
  if (tool.progress is Map<String, Object?>) {
    final progress = Map<String, Object?>.from(
      tool.progress as Map<String, Object?>,
    );
    final retained = _asInt(progress['retainedBytes']);
    final total = _asInt(progress['totalBytes']);
    if (retained != null && total != null) {
      final digest = progress['digest'] is String
          ? progress['digest'] as String
          : null;
      try {
        return ToolOutputTruncation(
          retainedBytes: retained,
          totalBytes: total,
          digest: digest,
        );
      } on FormatException {
        return null;
      }
    }
  }
  return null;
}

int? _asInt(Object? value) {
  if (value is int) return value;
  if (value is double && value.isFinite) return value.toInt();
  if (value is String) return int.tryParse(value);
  return null;
}

TranscriptToolStatus _toolStatusFor(CanonicalToolCall tool) {
  if (tool.isTerminal && tool.isError) return TranscriptToolStatus.error;
  if (tool.isTerminal) return TranscriptToolStatus.completed;
  return TranscriptToolStatus.running;
}

UserTurnStatus _userStatusFor(TurnStatus status) {
  switch (status) {
    case TurnStatus.pending:
      return UserTurnStatus.queued;
    case TurnStatus.running:
      return UserTurnStatus.dispatched;
    case TurnStatus.waitingForInput:
      return UserTurnStatus.dispatching;
    case TurnStatus.completed:
      return UserTurnStatus.settled;
    case TurnStatus.failed:
      return UserTurnStatus.failed;
    case TurnStatus.cancelled:
      return UserTurnStatus.aborted;
  }
}

AssistantTurnStatus _assistantStatusFor(TurnStatus status) {
  switch (status) {
    case TurnStatus.pending:
    case TurnStatus.running:
    case TurnStatus.waitingForInput:
      return AssistantTurnStatus.active;
    case TurnStatus.completed:
      return AssistantTurnStatus.completed;
    case TurnStatus.failed:
      return AssistantTurnStatus.failed;
    case TurnStatus.cancelled:
      return AssistantTurnStatus.aborted;
  }
}

(String?, String?)? _assistantError(TurnStatus status) {
  if (status == TurnStatus.failed) {
    return ('turn_failed', 'Turn failed');
  }
  if (status == TurnStatus.cancelled) {
    return ('turn_cancelled', 'Turn cancelled');
  }
  return null;
}

String _flattenContent(List<CanonicalContentBlock> content) {
  final buffer = StringBuffer();
  for (final block in content) {
    if (block.kind == 'text') {
      buffer.write(block.text);
    } else {
      buffer.write(block.text);
    }
  }
  return buffer.toString();
}

List<TranscriptDiagnostic> _cappedDiagnostics(
  List<TranscriptDiagnostic> input,
) {
  if (input.length <= _kCanonicalDiagnosticCountCap) {
    return List<TranscriptDiagnostic>.unmodifiable(input);
  }
  return List<TranscriptDiagnostic>.unmodifiable(
    input.sublist(input.length - _kCanonicalDiagnosticCountCap),
  );
}
