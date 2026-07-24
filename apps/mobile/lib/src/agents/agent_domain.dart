final class AgentRecordData {
  const AgentRecordData({
    required this.agentId,
    required this.task,
    required this.state,
    required this.originSessionId,
    required this.originTurnId,
    required this.supportedActions,
    required this.revision,
    this.model,
    this.latestActivity,
    this.completionSummary,
    this.worktreeRef,
  });
  final String agentId;
  final String task;
  final String state;
  final String originSessionId;
  final String originTurnId;
  final Set<String> supportedActions;
  final String revision;
  final String? model;
  final String? latestActivity;
  final String? completionSummary;
  final String? worktreeRef;

  static AgentRecordData? tryParse(Map<String, Object?> value) {
    final actions = value['supportedActions'];
    if (value['agentId'] is! String ||
        value['task'] is! String ||
        value['state'] is! String ||
        value['originSessionId'] is! String ||
        value['originTurnId'] is! String ||
        value['revision'] is! String ||
        actions is! List)
      return null;
    return AgentRecordData(
      agentId: value['agentId'] as String,
      task: value['task'] as String,
      state: value['state'] as String,
      originSessionId: value['originSessionId'] as String,
      originTurnId: value['originTurnId'] as String,
      supportedActions: actions.whereType<String>().toSet(),
      revision: value['revision'] as String,
      model: value['model'] as String?,
      latestActivity: value['latestActivity'] as String?,
      completionSummary: value['completionSummary'] as String?,
      worktreeRef: value['worktreeRef'] as String?,
    );
  }
}

final class AgentSupervisionState {
  const AgentSupervisionState({
    this.items = const <AgentRecordData>[],
    this.unavailableReason,
    this.refreshing = false,
  });
  final List<AgentRecordData> items;
  final String? unavailableReason;
  final bool refreshing;
}

AgentSupervisionState reduceAgents(
  AgentSupervisionState state,
  String type,
  Map<String, Object?> payload,
) {
  if (type == 'agent.unavailable') {
    final status = payload['status'];
    return AgentSupervisionState(
      unavailableReason: status is Map
          ? status['reason']?.toString() ?? 'Agent supervision unavailable'
          : 'Agent supervision unavailable',
    );
  }
  final raw = payload['items'];
  if (raw is! List) return state;
  return AgentSupervisionState(
    items: raw
        .whereType<Map>()
        .map(
          (item) => AgentRecordData.tryParse(Map<String, Object?>.from(item)),
        )
        .whereType<AgentRecordData>()
        .toList(growable: false),
  );
}
