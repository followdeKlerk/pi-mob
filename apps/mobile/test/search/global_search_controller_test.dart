import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/search/global_search_controller.dart';
import 'package:pi_mob/src/search/search_hits.dart';

final class _Transport implements BridgeTransport {
  @override
  Future<EndpointProbe> probe(Uri endpoint) async =>
      const EndpointProbe(statusCode: 200, ready: true, body: {});

  @override
  Future<BridgeSocket> connect(Uri endpoint) =>
      Future<BridgeSocket>.error(UnsupportedError('not used'));
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late AppDatabase db;
  late ConnectionCoordinator coordinator;
  late GlobalSearchController controller;
  setUp(() {
    db = AppDatabase.withExecutor(NativeDatabase.memory());
    coordinator = ConnectionCoordinator(transport: _Transport(), database: db);
    controller = GlobalSearchController(
      coordinator: coordinator,
      database: db,
      debounce: Duration.zero,
    );
  });
  tearDown(() async {
    controller.dispose();
    coordinator.dispose();
    await db.close();
  });

  test('empty and too-short queries never start a database query', () async {
    controller.setQuery('a');
    expect(controller.phase, GlobalSearchPhase.idle);
    expect((await controller.searchNow()).hits, isEmpty);
  });

  test('cancel advances epoch and keeps controller reusable', () async {
    controller.setQuery('search');
    controller.cancel();
    expect(controller.phase, GlobalSearchPhase.cancelled);
    controller.reset();
    expect(controller.phase, GlobalSearchPhase.idle);
  });

  test('global limits are explicit', () {
    expect(kGlobalSearchHitCap, 80);
    expect(kGlobalSearchMinQueryLength, 2);
    expect(kGlobalSearchDebounce, const Duration(milliseconds: 120));
  });
}
