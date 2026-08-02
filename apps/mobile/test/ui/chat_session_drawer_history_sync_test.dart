import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/ui/shell/chat_session_drawer.dart';

/// Drawer regression: while the coordinator is past hello (phase
/// `synchronizing`) or has not finished the history gate, the drawer
/// must surface a visible syncing indicator so the user does not
/// interpret cached chats as a ready host.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('drawer surfaces synchronizing indicator when phase is synchronizing',
      (tester) async {
    final fixture = _DrawerFixture();
    fixture.coordinator.debugForcePhase(ConnectionPhase.synchronizing);
    addTearDown(fixture.dispose);

    await _openDrawer(tester, fixture);

    expect(
      find.byKey(const Key('drawer-history-sync-indicator')),
      findsOneWidget,
    );
  });

  testWidgets(
      'drawer surfaces history-gate indicator when phase is ready and gate incomplete',
      (tester) async {
    final fixture = _DrawerFixture();
    // phase=ready mirrors a successful hello/handshake; the gate being
    // incomplete mirrors the post-hello state where the bridge is
    // streaming durable history before the user can browse it.
    fixture.coordinator.debugForcePhase(ConnectionPhase.ready);
    fixture.coordinator.debugSetHistorySyncState(
      completed: 1,
      total: 4,
      complete: false,
    );
    addTearDown(fixture.dispose);

    await _openDrawer(tester, fixture);

    expect(
      find.byKey(const Key('drawer-history-sync-indicator')),
      findsOneWidget,
    );
  });

  testWidgets(
      'drawer does NOT surface history-sync indicator when ready and gate complete',
      (tester) async {
    final fixture = _DrawerFixture();
    fixture.coordinator.debugForcePhase(ConnectionPhase.ready);
    fixture.coordinator.debugSetHistorySyncState(
      completed: 4,
      total: 4,
      complete: true,
    );
    addTearDown(fixture.dispose);

    await _openDrawer(tester, fixture);

    expect(
      find.byKey(const Key('drawer-history-sync-indicator')),
      findsNothing,
    );
  });
}

Future<void> _openDrawer(WidgetTester tester, _DrawerFixture fixture) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        drawer: ChatSessionDrawer(
          coordinator: fixture.coordinator,
          notifications: null,
          onForgetHost: fixture.forgetHost,
        ),
        body: Builder(
          builder: (context) => TextButton(
            key: const Key('open-test-drawer'),
            onPressed: () => Scaffold.of(context).openDrawer(),
            child: const Text('Open drawer'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.byKey(const Key('open-test-drawer')));
  // MotionSpinner uses an indefinite animation; pump() once for the
  // drawer slide-in frame rather than pumpAndSettle.
  await tester.pump(const Duration(milliseconds: 400));
}

final class _DrawerFixture {
  _DrawerFixture() {
    database = AppDatabase.withExecutor(NativeDatabase.memory());
    coordinator = ConnectionCoordinator(
      transport: const _OfflineTransport(),
      database: database,
    );
    coordinator.addListener(_refresh);
  }

  late final AppDatabase database;
  late final ConnectionCoordinator coordinator;
  int forgetHostCalls = 0;

  void _refresh() {}

  Future<void> forgetHost() async {
    forgetHostCalls += 1;
  }

  Future<void> dispose() async {
    coordinator.removeListener(_refresh);
    coordinator.dispose();
    await database.close();
  }
}

final class _OfflineTransport implements BridgeTransport {
  const _OfflineTransport();

  @override
  Future<BridgeSocket> connect(Uri endpoint) =>
      throw UnsupportedError('not used by drawer tests');

  @override
  Future<EndpointProbe> probe(Uri endpoint) =>
      throw UnsupportedError('not used by drawer tests');
}