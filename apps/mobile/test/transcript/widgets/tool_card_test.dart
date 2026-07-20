/// Compact tests for [ToolCard], the single factory that renders every
/// built-in tool plus the unknown fallback.
///
/// Coverage:
///
///   * The seven built-in tools (`read`, `bash`, `edit`, `write`,
///     `grep`, `find`, `ls`) each surface their canonical label.
///   * The unknown fallback prefixes with `Unknown tool:`.
///   * All five lifecycle states (`running`, `completed`, `error`,
///     `cancelled`, `policyDenied`) render the expected colour, icon,
///     and label without throwing.
///   * Truncated tool output exposes the retained/total byte summary
///     and the optional digest, both visible and accessible.
///   * Tap toggles the expanded body, and the body content survives
///     across rebuilds of the same widget instance.
///   * The semantic label includes the tool name and the status
///     announcement, and the policy-denied state shares the same banner
///     surface as `error`.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/transcript/widgets/tool_card.dart';
import 'package:pi_mob/src/transcript/widgets/transcript_status.dart';
import 'package:pi_mob/src/transcript/widgets/view_data/tool_call_view_data.dart';

ToolCallViewData _buildData({
  required String toolName,
  required TranscriptToolStatus status,
  Map<String, Object?> arguments = const <String, Object?>{},
  Map<String, Object?>? result,
  String? errorMessage,
  ToolOutputTruncation? truncation,
  DateTime? startedAt,
  DateTime? finishedAt,
}) => ToolCallViewData(
  toolCallId: 'call-$toolName-${status.name}',
  toolName: toolName,
  arguments: arguments,
  status: status,
  result: result,
  errorMessage: errorMessage,
  truncation: truncation,
  startedAt: startedAt,
  finishedAt: finishedAt,
);

Widget _wrap(Widget child, {TextScaler textScaler = TextScaler.noScaling}) {
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

  testWidgets('renders the canonical label for every built-in tool', (
    tester,
  ) async {
    for (final name in BuiltInToolName.all) {
      final args = switch (name) {
        BuiltInToolName.read => const <String, Object?>{'path': '/tmp/a'},
        BuiltInToolName.bash => const <String, Object?>{'command': 'echo hi'},
        BuiltInToolName.edit => const <String, Object?>{
          'path': '/tmp/a',
          'oldText': 'a',
          'newText': 'b',
        },
        BuiltInToolName.write => const <String, Object?>{
          'path': '/tmp/a',
          'content': 'data',
        },
        BuiltInToolName.grep => const <String, Object?>{'pattern': 'foo'},
        BuiltInToolName.find => const <String, Object?>{'pattern': '*.dart'},
        BuiltInToolName.ls => const <String, Object?>{'path': '/tmp'},
        _ => const <String, Object?>{},
      };
      await tester.pumpWidget(
        _wrap(
          ToolCard.forViewData(
            _buildData(
              toolName: name,
              status: TranscriptToolStatus.completed,
              arguments: args,
              result: const <String, Object?>{'ok': true},
            ),
          ),
        ),
      );
      expect(find.text(name), findsOneWidget, reason: '$name label missing');
      expect(find.byType(InkWell), findsWidgets);
    }
  });

  testWidgets('unknown tool renders the fallback label', (tester) async {
    await tester.pumpWidget(
      _wrap(
        ToolCard.forViewData(
          _buildData(toolName: 'mystery', status: TranscriptToolStatus.running),
        ),
      ),
    );
    expect(find.text('mystery'), findsOneWidget);
  });

  for (final status in TranscriptToolStatus.values) {
    testWidgets('renders $status status label + icon without errors', (
      tester,
    ) async {
      await tester.pumpWidget(
        _wrap(
          ToolCard.forViewData(
            _buildData(
              toolName: BuiltInToolName.read,
              status: status,
              arguments: const <String, Object?>{'path': '/tmp/x'},
              result: status == TranscriptToolStatus.completed
                  ? const <String, Object?>{'content': 'hi', 'byteCount': 2}
                  : null,
              errorMessage: switch (status) {
                TranscriptToolStatus.error => 'boom',
                TranscriptToolStatus.policyDenied => 'forbidden',
                _ => null,
              },
            ),
          ),
        ),
      );
      expect(find.text(status.label), findsOneWidget);
      expect(
        find.byIcon(status.icon),
        findsOneWidget,
        reason: 'status icon for $status missing',
      );
      if (status.isFailure) {
        expect(find.byKey(const Key('tool-error-banner')), findsOneWidget);
      }
    });
  }

  testWidgets('truncation banner surfaces retained, total, and digest values', (
    tester,
  ) async {
    const truncation = ToolOutputTruncation(
      retainedBytes: 5120,
      totalBytes: 20480,
      digest: 'abc123',
    );
    await tester.pumpWidget(
      _wrap(
        ToolCard.forViewData(
          _buildData(
            toolName: BuiltInToolName.read,
            status: TranscriptToolStatus.completed,
            arguments: const <String, Object?>{'path': '/tmp/x'},
            result: const <String, Object?>{'content': 'hi', 'byteCount': 5120},
            truncation: truncation,
          ),
        ),
      ),
    );
    expect(find.byKey(const Key('tool-truncation-banner')), findsOneWidget);
    expect(find.textContaining('5.0 KB'), findsOneWidget);
    expect(find.textContaining('20.0 KB'), findsOneWidget);
    expect(find.textContaining('retained'), findsOneWidget);
    expect(find.textContaining('SHA-256 abc123'), findsOneWidget);
  });

  testWidgets('tap toggles expanded body with arguments and result', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        ToolCard.forViewData(
          _buildData(
            toolName: BuiltInToolName.read,
            status: TranscriptToolStatus.completed,
            arguments: const <String, Object?>{
              'path': '/tmp/x',
              'offset': 4,
              'limit': 8,
            },
            result: const <String, Object?>{
              'content': 'long body',
              'byteCount': 8,
              'totalLines': 12,
            },
          ),
        ),
      ),
    );
    // Argument detail is hidden until expanded.
    expect(find.text('Arguments'), findsNothing);
    await tester.tap(find.text('read'));
    await tester.pump();
    expect(find.text('Arguments'), findsOneWidget);
    expect(find.text('Result'), findsOneWidget);
    expect(find.textContaining('/tmp/x', findRichText: true), findsOneWidget);
    expect(find.textContaining('8', findRichText: true), findsWidgets);

    // Collapse again.
    await tester.tap(find.text('read'));
    await tester.pump();
    expect(find.text('Arguments'), findsNothing);
  });

  testWidgets(
    'expansion survives a data refresh and re-anchored status changes',
    (tester) async {
      final key = GlobalKey();

      await tester.pumpWidget(
        _wrap(
          ToolCard.forViewData(
            const ToolCallViewData(
              toolCallId: 't1',
              toolName: BuiltInToolName.bash,
              arguments: <String, Object?>{'command': 'ls'},
              status: TranscriptToolStatus.running,
            ),
            key: key,
          ),
        ),
      );
      await tester.tap(find.text('bash'));
      await tester.pump();
      expect(find.text('Arguments'), findsOneWidget);

      // Refresh the same widget instance with completed status.
      await tester.pumpWidget(
        _wrap(
          ToolCard.forViewData(
            const ToolCallViewData(
              toolCallId: 't1',
              toolName: BuiltInToolName.bash,
              arguments: <String, Object?>{'command': 'ls'},
              status: TranscriptToolStatus.completed,
              result: <String, Object?>{
                'stdout': '',
                'stderr': '',
                'exitCode': 0,
              },
            ),
            key: key,
          ),
        ),
      );
      expect(
        find.text('Completed'),
        findsOneWidget,
        reason: 'status label should switch with the new view-data',
      );
      expect(
        find.text('Arguments'),
        findsOneWidget,
        reason: 'expansion state must persist across rebuilds of the same key',
      );
    },
  );

  testWidgets('semantics label announces tool name and status', (tester) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(
      _wrap(
        ToolCard.forViewData(
          _buildData(
            toolName: BuiltInToolName.grep,
            status: TranscriptToolStatus.policyDenied,
            arguments: const <String, Object?>{'pattern': 'foo'},
            errorMessage: 'blocked',
          ),
        ),
      ),
    );
    expect(
      find.bySemanticsLabel('Tool grep, Status: policy denied'),
      findsOneWidget,
    );
    handle.dispose();
  });

  testWidgets(
    'malformed argument payload renders raw JSON + parse failure notice',
    (tester) async {
      await tester.pumpWidget(
        _wrap(
          ToolCard.forViewData(
            _buildData(
              toolName: BuiltInToolName.read,
              status: TranscriptToolStatus.completed,
              // Missing required `path`.
              arguments: const <String, Object?>{'limit': 1},
              result: const <String, Object?>{'content': 'x', 'byteCount': 1},
            ),
          ),
        ),
      );
      await tester.tap(find.text('read'));
      await tester.pump();
      expect(find.textContaining('Argument parse failed'), findsOneWidget);
      expect(find.text('Raw arguments'), findsOneWidget);
    },
  );

  testWidgets('large output is capped before text layout', (tester) async {
    await tester.pumpWidget(
      _wrap(
        ToolCard.forViewData(
          _buildData(
            toolName: BuiltInToolName.read,
            status: TranscriptToolStatus.completed,
            arguments: const <String, Object?>{'path': 'large.txt'},
            result: <String, Object?>{
              'content': List<String>.filled(200000, 'x').join(),
              'byteCount': 200000,
            },
          ),
        ),
      ),
    );
    await tester.tap(find.text('read'));
    await tester.pump();
    expect(find.byKey(const Key('tool-inline-preview-cap')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
