/// Pure reducer that turns the durable transcript journal into an
/// [AgentSupervisionState] projection.
///
/// The reducer only consumes events whose `type` matches the
/// supervision vocabulary (`tool.started`, `tool.output`,
/// `tool.completed`, `tool.failed`, `tool.cancelled`, and
/// `turn.started`). Anything else is a no-op, so the reducer stays
/// safe to feed a full live stream.
///
/// The reducer is replay-friendly: feeding the same events twice
/// produces the same projection. That property is what lets the
/// mobile shell rebuild the projection on reconnect without
/// depending on retained in-memory state.
library;

import 'dart:collection';

import '../../domain/mobile_state.dart';
import 'agent_supervision.dart';

/// Maximum bytes of accumulated latest-output kept per run. Beyond
/// this the reducer stops growing the buffer and keeps the head of
/// the streamed output only.
const int _kLatestOutputByteCap = 8 * 1024; // 8 KiB

/// Maximum characters of task text kept per run.
const int _kTaskCharCap = 1024;

/// Maximum characters of steer direction kept per run.
const int _kSteerCharCap = 1024;

/// Tool-result keys the reducer inspects when lowering a terminal
/// tool event. These match the public Agent extension contract; the
/// reducer ignores unknown keys but does not error on them.
const String _kResultAgentId = 'agent_id';
const String _kResultAgentStatus = 'agent_status';
const String _kResultOutput = 'output';
const String _kResultContent = 'content';
const String _kResultText = 'text';
const String _kResultError = 'error';
const String _kResultMessage = 'message';
const String _kResultBlocked = 'blocked';

/// Possible status strings the Agent extension may report inside the
/// terminal tool result. Anything not in this set is treated as
/// opaque and surfaced verbatim only when the run is still running.
const Set<String> _kTerminalResultStatuses = <String>{
  'completed',
  'complete',
  'done',
  'success',
  'succeeded',
  'ok',
};

/// Pure reducer. See file-level docs for the projection contract.
class AgentSupervisionReducer {
  const AgentSupervisionReducer();

  /// Applies one event to [state] and returns the new state. Empty
  /// events and events whose streamId mismatches are passed through
  /// unchanged so callers do not have to guard each call site.
  AgentSupervisionState apply({
    required AgentSupervisionState state,
    required StreamEventState event,
  }) {
    final payload = event.payload;
    switch (event.type) {
      case 'turn.started':
        return _handleTurnStarted(state, event, payload);
      case 'tool.started':
        return _handleToolStarted(state, event, payload);
      case 'tool.output':
        return _handleToolOutput(state, event, payload);
      case 'tool.completed':
        return _handleToolCompleted(state, event, payload);
      case 'tool.failed':
        return _handleToolFailed(state, event, payload);
      case 'tool.cancelled':
        return _handleToolCancelled(state, event, payload);
      default:
        return state;
    }
  }

  // ----- Event handlers -----

  AgentSupervisionState _handleTurnStarted(
    AgentSupervisionState state,
    StreamEventState event,
    Map<String, Object?> payload,
  ) {
    final chatId = event.streamId.startsWith('session:')
        ? event.streamId.substring('session:'.length)
        : null;
    final turnId = _turnIdFromPayload(payload);
    // The current turn is tracked as state so the next Agent tool
    // event can attach the right origin. Existing runs whose origin
    // turn is still null are also backfilled here so a late-arriving
    // turn.started event still attaches to runs that preceded it.
    final next = LinkedHashMap<String, AgentRun>.from(state.runsByToolCallId);
    for (final entry in state.runs) {
      AgentRun run = entry;
      if (run.originChatId == null && chatId != null) {
        run = run.copyWith(originChatId: chatId);
      }
      if (run.originTurnId == null && turnId != null) {
        run = run.copyWith(originTurnId: turnId);
      }
      next[run.toolCallId] = run;
    }
    return state.copyWith(
      runsByToolCallId: next,
      runsByAgentId: _reindexAgentIds(next.values),
      currentTurnId: turnId ?? state.currentTurnId,
      currentChatId: chatId ?? state.currentChatId,
    );
  }

  AgentSupervisionState _handleToolStarted(
    AgentSupervisionState state,
    StreamEventState event,
    Map<String, Object?> payload,
  ) {
    final toolName = _stringField(payload, 'toolName');
    if (toolName == SupervisionToolNames.agent) {
      return _handleAgentStarted(state, event, payload);
    }
    if (toolName == SupervisionToolNames.getSubagentResult ||
        toolName == SupervisionToolNames.steerSubagent) {
      return _handleAgentQueryStarted(state, event, payload);
    }
    return state;
  }

  AgentSupervisionState _handleAgentStarted(
    AgentSupervisionState state,
    StreamEventState event,
    Map<String, Object?> payload,
  ) {
    final toolCallId = _stringField(payload, 'toolCallId');
    if (toolCallId == null) return state;
    final existing = state.runByToolCallId(toolCallId);
    if (existing != null && existing.startedAt.isBefore(event.occurredAt)) {
      // A second `tool.started` for the same id after the first one
      // was observed is treated as a duplicate (the reducer is
      // replay-safe). We still patch the assistantStepId in case the
      // upstream event carried one we did not see before.
      final patched = existing.copyWith(
        assistantStepId:
            _stringField(payload, 'assistantStepId') ??
            existing.assistantStepId,
      );
      return _replaceRun(state, patched);
    }
    final arguments = _argumentsMap(payload);
    final task = _capString(
      _stringField(arguments, 'description') ??
          _stringField(arguments, 'task') ??
          '',
      _kTaskCharCap,
    );
    final run = AgentRun(
      toolCallId: toolCallId,
      task: task,
      subagentType: _stringField(arguments, 'subagent_type'),
      model: _stringField(arguments, 'model'),
      thinkingLevel: _stringField(arguments, 'thinking'),
      backgroundRequested: _boolField(arguments, 'run_in_background') ?? false,
      status: AgentRunStatus.running,
      startedAt: _startTimeFromPayload(payload) ?? event.occurredAt,
      assistantStepId: _stringField(payload, 'assistantStepId'),
      originChatId:
          _originChatFromStreamId(event.streamId) ?? state.currentChatId,
      originTurnId: state.currentTurnId,
    );
    final next = LinkedHashMap<String, AgentRun>.from(state.runsByToolCallId)
      ..[run.toolCallId] = run;
    return state.copyWith(
      runsByToolCallId: next,
      runsByAgentId: _reindexAgentIds(next.values),
    );
  }

  AgentSupervisionState _handleAgentQueryStarted(
    AgentSupervisionState state,
    StreamEventState event,
    Map<String, Object?> payload,
  ) {
    final toolCallId = _stringField(payload, 'toolCallId');
    if (toolCallId == null) return state;
    final arguments = _argumentsMap(payload);
    final agentId = _stringField(arguments, 'agent_id');
    final run =
        state.runByAgentId(agentId ?? '') ??
        state.runByToolCallId(agentId ?? '');
    if (run == null) {
      // The query is dangling (no matching Agent run). The reducer
      // records this as a blocker so the UI can tell the user the
      // parent prompt is referencing a subagent that never started.
      final blockers = <AgentSupervisionBlocker>[
        ...state.blockers,
        AgentSupervisionBlocker(
          toolCallId: agentId ?? toolCallId,
          kind: 'orphan_query',
          detail:
              'No matching Agent run for $agentId; the get_subagent_result / steer_subagent tool is referencing an unknown id.',
        ),
      ];
      return state.copyWith(blockers: blockers);
    }
    if (_stringField(payload, 'toolName') ==
        SupervisionToolNames.steerSubagent) {
      final direction = _capString(
        _stringField(arguments, 'message') ??
            _stringField(arguments, 'direction') ??
            '',
        _kSteerCharCap,
      );
      final patched = run.copyWith(
        lastSteerDirection: direction.isEmpty ? null : direction,
        lastSteerAt: event.occurredAt,
      );
      return _replaceRun(state, patched);
    }
    return state;
  }

  AgentSupervisionState _handleToolOutput(
    AgentSupervisionState state,
    StreamEventState event,
    Map<String, Object?> payload,
  ) {
    final toolCallId = _stringField(payload, 'toolCallId');
    if (toolCallId == null) return state;
    final run = state.runByToolCallId(toolCallId);
    if (run == null) return state;
    final outputDelta =
        _stringField(payload, 'output') ?? _stringField(payload, 'delta');
    if (outputDelta == null || outputDelta.isEmpty) return state;
    final combined = (run.latestOutput ?? '') + outputDelta;
    final capped = _capString(combined, _kLatestOutputByteCap);
    final patched = run.copyWith(
      latestOutput: capped,
      latestOutputCapturedAt: event.occurredAt,
    );
    return _replaceRun(state, patched);
  }

  AgentSupervisionState _handleToolCompleted(
    AgentSupervisionState state,
    StreamEventState event,
    Map<String, Object?> payload,
  ) {
    final toolCallId = _stringField(payload, 'toolCallId');
    if (toolCallId == null) return state;
    final toolName = _stringField(payload, 'toolName');
    if (toolName != null &&
        toolName != SupervisionToolNames.agent &&
        toolName != SupervisionToolNames.getSubagentResult &&
        toolName != SupervisionToolNames.steerSubagent) {
      return state;
    }
    final run = state.runByToolCallId(toolCallId);
    final finishedAt = _finishedTimeFromPayload(payload) ?? event.occurredAt;
    final result = _resultMap(payload);
    final output = _extractResultOutput(result);
    final agentId = _stringField(result, _kResultAgentId);
    final extensionStatus = _stringField(result, _kResultAgentStatus);
    final blocked = _stringField(result, _kResultBlocked);
    final errorMessage =
        _stringField(result, _kResultError) ??
        _stringField(result, _kResultMessage);
    final isBlocked =
        blocked != null ||
        extensionStatus == 'blocked' ||
        extensionStatus == 'rejected';
    final status = _resolveTerminalStatus(
      toolName: toolName,
      extensionStatus: extensionStatus,
      isError: false,
      isCancelled: false,
    );
    if (run == null) {
      // The Agent run may have started before this view of the
      // journal was hydrated. We do not synthesise a run from a
      // terminal event alone because task / model metadata would be
      // missing; instead we record a blocker so the UI can show the
      // gap.
      if (toolName == SupervisionToolNames.agent) {
        final blockers = <AgentSupervisionBlocker>[
          ...state.blockers,
          AgentSupervisionBlocker(
            toolCallId: toolCallId,
            kind: 'orphan_completion',
            detail:
                'Agent tool completion arrived before its tool.started; the run is unrecoverable.',
          ),
        ];
        return state.copyWith(blockers: blockers);
      }
      return state;
    }
    final patched = run.copyWith(
      status: isBlocked ? AgentRunStatus.error : status,
      endedAt: finishedAt,
      errorMessage: isBlocked
          ? (blocked ?? 'Blocked by extension')
          : (status == AgentRunStatus.error ? errorMessage : null),
      blockedReason: isBlocked
          ? (blocked ?? 'Extension reported blocked status')
          : null,
      agentId: agentId ?? run.agentId,
      latestOutput: output ?? run.latestOutput,
      latestOutputCapturedAt: output == null
          ? run.latestOutputCapturedAt
          : event.occurredAt,
    );
    return _replaceRun(state, patched);
  }

  AgentSupervisionState _handleToolFailed(
    AgentSupervisionState state,
    StreamEventState event,
    Map<String, Object?> payload,
  ) {
    final toolCallId = _stringField(payload, 'toolCallId');
    if (toolCallId == null) return state;
    final toolName = _stringField(payload, 'toolName');
    if (toolName != null &&
        toolName != SupervisionToolNames.agent &&
        toolName != SupervisionToolNames.getSubagentResult &&
        toolName != SupervisionToolNames.steerSubagent) {
      return state;
    }
    final run = state.runByToolCallId(toolCallId);
    if (run == null) {
      if (toolName == SupervisionToolNames.agent) {
        final blockers = <AgentSupervisionBlocker>[
          ...state.blockers,
          AgentSupervisionBlocker(
            toolCallId: toolCallId,
            kind: 'orphan_completion',
            detail:
                'Agent tool failure arrived before its tool.started; the run is unrecoverable.',
          ),
        ];
        return state.copyWith(blockers: blockers);
      }
      return state;
    }
    final result = _resultMap(payload);
    final errorMessage =
        _stringField(payload, 'errorMessage') ??
        _stringField(result, _kResultError) ??
        _stringField(result, _kResultMessage);
    final patched = run.copyWith(
      status: AgentRunStatus.error,
      endedAt: _finishedTimeFromPayload(payload) ?? event.occurredAt,
      errorMessage: errorMessage ?? 'Tool failed',
    );
    return _replaceRun(state, patched);
  }

  AgentSupervisionState _handleToolCancelled(
    AgentSupervisionState state,
    StreamEventState event,
    Map<String, Object?> payload,
  ) {
    final toolCallId = _stringField(payload, 'toolCallId');
    if (toolCallId == null) return state;
    final run = state.runByToolCallId(toolCallId);
    if (run == null) return state;
    final patched = run.copyWith(
      status: AgentRunStatus.cancelled,
      endedAt: _finishedTimeFromPayload(payload) ?? event.occurredAt,
    );
    return _replaceRun(state, patched);
  }

  // ----- Helpers -----

  AgentSupervisionState _replaceRun(AgentSupervisionState state, AgentRun run) {
    final next = LinkedHashMap<String, AgentRun>.from(state.runsByToolCallId)
      ..[run.toolCallId] = run;
    return state.copyWith(
      runsByToolCallId: next,
      runsByAgentId: _reindexAgentIds(next.values),
    );
  }

  AgentRunStatus _resolveTerminalStatus({
    required String? toolName,
    required String? extensionStatus,
    required bool isError,
    required bool isCancelled,
  }) {
    if (isCancelled) return AgentRunStatus.cancelled;
    if (isError) return AgentRunStatus.error;
    if (extensionStatus != null &&
        _kTerminalResultStatuses.contains(extensionStatus)) {
      return AgentRunStatus.completed;
    }
    if (extensionStatus != null && extensionStatus.isNotEmpty) {
      // Opaque status reported by an extension that does not match
      // our terminal vocabulary. Treat as completed only if the
      // event is `tool.completed` (success). Tool failure events
      // are routed via `_handleToolFailed` instead.
      return AgentRunStatus.completed;
    }
    // Default for `tool.completed` without a status hint is
    // success — the bridge only emits `tool.completed` when the
    // underlying tool returned a structured success envelope.
    return AgentRunStatus.completed;
  }

  String? _stringField(Map<String, Object?> map, String key) {
    final value = map[key];
    if (value is String && value.isNotEmpty) return value;
    return null;
  }

  bool? _boolField(Map<String, Object?> map, String key) {
    final value = map[key];
    if (value is bool) return value;
    return null;
  }

  Map<String, Object?> _argumentsMap(Map<String, Object?> payload) {
    final raw = payload['arguments'];
    if (raw is Map) {
      return Map<String, Object?>.from(raw);
    }
    return const <String, Object?>{};
  }

  Map<String, Object?> _resultMap(Map<String, Object?> payload) {
    final raw = payload['result'];
    if (raw is Map) return Map<String, Object?>.from(raw);
    return const <String, Object?>{};
  }

  String? _extractResultOutput(Map<String, Object?> result) {
    final candidates = <Object?>[
      result[_kResultOutput],
      result[_kResultContent],
      result[_kResultText],
    ];
    for (final candidate in candidates) {
      if (candidate is String && candidate.isNotEmpty) {
        return _capString(candidate, _kLatestOutputByteCap);
      }
    }
    return null;
  }

  String? _turnIdFromPayload(Map<String, Object?> payload) {
    final value = payload['turnId'];
    if (value is String && value.isNotEmpty) return value;
    final index = payload['turnIndex'];
    if (index is int) return 'turn-$index';
    if (index is String && index.isNotEmpty) return 'turn-$index';
    return null;
  }

  DateTime? _startTimeFromPayload(Map<String, Object?> payload) {
    final raw = payload['startedAt'];
    if (raw is String) return DateTime.tryParse(raw);
    return null;
  }

  DateTime? _finishedTimeFromPayload(Map<String, Object?> payload) {
    final raw = payload['finishedAt'];
    if (raw is String) return DateTime.tryParse(raw);
    return null;
  }

  String? _originChatFromStreamId(String streamId) {
    if (!streamId.startsWith('session:')) return null;
    final remainder = streamId.substring('session:'.length);
    return remainder.isEmpty ? null : remainder;
  }

  Map<String, AgentRun> _reindexAgentIds(Iterable<AgentRun> runs) {
    final index = <String, AgentRun>{};
    for (final run in runs) {
      final id = run.agentId;
      if (id != null && id.isNotEmpty) index[id] = run;
    }
    return index;
  }
}

String _capString(String value, int cap) {
  if (value.length <= cap) return value;
  return value.substring(0, cap);
}
