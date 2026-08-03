import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/ui/shell/connection_panel.dart';

/// Connection/setup screen regression: when the user opens it via
/// "Change bridge address", the currently configured bridge URL must
/// be pre-filled into the endpoint field so they can confirm, edit,
/// or re-pair without retyping the host from memory. The pairing
/// secret (if any) is never surfaced.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'connection panel prefills endpoint from coordinator.endpoint when set',
    (tester) async {
      final fixture = _PanelFixture();
      fixture.coordinator.debugSetEndpoint(
        Uri.parse('https://pi.tailnet.ts.net'),
      );
      addTearDown(fixture.dispose);

      await _pump(tester, fixture);

      final field = find.byKey(const Key('endpoint-field'));
      expect(field, findsOneWidget);
      final widget = tester.widget<TextField>(field);
      expect(widget.controller!.text, 'https://pi.tailnet.ts.net');
    },
  );

  testWidgets(
    'connection panel prefills endpoint from coordinator.lastKnownEndpoint '
    'after forgetHost() (Change bridge address flow)',
    (tester) async {
      final fixture = _PanelFixture();
      // Simulate the user's last successful pair, then the forgetHost()
      // sequence performed by "Change bridge address". The endpoint field
      // must remember what they typed last time.
      final last = Uri.parse('https://pi.tailnet.ts.net');
      fixture.coordinator.debugSetEndpoint(last);
      await fixture.coordinator.connect(last.toString());
      await fixture.coordinator.forgetHost();

      await _pump(tester, fixture);

      final field = find.byKey(const Key('endpoint-field'));
      final widget = tester.widget<TextField>(field);
      expect(widget.controller!.text, 'https://pi.tailnet.ts.net');
    },
  );

  testWidgets(
    'connection panel renders current phase and sanitized errorMessage',
    (tester) async {
      final fixture = _PanelFixture();
      fixture.coordinator.debugSetErrorMessage('Protocol error: Bad envelope');
      fixture.coordinator.debugForcePhase(ConnectionPhase.incompatible);
      addTearDown(fixture.dispose);

      await _pump(tester, fixture);

      expect(find.byKey(const Key('connection-state')), findsOneWidget);
      final stateText = tester
          .widget<Text>(find.byKey(const Key('connection-state')))
          .data!;
      expect(stateText.contains('incompatible'), isTrue);
      final errorText = tester
          .widget<SelectableText>(find.byKey(const Key('connection-error')))
          .data;
      expect(errorText, 'Protocol error: Bad envelope');
    },
  );

  testWidgets(
    'sanitized endpoint label is exposed via coordinator static helper',
    (tester) async {
      expect(
        ConnectionCoordinator.sanitizedEndpointLabel(
          Uri.parse('https://user:token@pi.tailnet.ts.net/path?x=y'),
        ),
        'pi.tailnet.ts.net',
      );
      expect(
        ConnectionCoordinator.sanitizedEndpointLabel(
          Uri.parse('http://10.0.0.5:8788'),
        ),
        '10.0.0.5:8788',
      );
      expect(ConnectionCoordinator.sanitizedEndpointLabel(null), 'unset');
    },
  );

  testWidgets(
    'connection panel redacts secrets from a host-supplied errorMessage',
    (tester) async {
      final fixture = _PanelFixture();
      fixture.coordinator.debugSetErrorMessage(
        'connect failed token=Bearer-ABCDEF123 key=shhh',
      );
      fixture.coordinator.debugForcePhase(ConnectionPhase.incompatible);
      addTearDown(fixture.dispose);

      await _pump(tester, fixture);

      final widget = tester.widget<SelectableText>(
        find.byKey(const Key('connection-error')),
      );
      expect(widget.data!.contains('Bearer-ABCDEF123'), isFalse);
      expect(widget.data!.contains('shhh'), isFalse);
    },
  );
}

Future<void> _pump(WidgetTester tester, _PanelFixture fixture) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: ConnectionPanel(
            coordinator: fixture.coordinator,
            endpointController: fixture.controller,
          ),
        ),
      ),
    ),
  );
  await tester.pump();
}

final class _PanelFixture {
  _PanelFixture() {
    database = AppDatabase.withExecutor(NativeDatabase.memory());
    coordinator = ConnectionCoordinator(
      transport: const _OfflineTransport(),
      database: database,
    );
    coordinator.addListener(_refresh);
  }

  late final AppDatabase database;
  late final ConnectionCoordinator coordinator;
  final TextEditingController controller = TextEditingController();

  void _refresh() {}

  Future<void> dispose() async {
    coordinator.removeListener(_refresh);
    coordinator.dispose();
    controller.dispose();
    await database.close();
  }
}

final class _OfflineTransport implements BridgeTransport {
  const _OfflineTransport();

  @override
  Future<BridgeSocket> connect(Uri endpoint) =>
      throw UnsupportedError('not used by panel tests');

  @override
  Future<EndpointProbe> probe(Uri endpoint) =>
      throw UnsupportedError('not used by panel tests');
}
