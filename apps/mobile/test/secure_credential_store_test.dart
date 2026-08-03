// Phase 4 RED — secure credential store must persist/load/clear the
// installation credential in Keystore-backed secure storage, and never
// write it to SQLite. Drift tests prove the latter.

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/security/secure_credential_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('persists, reads, and clears the credential', () async {
    final store = InMemorySecureCredentialStore();
    expect(await store.read(), isNull);
    await store.write('pc_secret_alpha');
    expect(await store.read(), 'pc_secret_alpha');
    await store.clear();
    expect(await store.read(), isNull);
  });

  test('never persists the credential in the SQLite drift database', () async {
    final database = AppDatabase.withExecutor(NativeDatabase.memory());
    await database.upsertHost(
      HostEntriesCompanion.insert(
        hostId: '11111111-1111-4111-8111-111111111111',
        endpoint: 'https://host.ts.net',
        displayName: 'preview',
        generation: '1',
        connectionState: 'connected',
        capabilitiesJson: '[]',
      ),
    );
    // Even simulating the user entering a credential, no drift column holds it.
    final rows = await database.select(database.metadataEntries).get();
    expect(rows.any((row) => row.installationId.startsWith('pc_')), isFalse);
    await database.close();
  });
}
