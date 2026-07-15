/// View-data for a reasoning block.
///
/// Pi surfaces an optional reasoning stream alongside the main turn. The
/// mobile widget collapses the block when it is finished so the transcript
/// stays scannable, and shows it expanded while it is still streaming so the
/// user can follow along. This file holds the pure data; the presentation
/// lives in `reasoning_block.dart`.
library;

/// Lifecycle of the reasoning block.
///
///   * [active] - the model is still emitting reasoning tokens. The widget
///     shows a compact live indicator with details available on demand.
///   * [completed] - the model finished this reasoning block. The widget
///     remains collapsed by default with a disclosure affordance.
enum ReasoningPhase { active, completed }

/// Immutable view-data for one reasoning block.
class ReasoningViewData {
  const ReasoningViewData({
    required this.reasoningId,
    required this.phase,
    required this.summary,
    this.steps = const <String>[],
  });

  /// Stable identifier. Used as a widget key so the framework preserves the
  /// collapsed/expanded state across rebuilds.
  final String reasoningId;

  /// Current lifecycle phase. See [ReasoningPhase].
  final ReasoningPhase phase;

  /// Short headline shown in the collapsed header. The reducer derives this
  /// from the first sentence of the reasoning stream so users get a useful
  /// preview even when the block is collapsed.
  final String summary;

  /// Ordered list of reasoning steps. Each step is a short string suitable
  /// for rendering as a bullet row. The widget trims the list to a sensible
  /// preview length when collapsed and expands it fully when expanded.
  final List<String> steps;

  /// Reasoning stays collapsed by default in every phase so active work does
  /// not dominate the mobile transcript. Users can disclose it explicitly.
  bool get isExpandedByDefault => false;

  /// Convenience: human label for the current phase.
  String get phaseLabel => switch (phase) {
    ReasoningPhase.active => 'Thinking…',
    ReasoningPhase.completed => 'Thinking',
  };
}
