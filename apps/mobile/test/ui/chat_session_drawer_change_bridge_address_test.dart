import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/ui/shell/chat_session_drawer.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('drawer shows a change bridge address action', (tester) async {
    final fixture = _DrawerFixture();
    addTearDown(fixture.dispose);

    await _openDrawer(tester, fixture);
    await _openSettings(tester);

    expect(find.byKey(const Key('drawer-forget-host')), findsOneWidget);
    expect(find.text('Change bridge address'), findsOneWidget);
    expect(find.text('Forget connection'), findsNothing);
  });

  testWidgets(
    'cancelling bridge address change keeps pairing and drawer open',
    (tester) async {
      final fixture = _DrawerFixture();
      addTearDown(fixture.dispose);

      await _openDrawer(tester, fixture);
      await _openSettings(tester);
      await tester.tap(find.byKey(const Key('drawer-forget-host')));
      await tester.pumpAndSettle();

      expect(find.text('Change bridge address?'), findsOneWidget);
      expect(
        find.textContaining('Saved chats and cached data'),
        findsOneWidget,
      );
      expect(find.textContaining('local drafts are preserved'), findsOneWidget);

      await tester.tap(find.byKey(const Key('cancel-change-bridge-address')));
      await tester.pumpAndSettle();

      expect(fixture.forgetHostCalls, 0);
      expect(find.byKey(const Key('chat-session-drawer')), findsOneWidget);
      expect(find.text('Change bridge address?'), findsNothing);
    },
  );

  testWidgets(
    'confirming bridge address change forgets host and closes drawer',
    (tester) async {
      final fixture = _DrawerFixture();
      addTearDown(fixture.dispose);

      await _openDrawer(tester, fixture);
      await _openSettings(tester);
      await tester.tap(find.byKey(const Key('drawer-forget-host')));
      await tester.pumpAndSettle();

      expect(find.text('Change bridge address?'), findsOneWidget);
      expect(
        find.byKey(const Key('confirm-change-bridge-address')),
        findsOneWidget,
      );

      await tester.tap(find.byKey(const Key('confirm-change-bridge-address')));
      await tester.pumpAndSettle();

      expect(fixture.forgetHostCalls, 1);
      expect(find.byKey(const Key('chat-session-drawer')), findsNothing);
    },
  );
}

Future<void> _openSettings(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('drawer-settings')));
  await tester.pumpAndSettle();
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
  await tester.pumpAndSettle();
}

final class _DrawerFixture {
  _DrawerFixture() {
    database = AppDatabase.withExecutor(NativeDatabase.memory());
    coordinator = ConnectionCoordinator(
      transport: const _OfflineTransport(),
      database: database,
    );
  }

  late final AppDatabase database;
  late final ConnectionCoordinator coordinator;
  int forgetHostCalls = 0;

  Future<void> forgetHost() async {
    forgetHostCalls += 1;
  }

  Future<void> dispose() async {
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
