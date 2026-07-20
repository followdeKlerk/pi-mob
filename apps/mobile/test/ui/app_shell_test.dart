import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/main.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/domain/mobile_state.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('shell exposes one Chat surface without destination tabs', (
    tester,
  ) async {
    final fixture = await _fixture(withSession: true);
    addTearDown(fixture.dispose);

    await tester.pumpWidget(PiMobApp(coordinator: fixture.coordinator));
    await tester.pump();

    expect(find.text('Saved chat'), findsOneWidget);
    expect(find.byKey(const Key('open-chat-drawer')), findsOneWidget);
    expect(find.byKey(const Key('open-transcript-search')), findsOneWidget);
    expect(find.byKey(const Key('open-chat-controls')), findsNothing);
    expect(find.byType(NavigationBar), findsNothing);
    expect(find.byKey(const Key('shell-sessions')), findsNothing);
    expect(find.byKey(const Key('shell-activity')), findsNothing);
    expect(find.byKey(const Key('shell-host')), findsNothing);
    expect(find.byKey(const Key('host-destination-scroll')), findsNothing);
    expect(find.byKey(const Key('composer-card')), findsOneWidget);
  });

  testWidgets('hamburger opens saved chats without repeating host identity', (
    tester,
  ) async {
    final fixture = await _fixture(withSession: true);
    addTearDown(fixture.dispose);

    await tester.pumpWidget(PiMobApp(coordinator: fixture.coordinator));
    await tester.pump();
    await tester.tap(find.byKey(const Key('open-chat-drawer')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('chat-session-drawer')), findsOneWidget);
    expect(find.byKey(const Key('saved-chat-list')), findsOneWidget);
    expect(find.text('Saved chat'), findsWidgets);
    expect(find.textContaining('Fixture host'), findsNothing);
    expect(find.byKey(const Key('new-chat-button')), findsOneWidget);
    expect(find.byKey(const Key('change-chat-folder')), findsOneWidget);
    expect(
      find.byKey(
        const Key('chat-actions-22222222-2222-4222-8222-222222222222'),
      ),
      findsOneWidget,
    );
  });

  testWidgets('empty Chat opens the same saved-chat drawer', (tester) async {
    final fixture = await _fixture();
    addTearDown(fixture.dispose);

    await tester.pumpWidget(PiMobApp(coordinator: fixture.coordinator));
    await tester.pump();

    expect(find.byKey(const Key('activity-empty-state')), findsOneWidget);
    expect(find.text('Open chats'), findsOneWidget);
    await tester.tap(find.byKey(const Key('activity-empty-go-sessions')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('chat-session-drawer')), findsOneWidget);
    expect(find.text('No saved chats yet'), findsOneWidget);
  });
}

Future<_Fixture> _fixture({bool withSession = false}) async {
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
  if (withSession) {
    await database.upsertSessionState(
      const SessionState(
        sessionId: '22222222-2222-4222-8222-222222222222',
        hostId: hostId,
        name: 'Saved chat',
        runtimeState: 'idle',
        queueCount: 0,
      ),
    );
  }
  final coordinator = ConnectionCoordinator(
    transport: _OfflineTransport(),
    database: database,
  );
  await coordinator.initialize(autoConnect: false);
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
  @override
  Future<BridgeSocket> connect(Uri endpoint) => throw const _Offline();

  @override
  Future<EndpointProbe> probe(Uri endpoint) async => const EndpointProbe(
    statusCode: 503,
    ready: false,
    body: {'status': 'not_ready'},
  );
}

final class _Offline implements Exception {
  const _Offline();
}
