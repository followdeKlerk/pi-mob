import 'transcript_items.dart';
import 'transcript_keys.dart';

/// Lifecycle phase for a user-initiated turn. Mirrors the bridge command
/// states but is rendered through the transcript lens.
///
/// The reducer derives these states from the durable turn events. Because
/// the reducer never inspects the prompt body, the user-turn record is
/// self-contained: any prompt text the UI wants to render comes from the
/// caller's local command context, not from the journal.
enum UserTurnStatus {
  /// The bridge accepted the prompt but has not yet reported any further
  /// state.
  accepted,

  /// The prompt is waiting in the bridge-owned follow-up queue.
  queued,

  /// The bridge is dispatching the prompt to Pi.
  dispatching,

  /// The bridge dispatched the prompt; Pi has not yet started a turn.
  dispatched,

  /// The associated assistant turn settled normally.
  settled,

  /// The user or the bridge aborted the turn before settlement.
  aborted,

  /// The turn failed at the bridge or Pi boundary.
  failed,

  /// The turn was running during a crash and may or may not have completed.
  /// Never repeated automatically; surfaced explicitly so the user can
  /// decide what to do next.
  indeterminate,
}

/// Lifecycle phase for an assistant turn.
///
/// Note: the bridge journals [AssistantTurnStatus.active] until the model
/// emits its final answer (or the turn is forcibly terminated). The
/// transcript never invents a `completed` state; it only lowers the
/// canonical event the bridge delivered.
enum AssistantTurnStatus {
  /// The assistant is still emitting items (reasoning, tools, or answer
  /// deltas).
  active,

  /// The assistant turn completed normally.
  completed,

  /// The turn was aborted by the user or the bridge before the model
  /// finished.
  aborted,

  /// The turn failed (tool error, model error, or other terminal failure).
  failed,

  /// The turn was running during a crash and may or may not have completed.
  /// Surfaced explicitly so the user can decide whether to retry.
  indeterminate,

  /// The turn was interrupted by a transient condition such as a dropped
  /// connection. The reducer replays missing events on reconnect before
  /// transitioning to a terminal state.
  interrupted,
}

/// Categorisation for a [SystemTurn]. A system turn is a journal-level
/// event that does not carry assistant or user content but still needs to
/// surface in the transcript (e.g. `turn.waiting_for_input`).
enum SystemTurnKind {
  /// A user-facing "needs your input" badge derived from
  /// `turn.waiting_for_input`.
  waitingForInput,

  /// A retrying badge derived from `turn.retrying`.
  retrying,

  /// A compacting badge derived from `turn.compacting`.
  compacting,

  /// A graceful abort derived from `turn.aborted`.
  aborted,

  /// A non-recoverable failure derived from `turn.failed`.
  failed,

  /// An indeterminate failure derived from `turn.indeterminate`.
  indeterminate,

  /// An explicit interruption notice (e.g. lost connection). Distinct
  /// from [aborted] because the user did not ask for it.
  interrupted,
}

/// Sealed hierarchy of turns in the transcript. The three concrete subtypes
/// cover the protocol's three production paths: the user-initiated side, the
/// model response, and the journal-level system notices.
///
/// Every turn is immutable. New state replaces the old value, which keeps
/// widget `==` stable and lets Flutter reuse [Element]s across rebuilds.
sealed class Turn {
  const Turn({required this.turnId, this.startedAt, this.endedAt});

  /// Bridge-allocated `turnId`. Reused across reconnects so the same turn
  /// keeps its widget key even after a forced replay.
  final String turnId;

  /// When the turn was first observed by the reducer. Optional so older
  /// journals without timestamps still render.
  final DateTime? startedAt;

  /// When the turn reached a terminal state. `null` while the turn is
  /// still active.
  final DateTime? endedAt;

  /// Canonical widget key. The widget layer uses this as a `Key` on the
  /// corresponding card.
  String get widgetKey;

  /// True when the turn has reached a terminal state.
  bool get isTerminal;
}

/// The user-initiated side of a turn. A [UserTurn] appears before its
/// associated [AssistantTurn]; if the user prompt has not yet produced an
/// assistant response, the [UserTurn] is the only entry on screen.
class UserTurn extends Turn {
  const UserTurn({
    required super.turnId,
    required this.commandId,
    required this.deliveryMode,
    required this.status,
    super.startedAt,
    super.endedAt,
    this.respondingToTurnId,
  });

  /// Identifier of the originating `prompt.submit` command. The reducer
  /// records this so the caller can resolve prompt text and attachments
  /// from its local command context without re-fetching journal data.
  final String commandId;

  /// Delivery mode reported by the bridge: `immediate`, `steer`, or
  /// `follow_up`. The widget uses this to surface an explicit badge.
  final String deliveryMode;

  /// Current lifecycle phase. See [UserTurnStatus].
  final UserTurnStatus status;

  /// Identifier of the turn this user prompt steers or follows up to.
  /// `null` when the prompt was a fresh `immediate` submission.
  final String? respondingToTurnId;

  @override
  String get widgetKey => TranscriptKeys.userTurnKey(turnId);

  @override
  bool get isTerminal => switch (status) {
    UserTurnStatus.settled ||
    UserTurnStatus.aborted ||
    UserTurnStatus.failed ||
    UserTurnStatus.indeterminate => true,
    UserTurnStatus.accepted ||
    UserTurnStatus.queued ||
    UserTurnStatus.dispatching ||
    UserTurnStatus.dispatched => false,
  };

  UserTurn copyWith({
    UserTurnStatus? status,
    DateTime? startedAt,
    DateTime? endedAt,
    String? respondingToTurnId,
  }) => UserTurn(
    turnId: turnId,
    commandId: commandId,
    deliveryMode: deliveryMode,
    status: status ?? this.status,
    startedAt: startedAt ?? this.startedAt,
    endedAt: endedAt ?? this.endedAt,
    respondingToTurnId: respondingToTurnId ?? this.respondingToTurnId,
  );

  @override
  bool operator ==(Object other) =>
      other is UserTurn &&
      other.turnId == turnId &&
      other.commandId == commandId &&
      other.deliveryMode == deliveryMode &&
      other.status == status &&
      other.startedAt == startedAt &&
      other.endedAt == endedAt &&
      other.respondingToTurnId == respondingToTurnId;

  @override
  int get hashCode => Object.hash(
    turnId,
    commandId,
    deliveryMode,
    status,
    startedAt,
    endedAt,
    respondingToTurnId,
  );
}

/// The model response. One [AssistantTurn] per bridge `turnId`. Items
/// share a single `assistantStepId` only when emitted by the same
/// logical step; tools launched in parallel therefore group naturally.
class AssistantTurn extends Turn {
  const AssistantTurn({
    required super.turnId,
    required this.assistantStepId,
    required this.status,
    required this.items,
    super.startedAt,
    super.endedAt,
    this.respondingToUserTurnId,
    this.errorCode,
    this.errorMessage,
  });

  /// Identifier of the assistant step that started the turn. Tools and
  /// reasoning emitted within the same step share this value, which is
  /// how parallel tool calls are grouped.
  final String assistantStepId;

  /// Lifecycle phase. See [AssistantTurnStatus].
  final AssistantTurnStatus status;

  /// Ordered list of items composing the turn. Order is preserved across
  /// reconnects because the reducer appends to this list rather than
  /// re-sorting it.
  final List<TurnItem> items;

  /// Identifier of the user turn this assistant turn is responding to.
  /// `null` when the assistant turn was driven by a system event (rare).
  final String? respondingToUserTurnId;

  /// Stable error code when [status] is [AssistantTurnStatus.failed] or
  /// [AssistantTurnStatus.indeterminate]. Always `null` otherwise.
  final String? errorCode;

  /// Optional human-readable error message. The reducer never invents
  /// this; it surfaces the bridge-reported message verbatim.
  final String? errorMessage;

  /// All tool items, in declaration order.
  Iterable<ToolItem> get toolItems => items.whereType<ToolItem>();

  /// All reasoning items, in declaration order.
  Iterable<ReasoningItem> get reasoningItems =>
      items.whereType<ReasoningItem>();

  /// The first final-answer item, or `null` if none has been emitted.
  FinalAnswerItem? get finalAnswer {
    for (final item in items) {
      if (item is FinalAnswerItem) return item;
    }
    return null;
  }

  @override
  String get widgetKey => TranscriptKeys.assistantTurnKey(turnId);

  @override
  bool get isTerminal => switch (status) {
    AssistantTurnStatus.completed ||
    AssistantTurnStatus.aborted ||
    AssistantTurnStatus.failed ||
    AssistantTurnStatus.indeterminate => true,
    AssistantTurnStatus.active || AssistantTurnStatus.interrupted => false,
  };

  AssistantTurn copyWith({
    String? assistantStepId,
    AssistantTurnStatus? status,
    List<TurnItem>? items,
    DateTime? startedAt,
    DateTime? endedAt,
    String? errorCode,
    String? errorMessage,
  }) => AssistantTurn(
    turnId: turnId,
    assistantStepId: assistantStepId ?? this.assistantStepId,
    status: status ?? this.status,
    items: items ?? this.items,
    startedAt: startedAt ?? this.startedAt,
    endedAt: endedAt ?? this.endedAt,
    respondingToUserTurnId: respondingToUserTurnId,
    errorCode: errorCode ?? this.errorCode,
    errorMessage: errorMessage ?? this.errorMessage,
  );

  @override
  bool operator ==(Object other) =>
      other is AssistantTurn &&
      other.turnId == turnId &&
      other.assistantStepId == assistantStepId &&
      other.status == status &&
      _listEquals(other.items, items) &&
      other.startedAt == startedAt &&
      other.endedAt == endedAt &&
      other.respondingToUserTurnId == respondingToUserTurnId &&
      other.errorCode == errorCode &&
      other.errorMessage == errorMessage;

  @override
  int get hashCode => Object.hash(
    turnId,
    assistantStepId,
    status,
    Object.hashAll(items),
    startedAt,
    endedAt,
    respondingToUserTurnId,
    errorCode,
    errorMessage,
  );
}

/// A journal-level system notice. Distinct from user/assistant turns
/// because it carries no assistant content; the widget renders it as a
/// badge or banner.
class SystemTurn extends Turn {
  const SystemTurn({
    required super.turnId,
    required this.kind,
    required this.message,
    super.startedAt,
    super.endedAt,
  });

  /// Categorisation. See [SystemTurnKind].
  final SystemTurnKind kind;

  /// Bridge-reported message. Never overridden by the reducer.
  final String message;

  @override
  String get widgetKey => TranscriptKeys.systemTurnKey(turnId, kind.name);

  @override
  bool get isTerminal => switch (kind) {
    SystemTurnKind.aborted ||
    SystemTurnKind.failed ||
    SystemTurnKind.indeterminate ||
    SystemTurnKind.interrupted => true,
    SystemTurnKind.waitingForInput ||
    SystemTurnKind.retrying ||
    SystemTurnKind.compacting => false,
  };

  @override
  bool operator ==(Object other) =>
      other is SystemTurn &&
      other.turnId == turnId &&
      other.kind == kind &&
      other.message == message &&
      other.startedAt == startedAt &&
      other.endedAt == endedAt;

  @override
  int get hashCode => Object.hash(turnId, kind, message, startedAt, endedAt);
}

bool _listEquals<T>(List<T> a, List<T> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}
