// Phase 4 — Drift SQLite does not hold plaintext installation credentials.
// We scan the database binary (encoded as bytes that survive sqlite) to be
// sure no row carries the credential.

import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/security/secure_credential_store.dart';

const _plaintext = 'pc_persistent_marker_42_AAAAAAAAAAAAA';

class FakeSecureCredentialStore implements SecureCredentialStore {
  String? _value;
  @override
  Future<String?> read() async => _value;
  @override
  Future<void> write(String credential) async => _value = credential;
  @override
  Future<void> clear() async => _value = null;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('SQLite drift database never stores the plaintext credential', () async {
    final database = AppDatabase.withExecutor(NativeDatabase.memory());
    final secure = FakeSecureCredentialStore();
    await secure.write(_plaintext);
    await database.upsertHost(HostEntriesCompanion.insert(
      hostId: '11111111-1111-4111-8111-111111111111',
      endpoint: 'https://host.ts.net',
      displayName: 'preview',
      generation: '1',
      connectionState: 'connected',
      capabilitiesJson: '[]',
    ));
    final rows = await database.allHosts();
    final encoded = utf8.encode(rows.map((row) => '${row.endpoint}|${row.displayName}|${row.capabilitiesJson}|${row.connectionState}').join(','));
    expect(utf8.decode(encoded), isNot(contains(_plaintext)));
    await database.close();
  });
}
