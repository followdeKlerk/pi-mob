import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/ui/shell/composer.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Control+Enter sends from the focused composer', (tester) async {
    final database = AppDatabase.withExecutor(NativeDatabase.memory());
    final coordinator = ConnectionCoordinator(
      transport: const _OfflineTransport(),
      database: database,
    );
    final controller = TextEditingController(text: 'Send this');
    var sends = 0;
    addTearDown(() async {
      controller.dispose();
      coordinator.dispose();
      await database.close();
    });

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Composer(
            coordinator: coordinator,
            draftController: controller,
            onOpenDialog: () {},
            onSubmit: (_) async => sends += 1,
          ),
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('draft-field')));
    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyDownEvent(LogicalKeyboardKey.enter);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.enter);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);

    expect(sends, 1);
  });
}

final class _OfflineTransport implements BridgeTransport {
  const _OfflineTransport();

  @override
  Future<BridgeSocket> connect(Uri endpoint) => throw StateError('offline');

  @override
  Future<EndpointProbe> probe(Uri endpoint) async => const EndpointProbe(
    statusCode: 503,
    ready: false,
    body: {'status': 'not_ready'},
  );
}
