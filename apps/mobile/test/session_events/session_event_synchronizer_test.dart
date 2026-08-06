import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/session_events/canonical_event.dart';
import 'package:pi_mob/src/session_events/session_event_repository.dart';
import 'package:pi_mob/src/session_events/session_event_synchronizer.dart';
import 'package:pi_mob/src/session_events/transcript_reducer.dart';

CanonicalSessionEvent _event({
  required int sequence,
  required CanonicalEventType type,
  String eventId = 'ev',
  Map<String, Object?>? payload,
}) => CanonicalSessionEvent(
  eventId: '$eventId-$sequence',
  sessionId: 's1',
  sequence: sequence,
  type: type,
  occurredAt: DateTime.utc(2026, 7, 14, 12, 0, sequence),
  payload: payload ?? <String, Object?>{'turnId': 't1'},
);

void main() {
  group('CanonicalEventRepository', () {
    late CanonicalEventRepository repository;

    setUp(() {
      repository = CanonicalEventRepository.inMemory('s1');
    });

    tearDown(() async {
      await repository.close();
    });

    test('appends events and advances the sequence pointer', () async {
      final result = await repository.append(
        _event(sequence: 1, type: CanonicalEventType.turnStarted, eventId: 'a'),
      );
      expect(result.event.sequence, 1);
      expect(await repository.latestSequence(), 1);
      expect(await repository.count(), 1);
    });

    test('duplicate (sessionId, sequence) is idempotent', () async {
      await repository.append(
        _event(sequence: 1, type: CanonicalEventType.turnStarted, eventId: 'a'),
      );
      final second = await repository.append(
        _event(sequence: 1, type: CanonicalEventType.turnStarted, eventId: 'a'),
      );
      expect(second.rowId, isNotNull);
      expect(await repository.count(), 1);
    });

    test('readAfter returns strict ascending sequence order', () async {
      for (final seq in [3, 1, 2, 4]) {
        await repository.append(
          _event(
            sequence: seq,
            type: CanonicalEventType.assistantStarted,
            eventId: 'a',
          ),
        );
      }
      final result = await repository.readAfter(0);
      expect(result.map((e) => e.event.sequence).toList(), <int>[1, 2, 3, 4]);
    });

    test('resetCache clears the rows and sequence pointer', () async {
      await repository.append(
        _event(sequence: 1, type: CanonicalEventType.turnStarted, eventId: 'a'),
      );
      await repository.resetCache();
      expect(await repository.count(), 0);
      expect(await repository.latestSequence(), 0);
    });
  });

  group('SessionEventSynchronizer', () {
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

    test('applies events in sequence order', () async {
      final result = await synchronizer.accept(
        _event(sequence: 1, type: CanonicalEventType.turnStarted),
      );
      expect(result.disposition, SynchronizerDisposition.applied);
      expect(result.state.lastAppliedSequence, 1);
      expect(result.state.turnStatuses['t1'], TurnStatus.running);
    });

    test('duplicate event id is recognised as duplicate', () async {
      final first = await synchronizer.accept(
        _event(sequence: 1, type: CanonicalEventType.turnStarted, eventId: 'a'),
      );
      expect(first.disposition, SynchronizerDisposition.applied);
      final second = await synchronizer.accept(
        _event(sequence: 1, type: CanonicalEventType.turnStarted, eventId: 'a'),
      );
      expect(second.disposition, SynchronizerDisposition.duplicate);
      // State is unchanged on duplicates.
      expect(second.state.lastAppliedSequence, 1);
    });

    test('sequence gap pauses the synchronizer and forces recovery', () async {
      final applied = await synchronizer.accept(
        _event(sequence: 1, type: CanonicalEventType.turnStarted, eventId: 'a'),
      );
      expect(applied.disposition, SynchronizerDisposition.applied);

      final gap = await synchronizer.accept(
        _event(sequence: 3, type: CanonicalEventType.turnStarted, eventId: 'b'),
      );
      expect(gap.disposition, SynchronizerDisposition.gap);
      expect(synchronizer.isPaused, isTrue);
    });

    test(
      'cold-start replay rebuilds the projection in strict sequence',
      () async {
        for (final seq in [1, 2, 3]) {
          await synchronizer.accept(
            _event(
              sequence: seq,
              type: CanonicalEventType.turnStarted,
              eventId: 'a$seq',
            ),
          );
        }

        final replayed = SessionEventSynchronizer(
          sessionId: 's1',
          repository: repository,
        );
        await replayed.replayFromCache();
        expect(replayed.lastAppliedSequence, 3);
        expect(replayed.state.turnStatuses['t1'], TurnStatus.running);
      },
    );

    test(
      'resetAndReplay rebuilds the projection after cache deletion',
      () async {
        for (final seq in [1, 2]) {
          await synchronizer.accept(
            _event(
              sequence: seq,
              type: CanonicalEventType.assistantStarted,
              eventId: 'm$seq',
              payload: <String, Object?>{'turnId': 't1', 'messageId': 'm$seq'},
            ),
          );
        }
        expect(synchronizer.lastAppliedSequence, 2);
        // resetAndReplay drops the cache and rebuilds; the projection
        // is empty until events are accepted again.
        await synchronizer.resetAndReplay();
        expect(synchronizer.lastAppliedSequence, 0);
        expect(synchronizer.state.assistantMessages, isEmpty);
        // Accepting the events again restores the projection.
        for (final seq in [1, 2]) {
          await synchronizer.accept(
            _event(
              sequence: seq,
              type: CanonicalEventType.assistantStarted,
              eventId: 'm$seq',
              payload: <String, Object?>{'turnId': 't1', 'messageId': 'm$seq'},
            ),
          );
        }
        expect(synchronizer.lastAppliedSequence, 2);
        expect(synchronizer.state.assistantMessages['m2']!.messageId, 'm2');
      },
    );

    test(
      'event for a different session returns wrongSession disposition',
      () async {
        final foreign = CanonicalSessionEvent(
          eventId: 'foreign',
          sessionId: 'other',
          sequence: 1,
          type: CanonicalEventType.turnStarted,
          occurredAt: DateTime.utc(2026),
          payload: <String, Object?>{'turnId': 't1'},
        );
        final result = await synchronizer.accept(foreign);
        expect(result.disposition, SynchronizerDisposition.wrongSession);
      },
    );

    test(
      'conflict on same sequence with different eventId pauses the sync',
      () async {
        await synchronizer.accept(
          _event(
            sequence: 1,
            type: CanonicalEventType.turnStarted,
            eventId: 'a',
          ),
        );
        final conflict = await synchronizer.accept(
          _event(
            sequence: 1,
            type: CanonicalEventType.turnStarted,
            eventId: 'b',
          ),
        );
        expect(conflict.disposition, SynchronizerDisposition.conflict);
        expect(synchronizer.isPaused, isTrue);
      },
    );

    test(
      'full transcript rebuild via canonical adapter matches reducer',
      () async {
        // Live delivery: user message, assistant start, replace, complete.
        await synchronizer.accept(
          _event(
            sequence: 1,
            type: CanonicalEventType.userMessageCreated,
            eventId: 'u',
            payload: <String, Object?>{
              'turnId': 't1',
              'messageId': 'm1',
              'text': 'hello',
            },
          ),
        );
        await synchronizer.accept(
          _event(
            sequence: 2,
            type: CanonicalEventType.assistantStarted,
            eventId: 'as',
            payload: <String, Object?>{'turnId': 't1', 'messageId': 'a1'},
          ),
        );
        await synchronizer.accept(
          _event(
            sequence: 3,
            type: CanonicalEventType.assistantContentReplaced,
            eventId: 'ar',
            payload: <String, Object?>{
              'turnId': 't1',
              'messageId': 'a1',
              'content': <Map<String, Object?>>[
                <String, Object?>{'kind': 'text', 'text': 'hi back'},
              ],
            },
          ),
        );
        await synchronizer.accept(
          _event(
            sequence: 4,
            type: CanonicalEventType.assistantMessageCompleted,
            eventId: 'ac',
            payload: <String, Object?>{'turnId': 't1', 'messageId': 'a1'},
          ),
        );

        // Disconnect + cold-start replay.
        final replayed = SessionEventSynchronizer(
          sessionId: 's1',
          repository: repository,
        );
        await replayed.replayFromCache();

        expect(replayed.lastAppliedSequence, 4);
        expect(replayed.state.userMessages['m1']!.text, 'hello');
        expect(
          replayed.state.assistantMessages['a1']!.content.single.text,
          'hi back',
        );
        expect(replayed.state.assistantMessages['a1']!.isTerminal, isTrue);
      },
    );
  });
}
