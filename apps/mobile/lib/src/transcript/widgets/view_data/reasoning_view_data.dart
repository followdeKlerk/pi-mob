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
///     forces expansion and shows a live indicator.
///   * [completed] - the model finished this reasoning block. The widget
///     collapses by default but exposes a chevron to expand on demand.
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

  /// Returns true when the widget should be shown expanded by default.
  ///
  /// Active reasoning is always expanded. Completed reasoning is collapsed
  /// so the transcript stays scannable.
  bool get isExpandedByDefault => phase == ReasoningPhase.active;

  /// Convenience: human label for the current phase.
  String get phaseLabel => switch (phase) {
    ReasoningPhase.active => 'Reasoning in progress',
    ReasoningPhase.completed => 'Reasoning',
  };
}
