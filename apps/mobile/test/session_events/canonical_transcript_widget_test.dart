import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/session_events/canonical_event.dart';
import 'package:pi_mob/src/session_events/canonical_session_manager.dart';
import 'package:pi_mob/src/session_events/canonical_transcript_document.dart';
import 'package:pi_mob/src/session_events/canonical_transcript_view.dart';
import 'package:pi_mob/src/transcript/domain/transcript_document.dart';
import 'package:pi_mob/src/transcript/domain/transcript_turn.dart';
import 'package:pi_mob/src/transcript/widgets/transcript_view.dart';

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
        'attachmentIds': <String>['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
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
  testWidgets(
    'CanonicalTranscriptView projects canonical state to TranscriptDocument',
    (tester) async {
      const sessionId = 'sess-widget-1';
      // Filesystem and SQLite work must run outside the widget fake clock.
      final manager = (await tester.runAsync(() => _buildManager(sessionId)))!;
      await tester.pump();
      final state = manager.snapshotFor(sessionId);
      expect(state, isNotNull);
      final projection = CanonicalTranscriptProjection();
      final document = projection.project(state!);
      expect(document.streamId, 'session:$sessionId');
      expect(document.turns.length, greaterThanOrEqualTo(2));
      final userTurns = document.turns.whereType<UserTurn>();
      expect(userTurns.length, 1);
      final originalUser = userTurns.first;
      expect(userTurns.first.message, 'Hello there');
      expect(userTurns.first.attachmentIds, [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ]);
      final assistantTurns = document.turns.whereType<AssistantTurn>();
      expect(assistantTurns.length, 1);
      expect(assistantTurns.first.finalAnswer?.viewData.markdown, 'Hi there');
      await tester.runAsync(
        () => manager.ingestWireEvents(sessionId, <CanonicalSessionEvent>[
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
            payload: <String, Object?>{
              'turnId': 'turn-2',
              'messageId': 'asst-2',
            },
          ),
        ]),
      );
      await tester.pump();
      final ordered = projection.project(manager.snapshotFor(sessionId)!).turns;
      expect(
        identical(ordered.whereType<UserTurn>().first, originalUser),
        isTrue,
      );
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
      await tester.runAsync(() => manager.resetAll());
    },
  );

  testWidgets('streamed transcript coalesces rapid redraws', (tester) async {
    const sessionId = 'sess-stream-cadence';
    final manager = (await tester.runAsync(() => _buildManager(sessionId)))!;
    await tester.pump();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: CanonicalTranscriptView(sessionId: sessionId, manager: manager),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.runAsync(
      () => manager.ingestWireEvents(sessionId, <CanonicalSessionEvent>[
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
        CanonicalSessionEvent(
          eventId: '00000000-0000-4000-8000-000000000009',
          sessionId: sessionId,
          sequence: 9,
          type: CanonicalEventType.assistantContentReplaced,
          occurredAt: DateTime.utc(2026, 8, 14, 12, 8),
          payload: <String, Object?>{
            'turnId': 'turn-2',
            'messageId': 'asst-2',
            'content': <Map<String, Object?>>[
              <String, Object?>{'kind': 'text', 'text': 'first chunk'},
            ],
          },
        ),
      ]),
    );
    await tester.pump();
    expect(find.text('first chunk'), findsOneWidget);

    await tester.runAsync(
      () => manager.ingestWireEvents(sessionId, <CanonicalSessionEvent>[
        CanonicalSessionEvent(
          eventId: '00000000-0000-4000-8000-000000000010',
          sessionId: sessionId,
          sequence: 10,
          type: CanonicalEventType.assistantContentReplaced,
          occurredAt: DateTime.utc(2026, 8, 14, 12, 9),
          payload: <String, Object?>{
            'turnId': 'turn-2',
            'messageId': 'asst-2',
            'content': <Map<String, Object?>>[
              <String, Object?>{'kind': 'text', 'text': 'latest full text'},
            ],
          },
        ),
      ]),
    );
    await tester.pump();
    expect(find.text('first chunk'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 32));
    expect(find.text('first chunk'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 1));
    expect(find.text('latest full text'), findsOneWidget);
    await tester.runAsync(() => manager.resetAll());
  });

  testWidgets('TranscriptView renders user attachment bytes once', (
    tester,
  ) async {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    final bytes = Uint8List.fromList(<int>[
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
      0,
      0,
      0,
      13,
      73,
      72,
      68,
      82,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1,
      8,
      4,
      0,
      0,
      0,
      181,
      28,
      12,
      2,
      0,
      0,
      0,
      11,
      73,
      68,
      65,
      84,
      120,
      218,
      99,
      100,
      248,
      15,
      0,
      1,
      5,
      1,
      1,
      39,
      24,
      227,
      101,
      0,
      0,
      0,
      0,
      73,
      69,
      78,
      68,
      174,
      66,
      96,
      130,
    ]);
    var calls = 0;
    final document = TranscriptDocument(
      streamId: 'session:one',
      turns: <Turn>[
        UserTurn(
          turnId: 'turn-1',
          commandId: 'command-1',
          deliveryMode: 'immediate',
          status: UserTurnStatus.settled,
          message: 'Inspect this',
          attachmentIds: const [id],
        ),
      ],
      diagnostics: const [],
      lastSettledTurnId: null,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TranscriptView(
            document: document,
            attachmentLoader: (_) async {
              calls += 1;
              return bytes;
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('user-attachment-image-$id')),
      findsOneWidget,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TranscriptView(
            document: document,
            attachmentLoader: (_) async {
              calls += 1;
              return bytes;
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(calls, 1);
  });

  testWidgets('CanonicalSessionManager coalesces completed ingests per frame', (
    tester,
  ) async {
    final dir = (await tester.runAsync(
      () => Directory.systemTemp.createTemp('canonical-widget-notify-'),
    ))!;
    final manager = CanonicalSessionManager(baseDirectoryOverride: dir);
    var notifies = 0;
    manager.addListener(() => notifies += 1);
    await manager.updateCapabilities(advertised: true, hostGeneration: 'gen-3');
    await tester.pump();
    notifies = 0;
    await tester.runAsync(
      () => manager.ingestWireEvents('sess-n', <CanonicalSessionEvent>[
        CanonicalSessionEvent(
          eventId: '00000000-0000-4000-8000-000000000099',
          sessionId: 'sess-n',
          sequence: 1,
          type: CanonicalEventType.turnStarted,
          occurredAt: DateTime.utc(2026, 8, 14, 14),
          payload: <String, Object?>{'turnId': 't-n'},
        ),
      ]),
    );
    await tester.runAsync(
      () => manager.ingestWireEvents('sess-n', <CanonicalSessionEvent>[
        CanonicalSessionEvent(
          eventId: '00000000-0000-4000-8000-000000000100',
          sessionId: 'sess-n',
          sequence: 2,
          type: CanonicalEventType.turnSettled,
          occurredAt: DateTime.utc(2026, 8, 14, 14, 1),
          payload: <String, Object?>{'turnId': 't-n'},
        ),
      ]),
    );
    expect(notifies, 0);
    await tester.pump();
    expect(notifies, 1);
    expect(manager.lastAppliedSequence('sess-n'), 2);
    await tester.runAsync(() => manager.resetAll());
  });
}
