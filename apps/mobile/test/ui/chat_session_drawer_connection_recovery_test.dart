import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/ui/shell/chat_session_drawer.dart';

/// Drawer recovery regression: when the bridge has demoted to an
/// off-rail phase (incompatible / degraded / hostUnreachable /
/// hostDraining), the user must be able to see WHAT went wrong and
/// attempt a recovery action without leaving the drawer. The
/// "Issue" pill on its own is not enough for an alpha preview.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'drawer surfaces sanitized errorMessage when phase is incompatible',
    (tester) async {
      final fixture = _DrawerFixture();
      fixture.coordinator.debugSetErrorMessage('Protocol error: Bad envelope');
      fixture.coordinator.debugForcePhase(ConnectionPhase.incompatible);
      addTearDown(fixture.dispose);

      await _openDrawer(tester, fixture);

      final errorFinder = find.byKey(const Key('drawer-connection-error'));
      expect(errorFinder, findsOneWidget);
      final widget = tester.widget<SelectableText>(errorFinder);
      expect(widget.data, 'Protocol error: Bad envelope');
      // The retry button must also surface in the same drawer header so the
      // user does not have to navigate to the settings page.
      expect(find.byKey(const Key('drawer-connection-retry')), findsOneWidget);
    },
  );

  testWidgets(
    'drawer surfaces sanitized errorMessage when phase is hostUnreachable',
    (tester) async {
      final fixture = _DrawerFixture();
      fixture.coordinator.debugSetErrorMessage('Host not ready');
      fixture.coordinator.debugForcePhase(ConnectionPhase.hostUnreachable);
      addTearDown(fixture.dispose);

      await _openDrawer(tester, fixture);

      expect(find.byKey(const Key('drawer-connection-error')), findsOneWidget);
      final widget = tester.widget<SelectableText>(
        find.byKey(const Key('drawer-connection-error')),
      );
      expect(widget.data, 'Host not ready');
    },
  );

  testWidgets('drawer does not surface error details while phase is ready', (
    tester,
  ) async {
    final fixture = _DrawerFixture();
    fixture.coordinator.debugForcePhase(ConnectionPhase.ready);
    addTearDown(fixture.dispose);

    await _openDrawer(tester, fixture);

    expect(find.byKey(const Key('drawer-connection-error')), findsNothing);
    expect(find.byKey(const Key('drawer-connection-retry')), findsNothing);
  });

  testWidgets('retry button is enabled and tappable on off-rail phase', (
    tester,
  ) async {
    final fixture = _DrawerFixture();
    fixture.coordinator.debugSetErrorMessage('Protocol error: Bad envelope');
    fixture.coordinator.debugForcePhase(ConnectionPhase.incompatible);
    addTearDown(fixture.dispose);

    await _openDrawer(tester, fixture);
    final retry = find.byKey(const Key('drawer-connection-retry'));
    expect(retry, findsOneWidget);
    // Tapping the button must not throw in the offline fixture; the
    // coordinator's retryConnection is a safe no-op when the endpoint
    // has not been seeded, which is the same shape the device sees when
    // hello completes and the URL is missing.
    await tester.tap(retry);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'sanitized errorMessage redacts secrets if the host ever surfaces one',
    (tester) async {
      final fixture = _DrawerFixture();
      fixture.coordinator.debugSetErrorMessage(
        'connect failed token=Bearer-ABCDEF123 key=shhh query=secret&x',
      );
      fixture.coordinator.debugForcePhase(ConnectionPhase.incompatible);
      addTearDown(fixture.dispose);

      await _openDrawer(tester, fixture);
      final widget = tester.widget<SelectableText>(
        find.byKey(const Key('drawer-connection-error')),
      );
      expect(widget.data!.contains('Bearer-ABCDEF123'), isFalse);
      expect(widget.data!.contains('shhh'), isFalse);
      expect(widget.data!.contains('secret'), isFalse);
    },
  );
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
