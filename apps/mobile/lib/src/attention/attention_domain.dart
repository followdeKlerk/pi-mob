/// Durable attention projection for the mobile control surface.
///
/// The bridge emits `attention.item` events when the host records that
/// something genuinely needs the user's attention (a turn that needs input,
/// a background completion, a turn that was interrupted, a turn that
/// failed). Each event carries the durable `attentionId`, the
/// `expectedRevision` the user must echo when resolving, and the closed
/// `category` union the bridge owns.
///
/// The mobile reducer is pure and replay-friendly: applying the same
/// event twice produces the same [AttentionState]. The local "read" flag
/// is mobile-authoritative (per docs/REMAINING_UX_PLAN.md §5 R12) and
/// lives outside the wire payload; it never masquerades as host truth.
library;

/// Closed attention category vocabulary the bridge owns. The wire-side
/// `category` string is validated against this set so the mobile UI can
/// render a closed grammar without inventing labels.
enum AttentionCategory {
  needsInput,
  completed,
  failed,
  interrupted,
  background,
}

const Map<String, AttentionCategory> _wireCategory =
    <String, AttentionCategory>{
      'needs_input': AttentionCategory.needsInput,
      'completed': AttentionCategory.completed,
      'failed': AttentionCategory.failed,
      'interrupted': AttentionCategory.interrupted,
      'background': AttentionCategory.background,
    };

const Set<String> _allCategories = <String>{
  'needs_input',
  'completed',
  'failed',
  'interrupted',
  'background',
};

bool isAttentionCategoryString(String value) => _allCategories.contains(value);

/// One durable attention item as last seen by the wire. `read` is the only
/// mobile-authoritative field; everything else comes verbatim from the
/// `attention.item` event.
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

  /// Mobile-authoritative read marker. Survives reconnects because the
  /// `AppDatabase` persists it keyed by `attentionId`.
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

  /// Lower a wire payload into an [AttentionItemData]. Returns null when
  /// any required field is missing or the wire category is not a closed
  /// [AttentionCategory]. The caller is expected to persist `read` in the
  /// DB before returning the parsed value so re-renders see the durable
  /// marker.
  static AttentionItemData? tryParse(
    Map<String, Object?> payload, {
    bool read = false,
  }) {
    final categoryValue = payload['category'];
    if (categoryValue is! String) return null;
    final category = _wireCategory[categoryValue];
    if (category == null) return null;
    final occurrenceRaw = payload['occurrence']?.toString();
    if (occurrenceRaw == null || occurrenceRaw.isEmpty) return null;
    final occurrence = DateTime.tryParse(occurrenceRaw)?.toUtc();
    if (occurrence == null) return null;

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

  /// Stable wire view, used by the protocol fixture when generating or
  /// validating payloads. The mirror of [tryParse] is intentional so a
  /// round-trip preserves the wire grammar.
  Map<String, Object?> toWire() => <String, Object?>{
    'attentionId': attentionId,
    'sessionId': sessionId,
    'turnId': turnId,
    'category': _wireCategory.entries
        .firstWhere((entry) => entry.value == category)
        .key,
    'occurrence': occurrence.toUtc().toIso8601String(),
    'summary': summary,
    'actionable': actionable,
    'revision': revision,
    'resolved': resolved,
    'superseded': superseded,
  };
}

/// The whole-session attention projection. The reducer produces a new
/// state on every wire event so the mobile UI can rebuild on reconnect
/// without retaining in-memory state.
final class AttentionState {
  const AttentionState([this.items = const <String, AttentionItemData>{}]);

  final Map<String, AttentionItemData> items;

  /// Attention items the user has not yet resolved or that the host has
  /// not superseded, sorted most-recent first.
  List<AttentionItemData> get visible {
    final list = items.values
        .where((item) => !item.resolved && !item.superseded)
        .toList(growable: false);
    list.sort((a, b) => b.occurrence.compareTo(a.occurrence));
    return list;
  }
}

/// Pure reducer. Applies a single wire `attention.item` payload to
/// [state] and preserves the mobile-authoritative `read` marker from the
/// existing projection. Unknown wire shapes are passed through unchanged.
AttentionState reduceAttention(
  AttentionState state,
  Map<String, Object?> payload,
) {
  final existingRead =
      state
          .items[payload['attentionId'] is String
              ? payload['attentionId'] as String
              : null]
          ?.read ??
      false;
  final parsed = AttentionItemData.tryParse(payload, read: existingRead);
  if (parsed == null) return state;
  return AttentionState(<String, AttentionItemData>{
    ...state.items,
    parsed.attentionId: parsed,
  });
}
