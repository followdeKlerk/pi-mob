import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/domain/mobile_state.dart';
import 'package:pi_mob/src/ui/shell/session_sync_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('sync gate is compact and never renders session identities', (
    tester,
  ) async {
    final fixture = await _fixture();
    addTearDown(fixture.dispose);
    fixture.coordinator.debugSetHistorySyncState(completed: 2, total: 5);
    await tester.pumpWidget(_app(fixture.coordinator));
    await tester.pump();

    expect(find.text('Syncing chats'), findsOneWidget);
    expect(find.text('2 of 5 chats synced'), findsOneWidget);
    expect(find.byKey(const Key('all-chat-sync-progress')), findsOneWidget);
    expect(find.byKey(const Key('sync-session-list')), findsNothing);
    expect(find.text('Private session name'), findsNothing);
    expect(find.textContaining('22222222'), findsNothing);
  });

  testWidgets('unknown total renders indeterminate progress', (tester) async {
    final fixture = await _fixture();
    addTearDown(fixture.dispose);
    fixture.coordinator.debugSetHistorySyncState(completed: 0, total: 0);
    await tester.pumpWidget(_app(fixture.coordinator));
    await tester.pump();

    expect(find.text('Preparing chats…'), findsOneWidget);
    final progress = tester.widget<LinearProgressIndicator>(
      find.byType(LinearProgressIndicator),
    );
    expect(progress.value, isNull);
  });

  testWidgets('error state exposes Retry without session rows', (tester) async {
    final fixture = await _fixture();
    addTearDown(fixture.dispose);
    fixture.coordinator.debugSetHistorySyncState(
      completed: 1,
      total: 3,
      error: 'network',
    );
    await tester.pumpWidget(_app(fixture.coordinator));
    await tester.pump();

    expect(find.text('Could not finish syncing chats'), findsOneWidget);
    expect(find.byKey(const Key('retry-all-chat-sync')), findsOneWidget);
    expect(find.byKey(const Key('sync-session-list')), findsNothing);
  });

  testWidgets('network progress repaints after one pump without a tap', (
    tester,
  ) async {
    final fixture = await _fixture();
    addTearDown(fixture.dispose);
    await tester.pumpWidget(_listeningGate(fixture.coordinator));
    expect(find.text('Preparing chats…'), findsOneWidget);

    fixture.coordinator.debugSetHistorySyncState(completed: 1, total: 4);
    await tester.pump();

    expect(find.text('1 of 4 chats synced'), findsOneWidget);
  });

  testWidgets('completion exits the synchronization gate automatically', (
    tester,
  ) async {
    final fixture = await _fixture();
    addTearDown(fixture.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: AnimatedBuilder(
          animation: fixture.coordinator,
          builder: (context, _) => fixture.coordinator.historyGateComplete
              ? const SizedBox(key: Key('normal-chat-surface'))
              : SessionSyncScreen(coordinator: fixture.coordinator),
        ),
      ),
    );
    expect(find.byKey(const Key('session-sync-screen')), findsOneWidget);

    fixture.coordinator.debugSetHistorySyncState(
      completed: 4,
      total: 4,
      complete: true,
    );
    await tester.pump();

    expect(find.byKey(const Key('normal-chat-surface')), findsOneWidget);
    expect(find.byKey(const Key('session-sync-screen')), findsNothing);
  });

  test('notification bursts coalesce and retain the latest progress', () async {
    final fixture = await _fixture();
    addTearDown(fixture.dispose);
    var notifications = 0;
    fixture.coordinator.addListener(() => notifications += 1);

    fixture.coordinator.debugSetHistorySyncState(completed: 1, total: 3);
    fixture.coordinator.debugSetHistorySyncState(completed: 2, total: 3);
    fixture.coordinator.debugSetHistorySyncState(completed: 3, total: 3);
    await Future<void>.delayed(Duration.zero);

    expect(notifications, 1);
    expect(fixture.coordinator.historySyncCompleted, 3);
  });

  test('pending notification is disposal safe', () async {
    final fixture = await _fixture();
    var notifications = 0;
    fixture.coordinator.addListener(() => notifications += 1);
    fixture.coordinator.debugSetHistorySyncState(completed: 1, total: 2);
    fixture.coordinator.dispose();
    await Future<void>.delayed(Duration.zero);
    expect(notifications, 0);
    await fixture.database.close();
  });
}

Widget _app(ConnectionCoordinator coordinator) => MaterialApp(
  home: Scaffold(body: SessionSyncScreen(coordinator: coordinator)),
);

Widget _listeningGate(ConnectionCoordinator coordinator) => MaterialApp(
  home: AnimatedBuilder(
    animation: coordinator,
    builder: (context, _) =>
        Scaffold(body: SessionSyncScreen(coordinator: coordinator)),
  ),
);

Future<_Fixture> _fixture() async {
  final database = AppDatabase.withExecutor(NativeDatabase.memory());
  const hostId = '11111111-1111-4111-8111-111111111111';
  await database.upsertHost(
    HostEntriesCompanion.insert(
      hostId: hostId,
      endpoint: 'https://fixture.test',
      displayName: 'Fixture host',
      generation: '1',
      connectionState: 'offline',
      capabilitiesJson: '[]',
    ),
  );
  await database.upsertSessionState(
    const SessionState(
      sessionId: '22222222-2222-4222-8222-222222222222',
      hostId: hostId,
      name: 'Private session name',
      runtimeState: 'idle',
      queueCount: 0,
    ),
  );
  final coordinator = ConnectionCoordinator(
    transport: const _OfflineTransport(),
    database: database,
  );
  await coordinator.initialize(autoConnect: false);
  // Drain initialization's coalesced notification before each assertion.
  await Future<void>.microtask(() {});
  return _Fixture(database, coordinator);
}

final class _Fixture {
  const _Fixture(this.database, this.coordinator);

  final AppDatabase database;
  final ConnectionCoordinator coordinator;

  Future<void> dispose() async {
    coordinator.dispose();
    await database.close();
  }
}

final class _OfflineTransport implements BridgeTransport {
  const _OfflineTransport();

  @override
  Future<BridgeSocket> connect(Uri endpoint) => throw StateError('offline');

  @override
  Future<EndpointProbe> probe(Uri endpoint) async => const EndpointProbe(
    ready: false,
    statusCode: 503,
    body: {'status': 'not_ready'},
  );
}
