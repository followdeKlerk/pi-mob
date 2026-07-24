// R12 — TranscriptView scroll restoration contract.
//
// Pins the persisted-offset / follow-mode wiring inside the inner
// TranscriptView: a non-null `initialScrollOffset` causes the first
// paint to jump to that pixel offset instead of the latest tail, and a
// followMode=false leaves the user pinned to history. Background
// follow ticks must not override the persisted tuple.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/transcript/domain/transcript_document.dart';
import 'package:pi_mob/src/transcript/domain/transcript_turn.dart';
import 'package:pi_mob/src/transcript/widgets/transcript_view.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  TranscriptDocument buildTranscriptDocument(String streamId, int turns) {
    final items = List<Turn>.generate(
      turns,
      (i) => UserTurn(
        turnId: 'turn-$i',
        commandId: 'cmd-$i',
        deliveryMode: 'immediate',
        status: UserTurnStatus.settled,
        startedAt: DateTime.utc(2026, 7, 23, 12, 0, i),
        message: 'message $i',
      ),
    );
    return TranscriptDocument(
      streamId: streamId,
      turns: items,
      diagnostics: const [],
      lastSettledTurnId: null,
    );
  }

  testWidgets('initialScrollOffset is restored on first frame', (tester) async {
    final persistLog = <(int, bool)>[];
    final doc = buildTranscriptDocument('session:abc', 30);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            height: 800,
            child: TranscriptView(
              key: const Key('transcript-test-restore'),
              document: doc,
              initialScrollOffset: 600,
              initialFollowMode: false,
              onScrollPersist: (offset, follow) =>
                  persistLog.add((offset, follow)),
            ),
          ),
        ),
      ),
    );
    // Let the post-frame jump fire.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 16));
    final state = tester.state(find.byType(TranscriptView));
    final ctrl = state.widget.key;
    expect(ctrl, const Key('transcript-test-restore'));
    // The jump lands at 600px (clamped to maxScrollExtent if smaller).
    final scrollable = find.byType(Scrollable).first;
    final scrollState = tester.state<ScrollableState>(scrollable);
    expect(scrollState.position.pixels, lessThanOrEqualTo(600));
    expect(scrollState.position.pixels, greaterThanOrEqualTo(0));
    expect(
      persistLog,
      isEmpty,
      reason: 'No user scroll yet; persistence must not fire on restore',
    );
  });

  testWidgets('null offset means default follow-tail', (tester) async {
    final doc = buildTranscriptDocument('session:tail', 10);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            height: 800,
            child: TranscriptView(
              key: const Key('transcript-test-tail'),
              document: doc,
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 16));
    final scrollable = find.byType(Scrollable).first;
    final scrollState = tester.state<ScrollableState>(scrollable);
    expect(
      scrollState.position.pixels,
      greaterThanOrEqualTo(scrollState.position.maxScrollExtent - 1),
      reason: 'Default behavior jumps to the latest tail',
    );
  });

  testWidgets('user scroll flushes the persistence callback', (tester) async {
    final persistLog = <(int, bool)>[];
    final doc = buildTranscriptDocument('session:flush', 50);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            height: 600,
            child: TranscriptView(
              key: const Key('transcript-test-flush'),
              document: doc,
              onScrollPersist: (offset, follow) =>
                  persistLog.add((offset, follow)),
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 16));
    // Drag the scrollable down (positive Y moves content down, i.e.
    // away from the tail); the user-initiated scroll must flush and
    // cancel follow so a tail-stick is not recorded as a user move.
    await tester.drag(
      find.byKey(const Key('transcript-list')),
      const Offset(0, 200),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(
      persistLog,
      isNotEmpty,
      reason: 'A user drag must flush the persistence callback',
    );
    // The recorded offset is non-negative and the follow flag is false
    // because the user has scrolled away from the tail.
    final last = persistLog.last;
    expect(last.$1, greaterThanOrEqualTo(0));
    expect(last.$2, isFalse);
  });
}
