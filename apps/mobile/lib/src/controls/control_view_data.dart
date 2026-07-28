import 'package:flutter/foundation.dart';

/// Host-configured model exposed to the mobile control surface.
@immutable
class ModelOptionData {
  const ModelOptionData({
    required this.id,
    required this.label,
    required this.provider,
    this.thinkingLevels = const <String>[],
  });

  final String id;
  final String label;
  final String provider;
  final List<String> thinkingLevels;
}

/// Coordinator-free state for model and thinking selection.
@immutable
class ModelThinkingViewData {
  const ModelThinkingViewData({
    required this.models,
    this.selectedModelId,
    this.selectedThinkingLevel,
    this.unavailableRestoredModel,
    this.enabled = true,
    this.disabledReason,
  });

  final List<ModelOptionData> models;
  final String? selectedModelId;
  final String? selectedThinkingLevel;

  /// Display name from restored Pi state when that model is no longer in the
  /// configured host model list. It is deliberately not treated as selected.
  final String? unavailableRestoredModel;
  final bool enabled;
  final String? disabledReason;

  ModelOptionData? get selectedModel {
    for (final model in models) {
      if (model.id == selectedModelId) return model;
    }
    return null;
  }
}

@immutable
class ModelThinkingCallbacks {
  const ModelThinkingCallbacks({this.onModelSelected, this.onThinkingSelected});

  final ValueChanged<String>? onModelSelected;
  final ValueChanged<String>? onThinkingSelected;
}

/// Advisory session statistics. Null means the host did not report the value;
/// it never means zero.
@immutable
class ContextStatsViewData {
  const ContextStatsViewData({
    this.sessionTokens,
    this.contextTokens,
    this.contextWindowTokens,
    this.costUsd,
  });

  final int? sessionTokens;
  final int? contextTokens;
  final int? contextWindowTokens;
  final double? costUsd;

  double? get contextFraction {
    final used = contextTokens;
    final window = contextWindowTokens;
    if (used == null || window == null || window <= 0) return null;
    return (used / window).clamp(0.0, 1.0);
  }

  String get advisory {
    final fraction = contextFraction;
    if (fraction == null) return 'Context estimate unavailable';
    if (fraction >= 0.9) {
      return 'Context nearly full; compaction may occur soon';
    }
    if (fraction >= 0.75) return 'Context usage is high';
    return 'Context usage is within the advisory range';
  }
}

enum RetryPhase { idle, scheduled, retrying, aborting, unavailable }

@immutable
class RetryViewData {
  const RetryViewData({
    required this.phase,
    this.autoRetry,
    this.remaining,
    this.attempt,
    this.maximumAttempts,
    this.failureMessage,
  });

  final RetryPhase phase;
  final bool? autoRetry;
  final Duration? remaining;
  final int? attempt;
  final int? maximumAttempts;
  final String? failureMessage;

  bool get canAbort =>
      phase == RetryPhase.scheduled || phase == RetryPhase.retrying;
}

@immutable
class RetryCallbacks {
  const RetryCallbacks({this.onAutoRetryChanged, this.onAbort});

  final ValueChanged<bool>? onAutoRetryChanged;
  final VoidCallback? onAbort;
}

enum CompactionPhase {
  idle,
  compacting,
  summarizing,
  completed,
  failed,
  unavailable,
}

@immutable
class CompactionViewData {
  const CompactionViewData({
    required this.phase,
    this.autoCompact,
    this.summary,
    this.message,
    this.canStart = true,
  });

  final CompactionPhase phase;
  final bool? autoCompact;
  final String? summary;
  final String? message;
  final bool canStart;
}

@immutable
class CompactionCallbacks {
  const CompactionCallbacks({this.onAutoCompactChanged, this.onStart});

  final ValueChanged<bool>? onAutoCompactChanged;
  final VoidCallback? onStart;
}

enum SupportedCommandCategory { skill, template, extension, mcpServer, mcpTool }

@immutable
class SupportedCommandData {
  const SupportedCommandData({
    required this.id,
    required this.title,
    required this.category,
    this.description,
    this.invocation,
    this.enabled = true,
    this.disabledReason,
    this.unavailableNote,
    this.togglingDisabled = false,
    this.requiresReloadAfterToggle = false,
  });

  final String id;
  final String title;
  final SupportedCommandCategory category;
  final String? description;
  final String? invocation;
  final bool enabled;
  final String? disabledReason;

  /// Host-authoritative availability copy. This takes precedence over the
  /// legacy [disabledReason] so older callers remain source-compatible while
  /// catalogue entries can explain why the host marked them unavailable.
  final String? unavailableNote;

  /// The entry is visible but host configuration does not permit a mobile
  /// toggle for it.
  final bool togglingDisabled;

  /// A host configuration change for this entry only takes effect after Pi
  /// reloads its catalogue.
  final bool requiresReloadAfterToggle;
}
