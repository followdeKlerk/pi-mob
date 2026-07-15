import 'dart:async';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/domain/controller_lease.dart';
import 'package:pi_mob/src/domain/mobile_state.dart' as ms show StreamCursor;
import 'package:pi_mob/src/domain/session_directory.dart';
import 'package:pi_mob/src/domain/session_subscriptions.dart';

class _RecordingTransport implements BridgeTransport {
  final List<Map<String, Object?>> sent = [];
  EndpointProbe probeResult = const EndpointProbe(
    ready: true,
    statusCode: 200,
    body: {'status': 'ok'},
  );

  @override
  Future<EndpointProbe> probe(Uri endpoint) async => probeResult;

  @override
  Future<BridgeSocket> connect(Uri endpoint) async {
    return _NoopSocket(sent);
  }
}

class _NoopSocket implements BridgeSocket {
  _NoopSocket(this.sent);
  final List<Map<String, Object?>> sent;
  final StreamController<String> _controller =
      StreamController<String>.broadcast();

  @override
  Stream<String> get messages => _controller.stream;

  @override
  Future<void> send(Map<String, Object?> message) async {
    sent.add(message);
  }

  @override
  Future<void> close([int? code, String? reason]) async {
    await _controller.close();
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late AppDatabase db;
  late _RecordingTransport transport;
  late ConnectionCoordinator coordinator;

  setUp(() async {
    db = AppDatabase.withExecutor(NativeDatabase.memory());
    transport = _RecordingTransport();
    coordinator = ConnectionCoordinator(transport: transport, database: db);
    await coordinator.initialize(autoConnect: false);
  });

  tearDown(() async {
    coordinator.dispose();
    await db.close();
  });

  test('takeControl repairs a missing foreground subscription', () async {
    expect(coordinator.subscriptionSet.isEmpty, isTrue);

    await coordinator.takeControl('restored-session');

    expect(coordinator.subscriptionSet.full?.sessionId, 'restored-session');
    expect(coordinator.selectedSessionId, 'restored-session');
  });

  test('subscription set starts empty and gains a summary row', () async {
    expect(coordinator.subscriptionSet.isEmpty, isTrue);
    await coordinator.addSummarySubscription('sA');
    expect(coordinator.subscriptionSet.summaries, hasLength(1));
  });

  test('addSummarySubscription enforces the five-cap', () async {
    for (var i = 0; i < 5; i++) {
      await coordinator.addSummarySubscription('s$i');
    }
    expect(
      () => coordinator.addSummarySubscription('overflow'),
      throwsStateError,
    );
  });

  test('controller book adopts a primary and exposes it as the active one', () {
    coordinator.adoptControllerEvent(<String, Object?>{
      'sessionId': 's1',
      'mode': 'controller',
      'leaseId': 'lease-1',
    });
    expect(coordinator.primarySessionId, 's1');
    expect(coordinator.controllerStates['s1']?.mode, ControllerMode.primary);
    expect(coordinator.controllerStates['s1']?.leaseId, 'lease-1');
  });

  test('observer event demotes primary and clears the lease', () {
    coordinator.adoptControllerEvent(<String, Object?>{
      'sessionId': 's1',
      'mode': 'controller',
      'leaseId': 'lease-1',
    });
    coordinator.adoptControllerEvent(<String, Object?>{
      'sessionId': 's1',
      'mode': 'observer',
      'leaseId': 'lease-1',
    });
    expect(coordinator.primarySessionId, isNull);
    expect(coordinator.controllerStates['s1']?.mode, ControllerMode.observer);
  });

  test('takeover is rejected on a non-full session', () async {
    await coordinator.addSummarySubscription('sA');
    expect(() => coordinator.takeoverController('sA'), throwsStateError);
  });

  test('attention events never cross-apply between sessions', () {
    coordinator.markAttention(
      sessionId: 'sA',
      state: SessionAttentionState.unread,
      unreadCount: 2,
    );
    coordinator.markAttention(
      sessionId: 'sB',
      state: SessionAttentionState.background,
    );
    expect(coordinator.attentionFor('sA'), SessionAttentionState.unread);
    expect(coordinator.unreadCountFor('sA'), 2);
    expect(coordinator.attentionFor('sB'), SessionAttentionState.background);
    expect(coordinator.unreadCountFor('sB'), 0);
    // Sessions not explicitly marked stay at none.
    expect(coordinator.attentionFor('sC'), SessionAttentionState.none);
  });

  test('subscription set isolates cursors per session', () {
    var set = SessionSubscriptionSet.empty()
        .setFull(sessionId: 'a', cursor: ms.StreamCursor.parse('4'))
        .addSummary(sessionId: 'b', cursor: ms.StreamCursor.parse('7'));
    set = set.advanceCursor(sessionId: 'b', next: ms.StreamCursor.parse('11'));
    expect(set.full?.cursor.value, '4');
    expect(set.summaries.single.cursor.value, '11');
  });

  test('directory filters and pages without cross-row contamination', () {
    final rows = List<SessionSummary>.generate(
      7,
      (i) => SessionSummary(
        sessionId: 's$i',
        name: 'session $i',
        runtimeState: i.isEven ? 'idle' : 'running',
        workspaceId: 'w1',
        attention: i == 3
            ? SessionAttentionState.needsAttention
            : SessionAttentionState.none,
        controllerMode: 'observer',
        queueDepth: 0,
        unreadCount: 0,
        lastActivityAt: DateTime.utc(2026, 1, 1),
      ),
    );
    final directory = SessionDirectory.fromSummaries(
      rows,
      filter: const SessionFilter(
        attentionStates: {SessionAttentionState.needsAttention},
      ),
      pageSize: 5,
    );
    final page = directory.page();
    expect(page.rows, hasLength(1));
    expect(page.rows.single.sessionId, 's3');
  });
}
