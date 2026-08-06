import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/session_events/canonical_event.dart';
import 'package:pi_mob/src/session_events/canonical_session_manager.dart';
import 'package:pi_mob/src/session_events/canonical_transcript_document.dart';
import 'package:pi_mob/src/transcript/domain/transcript_turn.dart';

Future<CanonicalSessionManager> _buildManager(String sessionId) async {
  final dir = await Directory.systemTemp.createTemp('canonical-widget-');
  final manager = CanonicalSessionManager(baseDirectoryOverride: dir);
  await manager.updateCapabilities(advertised: true, hostGeneration: 'gen-1');
  await manager.ingestWireEvents(sessionId, <CanonicalSessionEvent>[
    CanonicalSessionEvent(
      eventId: '00000000-0000-4000-8000-000000000001',
      sessionId: sessionId,
      sequence: 1,
      type: CanonicalEventType.userMessageCreated,
      occurredAt: DateTime.utc(2026, 8, 14, 12),
      payload: <String, Object?>{
        'turnId': 'turn-1',
        'messageId': 'msg-1',
        'text': 'Hello there',
      },
    ),
    CanonicalSessionEvent(
      eventId: '00000000-0000-4000-8000-000000000002',
      sessionId: sessionId,
      sequence: 2,
      type: CanonicalEventType.assistantStarted,
      occurredAt: DateTime.utc(2026, 8, 14, 12, 1),
      payload: <String, Object?>{'turnId': 'turn-1', 'messageId': 'asst-1'},
    ),
    CanonicalSessionEvent(
      eventId: '00000000-0000-4000-8000-000000000003',
      sessionId: sessionId,
      sequence: 3,
      type: CanonicalEventType.assistantContentReplaced,
      occurredAt: DateTime.utc(2026, 8, 14, 12, 2),
      payload: <String, Object?>{
        'turnId': 'turn-1',
        'messageId': 'asst-1',
        'content': <Map<String, Object?>>[
          <String, Object?>{'kind': 'text', 'text': 'Hi '},
        ],
      },
    ),
    CanonicalSessionEvent(
      eventId: '00000000-0000-4000-8000-000000000004',
      sessionId: sessionId,
      sequence: 4,
      type: CanonicalEventType.assistantContentReplaced,
      occurredAt: DateTime.utc(2026, 8, 14, 12, 3),
      payload: <String, Object?>{
        'turnId': 'turn-1',
        'messageId': 'asst-1',
        'content': <Map<String, Object?>>[
          <String, Object?>{'kind': 'text', 'text': 'Hi there'},
        ],
      },
    ),
    CanonicalSessionEvent(
      eventId: '00000000-0000-4000-8000-000000000005',
      sessionId: sessionId,
      sequence: 5,
      type: CanonicalEventType.assistantMessageCompleted,
      occurredAt: DateTime.utc(2026, 8, 14, 12, 4),
      payload: <String, Object?>{'turnId': 'turn-1', 'messageId': 'asst-1'},
    ),
    CanonicalSessionEvent(
      eventId: '00000000-0000-4000-8000-000000000006',
      sessionId: sessionId,
      sequence: 6,
      type: CanonicalEventType.turnSettled,
      occurredAt: DateTime.utc(2026, 8, 14, 12, 5),
      payload: <String, Object?>{'turnId': 'turn-1'},
    ),
  ]);
  return manager;
}

void main() {
  test(
    'CanonicalTranscriptView projects canonical state to TranscriptDocument',
    () async {
      const sessionId = 'sess-widget-1';
      final manager = await _buildManager(sessionId);
      final state = manager.snapshotFor(sessionId);
      expect(state, isNotNull);
      final document = projectCanonicalToDocument(state!);
      expect(document.streamId, 'session:$sessionId');
      expect(document.turns.length, greaterThanOrEqualTo(2));
      final userTurns = document.turns.whereType<UserTurn>();
      expect(userTurns.length, 1);
      expect(userTurns.first.message, 'Hello there');
      final assistantTurns = document.turns.whereType<AssistantTurn>();
      expect(assistantTurns.length, 1);
      expect(assistantTurns.first.finalAnswer?.viewData.markdown, 'Hi there');
      await manager.ingestWireEvents(sessionId, <CanonicalSessionEvent>[
        CanonicalSessionEvent(
          eventId: '00000000-0000-4000-8000-000000000007',
          sessionId: sessionId,
          sequence: 7,
          type: CanonicalEventType.userMessageCreated,
          occurredAt: DateTime.utc(2026, 8, 14, 12, 6),
          payload: <String, Object?>{
            'turnId': 'turn-2',
            'messageId': 'msg-2',
            'text': 'Second question',
          },
        ),
        CanonicalSessionEvent(
          eventId: '00000000-0000-4000-8000-000000000008',
          sessionId: sessionId,
          sequence: 8,
          type: CanonicalEventType.assistantStarted,
          occurredAt: DateTime.utc(2026, 8, 14, 12, 7),
          payload: <String, Object?>{'turnId': 'turn-2', 'messageId': 'asst-2'},
        ),
      ]);
      final ordered = projectCanonicalToDocument(
        manager.snapshotFor(sessionId)!,
      ).turns;
      expect(ordered.whereType<UserTurn>().map((turn) => turn.message), [
        'Hello there',
        'Second question',
      ]);
      expect(
        ordered.indexWhere((turn) => turn is AssistantTurn),
        lessThan(
          ordered.indexWhere(
            (turn) => turn is UserTurn && turn.message == 'Second question',
          ),
        ),
      );
      await manager.resetAll();
    },
  );

  test('CanonicalSessionManager notifies listeners on every commit', () async {
    final dir = await Directory.systemTemp.createTemp(
      'canonical-widget-notify-',
    );
    final manager = CanonicalSessionManager(baseDirectoryOverride: dir);
    var notifies = 0;
    manager.addListener(() => notifies += 1);
    await manager.updateCapabilities(advertised: true, hostGeneration: 'gen-3');
    expect(notifies, greaterThanOrEqualTo(1));
    await manager.ingestWireEvents('sess-n', <CanonicalSessionEvent>[
      CanonicalSessionEvent(
        eventId: '00000000-0000-4000-8000-000000000099',
        sessionId: 'sess-n',
        sequence: 1,
        type: CanonicalEventType.turnStarted,
        occurredAt: DateTime.utc(2026, 8, 14, 14),
        payload: <String, Object?>{'turnId': 't-n'},
      ),
    ]);
    expect(notifies, greaterThanOrEqualTo(2));
    await manager.resetAll();
  });
}
