import 'mobile_state.dart';

final class ModelOption {
  const ModelOption({
    required this.id,
    required this.label,
    this.provider,
    this.available = true,
  });
  final String id;
  final String label;
  final String? provider;
  final bool available;

  factory ModelOption.fromJson(Map<String, Object?> json) {
    final id = (json['id'] ?? json['modelId'] ?? '').toString();
    return ModelOption(
      id: id,
      label: (json['label'] ?? json['name'] ?? id).toString(),
      provider: json['provider'] as String?,
      available: json['available'] != false,
    );
  }
}

enum RetryPhase { idle, waiting, running, completed, failed, aborted }

enum CompactionPhase { idle, running, completed, failed, aborted }

final class SessionControlState {
  const SessionControlState({
    required this.sessionId,
    this.modelId,
    this.modelUnavailable = false,
    this.thinkingLevel,
    this.inputTokens,
    this.outputTokens,
    this.contextTokens,
    this.contextWindow,
    this.cost,
    this.retryPhase = RetryPhase.idle,
    this.retryAttempt,
    this.retryMaxAttempts,
    this.retryDelayMs,
    this.autoRetryEnabled,
    this.compactionPhase = CompactionPhase.idle,
    this.autoCompactionEnabled,
    this.compactionSummary,
    this.steeringEnabled,
    this.followUpEnabled,
    this.commands = const <DiscoveredCommand>[],
  });

  final String sessionId;
  final String? modelId;
  final bool modelUnavailable;
  final String? thinkingLevel;
  final int? inputTokens;
  final int? outputTokens;
  final int? contextTokens;
  final int? contextWindow;
  final double? cost;
  final RetryPhase retryPhase;
  final int? retryAttempt;
  final int? retryMaxAttempts;
  final int? retryDelayMs;
  final bool? autoRetryEnabled;
  final CompactionPhase compactionPhase;
  final bool? autoCompactionEnabled;
  final String? compactionSummary;
  final bool? steeringEnabled;
  final bool? followUpEnabled;
  final List<DiscoveredCommand> commands;

  factory SessionControlState.empty(String id) =>
      SessionControlState(sessionId: id);

  SessionControlState apply(String type, Map<String, Object?> payload) {
    RetryPhase retry(String? value) => switch (value) {
      'waiting' => RetryPhase.waiting,
      'running' => RetryPhase.running,
      'completed' => RetryPhase.completed,
      'failed' => RetryPhase.failed,
      'aborted' => RetryPhase.aborted,
      _ => retryPhase,
    };
    CompactionPhase compaction(String? value) => switch (value) {
      'running' => CompactionPhase.running,
      'completed' => CompactionPhase.completed,
      'failed' => CompactionPhase.failed,
      'aborted' => CompactionPhase.aborted,
      _ => compactionPhase,
    };
    final rawCommands = payload['commandCatalogue'];
    final nextCommands = rawCommands is List
        ? rawCommands
              .whereType<Map>()
              .map((raw) {
                final item = Map<String, Object?>.from(raw);
                return DiscoveredCommand(
                  name: item['name']?.toString() ?? '',
                  category: item['category']?.toString() ?? 'extension',
                  description: item['description'] as String?,
                  requiresInput: item['requiresInput'] == true,
                );
              })
              .where((item) => item.name.isNotEmpty)
              .toList(growable: false)
        : commands;
    return SessionControlState(
      sessionId: sessionId,
      modelId: payload['modelId']?.toString() ?? modelId,
      modelUnavailable:
          payload['modelUnavailable'] as bool? ?? modelUnavailable,
      thinkingLevel: payload['thinkingLevel']?.toString() ?? thinkingLevel,
      inputTokens: payload['inputTokens'] as int? ?? inputTokens,
      outputTokens: payload['outputTokens'] as int? ?? outputTokens,
      contextTokens:
          payload['contextTokens'] as int? ??
          payload['tokens'] as int? ??
          contextTokens,
      contextWindow: payload['contextWindow'] as int? ?? contextWindow,
      cost: (payload['cost'] as num?)?.toDouble() ?? cost,
      retryPhase: type == 'retry.state'
          ? retry(payload['state'] as String?)
          : retryPhase,
      retryAttempt: payload['attempt'] as int? ?? retryAttempt,
      retryMaxAttempts: payload['maxAttempts'] as int? ?? retryMaxAttempts,
      retryDelayMs: payload['delayMs'] as int? ?? retryDelayMs,
      autoRetryEnabled: payload['autoEnabled'] as bool? ?? autoRetryEnabled,
      compactionPhase: type == 'compaction.state'
          ? compaction(payload['state'] as String?)
          : compactionPhase,
      autoCompactionEnabled:
          payload['autoCompactionEnabled'] as bool? ??
          payload['autoEnabled'] as bool? ??
          autoCompactionEnabled,
      compactionSummary: payload['summary']?.toString() ?? compactionSummary,
      steeringEnabled: payload['steeringEnabled'] as bool? ?? steeringEnabled,
      followUpEnabled: payload['followUpEnabled'] as bool? ?? followUpEnabled,
      commands: nextCommands,
    );
  }

  double? get contextFraction =>
      contextTokens == null || contextWindow == null || contextWindow == 0
      ? null
      : contextTokens! / contextWindow!;
}

final class DiscoveredCommand {
  const DiscoveredCommand({
    required this.name,
    required this.category,
    this.description,
    this.requiresInput = false,
  });
  final String name;
  final String category;
  final String? description;
  final bool requiresInput;
}

extension SessionControlLookup on Map<String, SessionControlState> {
  SessionControlState forSession(SessionState session) =>
      this[session.sessionId] ?? SessionControlState.empty(session.sessionId);
}
