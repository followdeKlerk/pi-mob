import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/domain/session_tree.dart';

void main() {
  test(
    'wire projection distinguishes root, fork, clone and fallback names',
    () {
      final root = SessionTreeNode.fromWire({'sessionId': '12345678-root'});
      final fork = SessionTreeNode.fromWire({
        'sessionId': 'fork',
        'parentSessionId': root.sessionId,
        'lineageType': 'branch',
        'lineageCreatedFrom': 'entry-1',
      });
      final clone = SessionTreeNode.fromWire({
        'sessionId': 'clone',
        'parentSessionId': root.sessionId,
        'lineageType': 'clone',
      });
      expect(root.name, 'Session 12345678');
      expect(fork.lineage, SessionLineageKind.fork);
      expect(fork.forkOriginEntryId, 'entry-1');
      expect(clone.lineage, SessionLineageKind.clone);
    },
  );

  test('tree children paginate and lineage is root to leaf', () {
    final root = const SessionTreeNode(sessionId: 'r', name: 'Root');
    final a = const SessionTreeNode(
      sessionId: 'a',
      name: 'Alpha',
      parentSessionId: 'r',
      lineage: SessionLineageKind.fork,
    );
    final b = const SessionTreeNode(
      sessionId: 'b',
      name: 'Beta',
      parentSessionId: 'a',
      lineage: SessionLineageKind.clone,
    );
    final tree = SessionTreeProjection([root, a, b]);
    expect(tree.childrenOf('r', limit: 1), [a]);
    expect(tree.lineageTo('b').map((node) => node.sessionId), ['r', 'a', 'b']);
  });

  test('eligible fork entries include only real nonempty user entries', () {
    final result = EligibleForkEntry.fromWire([
      {'entryId': 'u1', 'role': 'user', 'text': 'fork here'},
      {'entryId': 'a1', 'role': 'assistant', 'text': 'no'},
      {'entryId': 'u2', 'role': 'user', 'text': '', 'synthetic': false},
      {'entryId': 'u3', 'role': 'user', 'text': 'synthetic', 'synthetic': true},
    ]);
    expect(result.map((entry) => entry.entryId), ['u1']);
  });

  test('soft deleted and delete_failed lifecycle round trip', () {
    final deleted = SessionTreeNode.fromWire({
      'sessionId': 'd',
      'deletionState': 'soft_deleted',
      'purgeAfter': '2026-07-21T00:00:00Z',
    });
    final failed = SessionTreeNode.fromWire({
      'sessionId': 'f',
      'lifecycleState': 'delete_failed',
      'repairReason': 'move failed',
    });
    expect(deleted.canRestore, isTrue);
    expect(failed.lifecycle, SessionLifecycleState.deleteFailed);
    expect(
      SessionTreeNode.fromWire(deleted.toWire()).lifecycle,
      SessionLifecycleState.softDeleted,
    );
  });
}
