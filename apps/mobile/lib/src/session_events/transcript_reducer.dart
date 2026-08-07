/// Canonical transcript reducer (mobile-side).
///
/// The reducer is intentionally a pure function over the closed
/// canonical event set declared in `canonical_event.dart`. It maps
/// canonical events to a [CanonicalTranscriptState] (also pure) that
/// the existing widget layer can render through the existing
/// `TranscriptDocument` projection without a second authoritative
/// reduction.
///
/// The reducer follows plan §10.1–10.5:
///   * user_message.created inserts by stable `messageId`
///   * assistant.started creates an empty message if absent
///   * assistant.content.replaced REPLACES the snapshot (never appends)
///   * assistant.completed marks the message terminal
///   * tool.started creates a tool card by `toolCallId`
///   * tool.progress.replaced replaces ONLY non-terminal tool state
///   * tool.completed / tool.failed mark terminal
///   * turn.* events progress monotonically; duplicates are idempotent
///
/// The reducer never crashes the chat screen because of an unexpected
/// event. Any malformed payload is recorded in the bounded diagnostic
/// list and the state is returned unchanged.
library;

import '../transcript/domain/transcript_diagnostics.dart';
import 'canonical_event.dart';

/// Stable identifier for a user message inside the canonical reducer.
/// Derived from `messageId` so duplicate inserts are no-ops.
class CanonicalUserMessage {
  CanonicalUserMessage({
    required this.messageId,
    required this.turnId,
    required this.text,
    required this.occurredAt,
    this.attachmentRefs = const <String>[],
  });

  final String messageId;
  final String turnId;
  final String text;
  final DateTime occurredAt;
  final List<String> attachmentRefs;

  CanonicalUserMessage copyWith({
    String? messageId,
    String? turnId,
    String? text,
    DateTime? occurredAt,
    List<String>? attachmentRefs,
  }) => CanonicalUserMessage(
    messageId: messageId ?? this.messageId,
    turnId: turnId ?? this.turnId,
    text: text ?? this.text,
    occurredAt: occurredAt ?? this.occurredAt,
    attachmentRefs: attachmentRefs ?? this.attachmentRefs,
  );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CanonicalUserMessage &&
          other.messageId == messageId &&
          other.turnId == turnId &&
          other.text == text &&
          other.occurredAt.isAtSameMomentAs(occurredAt) &&
          other.attachmentRefs.length == attachmentRefs.length &&
          _listEquals(other.attachmentRefs, attachmentRefs));

  @override
  int get hashCode => Object.hash(
    messageId,
    turnId,
    text,
    occurredAt,
    Object.hashAll(attachmentRefs),
  );
}

/// Stable identifier for an assistant message. The reducer creates one
/// of these lazily so `assistant.content.replaced` arriving before
/// `assistant.started` does not crash the screen.
class CanonicalAssistantMessage {
  CanonicalAssistantMessage({
    required this.messageId,
    required this.turnId,
    required this.content,
    required this.startedAt,
    this.completedAt,
    this.isTerminal = false,
  });

  final String messageId;
  final String turnId;
  final List<CanonicalContentBlock> content;
  final DateTime startedAt;
  final DateTime? completedAt;
  final bool isTerminal;

  CanonicalAssistantMessage copyWith({
    String? messageId,
    String? turnId,
    List<CanonicalContentBlock>? content,
    DateTime? startedAt,
    DateTime? completedAt,
    bool? isTerminal,
  }) => CanonicalAssistantMessage(
    messageId: messageId ?? this.messageId,
    turnId: turnId ?? this.turnId,
    content: content ?? this.content,
    startedAt: startedAt ?? this.startedAt,
    completedAt: completedAt ?? this.completedAt,
    isTerminal: isTerminal ?? this.isTerminal,
  );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CanonicalAssistantMessage &&
          other.messageId == messageId &&
          other.turnId == turnId &&
          other.startedAt.isAtSameMomentAs(startedAt) &&
          (other.completedAt?.isAtSameMomentAs(
                completedAt ?? DateTime.fromMillisecondsSinceEpoch(0),
              ) ??
              completedAt == null) &&
          other.isTerminal == isTerminal &&
          _listEquals(other.content, content));

  @override
  int get hashCode => Object.hash(
    messageId,
    turnId,
    startedAt,
    completedAt,
    isTerminal,
    Object.hashAll(content),
  );
}

/// Replacement (never append) content snapshot.
class CanonicalContentBlock {
  const CanonicalContentBlock({required this.kind, required this.text});
  final String kind;
  final String text;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CanonicalContentBlock &&
          other.kind == kind &&
          other.text == text);

  @override
  int get hashCode => Object.hash(kind, text);
}

/// Stable identifier for a tool call. Derived from `toolCallId` so
/// duplicate starts are no-ops.
class CanonicalToolCall {
  CanonicalToolCall({
    required this.toolCallId,
    required this.turnId,
    required this.toolName,
    required this.arguments,
    required this.startedAt,
    this.progress,
    this.result,
    this.isError = false,
    this.errorMessage,
    this.completedAt,
    this.isTerminal = false,
  });

  final String toolCallId;
  final String turnId;
  final String toolName;
  final Map<String, Object?> arguments;
  final DateTime startedAt;
  final Object? progress;
  final Object? result;
  final bool isError;
  final String? errorMessage;
  final DateTime? completedAt;
  final bool isTerminal;

  CanonicalToolCall copyWith({
    String? toolCallId,
    String? turnId,
    String? toolName,
    Map<String, Object?>? arguments,
    DateTime? startedAt,
    Object? progress,
    Object? result,
    bool? isError,
    String? errorMessage,
    DateTime? completedAt,
    bool? isTerminal,
    bool clearProgress = false,
    bool clearResult = false,
    bool clearErrorMessage = false,
  }) => CanonicalToolCall(
    toolCallId: toolCallId ?? this.toolCallId,
    turnId: turnId ?? this.turnId,
    toolName: toolName ?? this.toolName,
    arguments: arguments ?? this.arguments,
    startedAt: startedAt ?? this.startedAt,
    progress: clearProgress ? null : (progress ?? this.progress),
    result: clearResult ? null : (result ?? this.result),
    isError: isError ?? this.isError,
    errorMessage: clearErrorMessage
        ? null
        : (errorMessage ?? this.errorMessage),
    completedAt: completedAt ?? this.completedAt,
    isTerminal: isTerminal ?? this.isTerminal,
  );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CanonicalToolCall &&
          other.toolCallId == toolCallId &&
          other.turnId == turnId &&
          other.toolName == toolName &&
          _mapEquals(other.arguments, arguments) &&
          other.startedAt.isAtSameMomentAs(startedAt) &&
          other.progress == progress &&
          other.result == result &&
          other.isError == isError &&
          other.errorMessage == errorMessage &&
          (other.completedAt?.isAtSameMomentAs(
                completedAt ?? DateTime.fromMillisecondsSinceEpoch(0),
              ) ??
              completedAt == null) &&
          other.isTerminal == isTerminal);

  @override
  int get hashCode => Object.hash(
    toolCallId,
    turnId,
    toolName,
    startedAt,
    progress,
    result,
    isError,
    errorMessage,
    completedAt,
    isTerminal,
  );
}

/// Pure, deterministic transcript state.
///
/// The state holds the canonical projections (user messages, assistant
/// messages, tool calls, turn pointers) plus a bounded diagnostic
/// list. The widget layer renders from these directly. The state is
/// never mutated in place: every `apply` call returns a new instance.
class CanonicalTranscriptState {
  CanonicalTranscriptState({
    required this.sessionId,
    this.lastAppliedSequence = 0,
    this.lastAppliedEventId,
    Map<String, CanonicalUserMessage>? userMessages,
    Map<String, CanonicalAssistantMessage>? assistantMessages,
    Map<String, CanonicalToolCall>? toolCalls,
    Map<String, String>? turnToMessage,
    Map<String, TurnStatus>? turnStatuses,
    Map<String, int>? entityOrder,
    List<TranscriptDiagnostic>? diagnostics,
  }) : userMessages = userMessages ?? <String, CanonicalUserMessage>{},
       assistantMessages =
           assistantMessages ?? <String, CanonicalAssistantMessage>{},
       toolCalls = toolCalls ?? <String, CanonicalToolCall>{},
       turnToMessage = turnToMessage ?? <String, String>{},
       turnStatuses = turnStatuses ?? <String, TurnStatus>{},
       entityOrder = entityOrder ?? <String, int>{},
       diagnostics = diagnostics ?? <TranscriptDiagnostic>[];

  final String sessionId;

  /// Highest `sequence` value the reducer has durably applied. Drives
  /// the synchronizer gap detection.
  final int lastAppliedSequence;

  /// `eventId` of the last applied event. Optional; the reducer
  /// accepts duplicate events with the same identity.
  final String? lastAppliedEventId;

  /// User messages keyed by `messageId`.
  final Map<String, CanonicalUserMessage> userMessages;

  /// Assistant messages keyed by `messageId`.
  final Map<String, CanonicalAssistantMessage> assistantMessages;

  /// Tool calls keyed by `toolCallId`.
  final Map<String, CanonicalToolCall> toolCalls;

  /// `turnId` -> `messageId` for the assistant message that owns the
  /// turn. Helps widgets group items under one parent turn.
  final Map<String, String> turnToMessage;

  /// `turnId` -> coarse-grained turn status. The reducer never
  /// regresses a turn back to an active state once it is terminal.
  final Map<String, TurnStatus> turnStatuses;

  /// Canonical first-seen sequence for every rendered entity. This preserves
  /// interleaved user/assistant/tool order after the category maps are split.
  final Map<String, int> entityOrder;

  /// Bounded diagnostics list (plan §10.5 — never crash the chat on
  /// unexpected events). Mutating helpers MUST keep this list under
  /// the cap.
  final List<TranscriptDiagnostic> diagnostics;

  CanonicalTranscriptState copyWith({
    int? lastAppliedSequence,
    String? lastAppliedEventId,
    Map<String, CanonicalUserMessage>? userMessages,
    Map<String, CanonicalAssistantMessage>? assistantMessages,
    Map<String, CanonicalToolCall>? toolCalls,
    Map<String, String>? turnToMessage,
    Map<String, TurnStatus>? turnStatuses,
    Map<String, int>? entityOrder,
    List<TranscriptDiagnostic>? diagnostics,
  }) => CanonicalTranscriptState(
    sessionId: sessionId,
    lastAppliedSequence: lastAppliedSequence ?? this.lastAppliedSequence,
    lastAppliedEventId: lastAppliedEventId ?? this.lastAppliedEventId,
    userMessages: userMessages ?? this.userMessages,
    assistantMessages: assistantMessages ?? this.assistantMessages,
    toolCalls: toolCalls ?? this.toolCalls,
    turnToMessage: turnToMessage ?? this.turnToMessage,
    turnStatuses: turnStatuses ?? this.turnStatuses,
    entityOrder: entityOrder ?? this.entityOrder,
    diagnostics: diagnostics ?? this.diagnostics,
  );

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    if (other is! CanonicalTranscriptState) return false;
    return other.sessionId == sessionId &&
        other.lastAppliedSequence == lastAppliedSequence &&
        other.lastAppliedEventId == lastAppliedEventId &&
        _mapUserEquals(other.userMessages, userMessages) &&
        _mapAssistantEquals(other.assistantMessages, assistantMessages) &&
        _mapToolEquals(other.toolCalls, toolCalls) &&
        _mapStringEquals(other.turnToMessage, turnToMessage) &&
        _mapStatusEquals(other.turnStatuses, turnStatuses) &&
        _diagListEquals(other.diagnostics, diagnostics);
  }

  @override
  int get hashCode => Object.hash(
    sessionId,
    lastAppliedSequence,
    lastAppliedEventId,
    Object.hashAllUnordered(
      userMessages.entries.map((e) => Object.hash(e.key, e.value)),
    ),
    Object.hashAllUnordered(
      assistantMessages.entries.map((e) => Object.hash(e.key, e.value)),
    ),
    Object.hashAllUnordered(
      toolCalls.entries.map((e) => Object.hash(e.key, e.value)),
    ),
    Object.hashAllUnordered(
      turnToMessage.entries.map((e) => Object.hash(e.key, e.value)),
    ),
    Object.hashAllUnordered(
      turnStatuses.entries.map((e) => Object.hash(e.key, e.value)),
    ),
    Object.hashAll(diagnostics),
  );

  static CanonicalTranscriptState empty(String sessionId) =>
      CanonicalTranscriptState(sessionId: sessionId);
}

bool _mapUserEquals(
  Map<String, CanonicalUserMessage> a,
  Map<String, CanonicalUserMessage> b,
) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (final entry in a.entries) {
    final other = b[entry.key];
    if (other == null) return false;
    if (entry.value != other) return false;
  }
  return true;
}

bool _mapAssistantEquals(
  Map<String, CanonicalAssistantMessage> a,
  Map<String, CanonicalAssistantMessage> b,
) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (final entry in a.entries) {
    final other = b[entry.key];
    if (other == null) return false;
    if (entry.value != other) return false;
  }
  return true;
}

bool _mapToolEquals(
  Map<String, CanonicalToolCall> a,
  Map<String, CanonicalToolCall> b,
) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (final entry in a.entries) {
    final other = b[entry.key];
    if (other == null) return false;
    if (entry.value != other) return false;
  }
  return true;
}

bool _mapStringEquals(Map<String, String> a, Map<String, String> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (final entry in a.entries) {
    if (b[entry.key] != entry.value) return false;
  }
  return true;
}

bool _mapStatusEquals(Map<String, TurnStatus> a, Map<String, TurnStatus> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (final entry in a.entries) {
    if (b[entry.key] != entry.value) return false;
  }
  return true;
}

bool _diagListEquals(
  List<TranscriptDiagnostic> a,
  List<TranscriptDiagnostic> b,
) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

enum TurnStatus {
  pending,
  running,
  waitingForInput,
  completed,
  failed,
  cancelled,
}

/// Returns the canonical transcript projection for [event] applied to
/// [state]. Pure and deterministic. Never mutates inputs.
///
/// The reducer must be applied to events in strict sequence order
/// (see `SessionEventSynchronizer`); calling it out of order may
/// still produce a valid projection but the synchronizer will detect
/// the gap and force a full replay.
CanonicalTranscriptState applyCanonicalEvent(
  CanonicalTranscriptState state,
  CanonicalSessionEvent event,
) {
  if (event.sessionId != state.sessionId) {
    return _record(
      state,
      event,
      'cross_session_event',
      'event belongs to ${event.sessionId}, state is ${state.sessionId}',
    );
  }

  // Idempotency: identical event id and sequence => no-op.
  if (state.lastAppliedSequence >= event.sequence) {
    return state;
  }

  switch (event.type) {
    case CanonicalEventType.userMessageCreated:
      return _handleUserMessageCreated(state, event);
    case CanonicalEventType.assistantStarted:
      return _handleAssistantStarted(state, event);
    case CanonicalEventType.assistantContentReplaced:
      return _handleAssistantContentReplaced(state, event);
    case CanonicalEventType.assistantMessageCompleted:
      return _handleAssistantCompleted(state, event);
    case CanonicalEventType.toolCallStarted:
      return _handleToolStarted(state, event);
    case CanonicalEventType.toolProgressReplaced:
      return _handleToolProgressReplaced(state, event);
    case CanonicalEventType.toolCallCompleted:
      return _handleToolCompleted(state, event);
    case CanonicalEventType.toolCallFailed:
      return _handleToolFailed(state, event);
    case CanonicalEventType.turnStarted:
      return _handleTurnStarted(state, event);
    case CanonicalEventType.turnWaitingForInput:
      return _handleTurnWaitingForInput(state, event);
    case CanonicalEventType.turnSettled:
      return _handleTurnTerminal(state, event, TurnStatus.completed);
    case CanonicalEventType.turnAborted:
      return _handleTurnTerminal(state, event, TurnStatus.cancelled);
    case CanonicalEventType.turnFailed:
      return _handleTurnTerminal(state, event, TurnStatus.failed);
    case CanonicalEventType.turnCancelled:
      return _handleTurnTerminal(state, event, TurnStatus.cancelled);
    case CanonicalEventType.ignored:
      return state.copyWith(lastAppliedSequence: event.sequence);
  }
}

// ---------- user messages ----------

CanonicalTranscriptState _handleUserMessageCreated(
  CanonicalTranscriptState state,
  CanonicalSessionEvent event,
) {
  final messageId = _requiredString(event.payload, 'messageId', event);
  if (messageId == null) return state;
  final turnId = _requiredString(event.payload, 'turnId', event);
  if (turnId == null) return state;
  // Idempotent on `messageId`: a duplicate creation is a no-op. The
  // state already records the highest applied sequence so we don't
  // regress.
  if (state.userMessages.containsKey(messageId)) {
    return state.copyWith(
      lastAppliedSequence: event.sequence,
      lastAppliedEventId: event.eventId,
    );
  }
  final text = event.payload['text'];
  final textStr = text is String ? text : '';
  final rawAttachments = event.payload['attachments'];
  final attachments = <String>[];
  if (rawAttachments is List) {
    for (final entry in rawAttachments) {
      if (entry is Map) {
        final ref = entry['id'] ?? entry['ref'];
        if (ref is String) attachments.add(ref);
      } else if (entry is String) {
        attachments.add(entry);
      }
    }
  }
  final userMessage = CanonicalUserMessage(
    messageId: messageId,
    turnId: turnId,
    text: textStr,
    occurredAt: event.occurredAt,
    attachmentRefs: List<String>.unmodifiable(attachments),
  );
  final next = state.copyWith(
    entityOrder: _recordEntity(state, 'user', messageId, event.sequence),
    userMessages: <String, CanonicalUserMessage>{
      ...state.userMessages,
      messageId: userMessage,
    },
    turnStatuses: <String, TurnStatus>{
      ...state.turnStatuses,
      turnId: state.turnStatuses[turnId] ?? TurnStatus.pending,
    },
    lastAppliedSequence: event.sequence,
    lastAppliedEventId: event.eventId,
  );
  return next;
}

Map<String, int> _recordEntity(
  CanonicalTranscriptState state,
  String kind,
  String id,
  int sequence,
) {
  final key = '$kind:$id';
  if (state.entityOrder.containsKey(key)) return state.entityOrder;
  return <String, int>{...state.entityOrder, key: sequence};
}

// ---------- assistant messages ----------

String _assistantStorageKey(
  CanonicalTranscriptState state,
  String messageId,
  String turnId,
) {
  // Distinct wire message ids in one turn are distinct assistant messages;
  // do not collapse them through the turn-to-message grouping pointer. Only
  // add a local suffix when the same wire id is reused by another turn.
  final existing = state.assistantMessages[messageId];
  if (existing == null || existing.turnId == turnId) return messageId;
  return '$messageId:$turnId';
}

CanonicalTranscriptState _handleAssistantStarted(
  CanonicalTranscriptState state,
  CanonicalSessionEvent event,
) {
  final wireMessageId = _requiredString(event.payload, 'messageId', event);
  if (wireMessageId == null) return state;
  final turnId = _requiredString(event.payload, 'turnId', event);
  if (turnId == null) return state;
  final messageId = _assistantStorageKey(state, wireMessageId, turnId);
  if (state.assistantMessages.containsKey(messageId)) {
    // Duplicate start: idempotent.
    return state.copyWith(
      lastAppliedSequence: event.sequence,
      lastAppliedEventId: event.eventId,
    );
  }
  final assistant = CanonicalAssistantMessage(
    messageId: messageId,
    turnId: turnId,
    content: const <CanonicalContentBlock>[],
    startedAt: event.occurredAt,
  );
  return state.copyWith(
    entityOrder: _recordEntity(state, 'assistant', messageId, event.sequence),
    assistantMessages: <String, CanonicalAssistantMessage>{
      ...state.assistantMessages,
      messageId: assistant,
    },
    turnToMessage: <String, String>{...state.turnToMessage, turnId: messageId},
    turnStatuses: <String, TurnStatus>{
      ...state.turnStatuses,
      turnId: TurnStatus.running,
    },
    lastAppliedSequence: event.sequence,
    lastAppliedEventId: event.eventId,
  );
}

CanonicalTranscriptState _handleAssistantContentReplaced(
  CanonicalTranscriptState state,
  CanonicalSessionEvent event,
) {
  final wireMessageId = _requiredString(event.payload, 'messageId', event);
  if (wireMessageId == null) return state;
  final turnId = _requiredString(event.payload, 'turnId', event);
  if (turnId == null) return state;
  final messageId = _assistantStorageKey(state, wireMessageId, turnId);
  final rawBlocks = event.payload['content'];
  final blocks = <CanonicalContentBlock>[];
  if (rawBlocks is List) {
    for (final entry in rawBlocks) {
      if (entry is Map) {
        final kind = entry['kind'];
        final text = entry['text'];
        blocks.add(
          CanonicalContentBlock(
            kind: kind is String ? kind : 'text',
            text: text is String ? text : '',
          ),
        );
      } else if (entry is String) {
        blocks.add(CanonicalContentBlock(kind: 'text', text: entry));
      }
    }
  } else if (rawBlocks is String) {
    blocks.add(CanonicalContentBlock(kind: 'text', text: rawBlocks));
  }
  final existing = state.assistantMessages[messageId];
  if (existing == null) {
    // Implicit create so a content-replaced arriving before
    // assistant.started never crashes the chat screen. The reducer
    // also records a bounded diagnostic.
    final created = CanonicalAssistantMessage(
      messageId: messageId,
      turnId: turnId,
      content: List<CanonicalContentBlock>.unmodifiable(blocks),
      startedAt: event.occurredAt,
    );
    final next = state.copyWith(
      entityOrder: _recordEntity(state, 'assistant', messageId, event.sequence),
      assistantMessages: <String, CanonicalAssistantMessage>{
        ...state.assistantMessages,
        messageId: created,
      },
      turnToMessage: <String, String>{
        ...state.turnToMessage,
        turnId: messageId,
      },
      lastAppliedSequence: event.sequence,
      lastAppliedEventId: event.eventId,
    );
    return _record(
      next,
      event,
      'implicit_assistant_started',
      'assistant.content.replaced arrived before assistant.started',
    );
  }
  if (existing.isTerminal) {
    // Late progress after completion: plan §3.7 says ignore it.
    return _record(
      state,
      event,
      'late_progress_ignored',
      'content replaced after assistant completion for $messageId',
    );
  }
  final replaced = existing.copyWith(
    content: List<CanonicalContentBlock>.unmodifiable(blocks),
  );
  return state.copyWith(
    assistantMessages: <String, CanonicalAssistantMessage>{
      ...state.assistantMessages,
      messageId: replaced,
    },
    lastAppliedSequence: event.sequence,
    lastAppliedEventId: event.eventId,
  );
}

CanonicalTranscriptState _handleAssistantCompleted(
  CanonicalTranscriptState state,
  CanonicalSessionEvent event,
) {
  final wireMessageId = _requiredString(event.payload, 'messageId', event);
  if (wireMessageId == null) return state;
  final turnId = _requiredString(event.payload, 'turnId', event) ?? 'unknown';
  final messageId = _assistantStorageKey(state, wireMessageId, turnId);
  final existing = state.assistantMessages[messageId];
  if (existing == null) {
    // A completion without a start is an orphan lifecycle notification. Do
    // not create a visible empty assistant: a later valid start/content event
    // can still establish the real message identity.
    return _record(
      state.copyWith(
        lastAppliedSequence: event.sequence,
        lastAppliedEventId: event.eventId,
      ),
      event,
      'orphan_assistant_completion',
      'assistant completion arrived before its start',
    );
  }
  if (existing.isTerminal) {
    // Duplicate terminal: idempotent.
    return state.copyWith(
      lastAppliedSequence: event.sequence,
      lastAppliedEventId: event.eventId,
    );
  }
  final completed = existing.copyWith(
    completedAt: event.occurredAt,
    isTerminal: true,
  );
  return state.copyWith(
    assistantMessages: <String, CanonicalAssistantMessage>{
      ...state.assistantMessages,
      messageId: completed,
    },
    lastAppliedSequence: event.sequence,
    lastAppliedEventId: event.eventId,
  );
}

// ---------- tool calls ----------

CanonicalTranscriptState _handleToolStarted(
  CanonicalTranscriptState state,
  CanonicalSessionEvent event,
) {
  final toolCallId = _requiredString(event.payload, 'toolCallId', event);
  if (toolCallId == null) return state;
  final turnId = _requiredString(event.payload, 'turnId', event);
  if (turnId == null) return state;
  final toolName = _requiredString(event.payload, 'toolName', event) ?? '';
  final rawArgs = event.payload['arguments'];
  final args = rawArgs is Map
      ? Map<String, Object?>.from(rawArgs)
      : <String, Object?>{};
  if (state.toolCalls.containsKey(toolCallId)) {
    // Duplicate start: idempotent.
    return state.copyWith(
      lastAppliedSequence: event.sequence,
      lastAppliedEventId: event.eventId,
    );
  }
  final tool = CanonicalToolCall(
    toolCallId: toolCallId,
    turnId: turnId,
    toolName: toolName,
    arguments: Map<String, Object?>.unmodifiable(args),
    startedAt: event.occurredAt,
  );
  return state.copyWith(
    entityOrder: _recordEntity(state, 'tool', toolCallId, event.sequence),
    toolCalls: <String, CanonicalToolCall>{
      ...state.toolCalls,
      toolCallId: tool,
    },
    lastAppliedSequence: event.sequence,
    lastAppliedEventId: event.eventId,
  );
}

CanonicalTranscriptState _handleToolProgressReplaced(
  CanonicalTranscriptState state,
  CanonicalSessionEvent event,
) {
  final toolCallId = _requiredString(event.payload, 'toolCallId', event);
  if (toolCallId == null) return state;
  final existing = state.toolCalls[toolCallId];
  if (existing == null) {
    // Progress before start: tolerate by creating a placeholder tool
    // card so the widget never crashes on the unexpected order.
    final created = CanonicalToolCall(
      toolCallId: toolCallId,
      turnId: _requiredString(event.payload, 'turnId', event) ?? 'unknown',
      toolName: '',
      arguments: const <String, Object?>{},
      startedAt: event.occurredAt,
      progress: event.payload['progress'],
    );
    return _record(
      state.copyWith(
        entityOrder: _recordEntity(state, 'tool', toolCallId, event.sequence),
        toolCalls: <String, CanonicalToolCall>{
          ...state.toolCalls,
          toolCallId: created,
        },
        lastAppliedSequence: event.sequence,
        lastAppliedEventId: event.eventId,
      ),
      event,
      'implicit_tool_started',
      'tool.progress.replaced arrived before tool.started',
    );
  }
  if (existing.isTerminal) {
    return _record(
      state,
      event,
      'late_progress_ignored',
      'tool progress after terminal for $toolCallId',
    );
  }
  final updated = existing.copyWith(progress: event.payload['progress']);
  return state.copyWith(
    toolCalls: <String, CanonicalToolCall>{
      ...state.toolCalls,
      toolCallId: updated,
    },
    lastAppliedSequence: event.sequence,
    lastAppliedEventId: event.eventId,
  );
}

CanonicalTranscriptState _handleToolCompleted(
  CanonicalTranscriptState state,
  CanonicalSessionEvent event,
) {
  final toolCallId = _requiredString(event.payload, 'toolCallId', event);
  if (toolCallId == null) return state;
  final existing = state.toolCalls[toolCallId];
  if (existing == null) {
    // Completion before start: tolerant create.
    final created = CanonicalToolCall(
      toolCallId: toolCallId,
      turnId: _requiredString(event.payload, 'turnId', event) ?? 'unknown',
      toolName: _requiredString(event.payload, 'toolName', event) ?? '',
      arguments: const <String, Object?>{},
      startedAt: event.occurredAt,
      result: event.payload['result'],
      completedAt: event.occurredAt,
      isTerminal: true,
    );
    return state.copyWith(
      entityOrder: _recordEntity(state, 'tool', toolCallId, event.sequence),
      toolCalls: <String, CanonicalToolCall>{
        ...state.toolCalls,
        toolCallId: created,
      },
      lastAppliedSequence: event.sequence,
      lastAppliedEventId: event.eventId,
    );
  }
  if (existing.isTerminal) {
    return state.copyWith(
      lastAppliedSequence: event.sequence,
      lastAppliedEventId: event.eventId,
    );
  }
  final completed = existing.copyWith(
    result: event.payload['result'],
    completedAt: event.occurredAt,
    isTerminal: true,
  );
  return state.copyWith(
    toolCalls: <String, CanonicalToolCall>{
      ...state.toolCalls,
      toolCallId: completed,
    },
    lastAppliedSequence: event.sequence,
    lastAppliedEventId: event.eventId,
  );
}

CanonicalTranscriptState _handleToolFailed(
  CanonicalTranscriptState state,
  CanonicalSessionEvent event,
) {
  final toolCallId = _requiredString(event.payload, 'toolCallId', event);
  if (toolCallId == null) return state;
  final errorRaw = event.payload['error'];
  final message = event.payload['errorMessage'];
  final existing = state.toolCalls[toolCallId];
  if (existing == null) {
    final created = CanonicalToolCall(
      toolCallId: toolCallId,
      turnId: _requiredString(event.payload, 'turnId', event) ?? 'unknown',
      toolName: _requiredString(event.payload, 'toolName', event) ?? '',
      arguments: const <String, Object?>{},
      startedAt: event.occurredAt,
      isError: true,
      errorMessage: message is String
          ? message
          : (errorRaw is String ? errorRaw : 'tool failed'),
      completedAt: event.occurredAt,
      isTerminal: true,
    );
    return state.copyWith(
      toolCalls: <String, CanonicalToolCall>{
        ...state.toolCalls,
        toolCallId: created,
      },
      lastAppliedSequence: event.sequence,
      lastAppliedEventId: event.eventId,
    );
  }
  if (existing.isTerminal) {
    return state.copyWith(
      lastAppliedSequence: event.sequence,
      lastAppliedEventId: event.eventId,
    );
  }
  final failed = existing.copyWith(
    isError: true,
    errorMessage: message is String
        ? message
        : (errorRaw is String ? errorRaw : 'tool failed'),
    completedAt: event.occurredAt,
    isTerminal: true,
  );
  return state.copyWith(
    toolCalls: <String, CanonicalToolCall>{
      ...state.toolCalls,
      toolCallId: failed,
    },
    lastAppliedSequence: event.sequence,
    lastAppliedEventId: event.eventId,
  );
}

// ---------- turn lifecycle ----------

CanonicalTranscriptState _handleTurnStarted(
  CanonicalTranscriptState state,
  CanonicalSessionEvent event,
) {
  final turnId = _requiredString(event.payload, 'turnId', event);
  if (turnId == null) return state;
  final current = state.turnStatuses[turnId];
  final next = current == null || current == TurnStatus.pending
      ? TurnStatus.running
      : current;
  return state.copyWith(
    turnStatuses: <String, TurnStatus>{...state.turnStatuses, turnId: next},
    lastAppliedSequence: event.sequence,
    lastAppliedEventId: event.eventId,
  );
}

CanonicalTranscriptState _handleTurnWaitingForInput(
  CanonicalTranscriptState state,
  CanonicalSessionEvent event,
) {
  final turnId = _requiredString(event.payload, 'turnId', event);
  if (turnId == null) return state;
  final current = state.turnStatuses[turnId];
  // Once terminal the reducer never regresses to waitingForInput.
  if (current == TurnStatus.completed ||
      current == TurnStatus.failed ||
      current == TurnStatus.cancelled) {
    return state.copyWith(
      lastAppliedSequence: event.sequence,
      lastAppliedEventId: event.eventId,
    );
  }
  return state.copyWith(
    turnStatuses: <String, TurnStatus>{
      ...state.turnStatuses,
      turnId: TurnStatus.waitingForInput,
    },
    lastAppliedSequence: event.sequence,
    lastAppliedEventId: event.eventId,
  );
}

CanonicalTranscriptState _handleTurnTerminal(
  CanonicalTranscriptState state,
  CanonicalSessionEvent event,
  TurnStatus terminal,
) {
  final turnId = _requiredString(event.payload, 'turnId', event);
  if (turnId == null) return state;
  final current = state.turnStatuses[turnId];
  // Plan §3.7: terminal states are monotonic. Once terminal, the
  // status never regresses.
  if (current == TurnStatus.completed ||
      current == TurnStatus.failed ||
      current == TurnStatus.cancelled) {
    return state.copyWith(
      lastAppliedSequence: event.sequence,
      lastAppliedEventId: event.eventId,
    );
  }
  return state.copyWith(
    turnStatuses: <String, TurnStatus>{...state.turnStatuses, turnId: terminal},
    lastAppliedSequence: event.sequence,
    lastAppliedEventId: event.eventId,
  );
}

// ---------- helpers ----------

String? _requiredString(
  Map<String, Object?> payload,
  String field,
  CanonicalSessionEvent event,
) {
  final value = payload[field];
  if (value is String && value.isNotEmpty) return value;
  return null;
}

CanonicalTranscriptState _record(
  CanonicalTranscriptState state,
  CanonicalSessionEvent event,
  String label,
  String detail,
) {
  final capped = state.diagnostics.length >= _kDiagnosticCap
      ? state.diagnostics.sublist(
          state.diagnostics.length - _kDiagnosticCap + 1,
        )
      : state.diagnostics;
  final diag = TranscriptDiagnostic(
    key: 'canonical:${event.eventId}',
    severity: TranscriptDiagnosticSeverity.warning,
    label: label,
    detail: detail,
    occurredAt: event.occurredAt,
  );
  return state.copyWith(
    diagnostics: <TranscriptDiagnostic>[...capped, diag],
    lastAppliedSequence: event.sequence,
    lastAppliedEventId: event.eventId,
  );
}

const int _kDiagnosticCap = 64;

bool _listEquals<T>(List<T> a, List<T> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

bool _mapEquals(Map<String, Object?> a, Map<String, Object?> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (final entry in a.entries) {
    if (!b.containsKey(entry.key)) return false;
    if (entry.value != b[entry.key]) return false;
  }
  return true;
}
