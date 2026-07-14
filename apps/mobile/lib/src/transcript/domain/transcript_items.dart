import '../widgets/view_data/final_answer_view_data.dart';
import '../widgets/view_data/reasoning_view_data.dart';
import '../widgets/view_data/tool_call_view_data.dart';
import 'transcript_diagnostics.dart';
import 'transcript_keys.dart';

/// Sealed hierarchy of items that compose an assistant turn.
///
/// Every item carries the originating `assistantStepId` so the reducer can
/// re-group parallel work even after a reconnect. Each item also exposes
/// a stable [key] for use as a Flutter widget key and as a record pointer
/// in the cursor index. Items are immutable: a new state replaces the old
/// value, which keeps widget `==` stable and lets Flutter reuse
/// [Element]s across rebuilds.
sealed class TurnItem {
  const TurnItem({
    required this.itemId,
    required this.assistantStepId,
    required this.key,
  });

  /// Identifier unique within the assistant step. Equal to the protocol
  /// content-block id for reasoning/answer events, or to the
  /// `toolCallId` for tool items, or to the originating cursor for
  /// diagnostic items.
  final String itemId;

  /// The originating assistant step. Items with the same
  /// `assistantStepId` were emitted as part of one logical action and
  /// belong under the same `AssistantTurn`.
  final String assistantStepId;

  /// Canonical widget key. Equivalent to `keyFor(itemId)` for the
  /// matching subtype.
  final String key;

  /// Convenience: widget key. Currently identical to [key] but exposed as
  /// a method so the widget layer does not need to know which field is
  /// the canonical one.
  String get widgetKey => key;
}

/// A reasoning block. Collapsed by default when complete; expanded while
/// the model is still streaming.
class ReasoningItem extends TurnItem {
  ReasoningItem({
    required super.itemId,
    required super.assistantStepId,
    required this.viewData,
  }) : super(key: TranscriptKeys.reasoningKey(itemId));

  /// The view-data the widget renders. Mutable session state lives in
  /// the [ReasoningViewData]; this wrapper is immutable.
  final ReasoningViewData viewData;

  /// Parallel group key. Reasoning and tool items within the same step
  /// share a group; the widget uses this to keep visual grouping even
  /// when the reducer reconstructs the transcript.
  String get parallelGroupKey =>
      TranscriptKeys.parallelGroupKey(assistantStepId);

  @override
  bool operator ==(Object other) =>
      other is ReasoningItem &&
      other.itemId == itemId &&
      other.assistantStepId == assistantStepId &&
      other.viewData == viewData;

  @override
  int get hashCode => Object.hash(itemId, assistantStepId, viewData);
}

/// A single tool call. Multiple tool items can share an
/// `assistantStepId` to represent a parallel group (e.g. several reads
/// launched in the same step).
class ToolItem extends TurnItem {
  ToolItem({
    required super.itemId,
    required super.assistantStepId,
    required this.viewData,
  }) : super(key: TranscriptKeys.toolKey(itemId));

  /// The view-data the widget renders. Tool cards never look at the raw
  /// protocol payload; the reducer has already lowered the lifecycle into
  /// a [ToolCallViewData].
  final ToolCallViewData viewData;

  /// Parallel group key. Two tool items share a group iff they came from
  /// the same assistant step.
  String get parallelGroupKey =>
      TranscriptKeys.parallelGroupKey(assistantStepId);

  @override
  bool operator ==(Object other) =>
      other is ToolItem &&
      other.itemId == itemId &&
      other.assistantStepId == assistantStepId &&
      other.viewData == viewData;

  @override
  int get hashCode => Object.hash(itemId, assistantStepId, viewData);
}

/// The user-facing final answer for a turn. Streams incrementally via
/// `assistant.delta` events keyed by `answerId`.
class FinalAnswerItem extends TurnItem {
  FinalAnswerItem({
    required super.itemId,
    required super.assistantStepId,
    required this.viewData,
    this.completedAt,
  }) : super(key: TranscriptKeys.finalAnswerKey(itemId));

  /// The view-data the widget renders. The Markdown source lives here;
  /// the widget handles rendering through the safe subset parser.
  final FinalAnswerViewData viewData;

  /// When the answer was finalised. `null` while still streaming.
  final DateTime? completedAt;

  /// True when the model has emitted an `assistant.completed` event for
  /// this answer.
  bool get isCompleted => completedAt != null;

  @override
  bool operator ==(Object other) =>
      other is FinalAnswerItem &&
      other.itemId == itemId &&
      other.assistantStepId == assistantStepId &&
      other.viewData == viewData &&
      other.completedAt == completedAt;

  @override
  int get hashCode =>
      Object.hash(itemId, assistantStepId, viewData, completedAt);
}

/// An unknown event or malformed payload the reducer absorbed. Always
/// paired with a [TranscriptDiagnostic] so the widget can render a
/// bounded placeholder.
class UnknownItem extends TurnItem {
  UnknownItem({
    required super.itemId,
    required super.assistantStepId,
    required this.diagnostic,
  }) : super(key: TranscriptKeys.unknownKey(itemId));

  /// Bounded diagnostic describing what was absorbed.
  final TranscriptDiagnostic diagnostic;

  @override
  bool operator ==(Object other) =>
      other is UnknownItem &&
      other.itemId == itemId &&
      other.assistantStepId == assistantStepId &&
      other.diagnostic == diagnostic;

  @override
  int get hashCode => Object.hash(itemId, assistantStepId, diagnostic);
}
