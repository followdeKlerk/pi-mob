import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/ui/shell/global_search_sheet.dart';

final class _Transport implements BridgeTransport {
  @override
  Future<EndpointProbe> probe(Uri endpoint) async =>
      const EndpointProbe(statusCode: 200, ready: true, body: {});

  @override
  Future<BridgeSocket> connect(Uri endpoint) =>
      Future<BridgeSocket>.error(UnsupportedError('not used'));
}

void main() {
  testWidgets('explains covered local sources and ignores too-short input', (
    tester,
  ) async {
    final db = AppDatabase.withExecutor(NativeDatabase.memory());
    final coordinator = ConnectionCoordinator(
      transport: _Transport(),
      database: db,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: GlobalSearchSheet(coordinator: coordinator)),
      ),
    );
    expect(find.textContaining('chat names, your prompts'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('global-search-input')), 'a');
    await tester.pump();
    expect(find.textContaining('Type at least two characters'), findsOneWidget);
    coordinator.dispose();
    await db.close();
  });
}
