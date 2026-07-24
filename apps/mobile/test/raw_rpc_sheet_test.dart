import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/ui/shell/raw_rpc_sheet.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('JSON editor sends raw RPC and displays the response', (tester) async {
    final database = AppDatabase.withExecutor(NativeDatabase.memory());
    final coordinator = ConnectionCoordinator(
      transport: const _OfflineTransport(),
      database: database,
    );
    addTearDown(() async {
      coordinator.dispose();
      await database.close();
    });
    Map<String, Object?>? sentCommand;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: RawRpcSheet(
            coordinator: coordinator,
            sessionId: '22222222-2222-4222-8222-222222222222',
            sendForTest: (command) async {
              sentCommand = command;
              return <String, Object?>{
                'type': 'response',
                'command': 'get_state',
                'success': true,
                'data': <String, Object?>{'state': 'idle'},
              };
            },
          ),
        ),
      ),
    );
    await tester.enterText(
      find.byKey(const Key('raw-rpc-command-editor')),
      '{"type":"get_state"}',
    );
    await tester.tap(find.byKey(const Key('raw-rpc-send')));
    await tester.pump();

    expect(sentCommand, <String, Object?>{'type': 'get_state'});
    final responseField = tester.widget<TextField>(
      find.byKey(const Key('raw-rpc-response')),
    );
    expect(responseField.controller?.text, contains('"success": true'));
    expect(responseField.controller?.text, contains('"state": "idle"'));
  });
}

final class _OfflineTransport implements BridgeTransport {
  const _OfflineTransport();

  @override
  Future<BridgeSocket> connect(Uri endpoint) =>
      throw UnsupportedError('not used');

  @override
  Future<EndpointProbe> probe(Uri endpoint) =>
      throw UnsupportedError('not used');
}
