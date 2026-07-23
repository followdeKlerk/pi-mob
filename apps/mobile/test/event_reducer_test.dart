import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/domain/mobile_state.dart';
import 'package:pi_mob/src/sync/event_reducer.dart';

StreamEventState event(String cursor, String id) => StreamEventState(
  hostId: 'host',
  streamId: 'session:s',
  cursor: StreamCursor.parse(cursor),
  eventId: id,
  type: 'assistant.delta',
  payload: {'text': id},
  occurredAt: DateTime.utc(2026),
);

void main() {
  const reducer = OrderedEventReducer();

  test('cursor comparison remains exact above JavaScript safe integer', () {
    final state = StreamViewState.initial(
      'session:s',
      cursor: StreamCursor.parse('9007199254740992'),
    );
    final result = reducer.apply(state, event('9007199254740993', 'a'));
    expect(result.disposition, EventDisposition.applied);
    expect(result.state.lastContiguousCursor.value, '9007199254740993');
  });

  test('deduplicates identity and rejects conflicting cursor', () {
    var state = reducer
        .apply(StreamViewState.initial('session:s'), event('1', 'a'))
        .state;
    expect(
      reducer.apply(state, event('1', 'a')).disposition,
      EventDisposition.duplicate,
    );
    final conflict = reducer.apply(state, event('1', 'b'));
    expect(conflict.disposition, EventDisposition.conflict);
    expect(conflict.state.integrity, StreamIntegrity.conflict);
  });

  test('gap pauses only its stream until atomic snapshot replacement', () {
    final first = reducer.apply(
      StreamViewState.initial('session:s'),
      event('2', 'b'),
    );
    expect(first.disposition, EventDisposition.gap);
    expect(
      reducer.apply(first.state, event('1', 'a')).disposition,
      EventDisposition.ignoredWhilePaused,
    );

    final replaced = reducer.replaceWithSnapshot(
      first.state,
      StreamSnapshot(
        snapshotId: 'snap',
        streamId: 'session:s',
        baselineCursor: StreamCursor.parse('5'),
        items: const [
          {'runtimeState': 'idle'},
        ],
      ),
      postBaselineEvents: [event('6', 'c')],
    );
    expect(replaced.integrity, StreamIntegrity.healthy);
    expect(replaced.lastContiguousCursor.value, '6');
    expect(replaced.events.map((e) => e.eventId), ['c']);
  });

  test('snapshot assembler validates identity, parts, and completeness', () {
    final assembler = SnapshotAssembler();
    assembler.begin(
      snapshotId: 'snap',
      streamId: 'session:s',
      baselineCursor: StreamCursor.parse('10'),
    );
    assembler.addPart(
      snapshotId: 'snap',
      part: 0,
      items: const [
        {'a': 1},
      ],
    );
    assembler.addPart(
      snapshotId: 'snap',
      part: 1,
      items: const [
        {'b': 2},
      ],
    );
    final snapshot = assembler.finish(snapshotId: 'snap', partCount: 2);
    expect(snapshot.items, const [
      {'a': 1},
      {'b': 2},
    ]);
    expect(assembler.isActive, isFalse);

    assembler.begin(
      snapshotId: 'other',
      streamId: 'session:s',
      baselineCursor: StreamCursor.zero,
    );
    expect(
      () => assembler.finish(snapshotId: 'other', partCount: 1),
      throwsStateError,
    );
    expect(assembler.isActive, isFalse);
  });
}
