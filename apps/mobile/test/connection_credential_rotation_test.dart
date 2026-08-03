// Phase 4 — connection coordinator must surface `invalid_auth` and
// `re_pair_required` as an actionable `rePairRequired` phase, and
// `forgetHost` must clear the secure-store credential.

import 'dart:async';
import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pi_mob/src/connection/bridge_transport.dart';
import 'package:pi_mob/src/connection/connection_coordinator.dart';
import 'package:pi_mob/src/data/app_database.dart';
import 'package:pi_mob/src/security/secure_credential_store.dart';

class FakeSecureCredentialStore implements SecureCredentialStore {
  String? _value;
  @override
  Future<String?> read() async => _value;
  @override
  Future<void> write(String credential) async => _value = credential;
  @override
  Future<void> clear() async => _value = null;
}

class FakeBridgeTransport implements BridgeTransport {
  @override
  Future<EndpointProbe> probe(Uri endpoint) async => const EndpointProbe(
    statusCode: 200,
    ready: true,
    body: {'status': 'ready'},
  );

  @override
  Future<BridgeSocket> connect(Uri endpoint) async {
    final controller = StreamController<String>();
    final messages = controller.stream;
    Future<void> send(Map<String, Object?> message) async {
      if (message['type'] == 'hello') {
        // Phase 4 — simulate the bridge's `re_pair_required` reply so the
        // coordinator surfaces the new phase and the test can assert it.
        controller.add(
          jsonEncode(
            _envelope('error', {
              'code': 're_pair_required',
              'message': 'Re-pair your phone with the bridge to continue.',
              'retryable': false,
              'details': <String, Object?>{},
            }, requestId: message['requestId']),
          ),
        );
        await Future<void>.delayed(const Duration(milliseconds: 5));
        await controller.close();
      }
    }

    return _FakeBridgeSocket(messages, send);
  }
}

class _FakeBridgeSocket implements BridgeSocket {
  _FakeBridgeSocket(this._messages, this._send);
  final Stream<String> _messages;
  final Future<void> Function(Map<String, Object?>) _send;

  @override
  Stream<String> get messages => _messages;

  @override
  Future<void> send(Map<String, Object?> message) => _send(message);

  @override
  Future<void> close([int? code, String? reason]) async {}
}

Map<String, Object?> _envelope(
  String type,
  Map<String, Object?> payload, {
  Object? requestId,
}) {
  return <String, Object?>{
    'protocol': {'major': 1, 'minor': 0},
    'messageId': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    if (requestId != null) 'requestId': requestId,
    'type': type,
    'sentAt': '${DateTime.now().toUtc().toIso8601String().substring(0, 23)}Z',
    'payload': payload,
  };
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    're-pair required surfaces a dedicated phase and clears no credential implicitly',
    () async {
      final database = AppDatabase.withExecutor(NativeDatabase.memory());
      final secure = FakeSecureCredentialStore();
      await secure.write('pc_initial');
      String? rejectionReason;
      final transport = FakeBridgeTransport();
      final coordinator = ConnectionCoordinator(
        transport: transport,
        database: database,
        secureCredentialStore: secure,
        onAuthRejection: (reason) => rejectionReason = reason,
      );
      await coordinator.initialize(autoConnect: false);
      await coordinator.connect('https://host.ts.net');
      // Yield long enough for the hello path to complete.
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(coordinator.phase, ConnectionPhase.rePairRequired);
      expect(rejectionReason, isNotNull);
      expect(await secure.read(), 'pc_initial');
      await database.close();
    },
  );

  test('forgetHost clears the secure-store credential', () async {
    final database = AppDatabase.withExecutor(NativeDatabase.memory());
    final secure = FakeSecureCredentialStore();
    await secure.write('pc_secret');
    final transport = FakeBridgeTransport();
    final coordinator = ConnectionCoordinator(
      transport: transport,
      database: database,
      secureCredentialStore: secure,
    );
    await coordinator.initialize(autoConnect: false);
    expect(await secure.read(), 'pc_secret');
    await coordinator.forgetHost();
    expect(await secure.read(), isNull);
    await database.close();
  });
}
