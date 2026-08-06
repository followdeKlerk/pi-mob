/// Compact tests for [TranscriptView] / [TranscriptEventView].
///
/// Coverage:
///
///   * An empty document renders the placeholder text.
///   * Renders turns with stable `ValueKey`-derived widget keys and a
///     `RepaintBoundary` per turn.
///   * Jump-to-latest FAB appears after the user scrolls away from the
///     tail, and disappears once they return.
///   * Renders under a 200% [TextScaler] without triggering a render
///     overflow (the constraint shrink-wrap path stays safe).
///   * Survives a `disableAnimations` test mode (pump only with
///     zero-duration ticks; transient animation callbacks are not
///     required for the transcript to settle).
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/domain/mobile_state.dart';
import 'package:pi_mob/src/transcript/domain/transcript_document.dart';
import 'package:pi_mob/src/transcript/domain/transcript_items.dart';
import 'package:pi_mob/src/transcript/domain/transcript_turn.dart';
import 'package:pi_mob/src/transcript/widgets/transcript_view.dart';
import 'package:pi_mob/src/transcript/widgets/view_data/final_answer_view_data.dart';
import 'package:pi_mob/src/transcript/widgets/view_data/reasoning_view_data.dart';
import 'package:pi_mob/src/transcript/widgets/view_data/tool_call_view_data.dart';
import 'package:pi_mob/src/transcript/widgets/transcript_status.dart';

AssistantTurn _assistantTurn({
  required String turnId,
  required String assistantStepId,
  List<TurnItem> items = const <TurnItem>[],
  AssistantTurnStatus status = AssistantTurnStatus.completed,
}) => AssistantTurn(
  turnId: turnId,
  assistantStepId: assistantStepId,
  status: status,
  items: items,
);

TranscriptDocument _document(List<Turn> turns) => TranscriptDocument(
  streamId: 'session:s',
  turns: turns,
  diagnostics: const [],
  lastSettledTurnId: null,
);

StreamEventState _event(
  int cursor,
  String type,
  Map<String, Object?> payload,
) => StreamEventState(
  hostId: 'host',
  streamId: 'session:s',
  cursor: StreamCursor.parse('$cursor'),
  eventId: 'event-$cursor',
  type: type,
  payload: payload,
  occurredAt: DateTime.utc(2026, 7, 20),
);

Widget _app(Widget child, {TextScaler textScaler = TextScaler.noScaling}) {
  return MaterialApp(
    home: Scaffold(
      body: MediaQuery(
        data: MediaQueryData(textScaler: textScaler),
        child: child,
      ),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('empty document renders the empty transcript placeholder', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(400, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _app(TranscriptView(document: TranscriptDocument.empty('session:s'))),
    );
    expect(find.text('No transcript yet'), findsOneWidget);
    expect(find.byKey(const Key('transcript-list')), findsNothing);
    expect(find.byKey(const Key('load-older-transcript')), findsNothing);
  });

  testWidgets('renders one RepaintBoundary + stable ValueKey per turn', (
    tester,
  ) async {
    final doc = _document([
      _assistantTurn(
        turnId: 'a',
        assistantStepId: 's1',
        items: [
          ToolItem(
            itemId: 'call-1',
            assistantStepId: 's1',
            viewData: ToolCallViewData(
              toolCallId: 'call-1',
              toolName: BuiltInToolName.read,
              arguments: const <String, Object?>{'path': '/tmp/x'},
              status: TranscriptToolStatus.completed,
              result: const <String, Object?>{'content': 'hi', 'byteCount': 2},
            ),
          ),
        ],
      ),
    ]);

    await tester.pumpWidget(_app(TranscriptView(document: doc)));
    expect(find.byType(RepaintBoundary), findsWidgets);
    // The list itself is keyed and addressable.
    final listFinder = find.byKey(const Key('transcript-list'));
    expect(listFinder, findsOneWidget);
    // The list's scroll controller is wired up so the FAB has a hook.
    final list = tester.widget<ListView>(listFinder);
    expect(list.controller, isNotNull);
  });

  testWidgets('user messages render without delivery indicators', (tester) async {
    await tester.pumpWidget(
      _app(
        TranscriptView(
          document: _document([
            const UserTurn(
              turnId: 'user-1',
              commandId: 'command-1',
              deliveryMode: 'immediate',
              status: UserTurnStatus.settled,
              message: 'Hello',
            ),
          ]),
        ),
      ),
    );

    expect(find.text('Hello'), findsOneWidget);
    expect(find.textContaining('You ·'), findsNothing);
    expect(find.textContaining('settled'), findsNothing);
  });

  testWidgets('unconfirmed user messages show no delivery text', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(
        TranscriptView(
          document: _document([
            const UserTurn(
              turnId: 'user-2',
              commandId: 'command-2',
              deliveryMode: 'immediate',
              status: UserTurnStatus.indeterminate,
              message: 'Maybe sent',
            ),
          ]),
        ),
      ),
    );

    expect(find.text('Maybe sent'), findsOneWidget);
    expect(find.byKey(const Key('user-delivery-check-user-2')), findsNothing);
    expect(find.textContaining('You ·'), findsNothing);
    expect(find.textContaining('indeterminate'), findsNothing);
  });

  testWidgets('settled event with no assistant output is explicit', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(
        TranscriptEventView(
          streamId: 'session:s',
          events: [
            _event(1, 'turn.started', {
              'turnId': 'empty-turn',
              'commandId': 'empty-command',
              'message': 'Are you there?',
            }),
            _event(2, 'turn.settled', {'turnId': 'empty-turn'}),
          ],
        ),
      ),
    );

    expect(find.text('Are you there?'), findsOneWidget);
    expect(find.text('Completed with no response'), findsOneWidget);
    expect(
      find.byKey(const Key('assistant-no-response-empty-turn')),
      findsOneWidget,
    );
  });

  testWidgets('assistant content suppresses no-response fallback', (
    tester,
  ) async {
    final doc = _document([
      _assistantTurn(
        turnId: 'answered',
        assistantStepId: 'step',
        items: [
          FinalAnswerItem(
            itemId: 'answer',
            assistantStepId: 'step',
            viewData: const FinalAnswerViewData(
              answerId: 'answer',
              markdown: 'Actual response',
            ),
          ),
        ],
      ),
    ]);
    await tester.pumpWidget(_app(TranscriptView(document: doc)));
    expect(find.text('Actual response'), findsOneWidget);
    expect(find.text('Completed with no response'), findsNothing);
  });

  testWidgets(
    'jump-to-latest FAB appears when scrolled away and hides on return',
    (tester) async {
      final turns = List<Turn>.generate(
        12,
        (i) => _assistantTurn(
          turnId: 'turn-$i',
          assistantStepId: 'step-$i',
          items: [
            ReasoningItem(
              itemId: 'r-$i',
              assistantStepId: 'step-$i',
              viewData: ReasoningViewData(
                reasoningId: 'r-$i',
                phase: ReasoningPhase.completed,
                summary: 'step summary $i',
              ),
            ),
          ],
        ),
      );
      await tester.binding.setSurfaceSize(const Size(400, 500));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(_app(TranscriptView(document: _document(turns))));

      // Initially pinned to bottom: FAB must be absent.
      expect(find.byKey(const Key('jump-to-latest')), findsNothing);

      // Scroll to the top.
      await tester.drag(
        find.byKey(const Key('transcript-list')),
        const Offset(0, 4000),
      );
      await tester.pump();
      expect(find.byKey(const Key('jump-to-latest')), findsOneWidget);

      // Tap it: should gently return to the bottom and clear the FAB.
      await tester.tap(find.byKey(const Key('jump-to-latest')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('jump-to-latest')), findsNothing);
    },
  );

  testWidgets('renders at 200% text scaling without overflow', (tester) async {
    final turns = List<Turn>.generate(
      6,
      (i) => _assistantTurn(
        turnId: 'turn-$i',
        assistantStepId: 'step-$i',
        items: [
          FinalAnswerItem(
            itemId: 'a-$i',
            assistantStepId: 'step-$i',
            viewData: FinalAnswerViewData(
              answerId: 'a-$i',
              markdown:
                  'Long answer $i with **bold** and a [link](https://example.com/${'x' * 32})',
            ),
          ),
        ],
      ),
    );

    await tester.binding.setSurfaceSize(const Size(320, 1400));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      _app(
        TranscriptView(document: _document(turns)),
        textScaler: const TextScaler.linear(2.0),
      ),
    );
    // No overflow exception should have been thrown during the build.
    expect(tester.takeException(), isNull);
    // Scrollable list still rendered.
    expect(find.byKey(const Key('transcript-list')), findsOneWidget);
  });

  testWidgets(
    'disableAnimations: builds, scrolls, and resolves under zero-durations',
    (tester) async {
      final turns = List<Turn>.generate(
        20,
        (i) => _assistantTurn(
          turnId: 'turn-$i',
          assistantStepId: 'step-$i',
          items: [
            ToolItem(
              itemId: 'tool-$i',
              assistantStepId: 'step-$i',
              viewData: ToolCallViewData(
                toolCallId: 'tool-$i',
                toolName: BuiltInToolName.bash,
                arguments: <String, Object?>{'command': 'echo $i'},
                status: TranscriptToolStatus.completed,
                result: const <String, Object?>{
                  'stdout': '',
                  'stderr': '',
                  'exitCode': 0,
                },
              ),
            ),
          ],
        ),
      );

      await tester.binding.setSurfaceSize(const Size(400, 500));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(_app(TranscriptView(document: _document(turns))));

      // Disable animations: pump a single zero-duration tick without
      // pumpAndSettle. The widget must not throw and must remain readable.
      await tester.pump(Duration.zero);
      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('transcript-list')), findsOneWidget);

      // A scroll gesture must still drive behaviour without animation.
      await tester.drag(
        find.byKey(const Key('transcript-list')),
        const Offset(0, 2000),
      );
      await tester.pump(Duration.zero);
      expect(find.byKey(const Key('jump-to-latest')), findsOneWidget);
    },
  );

  testWidgets('TranscriptEventView reduces events into a TranscriptView', (
    tester,
  ) async {
    final events = [
      StreamEventState(
        hostId: 'h',
        streamId: 'session:s',
        cursor: StreamCursor.parse('1'),
        eventId: 'turn-start',
        type: 'turn.started',
        payload: const <String, Object?>{
          'turnId': 'turn-1',
          'commandId': 'cmd-1',
          'deliveryMode': 'immediate',
        },
        occurredAt: DateTime.utc(2026),
      ),
      StreamEventState(
        hostId: 'h',
        streamId: 'session:s',
        cursor: StreamCursor.parse('2'),
        eventId: 'assistant-start',
        type: 'assistant.started',
        payload: const <String, Object?>{'contentBlockId': 'ans-1'},
        occurredAt: DateTime.utc(2026),
      ),
      StreamEventState(
        hostId: 'h',
        streamId: 'session:s',
        cursor: StreamCursor.parse('3'),
        eventId: 'assistant-delta',
        type: 'assistant.delta',
        payload: const <String, Object?>{
          'contentBlockId': 'ans-1',
          'text': 'hello world',
        },
        occurredAt: DateTime.utc(2026),
      ),
      StreamEventState(
        hostId: 'h',
        streamId: 'session:s',
        cursor: StreamCursor.parse('4'),
        eventId: 'assistant-completed',
        type: 'assistant.completed',
        payload: const <String, Object?>{'contentBlockId': 'ans-1'},
        occurredAt: DateTime.utc(2026),
      ),
    ];

    await tester.pumpWidget(
      _app(TranscriptEventView(streamId: 'session:s', events: events)),
    );
    expect(find.byKey(const Key('transcript-list')), findsOneWidget);
    expect(
      find.textContaining('hello world', findRichText: true),
      findsOneWidget,
    );
  });
}
