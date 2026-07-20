// ignore_for_file: library_private_types_in_public_api

import '../../domain/mobile_state.dart';
import '../widgets/view_data/final_answer_view_data.dart';
import '../widgets/view_data/reasoning_view_data.dart';
import '../widgets/view_data/tool_call_view_data.dart';
import '../widgets/transcript_status.dart';
import 'transcript_diagnostics.dart';
import 'transcript_document.dart';
import 'transcript_event_parser.dart';
import 'transcript_items.dart';
import 'transcript_keys.dart';
import 'transcript_truncation.dart';
import 'transcript_turn.dart';

/// Maximum bytes of accumulated answer markdown kept in the private
/// delta buffer. Beyond this, the reducer stops growing the buffer and
/// records a [TranscriptDiagnostic]. The widget never sees unbounded
/// memory growth even if the bridge forgets to mark truncation.
const int _kAnswerDeltaByteCap = 262144; // 256 KiB

/// Maximum bytes of accumulated tool output kept in the private delta
/// buffer. Tools that exceed the cap still get a final
/// [TranscriptToolStatus.completed] item, but the rendered preview only
/// shows the head of the output.
const int _kToolOutputByteCap = 262144; // 256 KiB

/// Maximum characters retained in the visible reasoning summary.
const int _kReasoningSummaryCharCap = 4096;

/// Maximum number of step bullets retained per reasoning block.
const int _kReasoningStepCap = 64;

/// Stream of buffered state the reducer maintains between events. The
/// reducer is pure: every call to [TranscriptReducer.apply] returns a new
/// state, and the document carried inside [TranscriptReducerState] is
/// itself immutable.
///
/// The transient maps hold per-id state that has not yet been sealed
/// into a [TurnItem]:
///
/// * [answerBuilders] accumulates markdown between `assistant.started`
///   and `assistant.completed`.
/// * [toolBuilders] accumulates output between `tool.started` and the
///   terminal tool event.
/// * [reasoningBuilders] accumulates reasoning text between
///   `reasoning.started` and `reasoning.completed`.
class TranscriptReducerState {
  TranscriptReducerState({
    required this.document,
    Map<String, _AnswerBuilder>? answerBuilders,
    Map<String, _ToolBuilder>? toolBuilders,
    Map<String, _ReasoningBuilder>? reasoningBuilders,
  }) : answerBuilders = answerBuilders ?? <String, _AnswerBuilder>{},
       toolBuilders = toolBuilders ?? <String, _ToolBuilder>{},
       reasoningBuilders = reasoningBuilders ?? <String, _ReasoningBuilder>{};

  /// Convenience factory for a fresh stream.
  factory TranscriptReducerState.empty(String streamId) =>
      TranscriptReducerState(document: TranscriptDocument.empty(streamId));

  final TranscriptDocument document;
  final Map<String, _AnswerBuilder> answerBuilders;
  final Map<String, _ToolBuilder> toolBuilders;
  final Map<String, _ReasoningBuilder> reasoningBuilders;

  TranscriptReducerState copyWith({TranscriptDocument? document}) =>
      TranscriptReducerState(
        document: document ?? this.document,
        answerBuilders: answerBuilders,
        toolBuilders: toolBuilders,
        reasoningBuilders: reasoningBuilders,
      );
}

class _AnswerBuilder {
  _AnswerBuilder({
    required this.assistantStepId,
    required this.answerId,
    this.markdown = '',
    this.completed = false,
  });

  final String assistantStepId;
  final String answerId;
  String markdown;
  bool completed;
}

class _ToolBuilder {
  _ToolBuilder({
    required this.assistantStepId,
    required this.toolName,
    required this.status,
    Map<String, Object?>? arguments,
    this.outputBuffer = '',
    this.result,
    this.errorMessage,
    this.truncation,
    this.startedAt,
    this.finishedAt,
  }) : arguments = arguments ?? <String, Object?>{};

  final String assistantStepId;
  String toolName;
  TranscriptToolStatus status;
  Map<String, Object?> arguments;
  String outputBuffer;
  Map<String, Object?>? result;
  String? errorMessage;
  TranscriptTruncation? truncation;
  DateTime? startedAt;
  DateTime? finishedAt;

  ToolCallViewData toViewData() {
    return ToolCallViewData(
      toolCallId: '', // populated by the reducer
      toolName: toolName,
      arguments: Map<String, Object?>.unmodifiable(arguments),
      status: status,
      result: result == null
          ? null
          : Map<String, Object?>.unmodifiable(result!),
      errorMessage: errorMessage,
      truncation: truncation?.toViewData(),
      startedAt: startedAt,
      finishedAt: finishedAt,
    );
  }
}

class _ReasoningBuilder {
  _ReasoningBuilder({
    required this.reasoningId,
    required this.assistantStepId,
    this.summary = '',
    this.steps = const <String>[],
  });

  final String reasoningId;
  final String assistantStepId;
  String summary;
  List<String> steps;

  ReasoningViewData toViewData(ReasoningPhase phase) => ReasoningViewData(
    reasoningId: reasoningId,
    phase: phase,
    summary: summary,
    steps: List<String>.unmodifiable(steps),
  );
}

/// Reduces a stream of journal events into a [TranscriptDocument].
///
/// The reducer is intentionally a single class with no I/O. Callers feed
/// events in cursor order (the [OrderedEventReducer] in
/// `lib/src/sync/event_reducer.dart` already enforces that) and the
/// reducer returns a new state each time. The reducer never mutates its
/// inputs and never inspects the network or the host clock.
class TranscriptReducer {
  const TranscriptReducer({TranscriptEventParser? parser})
    : _parser = parser ?? const TranscriptEventParser();

  final TranscriptEventParser _parser;

  /// Applies [event] to [state]. Throws [ArgumentError] when [event]
  /// belongs to a different stream.
  TranscriptReducerState apply({
    required TranscriptReducerState state,
    required StreamEventState event,
  }) {
    if (event.streamId != state.document.streamId) {
      throw ArgumentError.value(
        event.streamId,
        'event.streamId',
        'wrong stream',
      );
    }
    final type = event.type;
    try {
      switch (type) {
        case 'turn.queued':
        case 'turn.accepted':
          return _handleTurnQueued(state, event);
        case 'turn.started':
          return _handleTurnStarted(state, event);
        case 'turn.waiting_for_input':
          return _handleTurnStatus(
            state,
            event,
            kind: SystemTurnKind.waitingForInput,
          );
        case 'turn.retrying':
          return _handleTurnStatus(state, event, kind: SystemTurnKind.retrying);
        case 'turn.compacting':
          return _handleTurnStatus(
            state,
            event,
            kind: SystemTurnKind.compacting,
          );
        case 'turn.settled':
          return _handleTurnSettled(state, event);
        case 'turn.aborted':
          return _handleTurnTerminal(
            state,
            event,
            status: AssistantTurnStatus.aborted,
            kind: SystemTurnKind.aborted,
          );
        case 'turn.failed':
          return _handleTurnTerminal(
            state,
            event,
            status: AssistantTurnStatus.failed,
            kind: SystemTurnKind.failed,
          );
        case 'turn.indeterminate':
          return _handleTurnTerminal(
            state,
            event,
            status: AssistantTurnStatus.indeterminate,
            kind: SystemTurnKind.indeterminate,
          );
        case 'turn.interrupted':
          return _handleTurnTerminal(
            state,
            event,
            status: AssistantTurnStatus.interrupted,
            kind: SystemTurnKind.interrupted,
          );
        case 'assistant.started':
          return _handleAssistantStarted(state, event);
        case 'assistant.delta':
          return _handleAssistantDelta(state, event);
        case 'assistant.completed':
          return _handleAssistantCompleted(state, event);
        case 'reasoning.started':
          return _handleReasoningStarted(state, event);
        case 'reasoning.delta':
          return _handleReasoningDelta(state, event);
        case 'reasoning.completed':
          return _handleReasoningCompleted(state, event);
        case 'tool.started':
          return _handleToolStarted(state, event);
        case 'tool.output':
          return _handleToolOutput(state, event);
        case 'tool.completed':
          return _handleToolCompleted(state, event);
        case 'tool.failed':
          return _handleToolFailed(state, event);
        case 'tool.cancelled':
          return _handleToolCancelled(state, event);
        default:
          return _handleUnknownEvent(state, event);
      }
    } on FormatException catch (e) {
      return _recordDiagnostic(
        state,
        event,
        label: 'event_parse_error',
        detail: e.message,
      );
    }
  }

  // ----- Turn lifecycle -----

  TranscriptReducerState _handleTurnQueued(
    TranscriptReducerState state,
    StreamEventState event,
  ) {
    final parsed = _parser.parseTurnQueued(event.payload);
    final existing = state.document.lastTurnWithKeyPrefix(
      TranscriptKeys.userTurnKey(parsed.turnId),
    );
    if (existing is UserTurn) {
      final updated = existing.copyWith(
        status: UserTurnStatus.queued,
        startedAt: event.occurredAt,
      );
      return state.copyWith(document: state.document.replaceTurn(updated));
    }
    final userTurn = UserTurn(
      turnId: parsed.turnId,
      commandId: parsed.commandId,
      deliveryMode: 'immediate',
      status: UserTurnStatus.queued,
      startedAt: event.occurredAt,
    );
    return state.copyWith(document: state.document.appendTurn(userTurn));
  }

  TranscriptReducerState _handleTurnStarted(
    TranscriptReducerState state,
    StreamEventState event,
  ) {
    final parsed = _parser.parseTurnStarted(event.payload);
    final userKey = TranscriptKeys.userTurnKey(parsed.turnId);
    final assistantKey = TranscriptKeys.assistantTurnKey(parsed.turnId);
    final nextDoc = _upsertTurn(
      state.document,
      UserTurn(
        turnId: parsed.turnId,
        commandId: parsed.commandId,
        deliveryMode: parsed.deliveryMode,
        status: UserTurnStatus.dispatched,
        startedAt: event.occurredAt,
        message: parsed.message,
        respondingToTurnId: parsed.respondingToTurnId,
      ),
      userKey,
    );
    final assistantTurn = AssistantTurn(
      turnId: parsed.turnId,
      assistantStepId: '',
      status: AssistantTurnStatus.active,
      items: const [],
      startedAt: event.occurredAt,
      respondingToUserTurnId: parsed.turnId,
    );
    final finalDoc = _upsertTurn(nextDoc, assistantTurn, assistantKey);
    // Pi content-block indexes commonly restart from zero for every prompt.
    // A turn boundary must therefore discard transient builders from the
    // preceding turn instead of allowing an identical block id to continue.
    return TranscriptReducerState(document: finalDoc);
  }

  TranscriptReducerState _handleTurnStatus(
    TranscriptReducerState state,
    StreamEventState event, {
    required SystemTurnKind kind,
  }) {
    final turnId = _parser.parseTurnStatusId(event.payload);
    final key = TranscriptKeys.systemTurnKey(turnId, kind.name);
    final existing = state.document.lastTurnWithKeyPrefix(key);
    final message = _messageForStatus(event, kind);
    final systemTurn = SystemTurn(
      turnId: turnId,
      kind: kind,
      message: message,
      startedAt: existing?.startedAt ?? event.occurredAt,
    );
    if (existing != null) {
      return state.copyWith(document: state.document.replaceTurn(systemTurn));
    }
    return state.copyWith(document: state.document.appendTurn(systemTurn));
  }

  TranscriptReducerState _handleTurnSettled(
    TranscriptReducerState state,
    StreamEventState event,
  ) {
    final turnId = _parser.parseTurnStatusId(event.payload);
    final assistantKey = TranscriptKeys.assistantTurnKey(turnId);
    final userKey = TranscriptKeys.userTurnKey(turnId);
    final doc = state.document;
    final assistant = doc.lastTurnWithKeyPrefix(assistantKey);
    final user = doc.lastTurnWithKeyPrefix(userKey);
    TranscriptDocument next = doc;
    if (assistant is AssistantTurn) {
      // Flush any pending answer builders that belong to this turn.
      next = _flushAnswerBuilders(state, next);
      next = next.replaceTurn(
        assistant.copyWith(
          status: AssistantTurnStatus.completed,
          endedAt: event.occurredAt,
        ),
      );
    }
    if (user is UserTurn) {
      next = next.replaceTurn(
        user.copyWith(
          status: UserTurnStatus.settled,
          endedAt: event.occurredAt,
        ),
      );
    }
    // Remove any active system turns for this turn id (waiting/retry/compact).
    next = _pruneSystemTurns(next, turnId, const {
      SystemTurnKind.waitingForInput,
      SystemTurnKind.retrying,
      SystemTurnKind.compacting,
    });
    final settledKey = assistantKey;
    return state.copyWith(
      document: next.withLastSettled(
        next.indexOfTurnByKey(settledKey) >= 0 ? settledKey : null,
      ),
    );
  }

  TranscriptReducerState _handleTurnTerminal(
    TranscriptReducerState state,
    StreamEventState event, {
    required AssistantTurnStatus status,
    required SystemTurnKind kind,
  }) {
    final parsed = _parser.parseTurnTerminal(event.payload);
    final turnId = parsed.turnId;
    final assistantKey = TranscriptKeys.assistantTurnKey(turnId);
    final userKey = TranscriptKeys.userTurnKey(turnId);
    final doc = state.document;
    var next = doc;
    final assistant = doc.lastTurnWithKeyPrefix(assistantKey);
    if (assistant is AssistantTurn) {
      next = _flushAnswerBuilders(state, next);
      next = next.replaceTurn(
        assistant.copyWith(
          status: status,
          endedAt: event.occurredAt,
          errorCode: parsed.errorCode,
          errorMessage: parsed.errorMessage,
        ),
      );
    }
    final user = doc.lastTurnWithKeyPrefix(userKey);
    if (user is UserTurn) {
      next = next.replaceTurn(
        user.copyWith(
          status: switch (status) {
            AssistantTurnStatus.aborted => UserTurnStatus.aborted,
            AssistantTurnStatus.failed => UserTurnStatus.failed,
            AssistantTurnStatus.indeterminate => UserTurnStatus.indeterminate,
            AssistantTurnStatus.interrupted => UserTurnStatus.aborted,
            _ => UserTurnStatus.failed,
          },
          endedAt: event.occurredAt,
        ),
      );
    }
    final message = parsed.errorMessage ?? _messageForTerminal(status);
    final systemKey = TranscriptKeys.systemTurnKey(turnId, kind.name);
    final existing = next.lastTurnWithKeyPrefix(systemKey);
    final systemTurn = SystemTurn(
      turnId: turnId,
      kind: kind,
      message: message,
      startedAt: existing?.startedAt ?? event.occurredAt,
      endedAt: event.occurredAt,
    );
    if (existing != null) {
      next = next.replaceTurn(systemTurn);
    } else {
      next = next.appendTurn(systemTurn);
    }
    final settledKey = status == AssistantTurnStatus.completed
        ? assistantKey
        : null;
    return state.copyWith(
      document: next.withLastSettled(
        next.indexOfTurnByKey(settledKey ?? '') >= 0 ? settledKey : null,
      ),
    );
  }

  // ----- Assistant events -----

  TranscriptReducerState _handleAssistantStarted(
    TranscriptReducerState state,
    StreamEventState event,
  ) {
    final parsed = _parser.parseAssistantStarted(event.payload);
    final turnId = _resolveAssistantTurnId(state, event);
    final assistantKey = TranscriptKeys.assistantTurnKey(turnId);
    final existing = state.document.lastTurnWithKeyPrefix(assistantKey);
    var document = state.document;
    if (existing is AssistantTurn) {
      // First assistant step for the turn; set its step id when available.
      if (existing.assistantStepId.isEmpty &&
          parsed.assistantStepId.isNotEmpty) {
        document = document.replaceTurn(
          existing.copyWith(assistantStepId: parsed.assistantStepId),
        );
      }
    } else {
      // Defensive replay path: assistant started before turn.started.
      document = document.appendTurn(
        AssistantTurn(
          turnId: turnId,
          assistantStepId: parsed.assistantStepId,
          status: AssistantTurnStatus.active,
          items: const [],
          startedAt: event.occurredAt,
        ),
      );
    }

    // contentBlockId is scoped to one Pi message and is routinely reused by
    // the next prompt (often as "0"). Namespace it by the durable turn id.
    final answerId = parsed.answerId!;
    final builderKey = _answerBuilderKey(turnId, answerId);
    final builders = Map<String, _AnswerBuilder>.of(state.answerBuilders);
    builders[builderKey] = _AnswerBuilder(
      assistantStepId: parsed.assistantStepId,
      answerId: answerId,
    );
    return TranscriptReducerState(
      document: document,
      answerBuilders: builders,
      toolBuilders: state.toolBuilders,
      reasoningBuilders: state.reasoningBuilders,
    );
  }

  TranscriptReducerState _handleAssistantDelta(
    TranscriptReducerState state,
    StreamEventState event,
  ) {
    final parsed = _parser.parseAssistantDelta(event.payload);
    final turnId = _resolveAssistantTurnId(state, event);
    final answerId = parsed.answerId;
    if (answerId == null) {
      return _recordDiagnostic(
        state,
        event,
        label: 'assistant_delta_no_answer',
        detail: 'assistant.delta arrived without answerId',
      );
    }
    final builderKey = _answerBuilderKey(turnId, answerId);
    final builders = Map<String, _AnswerBuilder>.of(state.answerBuilders);
    final existing = builders[builderKey];
    final delta = parsed.delta ?? '';
    final step = parsed.assistantStepId.isNotEmpty
        ? parsed.assistantStepId
        : (existing?.assistantStepId ?? '');
    if (existing == null) {
      builders[builderKey] = _AnswerBuilder(
        assistantStepId: step,
        answerId: answerId,
        markdown: delta,
      );
    } else {
      final combined = existing.markdown + delta;
      builders[builderKey] = _AnswerBuilder(
        assistantStepId: step,
        answerId: answerId,
        markdown: _capString(combined, _kAnswerDeltaByteCap),
        completed: existing.completed,
      );
    }
    return state.copyWith()._withBuilders(answerBuilders: builders);
  }

  TranscriptReducerState _handleAssistantCompleted(
    TranscriptReducerState state,
    StreamEventState event,
  ) {
    final parsed = _parser.parseAssistantCompleted(event.payload);
    final turnId = _resolveAssistantTurnId(state, event);
    final answerId = parsed.answerId;
    if (answerId == null) {
      return _recordDiagnostic(
        state,
        event,
        label: 'assistant_completed_no_answer',
        detail: 'assistant.completed arrived without answerId',
      );
    }
    final builderKey = _answerBuilderKey(turnId, answerId);
    final builders = Map<String, _AnswerBuilder>.of(state.answerBuilders);
    final existing = builders[builderKey];
    final step = parsed.assistantStepId.isNotEmpty
        ? parsed.assistantStepId
        : (existing?.assistantStepId ?? '');
    final markdown = existing?.markdown ?? '';
    final builder = _AnswerBuilder(
      assistantStepId: step,
      answerId: answerId,
      markdown: markdown,
      completed: true,
    );
    builders[builderKey] = builder;
    final viewData = FinalAnswerViewData(
      answerId: answerId,
      markdown: markdown,
    );
    final nextState = state._withBuilders(answerBuilders: builders);
    return _addFinalAnswerItem(
      nextState,
      turnId: turnId,
      assistantStepId: step,
      itemId: answerId,
      viewData: viewData,
      completedAt: event.occurredAt,
    );
  }

  // ----- Reasoning events -----

  TranscriptReducerState _handleReasoningStarted(
    TranscriptReducerState state,
    StreamEventState event,
  ) {
    final parsed = _parser.parseReasoningStarted(event.payload);
    final builders = Map<String, _ReasoningBuilder>.of(state.reasoningBuilders);
    builders[parsed.reasoningId] = _ReasoningBuilder(
      reasoningId: parsed.reasoningId,
      assistantStepId: parsed.assistantStepId,
    );
    final viewData = builders[parsed.reasoningId]!.toViewData(
      ReasoningPhase.active,
    );
    final nextState = state._withBuilders(reasoningBuilders: builders);
    return _upsertReasoningItem(
      nextState,
      assistantStepId: parsed.assistantStepId,
      itemId: parsed.reasoningId,
      viewData: viewData,
    );
  }

  TranscriptReducerState _handleReasoningDelta(
    TranscriptReducerState state,
    StreamEventState event,
  ) {
    final parsed = _parser.parseReasoningDelta(event.payload);
    final delta = parsed.delta ?? '';
    final builders = Map<String, _ReasoningBuilder>.of(state.reasoningBuilders);
    final existing = builders[parsed.reasoningId];
    final step = parsed.assistantStepId.isNotEmpty
        ? parsed.assistantStepId
        : (existing?.assistantStepId ?? '');
    final summaryBase = existing?.summary ?? '';
    final combined = summaryBase + delta;
    final summary = _capString(combined, _kReasoningSummaryCharCap);
    final steps = existing?.steps ?? const <String>[];
    builders[parsed.reasoningId] = _ReasoningBuilder(
      reasoningId: parsed.reasoningId,
      assistantStepId: step,
      summary: summary,
      steps: steps,
    );
    final viewData = builders[parsed.reasoningId]!.toViewData(
      ReasoningPhase.active,
    );
    final nextState = state._withBuilders(reasoningBuilders: builders);
    return _upsertReasoningItem(
      nextState,
      assistantStepId: step,
      itemId: parsed.reasoningId,
      viewData: viewData,
    );
  }

  TranscriptReducerState _handleReasoningCompleted(
    TranscriptReducerState state,
    StreamEventState event,
  ) {
    final parsed = _parser.parseReasoningCompleted(event.payload);
    final builders = Map<String, _ReasoningBuilder>.of(state.reasoningBuilders);
    final existing = builders[parsed.reasoningId];
    final step = parsed.assistantStepId.isNotEmpty
        ? parsed.assistantStepId
        : (existing?.assistantStepId ?? '');
    final summary = parsed.summary ?? (existing?.summary ?? '');
    final steps = parsed.steps.isNotEmpty
        ? parsed.steps
        : (existing?.steps ?? const <String>[]);
    final cappedSteps = steps.length > _kReasoningStepCap
        ? steps.sublist(0, _kReasoningStepCap)
        : steps;
    final builder = _ReasoningBuilder(
      reasoningId: parsed.reasoningId,
      assistantStepId: step,
      summary: summary,
      steps: cappedSteps,
    );
    builders[parsed.reasoningId] = builder;
    final viewData = builder.toViewData(ReasoningPhase.completed);
    final nextState = state._withBuilders(reasoningBuilders: builders);
    return _upsertReasoningItem(
      nextState,
      assistantStepId: step,
      itemId: parsed.reasoningId,
      viewData: viewData,
    );
  }

  // ----- Tool events -----

  TranscriptReducerState _handleToolStarted(
    TranscriptReducerState state,
    StreamEventState event,
  ) {
    final parsed = _parser.parseToolStarted(event.payload);
    final builders = Map<String, _ToolBuilder>.of(state.toolBuilders);
    final pending = builders[parsed.toolCallId];
    builders[parsed.toolCallId] = _ToolBuilder(
      assistantStepId: parsed.assistantStepId,
      toolName: parsed.toolName,
      status: TranscriptToolStatus.running,
      arguments: Map<String, Object?>.of(parsed.arguments),
      outputBuffer: pending?.outputBuffer ?? '',
      result: pending?.result,
      truncation: pending?.truncation,
      startedAt: parsed.startedAt ?? event.occurredAt,
    );
    final viewData = builders[parsed.toolCallId]!.toViewData();
    final fixedView = ToolCallViewData(
      toolCallId: parsed.toolCallId,
      toolName: viewData.toolName,
      arguments: viewData.arguments,
      status: viewData.status,
      result: viewData.result,
      errorMessage: viewData.errorMessage,
      truncation: viewData.truncation,
      startedAt: viewData.startedAt,
      finishedAt: viewData.finishedAt,
    );
    final nextState = state._withBuilders(toolBuilders: builders);
    return _upsertToolItem(
      nextState,
      assistantStepId: parsed.assistantStepId,
      itemId: parsed.toolCallId,
      viewData: fixedView,
    );
  }

  TranscriptReducerState _handleToolOutput(
    TranscriptReducerState state,
    StreamEventState event,
  ) {
    final parsed = _parser.parseToolOutput(event.payload);
    final builders = Map<String, _ToolBuilder>.of(state.toolBuilders);
    final existing = builders[parsed.toolCallId];
    final pendingOnly =
        existing == null ||
        (existing.startedAt == null && existing.finishedAt == null);
    final step = parsed.assistantStepId.isNotEmpty
        ? parsed.assistantStepId
        : (existing?.assistantStepId ?? '');
    final toolName = parsed.toolName.isNotEmpty
        ? parsed.toolName
        : (existing?.toolName ?? '');
    if (existing == null) {
      builders[parsed.toolCallId] = _ToolBuilder(
        assistantStepId: step,
        toolName: toolName,
        status: TranscriptToolStatus.running,
        outputBuffer: _capString(parsed.outputDelta ?? '', _kToolOutputByteCap),
        result: parsed.result,
        truncation: parsed.truncation,
      );
    } else {
      final combined = existing.outputBuffer + (parsed.outputDelta ?? '');
      builders[parsed.toolCallId] = _ToolBuilder(
        assistantStepId: existing.assistantStepId,
        toolName: existing.toolName,
        status: existing.status,
        arguments: existing.arguments,
        outputBuffer: _capString(combined, _kToolOutputByteCap),
        result: parsed.result ?? existing.result,
        errorMessage: existing.errorMessage,
        truncation: parsed.truncation ?? existing.truncation,
        startedAt: existing.startedAt,
        finishedAt: existing.finishedAt,
      );
    }
    final nextState = state._withBuilders(toolBuilders: builders);
    // A metadata-only output can arrive from a retained history boundary
    // before its `tool.started` event. Keep it pending by call ID rather than
    // manufacturing an anonymous timeline card. The start/terminal event will
    // attach the accumulated output and truncation to the real tool card.
    if (pendingOnly) return nextState;
    final viewData = builders[parsed.toolCallId]!.toViewData();
    final fixedView = ToolCallViewData(
      toolCallId: parsed.toolCallId,
      toolName: viewData.toolName,
      arguments: viewData.arguments,
      status: viewData.status,
      result: viewData.result,
      errorMessage: viewData.errorMessage,
      truncation: viewData.truncation,
      startedAt: viewData.startedAt,
      finishedAt: viewData.finishedAt,
    );
    return _upsertToolItem(
      nextState,
      assistantStepId: step,
      itemId: parsed.toolCallId,
      viewData: fixedView,
    );
  }

  TranscriptReducerState _handleToolCompleted(
    TranscriptReducerState state,
    StreamEventState event,
  ) {
    final parsed = _parser.parseToolCompleted(event.payload);
    final builders = Map<String, _ToolBuilder>.of(state.toolBuilders);
    final existing = builders[parsed.toolCallId];
    final step = parsed.assistantStepId.isNotEmpty
        ? parsed.assistantStepId
        : (existing?.assistantStepId ?? '');
    final toolName = parsed.toolName.isNotEmpty
        ? parsed.toolName
        : (existing?.toolName ?? '');
    final result = parsed.result ?? existing?.result;
    final truncation = parsed.truncation ?? existing?.truncation;
    final outputBuffer = existing?.outputBuffer ?? '';
    final arguments = existing?.arguments ?? const <String, Object?>{};
    final builder = _ToolBuilder(
      assistantStepId: step,
      toolName: toolName,
      status: TranscriptToolStatus.completed,
      arguments: Map<String, Object?>.of(arguments),
      outputBuffer: outputBuffer,
      result: result,
      errorMessage: null,
      truncation: truncation,
      startedAt: existing?.startedAt,
      finishedAt: parsed.finishedAt ?? event.occurredAt,
    );
    builders[parsed.toolCallId] = builder;
    final viewData = builder.toViewData();
    final fixedView = ToolCallViewData(
      toolCallId: parsed.toolCallId,
      toolName: viewData.toolName,
      arguments: viewData.arguments,
      status: viewData.status,
      result: viewData.result,
      errorMessage: viewData.errorMessage,
      truncation: viewData.truncation,
      startedAt: viewData.startedAt,
      finishedAt: viewData.finishedAt,
    );
    final nextState = state._withBuilders(toolBuilders: builders);
    return _upsertToolItem(
      nextState,
      assistantStepId: step,
      itemId: parsed.toolCallId,
      viewData: fixedView,
    );
  }

  TranscriptReducerState _handleToolFailed(
    TranscriptReducerState state,
    StreamEventState event,
  ) {
    final parsed = _parser.parseToolFailed(event.payload);
    final builders = Map<String, _ToolBuilder>.of(state.toolBuilders);
    final existing = builders[parsed.toolCallId];
    final step = parsed.assistantStepId.isNotEmpty
        ? parsed.assistantStepId
        : (existing?.assistantStepId ?? '');
    final toolName = parsed.toolName.isNotEmpty
        ? parsed.toolName
        : (existing?.toolName ?? '');
    final builder = _ToolBuilder(
      assistantStepId: step,
      toolName: toolName,
      status: TranscriptToolStatus.error,
      arguments: existing?.arguments ?? const <String, Object?>{},
      outputBuffer: existing?.outputBuffer ?? '',
      result: parsed.result ?? existing?.result,
      errorMessage: parsed.errorMessage,
      truncation: parsed.truncation ?? existing?.truncation,
      startedAt: existing?.startedAt,
      finishedAt: parsed.finishedAt ?? event.occurredAt,
    );
    builders[parsed.toolCallId] = builder;
    final viewData = builder.toViewData();
    final fixedView = ToolCallViewData(
      toolCallId: parsed.toolCallId,
      toolName: viewData.toolName,
      arguments: viewData.arguments,
      status: viewData.status,
      result: viewData.result,
      errorMessage: viewData.errorMessage,
      truncation: viewData.truncation,
      startedAt: viewData.startedAt,
      finishedAt: viewData.finishedAt,
    );
    final nextState = state._withBuilders(toolBuilders: builders);
    return _upsertToolItem(
      nextState,
      assistantStepId: step,
      itemId: parsed.toolCallId,
      viewData: fixedView,
    );
  }

  TranscriptReducerState _handleToolCancelled(
    TranscriptReducerState state,
    StreamEventState event,
  ) {
    final parsed = _parser.parseToolCancelled(event.payload);
    final builders = Map<String, _ToolBuilder>.of(state.toolBuilders);
    final existing = builders[parsed.toolCallId];
    final step = parsed.assistantStepId.isNotEmpty
        ? parsed.assistantStepId
        : (existing?.assistantStepId ?? '');
    final toolName = parsed.toolName.isNotEmpty
        ? parsed.toolName
        : (existing?.toolName ?? '');
    final builder = _ToolBuilder(
      assistantStepId: step,
      toolName: toolName,
      status: TranscriptToolStatus.cancelled,
      arguments: existing?.arguments ?? const <String, Object?>{},
      outputBuffer: existing?.outputBuffer ?? '',
      result: existing?.result,
      errorMessage: existing?.errorMessage,
      truncation: existing?.truncation,
      startedAt: existing?.startedAt,
      finishedAt: parsed.finishedAt ?? event.occurredAt,
    );
    builders[parsed.toolCallId] = builder;
    final viewData = builder.toViewData();
    final fixedView = ToolCallViewData(
      toolCallId: parsed.toolCallId,
      toolName: viewData.toolName,
      arguments: viewData.arguments,
      status: viewData.status,
      result: viewData.result,
      errorMessage: viewData.errorMessage,
      truncation: viewData.truncation,
      startedAt: viewData.startedAt,
      finishedAt: viewData.finishedAt,
    );
    final nextState = state._withBuilders(toolBuilders: builders);
    return _upsertToolItem(
      nextState,
      assistantStepId: step,
      itemId: parsed.toolCallId,
      viewData: fixedView,
    );
  }

  // ----- Helpers -----

  TranscriptReducerState _handleUnknownEvent(
    TranscriptReducerState state,
    StreamEventState event,
  ) {
    return _recordDiagnostic(
      state,
      event,
      label: 'unknown_event',
      detail: 'No presenter exists for event type ${event.type}',
    );
  }

  TranscriptReducerState _recordDiagnostic(
    TranscriptReducerState state,
    StreamEventState event, {
    required String label,
    required String detail,
  }) {
    final key = TranscriptKeys.unknownKey(
      '${event.cursor.value}:${event.eventId}',
    );
    final preview = truncateDiagnosticJson(event.payload);
    final diagnostic = TranscriptDiagnostic(
      key: key,
      severity: TranscriptDiagnosticSeverity.warning,
      label: label,
      detail: detail,
      previewJson: preview.isEmpty ? null : preview,
      occurredAt: event.occurredAt,
    );
    final diagnostics = <TranscriptDiagnostic>[
      ...state.document.diagnostics,
      diagnostic,
    ];
    final trimmed = diagnostics.length > kTranscriptDiagnosticCountCap
        ? diagnostics.sublist(
            diagnostics.length - kTranscriptDiagnosticCountCap,
          )
        : diagnostics;
    return state.copyWith(document: state.document.withDiagnostics(trimmed));
  }

  String _answerBuilderKey(String turnId, String answerId) =>
      '$turnId::$answerId';

  String _resolveAssistantTurnId(
    TranscriptReducerState state,
    StreamEventState event,
  ) {
    final turnIdRaw = event.payload['turnId'];
    if (turnIdRaw is String && turnIdRaw.isNotEmpty) return turnIdRaw;
    // Fallback: last assistant turn by key prefix.
    final existing = state.document.lastTurnWithKeyPrefix('turn:assistant:');
    if (existing is AssistantTurn) return existing.turnId;
    return '';
  }

  TranscriptDocument _flushAnswerBuilders(
    TranscriptReducerState state,
    TranscriptDocument doc,
  ) {
    // No-op placeholder for future flush logic; assistant completion
    // already inserts final answer items on assistant.completed.
    return doc;
  }

  TranscriptDocument _upsertTurn(
    TranscriptDocument doc,
    Turn turn,
    String key,
  ) {
    final existing = doc.lastTurnWithKeyPrefix(key);
    if (existing != null) {
      return doc.replaceTurn(turn);
    }
    return doc.appendTurn(turn);
  }

  TranscriptDocument _pruneSystemTurns(
    TranscriptDocument doc,
    String turnId,
    Set<SystemTurnKind> kinds,
  ) {
    var next = doc;
    for (final kind in kinds) {
      final key = TranscriptKeys.systemTurnKey(turnId, kind.name);
      if (next.indexOfTurnByKey(key) >= 0) {
        final remaining = <Turn>[
          for (final turn in next.turns)
            if (turn.widgetKey != key) turn,
        ];
        next = TranscriptDocument(
          streamId: next.streamId,
          turns: List<Turn>.unmodifiable(remaining),
          diagnostics: next.diagnostics,
          lastSettledTurnId: next.lastSettledTurnId,
        );
      }
    }
    return next;
  }

  TranscriptReducerState _upsertReasoningItem(
    TranscriptReducerState state, {
    required String assistantStepId,
    required String itemId,
    required ReasoningViewData viewData,
  }) {
    final turnId = _resolveTurnForStep(state, assistantStepId);
    if (turnId == null) {
      return _recordDiagnostic(
        state,
        _syntheticEvent(state, 'reasoning.orphan'),
        label: 'orphan_reasoning',
        detail: 'Reasoning item arrived before its assistant turn',
      );
    }
    final assistantKey = TranscriptKeys.assistantTurnKey(turnId);
    final turn = state.document.lastTurnWithKeyPrefix(assistantKey);
    if (turn is! AssistantTurn) {
      return _recordDiagnostic(
        state,
        _syntheticEvent(state, 'reasoning.orphan'),
        label: 'orphan_reasoning',
        detail: 'Reasoning item arrived before its assistant turn',
      );
    }
    final item = ReasoningItem(
      itemId: itemId,
      assistantStepId: assistantStepId,
      viewData: viewData,
    );
    return state.copyWith(
      document: state.document.replaceTurn(
        turn.copyWith(items: _replaceOrAppendItem(turn.items, item)),
      ),
    );
  }

  TranscriptReducerState _upsertToolItem(
    TranscriptReducerState state, {
    required String assistantStepId,
    required String itemId,
    required ToolCallViewData viewData,
  }) {
    final item = ToolItem(
      itemId: itemId,
      assistantStepId: assistantStepId,
      viewData: viewData,
    );
    // Live normalized tool events can omit assistantStepId. Once a call has
    // been placed, update that stable item in its owning turn rather than
    // resolving an empty step to whichever turn happens to be newest.
    for (final candidate in state.document.turns.reversed) {
      if (candidate is! AssistantTurn) continue;
      final existingIndex = candidate.items.indexWhere(
        (existing) => existing is ToolItem && existing.itemId == itemId,
      );
      if (existingIndex < 0) continue;
      final existingTool = candidate.items[existingIndex] as ToolItem;
      final replacement = assistantStepId.isEmpty
          ? ToolItem(
              itemId: itemId,
              assistantStepId: existingTool.assistantStepId,
              viewData: viewData,
            )
          : item;
      return state.copyWith(
        document: state.document.replaceTurn(
          candidate.copyWith(
            items: _replaceOrAppendItem(candidate.items, replacement),
          ),
        ),
      );
    }
    final turnId = _resolveTurnForStep(state, assistantStepId);
    if (turnId == null) {
      return _recordDiagnostic(
        state,
        _syntheticEvent(state, 'tool.orphan'),
        label: 'orphan_tool',
        detail: 'Tool item arrived before its assistant turn',
      );
    }
    final assistantKey = TranscriptKeys.assistantTurnKey(turnId);
    final turn = state.document.lastTurnWithKeyPrefix(assistantKey);
    if (turn is! AssistantTurn) {
      return _recordDiagnostic(
        state,
        _syntheticEvent(state, 'tool.orphan'),
        label: 'orphan_tool',
        detail: 'Tool item arrived before its assistant turn',
      );
    }
    return state.copyWith(
      document: state.document.replaceTurn(
        turn.copyWith(items: _replaceOrAppendItem(turn.items, item)),
      ),
    );
  }

  TranscriptReducerState _addFinalAnswerItem(
    TranscriptReducerState state, {
    required String turnId,
    required String assistantStepId,
    required String itemId,
    required FinalAnswerViewData viewData,
    DateTime? completedAt,
  }) {
    final explicitKey = TranscriptKeys.assistantTurnKey(turnId);
    final resolvedTurnId = state.document.indexOfTurnByKey(explicitKey) >= 0
        ? turnId
        : _resolveTurnForStep(state, assistantStepId);
    if (resolvedTurnId == null) {
      return _recordDiagnostic(
        state,
        _syntheticEvent(state, 'final_answer.orphan'),
        label: 'orphan_final_answer',
        detail: 'Final answer arrived before its assistant turn',
      );
    }
    final assistantKey = TranscriptKeys.assistantTurnKey(resolvedTurnId);
    final turn = state.document.lastTurnWithKeyPrefix(assistantKey);
    if (turn is! AssistantTurn) {
      return _recordDiagnostic(
        state,
        _syntheticEvent(state, 'final_answer.orphan'),
        label: 'orphan_final_answer',
        detail: 'Final answer arrived before its assistant turn',
      );
    }
    final item = FinalAnswerItem(
      itemId: itemId,
      assistantStepId: assistantStepId,
      viewData: viewData,
      completedAt: completedAt,
    );
    return state.copyWith(
      document: state.document.replaceTurn(
        turn.copyWith(items: _replaceOrAppendItem(turn.items, item)),
      ),
    );
  }

  String? _resolveTurnForStep(
    TranscriptReducerState state,
    String assistantStepId,
  ) {
    if (assistantStepId.isEmpty) {
      // No step id; default to the last assistant turn if it has no
      // step id yet.
      final last = state.document.lastTurnWithKeyPrefix('turn:assistant:');
      if (last is AssistantTurn && last.assistantStepId.isEmpty) {
        return last.turnId;
      }
      return last is AssistantTurn ? last.turnId : null;
    }
    for (final turn in state.document.turns) {
      if (turn is AssistantTurn && turn.assistantStepId == assistantStepId) {
        return turn.turnId;
      }
    }
    return null;
  }

  List<TurnItem> _replaceOrAppendItem(List<TurnItem> items, TurnItem next) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].widgetKey == next.widgetKey) {
        final copy = List<TurnItem>.of(items);
        copy[i] = next;
        return List<TurnItem>.unmodifiable(copy);
      }
    }
    return List<TurnItem>.unmodifiable([...items, next]);
  }

  String _messageForStatus(StreamEventState event, SystemTurnKind kind) {
    final raw = event.payload['message'];
    if (raw is String && raw.isNotEmpty) return raw;
    return switch (kind) {
      SystemTurnKind.waitingForInput => 'Waiting for your input',
      SystemTurnKind.retrying => 'Retrying',
      SystemTurnKind.compacting => 'Compacting context',
      _ => kind.name,
    };
  }

  String _messageForTerminal(AssistantTurnStatus status) => switch (status) {
    AssistantTurnStatus.aborted => 'Turn aborted',
    AssistantTurnStatus.failed => 'Turn failed',
    AssistantTurnStatus.indeterminate => 'Turn may or may not have completed',
    AssistantTurnStatus.interrupted => 'Turn interrupted',
    _ => 'Turn closed',
  };
}

extension on TranscriptReducerState {
  /// Private helper used by reducer internals to rebuild a state with new
  /// transient builder maps. Keeps the call sites readable.
  TranscriptReducerState _withBuilders({
    Map<String, _AnswerBuilder>? answerBuilders,
    Map<String, _ToolBuilder>? toolBuilders,
    Map<String, _ReasoningBuilder>? reasoningBuilders,
  }) => TranscriptReducerState(
    document: document,
    answerBuilders: answerBuilders ?? this.answerBuilders,
    toolBuilders: toolBuilders ?? this.toolBuilders,
    reasoningBuilders: reasoningBuilders ?? this.reasoningBuilders,
  );
}

String _capString(String value, int byteCap) {
  if (value.length <= byteCap) return value;
  return value.substring(0, byteCap);
}

/// Synthesises a minimal [StreamEventState] for internal diagnostics that
/// have no originating event (e.g. orphan-item warnings). The cursor is
/// taken from the most recent event in the document so the diagnostic key
/// stays stable across rebuilds.
StreamEventState _syntheticEvent(TranscriptReducerState state, String label) {
  final cursor = StreamCursor.parse('1');
  return StreamEventState(
    hostId: 'host:synthetic',
    streamId: state.document.streamId,
    cursor: cursor,
    eventId: 'synthetic-$label',
    type: label,
    payload: const {'_synthetic': true},
    occurredAt: DateTime.now().toUtc(),
  );
}
