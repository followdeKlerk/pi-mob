import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pi_mob/src/domain/mobile_state.dart';
import 'package:pi_mob/src/session_events/canonical_projection.dart';
import 'package:pi_mob/src/session_events/transcript_reducer.dart';

StreamEventState _journalEvent({
  required int cursor,
  required String type,
  required Map<String, Object?> payload,
  String eventId = 'ev',
  String streamId = 'session:s1',
}) => StreamEventState(
  hostId: 'host',
  streamId: streamId,
  cursor: StreamCursor.parse('$cursor'),
  eventId: '$eventId-$cursor',
  type: type,
  payload: payload,
  occurredAt: DateTime.utc(2026, 7, 14, 12, 0, cursor),
);

void main() {
  late Directory tempDir;

  setUp(() {
    tempDir = Directory.systemTemp.createTempSync('canonical-projection-');
  });

  tearDown(() {
    if (tempDir.existsSync()) tempDir.deleteSync(recursive: true);
  });

  test(
    'live delivery, cold start, and cache reset all rebuild the same state',
    () async {
      final factory = CanonicalProjectionFactory(
        baseDirectoryOverride: tempDir,
      );
      final bootstrap = <StreamEventState>[
        _journalEvent(
          cursor: 1,
          type: 'turn.started',
          payload: <String, Object?>{'turnIndex': 1, 'message': 'Hi'},
        ),
        _journalEvent(
          cursor: 2,
          type: 'assistant.started',
          payload: <String, Object?>{'contentBlockId': 'a1', 'turnIndex': 1},
        ),
        _journalEvent(
          cursor: 3,
          type: 'assistant.delta',
          payload: <String, Object?>{'contentBlockId': 'a1', 'text': 'hello '},
        ),
        _journalEvent(
          cursor: 4,
          type: 'assistant.delta',
          payload: <String, Object?>{'contentBlockId': 'a1', 'text': 'world'},
        ),
        _journalEvent(
          cursor: 5,
          type: 'assistant.completed',
          payload: <String, Object?>{'contentBlockId': 'a1', 'turnIndex': 1},
        ),
        _journalEvent(
          cursor: 6,
          type: 'turn.settled',
          payload: <String, Object?>{'turnIndex': 1},
        ),
        _journalEvent(
          cursor: 7,
          type: 'tool.started',
          payload: <String, Object?>{
            'toolCallId': 'read-1',
            'toolName': 'read',
            'turnIndex': 1,
            'arguments': <String, Object?>{'path': '/tmp/x'},
          },
        ),
        _journalEvent(
          cursor: 8,
          type: 'tool.completed',
          payload: <String, Object?>{
            'toolCallId': 'read-1',
            'toolName': 'read',
            'result': <String, Object?>{'content': 'done'},
          },
        ),
      ];

      // 1. Live path: open and bootstrap.
      final live = await factory.openForSession(
        sessionId: 's1',
        bootstrap: bootstrap,
      );
      final liveState = live.synchronizer.state;

      // 2. Cold-start path: open a new projection; the cache must replay
      //    from disk and produce the same state.
      final cold = await factory.openForSession(sessionId: 's1');
      final coldState = cold.synchronizer.state;

      expect(coldState.lastAppliedSequence, liveState.lastAppliedSequence);
      expect(coldState.assistantMessages, equals(liveState.assistantMessages));
      expect(coldState.toolCalls.keys, equals(liveState.toolCalls.keys));
      expect(coldState.toolCalls['read-1']!.toolCallId, 'read-1');
      expect(coldState.toolCalls['read-1']!.result, isNotNull);
      expect(coldState.toolCalls['read-1']!.isTerminal, isTrue);
      expect(coldState.turnStatuses, equals(liveState.turnStatuses));
      expect(coldState.diagnostics, equals(liveState.diagnostics));
      expect(cold.synchronizer.lastAppliedSequence, 8);

      // 3. Cache-clear path: open, reset the cache, re-bootstrap, and
      //    confirm the projection still matches.
      await cold.repository.resetCache();
      final cleared = await factory.openForSession(
        sessionId: 's1',
        bootstrap: bootstrap,
      );
      final clearedState = cleared.synchronizer.state;
      expect(clearedState.lastAppliedSequence, liveState.lastAppliedSequence);
      expect(
        clearedState.assistantMessages,
        equals(liveState.assistantMessages),
      );
      expect(clearedState.toolCalls.keys, equals(liveState.toolCalls.keys));
      expect(clearedState.toolCalls['read-1']!.toolCallId, 'read-1');
      expect(clearedState.toolCalls['read-1']!.result, isNotNull);
      expect(clearedState.toolCalls['read-1']!.isTerminal, isTrue);
      expect(clearedState.turnStatuses, equals(liveState.turnStatuses));
      expect(clearedState.diagnostics, equals(liveState.diagnostics));

      // 4. Verify the on-disk cache exists for the next cold start.
      final cacheFile = File(p.join(tempDir.path, 'canonical-s1.sqlite'));
      expect(cacheFile.existsSync(), isTrue);

      // 5. Verify the canonical reducer never produced a terminal-but-
      //    regressed entity (assistant content is final, tool is final,
      //    turn is completed).
      expect(
        coldState.assistantMessages['a1']!.content.single.text,
        'hello world',
      );
      expect(coldState.assistantMessages['a1']!.isTerminal, isTrue);
      expect(coldState.toolCalls['read-1']!.isTerminal, isTrue);
      expect(coldState.toolCalls['read-1']!.isError, isFalse);
      expect(coldState.turnStatuses['1'], equals(TurnStatus.completed));

      await live.close();
      await cold.close();
      await cleared.close();
    },
  );

  test('canonical projection tolerates out-of-order bootstraps', () async {
    final factory = CanonicalProjectionFactory(baseDirectoryOverride: tempDir);
    // Bootstrap supplies events out of canonical order: the
    // synchronizer must pause on the first gap and the cache must
    // still produce a recoverable projection after reset.
    final journal = <StreamEventState>[
      _journalEvent(
        cursor: 2,
        type: 'assistant.started',
        streamId: 'session:s2',
        payload: <String, Object?>{'contentBlockId': 'a1', 'turnIndex': 1},
      ),
      _journalEvent(
        cursor: 1,
        type: 'turn.started',
        streamId: 'session:s2',
        payload: <String, Object?>{'turnIndex': 1, 'message': 'Hi'},
      ),
    ];
    final projection = await factory.openForSession(
      sessionId: 's2',
      bootstrap: journal,
    );
    expect(projection.synchronizer.lastAppliedSequence, 1);

    // After a reset, supplying the canonical-ordered sequence
    // produces the full projection.
    await projection.repository.resetCache();
    final reordered = <StreamEventState>[
      _journalEvent(
        cursor: 1,
        type: 'turn.started',
        streamId: 'session:s2',
        payload: <String, Object?>{'turnIndex': 1, 'message': 'Hi'},
      ),
      _journalEvent(
        cursor: 2,
        type: 'assistant.started',
        streamId: 'session:s2',
        payload: <String, Object?>{'contentBlockId': 'a1', 'turnIndex': 1},
      ),
      _journalEvent(
        cursor: 3,
        type: 'assistant.completed',
        streamId: 'session:s2',
        payload: <String, Object?>{'contentBlockId': 'a1', 'turnIndex': 1},
      ),
    ];
    final projection2 = await factory.openForSession(
      sessionId: 's2',
      bootstrap: reordered,
    );
    expect(projection2.synchronizer.lastAppliedSequence, 3);
    expect(projection2.synchronizer.state.assistantMessages, hasLength(1));
    expect(
      projection2.synchronizer.state.assistantMessages['a1']!.isTerminal,
      isTrue,
    );
    await projection.close();
    await projection2.close();
  });
}
