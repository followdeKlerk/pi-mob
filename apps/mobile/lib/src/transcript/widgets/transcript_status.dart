import 'package:flutter/material.dart';

/// Lifecycle status for a single tool call, reasoning block, or final-answer
/// turn. The set is intentionally closed: any state the protocol surfaces that
/// does not map cleanly onto one of these values must be lowered by the
/// reducer before the widget sees it.
///
/// The five values were chosen so a presenter never has to invent a state:
///   * [running] - the call is in flight on the host.
///   * [completed] - the call returned a successful result.
///   * [error] - the call returned an error envelope.
///   * [cancelled] - the call was cancelled before completing.
///   * [policyDenied] - a host-side policy hook refused the call.
///
/// Tool cards, reasoning blocks, and final-answer turns all expose a status;
/// the [TranscriptStatusLabel] extension centralizes presentation so the UI
/// stays consistent across widget families.
enum TranscriptToolStatus { running, completed, error, cancelled, policyDenied }

/// Shared presentation labels, icons, and colours for [TranscriptToolStatus].
///
/// Centralizing presentation here means a new widget cannot accidentally
/// disagree with the rest of the transcript on how `error` looks. The
/// extension is resolution-aware: it queries the [ColorScheme] only at build
/// time, so widgets remain unit-testable without a [BuildContext].
extension TranscriptStatusPresentation on TranscriptToolStatus {
  /// Human-friendly label. Short, sentence-case, never capitalised beyond the
  /// first word. The label is used both for visible text and for semantic
  /// announcements.
  String get label => switch (this) {
    TranscriptToolStatus.running => 'Running',
    TranscriptToolStatus.completed => 'Completed',
    TranscriptToolStatus.error => 'Error',
    TranscriptToolStatus.cancelled => 'Cancelled',
    TranscriptToolStatus.policyDenied => 'Policy denied',
  };

  /// Long-form semantic label suitable for screen-reader announcement. The
  /// longer phrasing helps users disambiguate "Running" from "Running tool"
  /// in dense transcripts.
  String get semanticLabel => switch (this) {
    TranscriptToolStatus.running => 'Status: running',
    TranscriptToolStatus.completed => 'Status: completed',
    TranscriptToolStatus.error => 'Status: error',
    TranscriptToolStatus.cancelled => 'Status: cancelled',
    TranscriptToolStatus.policyDenied => 'Status: policy denied',
  };

  /// Stable icon for the status. Using a const [IconData] keeps the widget
  /// tree stable across rebuilds, which matters for [RepaintBoundary] caching
  /// in long transcripts.
  IconData get icon => switch (this) {
    TranscriptToolStatus.running => Icons.hourglass_bottom,
    TranscriptToolStatus.completed => Icons.check_circle,
    TranscriptToolStatus.error => Icons.error,
    TranscriptToolStatus.cancelled => Icons.cancel,
    TranscriptToolStatus.policyDenied => Icons.policy,
  };

  /// Resolves the status colour from the active [ColorScheme]. The mapping is
  /// deliberately simple: errors and policy denials both surface as the error
  /// colour so users immediately notice failure states.
  Color resolveColor(ColorScheme scheme) => switch (this) {
    TranscriptToolStatus.running => scheme.primary,
    TranscriptToolStatus.completed => scheme.primary,
    TranscriptToolStatus.error => scheme.error,
    TranscriptToolStatus.cancelled => scheme.outline,
    TranscriptToolStatus.policyDenied => scheme.error,
  };

  /// Returns true when the status indicates the tool is still in flight.
  /// Useful for conditional affordances like the spinner and the
  /// "running" announcement.
  bool get isInFlight => this == TranscriptToolStatus.running;

  /// Returns true when the status indicates a failed call (either an error
  /// or a policy denial). Reasoners and final-answer turns can use this to
  /// decide whether to surface retry affordances.
  bool get isFailure =>
      this == TranscriptToolStatus.error ||
      this == TranscriptToolStatus.policyDenied;
}
