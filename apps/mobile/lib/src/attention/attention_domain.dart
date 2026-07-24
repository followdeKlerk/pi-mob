enum AttentionCategory {
  needsInput,
  completed,
  failed,
  interrupted,
  background,
}

AttentionCategory? _category(Object? value) => switch (value) {
  'needs_input' => AttentionCategory.needsInput,
  'completed' => AttentionCategory.completed,
  'failed' => AttentionCategory.failed,
  'interrupted' => AttentionCategory.interrupted,
  'background' => AttentionCategory.background,
  _ => null,
};

final class AttentionItemData {
  const AttentionItemData({
    required this.attentionId,
    required this.sessionId,
    required this.turnId,
    required this.category,
    required this.occurrence,
    required this.summary,
    required this.actionable,
    required this.revision,
    required this.resolved,
    required this.superseded,
    required this.read,
  });

  final String attentionId;
  final String sessionId;
  final String turnId;
  final AttentionCategory category;
  final DateTime occurrence;
  final String summary;
  final bool actionable;
  final String revision;
  final bool resolved;
  final bool superseded;
  final bool read;

  AttentionItemData copyWith({bool? read}) => AttentionItemData(
    attentionId: attentionId,
    sessionId: sessionId,
    turnId: turnId,
    category: category,
    occurrence: occurrence,
    summary: summary,
    actionable: actionable,
    revision: revision,
    resolved: resolved,
    superseded: superseded,
    read: read ?? this.read,
  );

  static AttentionItemData? tryParse(
    Map<String, Object?> payload, {
    bool read = false,
  }) {
    final category = _category(payload['category']);
    final occurrence = DateTime.tryParse(
      payload['occurrence']?.toString() ?? '',
    )?.toUtc();
    final attentionId = payload['attentionId'];
    final sessionId = payload['sessionId'];
    final turnId = payload['turnId'];
    final summary = payload['summary'];
    final revision = payload['revision'];
    final actionable = payload['actionable'];
    final resolved = payload['resolved'];
    final superseded = payload['superseded'];
    if (attentionId is! String ||
        sessionId is! String ||
        turnId is! String ||
        summary is! String ||
        revision is! String ||
        category == null ||
        occurrence == null ||
        actionable is! bool ||
        resolved is! bool ||
        superseded is! bool) {
      return null;
    }
    return AttentionItemData(
      attentionId: attentionId,
      sessionId: sessionId,
      turnId: turnId,
      category: category,
      occurrence: occurrence,
      summary: summary,
      actionable: actionable,
      revision: revision,
      resolved: resolved,
      superseded: superseded,
      read: read,
    );
  }
}

final class AttentionState {
  const AttentionState([this.items = const <String, AttentionItemData>{}]);
  final Map<String, AttentionItemData> items;
  List<AttentionItemData> get visible =>
      items.values
          .where((item) => !item.resolved && !item.superseded)
          .toList(growable: false)
        ..sort((a, b) => b.occurrence.compareTo(a.occurrence));
}

AttentionState reduceAttention(
  AttentionState state,
  Map<String, Object?> payload,
) {
  final parsed = AttentionItemData.tryParse(
    payload,
    read: state.items[payload['attentionId']]?.read ?? false,
  );
  if (parsed == null) return state;
  return AttentionState(<String, AttentionItemData>{
    ...state.items,
    parsed.attentionId: parsed,
  });
}
