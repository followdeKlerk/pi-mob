/// Focused widget tests for [AgentSupervisionSheet].
///
/// Coverage:
///
///   * The sheet renders one row per supervised Agent run with task,
///     model, status, elapsed, origin, and a latest-output preview.
///   * Capability flags surface only when an authoritative contract
///     was provided; otherwise the row shows an explicit "Unavailable"
///     line so the user sees the truth instead of a silent grey-out.
///   * `Open transcript` and `Open result` actions fire their
///     callbacks with the correct chat id (and turn id for transcript).
///   * Blockers render in their own section.
///   * The empty state renders when no Agent runs are present.
///   * The selected-chat title and the global title both render
///     verbatim; the widget never invents a chat id.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/agents/domain/agent_supervision.dart';
import 'package:pi_mob/src/agents/widgets/agent_supervision_sheet.dart';
import 'package:pi_mob/src/ui/theme/pi_theme.dart';

AgentRun _running({
  String toolCallId = 'call-A',
  String task = 'Investigate flaky test',
  String? model = 'claude-sonnet-4-5',
  String? agentType = 'general-purpose',
  String? thinkingLevel = 'medium',
  bool backgroundRequested = false,
  String? agentId,
  DateTime? startedAt,
  String? originChatId,
  String? originTurnId,
  String? latestOutput,
  String? errorMessage,
  AgentRunCapabilities? caps,
  AgentRunStatus status = AgentRunStatus.running,
}) {
  return AgentRun(
    toolCallId: toolCallId,
    task: task,
    subagentType: agentType,
    model: model,
    thinkingLevel: thinkingLevel,
    backgroundRequested: backgroundRequested,
    status: status,
    startedAt: startedAt ?? DateTime.utc(2026, 7, 21, 12, 0, 0),
    agentId: agentId,
    originChatId: originChatId,
    originTurnId: originTurnId,
    latestOutput: latestOutput,
    errorMessage: errorMessage,
    caps: caps,
  );
}

Future<void> _pumpSheet(
  WidgetTester tester, {
  required AgentSupervisionState state,
  String title = 'Selected chat',
  void Function(String? chatId, String? turnId)? onOpenTranscript,
  void Function(String? chatId)? onOpenResult,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: piLightTheme(),
      home: Scaffold(
        body: AgentSupervisionSheet(
          state: state,
          title: title,
          now: DateTime.utc(2026, 7, 21, 12, 0, 30),
          onOpenTranscript: onOpenTranscript,
          onOpenResult: onOpenResult,
        ),
      ),
    ),
  );
}

void main() {
  group('AgentSupervisionSheet', () {
    testWidgets('renders empty state when no runs are observed', (
      tester,
    ) async {
      await _pumpSheet(tester, state: AgentSupervisionState.empty());
      expect(find.text('Selected chat'), findsOneWidget);
      expect(
        find.textContaining('No Agent activity observed yet'),
        findsOneWidget,
      );
    });

    testWidgets('renders one row per run with task, model, status', (
      tester,
    ) async {
      final state = AgentSupervisionState(
        runs: [
          _running(
            toolCallId: 'call-A',
            task: 'Investigate flaky test',
            originChatId: 'chat-1',
            originTurnId: 'turn-1',
          ),
          _running(
            toolCallId: 'call-B',
            task: 'Plan the refactor',
            backgroundRequested: true,
            originChatId: 'chat-1',
            originTurnId: 'turn-2',
          ),
        ],
      );
      await _pumpSheet(tester, state: state);
      expect(find.byKey(const Key('agent-run-row')), findsNWidgets(2));
      expect(find.text('Investigate flaky test'), findsOneWidget);
      expect(find.text('Plan the refactor'), findsOneWidget);
      expect(find.textContaining('background'), findsOneWidget);
      expect(find.textContaining('foreground'), findsOneWidget);
      expect(find.text('Running'), findsNWidgets(2));
      expect(find.text('2 running'), findsOneWidget);
    });

    testWidgets('shows explicit "Unavailable" line when no caps contract', (
      tester,
    ) async {
      final state = AgentSupervisionState(runs: [_running()]);
      await _pumpSheet(tester, state: state);
      expect(
        find.textContaining('Steer / cancel / adopt: unavailable'),
        findsOneWidget,
      );
      expect(find.textContaining('no authoritative contract'), findsOneWidget);
    });

    testWidgets('renders capability pills when caps contract exists', (
      tester,
    ) async {
      final state = AgentSupervisionState(
        runs: [
          _running(
            caps: const AgentRunCapabilities(
              canSteer: true,
              canCancel: true,
              contractSource: 'extension:test-agent@v1',
            ),
          ),
        ],
      );
      await _pumpSheet(tester, state: state);
      expect(find.text('Steer available'), findsOneWidget);
      expect(find.text('Cancel available'), findsOneWidget);
      expect(find.text('Adopt available'), findsNothing);
    });

    testWidgets('shows latest output and error message when present', (
      tester,
    ) async {
      final state = AgentSupervisionState(
        runs: [
          _running(
            status: AgentRunStatus.error,
            latestOutput: 'partial result before crash',
            errorMessage: 'subagent timed out',
          ),
        ],
      );
      await _pumpSheet(tester, state: state);
      expect(find.text('partial result before crash'), findsOneWidget);
      expect(find.text('subagent timed out'), findsOneWidget);
    });

    testWidgets('renders blockers section with detail', (tester) async {
      final state = AgentSupervisionState(
        blockers: const [
          AgentSupervisionBlocker(
            toolCallId: 'call-A',
            kind: 'no_steer_contract',
            detail: 'No steer capability advertised by extension.',
          ),
        ],
      );
      await _pumpSheet(tester, state: state);
      expect(find.text('Control blockers'), findsOneWidget);
      expect(find.text('no_steer_contract'), findsOneWidget);
      expect(
        find.textContaining('No steer capability advertised'),
        findsOneWidget,
      );
    });

    testWidgets('Open transcript callback fires with origin chat and turn', (
      tester,
    ) async {
      String? capturedChat;
      String? capturedTurn;
      final state = AgentSupervisionState(
        runs: [
          _running(
            toolCallId: 'call-A',
            originChatId: 'chat-9',
            originTurnId: 'turn-77',
          ),
        ],
      );
      await _pumpSheet(
        tester,
        state: state,
        onOpenTranscript: (chatId, turnId) {
          capturedChat = chatId;
          capturedTurn = turnId;
        },
      );
      await tester.tap(find.byKey(const Key('agent-run-open-transcript')));
      await tester.pump();
      expect(capturedChat, 'chat-9');
      expect(capturedTurn, 'turn-77');
    });

    testWidgets('Open result callback fires with origin chat', (tester) async {
      String? capturedChat;
      final state = AgentSupervisionState(
        runs: [
          _running(
            toolCallId: 'call-A',
            originChatId: 'chat-9',
            latestOutput: 'final answer',
          ),
        ],
      );
      await _pumpSheet(
        tester,
        state: state,
        onOpenResult: (chatId) => capturedChat = chatId,
      );
      await tester.tap(find.byKey(const Key('agent-run-open-result')));
      await tester.pump();
      expect(capturedChat, 'chat-9');
    });

    testWidgets('global title renders verbatim', (tester) async {
      await _pumpSheet(
        tester,
        state: AgentSupervisionState.empty(),
        title: 'Global agents',
      );
      expect(find.text('Global agents'), findsOneWidget);
    });

    testWidgets('running badge hides when no run is in flight', (tester) async {
      final state = AgentSupervisionState(
        runs: [_running(status: AgentRunStatus.completed)],
      );
      await _pumpSheet(tester, state: state);
      expect(find.text('0 running'), findsNothing);
      expect(find.textContaining('running'), findsNothing);
    });
  });
}
