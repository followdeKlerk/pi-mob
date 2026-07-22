import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/domain/process_domain.dart';

const sessionId = '11111111-1111-4111-8111-111111111111';
const startedAt = '2026-07-15T00:00:00.000Z';

Map<String, Object?> snapshotEnvelope({
  String processId = 'process-1',
  String revision = 'process-r1',
  String status = 'running',
  List<String> supportedActions = const <String>['stop'],
  bool stale = false,
}) => <String, Object?>{
  'type': 'process.snapshot',
  'payload': <String, Object?>{
    'sessionId': sessionId,
    'processId': processId,
    'revision': revision,
    'status': status,
    'command': 'bun test',
    'startedAt': startedAt,
    'capability': 'runtime.processes.v1',
    'stale': stale,
    'supportedActions': supportedActions,
    'pid': 4123,
    'ports': const <Object?>[
      <String, Object?>{'port': 4173, 'protocol': 'tcp'},
    ],
  },
};

Map<String, Object?> snapshotResultEnvelope(List<Map<String, Object?>> items) =>
    <String, Object?>{
      'type': 'process.snapshot.result',
      'payload': <String, Object?>{'items': items},
    };

Map<String, Object?> outputEnvelope({
  String type = 'process.output',
  String revision = 'process-r1',
  String stream = 'stdout',
  String content = 'ok\n',
}) => <String, Object?>{
  'type': type,
  'payload': <String, Object?>{
    'sessionId': sessionId,
    'processId': 'process-1',
    'revision': revision,
    'stream': stream,
    'content': content,
    'truncation': <String, Object?>{
      'retainedBytes': content.length,
      'totalBytes': content.length,
      'isTruncated': false,
    },
    'cursor': '1',
    'pageToken': 'page-1',
  },
};

Map<String, Object?> unavailableEnvelope() => <String, Object?>{
  'type': 'process.unavailable',
  'payload': <String, Object?>{
    'sessionId': sessionId,
    'capability': 'runtime.processes.v1',
    'status': <String, Object?>{
      'state': 'unavailable',
      'reason': 'upgrade bridge',
      'remediation': 'refresh capabilities',
    },
  },
};

void main() {
  test('decodes canonical snapshot events with full authoritative fields', () {
    final state = reduceProcess(
      const ProcessDomainState(),
      snapshotEnvelope(),
    );

    final process = state.items.single;
    expect(process.sessionId, sessionId);
    expect(process.processId, 'process-1');
    expect(process.pid, 4123);
    expect(process.ports.single.port, 4173);
    expect(process.supports(MobileProcessAction.stop), isTrue);
  });

  test('decodes canonical response payloads and keeps stdout/stderr separate', () {
    var state = reduceProcess(const ProcessDomainState(), snapshotEnvelope());
    state = reduceProcess(
      state,
      outputEnvelope(type: 'process.output.page.result', stream: 'stdout'),
    );
    state = reduceProcess(
      state,
      outputEnvelope(stream: 'stderr', content: 'boom\n'),
    );
    state = reduceProcess(
      state,
      outputEnvelope(revision: 'process-r2', content: 'stale\n'),
    );

    final process = state.items.single;
    expect(process.stdout?.content, 'ok\n');
    expect(process.stderr?.content, 'boom\n');
    expect(process.stdout?.stream, 'stdout');
    expect(process.stderr?.stream, 'stderr');
  });

  test('snapshot result replaces a session inventory by process id', () {
    var state = reduceProcess(const ProcessDomainState(), snapshotEnvelope());
    state = reduceProcess(
      state,
      snapshotEnvelope(processId: 'process-2', revision: 'process-r2'),
    );

    final replacementItem = Map<String, Object?>.from(
      snapshotEnvelope(revision: 'process-r3')['payload'] as Map<String, Object?>,
    )..['supportedActions'] = const <String>['restart', 'rerun'];
    state = reduceProcess(state, snapshotResultEnvelope(<Map<String, Object?>>[
      replacementItem,
    ]));

    expect(state.items, hasLength(1));
    expect(state.items.single.processId, 'process-1');
    expect(state.items.single.revision, 'process-r3');
    expect(state.items.single.supports(MobileProcessAction.restart), isTrue);
  });

  test('unavailable clears actions and stale snapshots stay gated', () {
    var state = reduceProcess(
      const ProcessDomainState(),
      snapshotEnvelope(supportedActions: const <String>['stop', 'restart']),
    );
    state = reduceProcess(state, unavailableEnvelope());

    var process = state.items.single;
    expect(state.unavailable, isTrue);
    expect(process.supportedActions, isEmpty);
    expect(process.supports(MobileProcessAction.stop), isFalse);

    state = reduceProcess(
      state,
      snapshotEnvelope(
        revision: 'process-r2',
        supportedActions: const <String>['restart'],
        stale: true,
      ),
    );
    process = state.items.single;
    expect(state.unavailable, isFalse);
    expect(process.supportedActions, [MobileProcessAction.restart]);
    expect(process.supports(MobileProcessAction.restart), isFalse);
  });

  testWidgets('sheet renders only gated actions and truthful unavailable text', (
    tester,
  ) async {
    final available = reduceProcess(
      const ProcessDomainState(),
      snapshotEnvelope(supportedActions: const <String>['restart']),
    );
    final unavailable = reduceProcess(available, unavailableEnvelope());

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ProcessSheet(
            state: unavailable,
            onStop: (_) {},
            onRestart: (_) {},
            onRerun: (_) {},
          ),
        ),
      ),
    );

    expect(find.text('Processes unavailable'), findsOneWidget);
    expect(find.text('upgrade bridge'), findsOneWidget);
    expect(find.byIcon(Icons.refresh), findsNothing);
    expect(find.textContaining('PID unavailable'), findsNothing);
  });
}
