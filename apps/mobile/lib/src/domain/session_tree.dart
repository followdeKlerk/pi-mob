import 'package:flutter/foundation.dart';

enum SessionLineageKind { root, fork, clone }

enum SessionLifecycleState { active, softDeleted, deleteFailed, purged }

@immutable
class SessionTreeNode {
  const SessionTreeNode({
    required this.sessionId,
    required this.name,
    this.parentSessionId,
    this.forkOriginEntryId,
    this.lineage = SessionLineageKind.root,
    this.lifecycle = SessionLifecycleState.active,
    this.deletedAt,
    this.purgeAfter,
    this.repairReason,
  });

  final String sessionId;
  final String name;
  final String? parentSessionId;
  final String? forkOriginEntryId;
  final SessionLineageKind lineage;
  final SessionLifecycleState lifecycle;
  final DateTime? deletedAt;
  final DateTime? purgeAfter;
  final String? repairReason;

  factory SessionTreeNode.fromWire(Map<String, Object?> wire) {
    final id = wire['sessionId'] as String? ?? '';
    final explicit = (wire['name'] as String?)?.trim();
    final lineageWire = wire['lineageType'];
    final lifecycleWire = wire['lifecycleState'] ?? wire['deletionState'];
    return SessionTreeNode(
      sessionId: id,
      name: explicit == null || explicit.isEmpty
          ? 'Session ${id.substring(0, id.length < 8 ? id.length : 8)}'
          : explicit,
      parentSessionId: wire['parentSessionId'] as String?,
      forkOriginEntryId:
          (wire['forkOriginEntryId'] ?? wire['lineageCreatedFrom']) as String?,
      lineage: lineageWire == 'clone'
          ? SessionLineageKind.clone
          : (lineageWire == 'branch' || lineageWire == 'fork')
          ? SessionLineageKind.fork
          : SessionLineageKind.root,
      lifecycle: lifecycleWire == 'purged'
          ? SessionLifecycleState.purged
          : lifecycleWire == 'delete_failed'
          ? SessionLifecycleState.deleteFailed
          : lifecycleWire == 'soft_deleted'
          ? SessionLifecycleState.softDeleted
          : SessionLifecycleState.active,
      deletedAt: DateTime.tryParse(wire['deletedAt'] as String? ?? ''),
      purgeAfter: DateTime.tryParse(wire['purgeAfter'] as String? ?? ''),
      repairReason: wire['repairReason'] as String?,
    );
  }

  Map<String, Object?> toWire() => {
    'sessionId': sessionId,
    'name': name,
    'parentSessionId': parentSessionId,
    'forkOriginEntryId': forkOriginEntryId,
    'lineageType': lineage.name,
    'lifecycleState': switch (lifecycle) {
      SessionLifecycleState.softDeleted => 'soft_deleted',
      SessionLifecycleState.deleteFailed => 'delete_failed',
      _ => lifecycle.name,
    },
    'deletedAt': deletedAt?.toUtc().toIso8601String(),
    'purgeAfter': purgeAfter?.toUtc().toIso8601String(),
    'repairReason': repairReason,
  };

  bool get canRestore =>
      lifecycle == SessionLifecycleState.softDeleted && purgeAfter != null;
}

class SessionTreeProjection {
  SessionTreeProjection([Iterable<SessionTreeNode> nodes = const []]) {
    for (final node in nodes) {
      upsert(node);
    }
  }

  final Map<String, SessionTreeNode> _nodes = {};
  Iterable<SessionTreeNode> get nodes => _nodes.values;
  SessionTreeNode? operator [](String id) => _nodes[id];

  void upsert(SessionTreeNode node) => _nodes[node.sessionId] = node;
  void remove(String id) => _nodes.remove(id);

  List<SessionTreeNode> childrenOf(
    String? parentSessionId, {
    int offset = 0,
    int limit = 50,
  }) {
    final children =
        _nodes.values
            .where(
              (node) =>
                  node.parentSessionId == parentSessionId &&
                  node.lifecycle != SessionLifecycleState.purged,
            )
            .toList()
          ..sort(
            (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
          );
    if (offset >= children.length) return const [];
    return children.sublist(offset, (offset + limit).clamp(0, children.length));
  }

  List<SessionTreeNode> lineageTo(String id) {
    final result = <SessionTreeNode>[];
    final seen = <String>{};
    var current = _nodes[id];
    while (current != null && seen.add(current.sessionId)) {
      result.add(current);
      current = current.parentSessionId == null
          ? null
          : _nodes[current.parentSessionId!];
    }
    return result.reversed.toList(growable: false);
  }
}

@immutable
class EligibleForkEntry {
  const EligibleForkEntry({required this.entryId, required this.preview});
  final String entryId;
  final String preview;

  static List<EligibleForkEntry> fromWire(
    Iterable<Map<String, Object?>> entries,
  ) => entries
      .where(
        (entry) =>
            entry['role'] == 'user' &&
            entry['synthetic'] != true &&
            entry['entryId'] is String,
      )
      .map(
        (entry) => EligibleForkEntry(
          entryId: entry['entryId']! as String,
          preview: (entry['text'] as String? ?? '').trim(),
        ),
      )
      .where((entry) => entry.preview.isNotEmpty)
      .toList(growable: false);
}
