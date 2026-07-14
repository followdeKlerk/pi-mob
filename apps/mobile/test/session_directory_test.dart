import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/domain/session_directory.dart';

SessionSummary _row(
  String id, {
  String name = 'Session',
  String runtime = 'idle',
  SessionAttentionState attention = SessionAttentionState.none,
  String controller = 'observer',
  int queue = 0,
  int unread = 0,
  DateTime? lastActivity,
}) => SessionSummary(
  sessionId: id,
  name: name,
  runtimeState: runtime,
  workspaceId: 'w1',
  attention: attention,
  controllerMode: controller,
  queueDepth: queue,
  unreadCount: unread,
  lastActivityAt: lastActivity,
);

void main() {
  group('SessionFilter', () {
    test('equality and hashCode are structural', () {
      const a = SessionFilter(query: 'foo', runtimeStates: {'idle'});
      const b = SessionFilter(query: 'foo', runtimeStates: {'idle'});
      expect(a, equals(b));
      expect(a.hashCode, equals(b.hashCode));
    });

    test('isEmpty when no facets set', () {
      expect(const SessionFilter().isEmpty, isTrue);
      expect(const SessionFilter(query: 'x').isEmpty, isFalse);
    });
  });

  group('SessionDirectory', () {
    final now = DateTime.utc(2026, 1, 1);
    final later = now.add(const Duration(hours: 1));
    final rows = <SessionSummary>[
      _row(
        'a',
        name: 'alpha',
        runtime: 'running',
        attention: SessionAttentionState.unread,
        unread: 3,
        lastActivity: later,
      ),
      _row(
        'b',
        name: 'beta',
        runtime: 'idle',
        attention: SessionAttentionState.needsAttention,
        lastActivity: now,
      ),
      _row(
        'c',
        name: 'gamma',
        runtime: 'stopped',
        controller: 'controller',
        lastActivity: now.subtract(const Duration(hours: 1)),
      ),
      _row(
        'd',
        name: 'alphabet',
        runtime: 'idle',
        attention: SessionAttentionState.background,
      ),
    ];

    test('pages results with a stable nextCursor', () {
      final directory = SessionDirectory.fromSummaries(
        rows,
        pageSize: 2,
        pageOffset: 0,
      );
      final first = directory.page();
      expect(first.rows, hasLength(2));
      expect(first.nextCursor, isNotNull);
      final second = directory.withPage(2).page();
      expect(second.rows, hasLength(2));
      expect(second.nextCursor, isNull);
    });

    test('search filter matches name and runtime case-insensitively', () {
      final directory = SessionDirectory.fromSummaries(
        rows,
        filter: const SessionFilter(query: 'ALPHA'),
      );
      expect(directory.totalFiltered, 2);
      expect(
        directory.sorted.map((row) => row.sessionId),
        unorderedEquals(<String>['a', 'd']),
      );
    });

    test('runtime filter constrains the result set', () {
      final directory = SessionDirectory.fromSummaries(
        rows,
        filter: const SessionFilter(runtimeStates: {'idle'}),
      );
      expect(
        directory.sorted.map((row) => row.sessionId),
        unorderedEquals(<String>['b', 'd']),
      );
    });

    test('attention filter excludes cleared sessions', () {
      final directory = SessionDirectory.fromSummaries(
        rows,
        filter: const SessionFilter(
          attentionStates: {SessionAttentionState.unread},
        ),
      );
      expect(directory.totalFiltered, 1);
      expect(directory.sorted.single.sessionId, 'a');
    });

    test('controller filter exposes only primary sessions', () {
      final directory = SessionDirectory.fromSummaries(
        rows,
        filter: const SessionFilter(controllerModes: {'controller'}),
      );
      expect(directory.totalFiltered, 1);
      expect(directory.sorted.single.sessionId, 'c');
    });

    test('sort by name is case-insensitive and stable', () {
      final directory = SessionDirectory.fromSummaries(
        rows,
        sort: SessionSort.name,
      );
      expect(directory.sorted.map((row) => row.name), <String>[
        'alpha',
        'alphabet',
        'beta',
        'gamma',
      ]);
    });

    test('sort by last activity places nulls last', () {
      final directory = SessionDirectory.fromSummaries([
        _row('a', lastActivity: now),
        _row('b'),
        _row('c', lastActivity: later),
      ], sort: SessionSort.lastActivity);
      expect(directory.sorted.map((row) => row.sessionId), <String>[
        'c',
        'a',
        'b',
      ]);
    });

    test('sort by attention groups badged sessions first', () {
      final directory = SessionDirectory.fromSummaries([
        _row('a', attention: SessionAttentionState.none),
        _row('b', attention: SessionAttentionState.needsAttention),
        _row('c', attention: SessionAttentionState.unread),
      ], sort: SessionSort.attention);
      expect(
        directory.sorted.map((row) => row.attention),
        <SessionAttentionState>[
          SessionAttentionState.needsAttention,
          SessionAttentionState.unread,
          SessionAttentionState.none,
        ],
      );
    });

    test('changing filter resets the page offset to zero', () {
      final directory = SessionDirectory.fromSummaries(
        rows,
        pageSize: 2,
        pageOffset: 2,
      );
      final reset = directory.withFilter(const SessionFilter(query: 'x'));
      expect(reset.pageOffset, 0);
      expect(reset.page().rows, hasLength(lessThanOrEqualTo(2)));
    });
  });

  group('SessionAttentionState', () {
    test('wire round-trip is stable for all known states', () {
      for (final state in SessionAttentionState.values) {
        expect(sessionAttentionFromWire(sessionAttentionWire(state)), state);
      }
    });

    test('unknown wire values collapse to none', () {
      expect(sessionAttentionFromWire(null), SessionAttentionState.none);
      expect(sessionAttentionFromWire('mystery'), SessionAttentionState.none);
      expect(sessionAttentionFromWire(42), SessionAttentionState.none);
    });
  });
}
