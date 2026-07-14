import 'package:drift/drift.dart' show Value;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/main.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/domain/mobile_state.dart';
import 'package:pi_mob/src/ui/shell/app_shell.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<void> selectDestination(
    WidgetTester tester,
    AppShellDestination destination,
  ) async {
    await tester.tap(find.byKey(Key('shell-${destination.name}')));
    await tester.pumpAndSettle();
  }

  testWidgets('shell exposes three named destinations with stable keys', (
    tester,
  ) async {
    final database = AppDatabase.withExecutor(NativeDatabase.memory());
    const hostId = '11111111-1111-4111-8111-111111111111';
    const sessionId = '22222222-2222-4222-8222-222222222222';
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
        sessionId: sessionId,
        hostId: hostId,
        name: 'Saved session',
        runtimeState: 'idle',
        queueCount: 0,
      ),
    );
    final coordinator = ConnectionCoordinator(
      transport: _OfflineTransport(),
      database: database,
    );
    await coordinator.initialize(autoConnect: false);
    await tester.binding.setSurfaceSize(const Size(1200, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(PiMobApp(coordinator: coordinator));
    await tester.pump();

    expect(find.byKey(const Key('shell-sessions')), findsOneWidget);
    expect(find.byKey(const Key('shell-activity')), findsOneWidget);
    expect(find.byKey(const Key('shell-host')), findsOneWidget);

    coordinator.dispose();
    await database.close();
  });

  testWidgets('diagnostics hidden from default Sessions landing', (
    tester,
  ) async {
    final database = AppDatabase.withExecutor(NativeDatabase.memory());
    const hostId = '11111111-1111-4111-8111-111111111111';
    await database.upsertHost(
      HostEntriesCompanion.insert(
        hostId: hostId,
        endpoint: 'https://fixture.test',
        displayName: 'Fixture host',
        generation: '1',
        connectionState: 'offline',
        bridgeVersion: const Value('m5'),
        piVersion: const Value('0.80.6'),
        protocolVersion: const Value('1.0'),
        capabilitiesJson: '[]',
      ),
    );
    final coordinator = ConnectionCoordinator(
      transport: _OfflineTransport(),
      database: database,
    );
    await coordinator.initialize(autoConnect: false);
    await tester.binding.setSurfaceSize(const Size(1200, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(PiMobApp(coordinator: coordinator));
    await tester.pump();
    await tester.pump();

    // No selected session => defaults to Sessions. Diagnostics must not
    // dominate this landing surface.
    expect(find.byKey(const Key('sessions-product-title')), findsOneWidget);
    expect(find.byKey(const Key('endpoint-field')), findsNothing);
    expect(find.byKey(const Key('draft-field')), findsNothing);
    expect(find.textContaining('Bridge:'), findsNothing);
    expect(find.textContaining('Protocol:'), findsNothing);

    coordinator.dispose();
    await database.close();
  });

  testWidgets(
    'default destination switches to Activity when a session exists',
    (tester) async {
      final database = AppDatabase.withExecutor(NativeDatabase.memory());
      const hostId = '11111111-1111-4111-8111-111111111111';
      const sessionId = '22222222-2222-4222-8222-222222222222';
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
          sessionId: sessionId,
          hostId: hostId,
          name: 'Active session',
          runtimeState: 'idle',
          queueCount: 0,
        ),
      );
      final coordinator = ConnectionCoordinator(
        transport: _OfflineTransport(),
        database: database,
      );
      await coordinator.initialize(autoConnect: false);
      await tester.binding.setSurfaceSize(const Size(1200, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(PiMobApp(coordinator: coordinator));
      await tester.pump();
      await tester.pump();

      // Activity surface visible from default landing; AppBar carries the
      // session name.
      expect(find.byKey(const Key('composer-card')), findsOneWidget);
      expect(find.byKey(const Key('activity-transcript')), findsOneWidget);
      expect(find.byKey(const Key('shell-app-bar-title')), findsOneWidget);
      expect(find.text('Active session'), findsWidgets);

      coordinator.dispose();
      await database.close();
    },
  );

  testWidgets(
    'switching destinations swaps the visible body and AppBar title',
    (tester) async {
      final database = AppDatabase.withExecutor(NativeDatabase.memory());
      const hostId = '11111111-1111-4111-8111-111111111111';
      const sessionId = '22222222-2222-4222-8222-222222222222';
      await database.upsertHost(
        HostEntriesCompanion.insert(
          hostId: hostId,
          endpoint: 'https://fixture.test',
          displayName: 'Fixture host',
          generation: '1',
          connectionState: 'offline',
          bridgeVersion: const Value('m5'),
          capabilitiesJson: '[]',
        ),
      );
      await database.upsertSessionState(
        const SessionState(
          sessionId: sessionId,
          hostId: hostId,
          name: 'Active session',
          runtimeState: 'idle',
          queueCount: 0,
        ),
      );
      final coordinator = ConnectionCoordinator(
        transport: _OfflineTransport(),
        database: database,
      );
      await coordinator.initialize(autoConnect: false);
      await tester.binding.setSurfaceSize(const Size(1200, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(PiMobApp(coordinator: coordinator));
      await tester.pump();
      await tester.pump();

      // Start on Activity (selected session exists).
      expect(find.byKey(const Key('composer-card')), findsOneWidget);

      await selectDestination(tester, AppShellDestination.sessions);
      expect(
        find.byKey(const Key('sessions-destination-scroll')),
        findsOneWidget,
      );
      expect(find.byKey(const Key('sessions-product-title')), findsOneWidget);
      expect(find.byKey(const Key('composer-card')), findsNothing);

      await selectDestination(tester, AppShellDestination.host);
      expect(find.byKey(const Key('host-destination-scroll')), findsOneWidget);
      expect(find.byKey(const Key('endpoint-field')), findsOneWidget);
      expect(find.byKey(const Key('host-privacy-explanation')), findsOneWidget);

      coordinator.dispose();
      await database.close();
    },
  );

  testWidgets('360x755 with no selected session does not overflow', (
    tester,
  ) async {
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
    final coordinator = ConnectionCoordinator(
      transport: _OfflineTransport(),
      database: database,
    );
    await coordinator.initialize(autoConnect: false);
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.binding.setSurfaceSize(const Size(360, 755));
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(2.0)),
        child: PiMobApp(coordinator: coordinator),
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(tester.takeException(), isNull);

    await selectDestination(tester, AppShellDestination.host);
    expect(tester.takeException(), isNull);

    // Activity is empty when no session is selected — the Compose path is
    // intentionally skipped so the empty-state card survives at 360x755
    // with 200% text scale.
    await selectDestination(tester, AppShellDestination.activity);
    expect(tester.takeException(), isNull);

    coordinator.dispose();
    await database.close();
  });

  testWidgets(
    'Activity destination keeps composer and Host keeps endpoint keys',
    (tester) async {
      final database = AppDatabase.withExecutor(NativeDatabase.memory());
      const hostId = '11111111-1111-4111-8111-111111111111';
      const sessionId = '22222222-2222-4222-8222-222222222222';
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
          sessionId: sessionId,
          hostId: hostId,
          name: 'Active session',
          runtimeState: 'idle',
          queueCount: 0,
        ),
      );
      final coordinator = ConnectionCoordinator(
        transport: _OfflineTransport(),
        database: database,
      );
      await coordinator.initialize(autoConnect: false);
      await tester.binding.setSurfaceSize(const Size(1200, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(PiMobApp(coordinator: coordinator));
      await tester.pump();
      await tester.pump();

      // Activity — composer reachable with its durable keys.
      expect(find.byKey(const Key('composer-card')), findsOneWidget);
      expect(find.byKey(const Key('draft-field')), findsOneWidget);
      expect(find.byKey(const Key('send-button')), findsOneWidget);
      expect(find.byKey(const Key('abort-button')), findsOneWidget);

      // Host — endpoint reachable with its durable keys.
      await selectDestination(tester, AppShellDestination.host);
      expect(find.byKey(const Key('endpoint-field')), findsOneWidget);
      expect(find.byKey(const Key('connect-button')), findsOneWidget);
      expect(find.byKey(const Key('retry-connection')), findsOneWidget);

      coordinator.dispose();
      await database.close();
    },
  );
}

class _OfflineTransport implements BridgeTransport {
  @override
  Future<BridgeSocket> connect(Uri endpoint) =>
      throw const SocketExceptionForTest();

  @override
  Future<EndpointProbe> probe(Uri endpoint) async => const EndpointProbe(
    statusCode: 503,
    ready: false,
    body: {'status': 'not_ready'},
  );
}

class SocketExceptionForTest implements Exception {
  const SocketExceptionForTest();
}
