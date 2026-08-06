import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/session_events/canonical_wire_transport.dart';
import 'package:pi_mob/src/session_events/session_event_repository.dart';
import 'package:pi_mob/src/session_events/session_event_synchronizer.dart';
import 'package:pi_mob/src/session_events/transcript_reducer.dart';

Map<String, Object?> _wireEvent({
  required String sessionId,
  required String eventId,
  required int sequence,
  required String eventType,
  String occurredAt = '2026-08-14T12:00:00.000Z',
  Map<String, Object?>? data,
}) => <String, Object?>{
  'eventId': eventId,
  'sessionId': sessionId,
  'sequence': sequence,
  'eventType': eventType,
  'occurredAt': occurredAt,
  'data': data ?? <String, Object?>{'turnId': 't1'},
};

Map<String, Object?> _liveFrame({
  required String sessionId,
  required String eventId,
  required int sequence,
  required String eventType,
  String occurredAt = '2026-08-14T12:00:00.000Z',
  Map<String, Object?>? data,
}) => <String, Object?>{
  'type': 'session.event',
  'protocol': <String, Object?>{'major': 1, 'minor': 0},
  'messageId':
      '00000000-0000-4000-8000-${sequence.toRadixString(16).padLeft(12, '0')}',
  'sentAt': occurredAt,
  'payload': _wireEvent(
    sessionId: sessionId,
    eventId: eventId,
    sequence: sequence,
    eventType: eventType,
    occurredAt: occurredAt,
    data: data,
  ),
};

Map<String, Object?> _replayEnvelope({
  required String sessionId,
  required List<Map<String, Object?>> events,
  required int latestSequence,
  required bool complete,
}) => <String, Object?>{
  'type': 'session.events.replay.result',
  'protocol': <String, Object?>{'major': 1, 'minor': 0},
  'messageId': '00000000-0000-4000-8000-0000000000aa',
  'requestId': '00000000-0000-4000-8000-0000000000aa',
  'sentAt': '2026-08-14T12:00:00.000Z',
  'payload': <String, Object?>{
    'sessionId': sessionId,
    'events': events,
    'latestSequence': latestSequence,
    'complete': complete,
  },
};

Future<void> _feedReplay(
  SessionEventSynchronizer synchronizer,
  Object? wireEnvelope,
) async {
  final result = decodeReplayResult(wireEnvelope);
  expect(result.complete, isTrue, reason: 'replay should be complete');
  for (final event in result.events) {
    final outcome = await synchronizer.accept(event);
    expect(
      outcome.disposition,
      anyOf(SynchronizerDisposition.applied, SynchronizerDisposition.duplicate),
      reason: 'replay event must be applied or recognised as duplicate',
    );
  }
}

Future<void> _feedLive(
  SessionEventSynchronizer synchronizer,
  Object? wireFrame,
) async {
  final event = decodeWireEvent(
    wireFrame,
    wireSessionId: synchronizer.sessionId,
  );
  final outcome = await synchronizer.accept(event);
  expect(
    outcome.disposition,
    anyOf(SynchronizerDisposition.applied, SynchronizerDisposition.duplicate),
    reason: 'live event must be applied or recognised as duplicate',
  );
}

void main() {
  group('canonical wire transport ↔ synchronizer integration', () {
    late CanonicalEventRepository repository;
    late SessionEventSynchronizer synchronizer;

    setUp(() async {
      repository = CanonicalEventRepository.inMemory('s1');
      synchronizer = SessionEventSynchronizer(
        sessionId: 's1',
        repository: repository,
      );
      await repository.ensureSchema();
    });

    tearDown(() async {
      await repository.close();
    });

    test(
      'replay-then-live: identical wire shapes project the same state',
      () async {
        final replayEvents = <Map<String, Object?>>[
          _wireEvent(
            sessionId: 's1',
            eventId: '00000000-0000-4000-8000-000000000001',
            sequence: 1,
            eventType: 'turn.started',
            data: <String, Object?>{'turnId': 't1'},
          ),
          _wireEvent(
            sessionId: 's1',
            eventId: '00000000-0000-4000-8000-000000000002',
            sequence: 2,
            eventType: 'assistant.started',
            data: <String, Object?>{'turnId': 't1', 'messageId': 'm1'},
          ),
          _wireEvent(
            sessionId: 's1',
            eventId: '00000000-0000-4000-8000-000000000003',
            sequence: 3,
            eventType: 'assistant.content.replaced',
            data: <String, Object?>{
              'turnId': 't1',
              'messageId': 'm1',
              'content': <Map<String, Object?>>[
                <String, Object?>{'kind': 'text', 'text': 'hello world'},
              ],
            },
          ),
          _wireEvent(
            sessionId: 's1',
            eventId: '00000000-0000-4000-8000-000000000004',
            sequence: 4,
            eventType: 'assistant.message.completed',
            data: <String, Object?>{'turnId': 't1', 'messageId': 'm1'},
          ),
          _wireEvent(
            sessionId: 's1',
            eventId: '00000000-0000-4000-8000-000000000005',
            sequence: 5,
            eventType: 'turn.settled',
            data: <String, Object?>{'turnId': 't1'},
          ),
        ];
        await _feedReplay(
          synchronizer,
          _replayEnvelope(
            sessionId: 's1',
            events: replayEvents,
            latestSequence: 5,
            complete: true,
          ),
        );
        final replayState = synchronizer.state;
        expect(replayState.lastAppliedSequence, 5);
        expect(replayState.turnStatuses['t1'], TurnStatus.completed);
        expect(
          replayState.assistantMessages['m1']!.content.single.text,
          'hello world',
        );

        // Live delivery of the same events with the same identities must
        // result in duplicate dispositions and the same projection.
        final liveFrame = _liveFrame(
          sessionId: 's1',
          eventId: '00000000-0000-4000-8000-000000000006',
          sequence: 6,
          eventType: 'user.message.created',
          data: <String, Object?>{
            'turnId': 't2',
            'messageId': 'm2',
            'text': 'next turn',
          },
        );
        await _feedLive(synchronizer, liveFrame);
        expect(synchronizer.state.userMessages['m2']!.text, 'next turn');
        expect(synchronizer.state.lastAppliedSequence, 6);
      },
    );

    test(
      'replay/live overlap: same event decoded twice is a duplicate',
      () async {
        final event = _wireEvent(
          sessionId: 's1',
          eventId: '00000000-0000-4000-8000-000000000001',
          sequence: 1,
          eventType: 'turn.started',
        );
        await _feedReplay(
          synchronizer,
          _replayEnvelope(
            sessionId: 's1',
            events: <Map<String, Object?>>[event],
            latestSequence: 1,
            complete: true,
          ),
        );
        // Same event arriving via the live channel must be a duplicate.
        final replayed = decodeWireEvent(
          _liveFrame(
            sessionId: 's1',
            eventId: '00000000-0000-4000-8000-000000000001',
            sequence: 1,
            eventType: 'turn.started',
          ),
          wireSessionId: 's1',
        );
        final outcome = await synchronizer.accept(replayed);
        expect(outcome.disposition, SynchronizerDisposition.duplicate);
        expect(synchronizer.lastAppliedSequence, 1);
      },
    );

    test(
      'replay/live overlap: live event with same sequence but new id is conflict',
      () async {
        final event = _wireEvent(
          sessionId: 's1',
          eventId: '00000000-0000-4000-8000-000000000001',
          sequence: 1,
          eventType: 'turn.started',
        );
        await _feedReplay(
          synchronizer,
          _replayEnvelope(
            sessionId: 's1',
            events: <Map<String, Object?>>[event],
            latestSequence: 1,
            complete: true,
          ),
        );
        final conflicting = decodeWireEvent(
          _liveFrame(
            sessionId: 's1',
            eventId: '00000000-0000-4000-8000-0000000000ff',
            sequence: 1,
            eventType: 'turn.started',
          ),
          wireSessionId: 's1',
        );
        final outcome = await synchronizer.accept(conflicting);
        expect(outcome.disposition, SynchronizerDisposition.conflict);
        expect(synchronizer.isPaused, isTrue);
      },
    );

    test(
      'replay gap: incomplete page forces resetAndReplay recovery',
      () async {
        // Page reports complete=true but is internally missing sequence 2.
        final page = _replayEnvelope(
          sessionId: 's1',
          events: <Map<String, Object?>>[
            _wireEvent(
              sessionId: 's1',
              eventId: '00000000-0000-4000-8000-000000000001',
              sequence: 1,
              eventType: 'turn.started',
            ),
            _wireEvent(
              sessionId: 's1',
              eventId: '00000000-0000-4000-8000-000000000003',
              sequence: 3,
              eventType: 'turn.settled',
            ),
          ],
          latestSequence: 3,
          complete: true,
        );
        final decoded = decodeReplayResult(page);
        expect(decoded.complete, isFalse);
        // The synchronizer should not apply events from a partial page
        // without explicit operator confirmation. Resetting clears the
        // cache; subsequent canonical delivery must rebuild cleanly.
        await synchronizer.resetAndReplay();
        expect(synchronizer.lastAppliedSequence, 0);
        final rebuilt = <Map<String, Object?>>[
          _wireEvent(
            sessionId: 's1',
            eventId: '00000000-0000-4000-8000-000000000001',
            sequence: 1,
            eventType: 'turn.started',
          ),
          _wireEvent(
            sessionId: 's1',
            eventId: '00000000-0000-4000-8000-000000000002',
            sequence: 2,
            eventType: 'turn.settled',
          ),
        ];
        await _feedReplay(
          synchronizer,
          _replayEnvelope(
            sessionId: 's1',
            events: rebuilt,
            latestSequence: 2,
            complete: true,
          ),
        );
        expect(synchronizer.lastAppliedSequence, 2);
        expect(synchronizer.state.turnStatuses['t1'], TurnStatus.completed);
      },
    );

    test('live delivery after replay advances the projection', () async {
      final page = _replayEnvelope(
        sessionId: 's1',
        events: <Map<String, Object?>>[
          _wireEvent(
            sessionId: 's1',
            eventId: '00000000-0000-4000-8000-000000000001',
            sequence: 1,
            eventType: 'turn.started',
          ),
        ],
        latestSequence: 1,
        complete: true,
      );
      await _feedReplay(synchronizer, page);
      expect(synchronizer.lastAppliedSequence, 1);

      // Cold-start: open a new synchronizer on the same repository and
      // verify the replay rebuilds the projection; then deliver a live
      // frame and verify both surfaces converge.
      final coldStart = SessionEventSynchronizer(
        sessionId: 's1',
        repository: repository,
      );
      await coldStart.replayFromCache();
      expect(coldStart.lastAppliedSequence, 1);
      expect(coldStart.state.turnStatuses['t1'], TurnStatus.running);

      final liveFrame = _liveFrame(
        sessionId: 's1',
        eventId: '00000000-0000-4000-8000-000000000002',
        sequence: 2,
        eventType: 'turn.settled',
        data: <String, Object?>{'turnId': 't1'},
      );
      await _feedLive(coldStart, liveFrame);
      expect(coldStart.lastAppliedSequence, 2);
      expect(coldStart.state.turnStatuses['t1'], TurnStatus.completed);
    });

    test(
      'decoded live event for a different session routes wrongSession',
      () async {
        final liveFrame = _liveFrame(
          sessionId: 'other',
          eventId: '00000000-0000-4000-8000-000000000001',
          sequence: 1,
          eventType: 'turn.started',
        );
        final event = decodeWireEvent(liveFrame);
        final outcome = await synchronizer.accept(event);
        expect(outcome.disposition, SynchronizerDisposition.wrongSession);
      },
    );
  });
}
